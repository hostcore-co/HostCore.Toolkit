import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { crc32 } from '../zip'
import { hct } from './host'

const REPO = join(import.meta.dir, '..', '..')
const TMP = join(REPO, '.test-tmp', `push-${process.pid}`)
const TEMPLATE = join(TMP, 'tokens')
const TOKEN = 'test-token-123'

/** Reads a zip's entries through its central directory. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const buf = Buffer.from(bytes)
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const out: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    const nameLength = buf.readUInt16LE(at + 28)
    const extra = buf.readUInt16LE(at + 30)
    const comment = buf.readUInt16LE(at + 32)
    const offset = buf.readUInt32LE(at + 42)
    const size = buf.readUInt32LE(at + 20)
    const crc = buf.readUInt32LE(at + 16)
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const dataStart = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28)
    const data = inflateRawSync(buf.subarray(dataStart, dataStart + size))
    expect(crc32(data)).toBe(crc)
    out[name] = data.toString('utf8')
    at += 46 + nameLength + extra + comment
  }
  return out
}

interface Received {
  method: string
  path: string
  authorization: string | null
  organisation: string | null
  form?: { tag: string; changelog: string; filename: string; type: string; files: Record<string, string> }
}

let requests: Received[] = []
let uploadAnswer: { status: number; body: unknown } = { status: 201, body: {} }
let server: ReturnType<typeof Bun.serve>

function submission(status: string, checks: Array<{ id: string; title: string; status: string; detail: string }>, buildLog = '') {
  return {
    data: [
      {
        type: 'submission',
        id: 'sub_1',
        attributes: { id: 'sub_1', module_id: 'mod_acme', tag: '0.2.0', status, checks, ...(buildLog ? { build_log: buildLog } : {}) },
        relationships: null,
      },
    ],
  }
}

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true })
  await mkdir(TMP, { recursive: true })
  await cp(join(REPO, 'examples', 'minimal'), TEMPLATE, { recursive: true })
  await writeFile(
    join(TEMPLATE, 'package.json'),
    JSON.stringify({ name: 'acme-tokens', private: true, dependencies: { react: '~19.3.1', 'react-dom': '~19.3.1' }, devDependencies: { vite: '^8.3.8', '@vitejs/plugin-react': '^6.3.0' } }),
  )
  await mkdir(join(TEMPLATE, 'public', 'images'), { recursive: true })
  await writeFile(join(TEMPLATE, 'public', 'images', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  // None of these are source: they stay out of the upload.
  await writeFile(join(TEMPLATE, '.env'), 'SECRET=1')
  await mkdir(join(TEMPLATE, 'node_modules', 'left-pad'), { recursive: true })
  await writeFile(join(TEMPLATE, 'node_modules', 'left-pad', 'index.js'), '')
  await mkdir(join(TEMPLATE, 'dist'), { recursive: true })
  await writeFile(join(TEMPLATE, 'dist', 'manifest.json'), '{}')

  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url)
      const received: Received = {
        method: request.method,
        path: url.pathname,
        authorization: request.headers.get('authorization'),
        organisation: request.headers.get('x-organisation'),
      }
      requests.push(received)
      if (url.pathname === '/api/v1/developer/modules/mod_acme/submissions') {
        const form = await request.formData()
        const archive = form.get('archive') as File
        received.form = {
          tag: String(form.get('tag')),
          changelog: String(form.get('changelog')),
          filename: archive.name,
          type: archive.type,
          files: unzip(new Uint8Array(await archive.arrayBuffer())),
        }
        return Response.json(uploadAnswer.body, { status: uploadAnswer.status })
      }
      if (url.pathname === '/api/v1/developer/modules/mod_acme/submissions/sub_1/preview') {
        return Response.json({
          data: [{ type: 'template_preview', id: 'p1', attributes: { module_id: 'mod_acme', url: 'https://preview.example.com/p/abc', expires_at: '2026-11-17T10:00:00Z', created_at: '2026-11-16T10:00:00Z' } }],
        })
      }
      return Response.json({ error: { code: 'not_found', message: 'no such listing' } }, { status: 404 })
    },
  })
})

afterAll(async () => {
  server.stop(true)
  await rm(TMP, { recursive: true, force: true })
})

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { HOSTCORE_API_URL: `http://127.0.0.1:${server.port}`, HOSTCORE_TOKEN: TOKEN, HOSTCORE_LISTING: '', HOSTCORE_ORG: '', ...extra }
}

describe('hct push', () => {
  it('builds, uploads the source with its tag and changelog, and prints the checks and the preview', async () => {
    requests = []
    uploadAnswer = {
      status: 201,
      body: submission('ready', [
        { id: 'render', title: 'Renders every page', status: 'pass', detail: '' },
        { id: 'size', title: 'Bundle size', status: 'warn', detail: 'client JavaScript is large' },
      ]),
    }
    const result = await hct(['push', TEMPLATE, '--listing', 'mod_acme', '--tag', '0.2.0', '--changelog', 'New colours', '--org', 'org_acme'], undefined, env())
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/v1/developer/modules/mod_acme/submissions',
      'POST /api/v1/developer/modules/mod_acme/submissions/sub_1/preview',
    ])
    for (const r of requests) {
      expect(r.authorization).toBe(`Bearer ${TOKEN}`)
      expect(r.organisation).toBe('org_acme')
    }
    const form = requests[0]!.form!
    expect(form).toMatchObject({ tag: '0.2.0', changelog: 'New colours', filename: 'minimal-0.2.0.zip', type: 'application/zip' })
    expect(Object.keys(form.files).sort()).toEqual(['package.json', 'public/images/mark.svg', 'template.json'])
    expect(JSON.parse(form.files['template.json']!).id).toBe('minimal')
    expect(result.stdout).toContain('version 0.2.0 uploaded (submission sub_1): ready')
    expect(result.stdout).toContain('  pass  Renders every page\n')
    expect(result.stdout).toContain('  warn  Bundle size: client JavaScript is large\n')
    expect(result.stdout).toContain('preview: https://preview.example.com/p/abc (until 2026-11-17T10:00:00Z)')
  }, 30_000)

  it('takes the tag from template.json and the listing from the environment', async () => {
    requests = []
    uploadAnswer = { status: 201, body: submission('ready', []) }
    const result = await hct(['push', TEMPLATE], undefined, env({ HOSTCORE_LISTING: 'mod_acme' }))
    expect(result.code).toBe(0)
    expect(requests[0]!.form!.tag).toBe('1.0.0')
    expect(requests[0]!.organisation).toBeNull()
  }, 30_000)

  it('exits 1 when the platform could not build the version or a check failed', async () => {
    uploadAnswer = { status: 201, body: submission('build_failed', [], 'error: something did not compile') }
    const failed = await hct(['push', TEMPLATE, '--listing', 'mod_acme'], undefined, env())
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('the platform could not build this version:\nerror: something did not compile')

    uploadAnswer = { status: 201, body: submission('ready', [{ id: 'render', title: 'Renders every page', status: 'fail', detail: 'home did not render' }]) }
    const check = await hct(['push', TEMPLATE, '--listing', 'mod_acme'], undefined, env())
    expect(check.code).toBe(1)
    expect(check.stdout).toContain('  fail  Renders every page: home did not render')
    expect(check.stderr).toContain('1 check(s) failed')
  }, 30_000)

  it('explains a refused token and an unknown listing', async () => {
    uploadAnswer = { status: 401, body: { error: { code: 'login_required', message: 'you must login to access this' } } }
    const refused = await hct(['push', TEMPLATE, '--listing', 'mod_acme'], undefined, env())
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('the upload failed (401 login_required): you must login to access this. Check HOSTCORE_TOKEN')

    const unknown = await hct(['push', TEMPLATE, '--listing', 'mod_other'], undefined, env())
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('(404 not_found): no such listing. Check the listing id')
  }, 30_000)

  it('refuses to start without its configuration or a tag the platform accepts', async () => {
    const missing = await hct(['push', TEMPLATE], undefined, { HOSTCORE_API_URL: '', HOSTCORE_TOKEN: '', HOSTCORE_LISTING: '' })
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('push needs --api <url> or HOSTCORE_API_URL, HOSTCORE_TOKEN, --listing <id> or HOSTCORE_LISTING')
    const tag = await hct(['push', TEMPLATE, '--listing', 'mod_acme', '--tag', '1.0.0-beta.1'], undefined, env())
    expect(tag.code).toBe(1)
    expect(tag.stderr).toContain('the version tag must look like 1.2.3')
  })

  it('uploads a template without a package.json as it is, and reports what the platform answers', async () => {
    requests = []
    uploadAnswer = { status: 422, body: { error: { code: 'invalid_archive', message: 'the archive has no package.json' } } }
    const bare = await hct(['push', join(REPO, 'examples', 'minimal'), '--listing', 'mod_acme', '--tag', '0.3.0'], undefined, env())
    expect(bare.code).toBe(1)
    expect(bare.stdout).toContain('has no package.json, so nothing is installed to build it with here; uploading it as it is')
    expect(bare.stdout).not.toContain('building')
    expect(bare.stderr).toContain('the upload failed (422 invalid_archive): the archive has no package.json')
    expect(requests.map((r) => r.path)).toEqual(['/api/v1/developer/modules/mod_acme/submissions'])
    expect(Object.keys(requests[0]!.form!.files)).toEqual(['template.json'])

    requests = []
    uploadAnswer = { status: 201, body: submission('ready', [{ id: 'tokens', title: 'Design tokens', status: 'pass', detail: '' }]) }
    const accepted = await hct(['push', join(REPO, 'examples', 'minimal'), '--listing', 'mod_acme', '--tag', '0.3.0'], undefined, env())
    expect(accepted.code).toBe(0)
    expect(accepted.stdout).toContain('version 0.3.0 uploaded (submission sub_1): ready')
    expect(accepted.stdout).toContain('preview: https://preview.example.com/p/abc')
  })
})
