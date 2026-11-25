/**
 * The URLs a stylesheet loads, read the way a browser reads them.
 *
 * A template's stylesheet is also loaded on its checkout pages, where
 * nothing may load from another site. So every
 * `@import` and every `url()` in it must stay on the store's own origin:
 * a relative or root-relative URL, a `data:` URI, or a fragment (`#id`).
 *
 * The stylesheet is tokenized as CSS Syntax Level 3 describes, rather than
 * searched with patterns, so that comments, quoting, escapes (`\75 rl(`,
 * `https\:\/\/…`) and whitespace are understood exactly as a browser
 * understands them.
 */

/** Where in a stylesheet a URL was written. */
export type StylesheetUrlSource = 'import' | 'url' | 'image-set'

export interface StylesheetUrl {
  /** The URL with its escapes resolved. */
  url: string
  /** 1-based line of the token holding the URL. */
  line: number
  source: StylesheetUrlSource
}

type Token =
  | { type: 'ws' | 'comment'; start: number }
  | { type: 'string'; value: string; start: number }
  | { type: 'bad-string' | 'bad-url'; start: number }
  | { type: 'url'; value: string; start: number }
  | { type: 'function' | 'at-keyword' | 'ident' | 'hash'; name: string; start: number }
  | { type: 'number'; start: number }
  | { type: 'delim'; value: string; start: number }

const isNewline = (c: string | undefined) => c === '\n' || c === '\r' || c === '\f'
const isWhitespace = (c: string | undefined) => c === ' ' || c === '\t' || isNewline(c)
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c)
const isNameStart = (c: string | undefined) => c !== undefined && (/^[a-zA-Z_]$/.test(c) || c.charCodeAt(0) >= 0x80)
const isName = (c: string | undefined) => isNameStart(c) || isDigit(c) || c === '-'
const isNonPrintable = (c: string | undefined) => {
  if (c === undefined) return false
  const code = c.charCodeAt(0)
  return code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f) || code === 0x7f
}

/** Splits CSS into tokens. Each token's `start` is the index of its first code point. */
export function tokenize(css: string): Token[] {
  // Code points, so that an escape or a non-BMP character is one step.
  const s = Array.from(css)
  const tokens: Token[] = []
  let i = 0

  const validEscape = (at: number) => s[at] === '\\' && s[at + 1] !== undefined && !isNewline(s[at + 1])
  const startsIdent = (at: number) => {
    if (s[at] === '-') return isNameStart(s[at + 1]) || s[at + 1] === '-' || validEscape(at + 1)
    if (isNameStart(s[at])) return true
    return validEscape(at)
  }
  const startsNumber = (at: number) => {
    if (s[at] === '+' || s[at] === '-') return isDigit(s[at + 1]) || (s[at + 1] === '.' && isDigit(s[at + 2]))
    if (s[at] === '.') return isDigit(s[at + 1])
    return isDigit(s[at])
  }

  /** Consumes the escape whose backslash is at i - 1. */
  const consumeEscape = (): string => {
    const c = s[i]
    if (c === undefined) return '�'
    if (isHex(c)) {
      let hex = ''
      while (hex.length < 6 && isHex(s[i])) hex += s[i++]
      if (s[i] === '\r' && s[i + 1] === '\n') i += 2
      else if (isWhitespace(s[i])) i++
      const code = Number.parseInt(hex, 16)
      return code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff ? '�' : String.fromCodePoint(code)
    }
    i++
    return c
  }

  const consumeName = (): string => {
    let name = ''
    for (;;) {
      if (isName(s[i])) name += s[i++]
      else if (validEscape(i)) {
        i++
        name += consumeEscape()
      } else return name
    }
  }

  const consumeString = (quote: string, start: number): Token => {
    let value = ''
    for (;;) {
      const c = s[i]
      if (c === undefined) return { type: 'string', value, start }
      if (c === quote) {
        i++
        return { type: 'string', value, start }
      }
      if (isNewline(c)) return { type: 'bad-string', start }
      if (c === '\\') {
        if (s[i + 1] === undefined) i++
        else if (isNewline(s[i + 1])) i += s[i + 1] === '\r' && s[i + 2] === '\n' ? 3 : 2
        else {
          i++
          value += consumeEscape()
        }
        continue
      }
      value += c
      i++
    }
  }

  const consumeBadUrlRemnants = () => {
    while (i < s.length && s[i] !== ')') {
      if (validEscape(i)) {
        i++
        consumeEscape()
      } else i++
    }
    if (s[i] === ')') i++
  }

  /** Consumes an unquoted url( … ) whose "url(" ended at i. */
  const consumeUrl = (start: number): Token => {
    let value = ''
    while (isWhitespace(s[i])) i++
    for (;;) {
      const c = s[i]
      if (c === undefined) return { type: 'url', value, start }
      if (c === ')') {
        i++
        return { type: 'url', value, start }
      }
      if (isWhitespace(c)) {
        while (isWhitespace(s[i])) i++
        if (s[i] === ')' || s[i] === undefined) {
          if (s[i] === ')') i++
          return { type: 'url', value, start }
        }
        consumeBadUrlRemnants()
        return { type: 'bad-url', start }
      }
      if (c === '"' || c === "'" || c === '(' || isNonPrintable(c)) {
        consumeBadUrlRemnants()
        return { type: 'bad-url', start }
      }
      if (c === '\\') {
        if (validEscape(i)) {
          i++
          value += consumeEscape()
          continue
        }
        consumeBadUrlRemnants()
        return { type: 'bad-url', start }
      }
      value += c
      i++
    }
  }

  const consumeIdentLike = (start: number): Token => {
    const name = consumeName()
    if (name.toLowerCase() === 'url' && s[i] === '(') {
      i++
      let ahead = i
      while (isWhitespace(s[ahead]) && isWhitespace(s[ahead + 1])) ahead++
      const next = isWhitespace(s[ahead]) ? s[ahead + 1] : s[ahead]
      if (next === '"' || next === "'") return { type: 'function', name, start }
      return consumeUrl(start)
    }
    if (s[i] === '(') {
      i++
      return { type: 'function', name, start }
    }
    return { type: 'ident', name, start }
  }

  const consumeNumeric = (start: number): Token => {
    if (s[i] === '+' || s[i] === '-') i++
    while (isDigit(s[i])) i++
    if (s[i] === '.' && isDigit(s[i + 1])) {
      i++
      while (isDigit(s[i])) i++
    }
    if ((s[i] === 'e' || s[i] === 'E') && (isDigit(s[i + 1]) || ((s[i + 1] === '+' || s[i + 1] === '-') && isDigit(s[i + 2])))) {
      i += 2
      while (isDigit(s[i])) i++
    }
    // A unit is part of the number: "2url(" is a dimension and a "(".
    if (startsIdent(i)) consumeName()
    else if (s[i] === '%') i++
    return { type: 'number', start }
  }

  while (i < s.length) {
    const start = i
    const c = s[i]!
    if (c === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i = Math.min(i + 2, s.length)
      tokens.push({ type: 'comment', start })
    } else if (isWhitespace(c)) {
      while (isWhitespace(s[i])) i++
      tokens.push({ type: 'ws', start })
    } else if (c === '"' || c === "'") {
      i++
      tokens.push(consumeString(c, start))
    } else if (c === '#' && (isName(s[i + 1]) || validEscape(i + 1))) {
      i++
      tokens.push({ type: 'hash', name: consumeName(), start })
    } else if (c === '@' && startsIdent(i + 1)) {
      i++
      tokens.push({ type: 'at-keyword', name: consumeName(), start })
    } else if (startsNumber(i)) {
      tokens.push(consumeNumeric(start))
    } else if (startsIdent(i)) {
      tokens.push(consumeIdentLike(start))
    } else {
      i++
      tokens.push({ type: 'delim', value: c, start })
    }
  }

  return tokens
}

/** 1-based line of each code-point index, counting \r\n, \r, \n and \f as one line break each. */
function lineIndex(css: string): (at: number) => number {
  const s = Array.from(css)
  const breaks: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\r' && s[i + 1] === '\n') continue
    if (isNewline(s[i])) breaks.push(i)
  }
  return (at) => {
    let lo = 0
    let hi = breaks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (breaks[mid]! < at) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
}

/** Functions whose quoted-string argument is a URL. `src()` is the quoted form of `url()`. */
const URL_FUNCTIONS = new Set(['url', 'src'])
/** Functions whose bare string arguments are image URLs. */
const IMAGE_SET_FUNCTIONS = new Set(['image-set', '-webkit-image-set'])
/** Stands for a url() or src() that is the target of an @import. */
const IMPORT_URL = '\0import'

/**
 * Every URL a stylesheet loads: each `@import` target, each `url()` and
 * `src()`, and each string in `image-set()`. The namespace URL of
 * `@namespace` names a namespace and loads nothing, so it is left out.
 */
export function stylesheetUrls(css: string): StylesheetUrl[] {
  const tokens = tokenize(css).filter((t) => t.type !== 'comment')
  const lineAt = lineIndex(css)
  const out: StylesheetUrl[] = []
  /** Open functions and parentheses, innermost last; "" for a bare "(". */
  const open: string[] = []
  /** The at-rule whose prelude is being read, lowercase, or "" outside one. */
  let atRule = ''
  /** True right after @import and its whitespace, where a string is the target. */
  let importTarget = false

  for (const t of tokens) {
    if (t.type === 'ws') continue
    const expectingImport = importTarget
    importTarget = false

    switch (t.type) {
      case 'at-keyword':
        atRule = t.name.toLowerCase()
        importTarget = atRule === 'import'
        break
      case 'function': {
        const name = t.name.toLowerCase()
        open.push(expectingImport && URL_FUNCTIONS.has(name) ? IMPORT_URL : name)
        break
      }
      case 'delim':
        if (t.value === '(') open.push('')
        else if (t.value === ')') open.pop()
        else if ((t.value === ';' || t.value === '{' || t.value === '}') && open.length === 0) atRule = ''
        break
      case 'url':
        if (atRule !== 'namespace') out.push({ url: t.value, line: lineAt(t.start), source: expectingImport ? 'import' : 'url' })
        break
      case 'string': {
        if (atRule === 'namespace') break
        const inner = open[open.length - 1]
        if (expectingImport || inner === IMPORT_URL) out.push({ url: t.value, line: lineAt(t.start), source: 'import' })
        else if (inner !== undefined && URL_FUNCTIONS.has(inner)) out.push({ url: t.value, line: lineAt(t.start), source: 'url' })
        else if (inner !== undefined && IMAGE_SET_FUNCTIONS.has(inner)) out.push({ url: t.value, line: lineAt(t.start), source: 'image-set' })
        break
      }
    }
  }
  return out
}

/**
 * Whether a URL stays on the origin the stylesheet is served from: a
 * relative or root-relative URL, a `data:` URI, or a fragment. Tabs and
 * newlines are dropped and surrounding control characters and spaces
 * trimmed first, as a browser's URL parser does, and a backslash counts as
 * a slash, as it does in an http(s) URL.
 */
export function isSameOriginUrl(url: string): boolean {
  const cleaned = url.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
  if (cleaned.startsWith('#')) return true
  if (/^[/\\]{2}/.test(cleaned)) return false
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned)
  if (scheme) return scheme[1]!.toLowerCase() === 'data'
  return true
}

export interface StylesheetFinding {
  line: number
  url: string
  message: string
}

/** The last path segment of a URL when it looks like a file name, for a suggested replacement. */
function fileName(url: string): string | undefined {
  const path = url.replace(/[?#].*$/, '').replace(/\\/g, '/')
  const last = path.slice(path.lastIndexOf('/') + 1)
  return /^[\w.-]+\.[A-Za-z0-9]+$/.test(last) ? last : undefined
}

/** What a template author reads for one URL that leaves the store's origin. */
export function describeExternalUrl(found: StylesheetUrl): string {
  const quoted = JSON.stringify(found.url)
  const written = found.source === 'import' ? `@import ${quoted}` : found.source === 'image-set' ? `image-set(${quoted})` : `url(${quoted})`
  const name = fileName(found.url)
  const example = name ? `, such as ${found.source === 'import' ? `@import "./${name}"` : `url("/${name}")`}` : ''
  const font = found.source === 'import' ? ' For a web font, put its font files in public/ and declare them with @font-face.' : ''
  return (
    `${written} loads from another site. The stylesheet is also used on your checkout pages, ` +
    `where nothing may load from another site: put the file in public/ and reference it with a relative or root-relative URL${example}.${font}`
  )
}

/** Every URL in a stylesheet that would load from another site, with what to do instead. */
export function externalStylesheetUrls(css: string): StylesheetFinding[] {
  return stylesheetUrls(css)
    .filter((u) => !isSameOriginUrl(u.url))
    .map((u) => ({ line: u.line, url: u.url, message: describeExternalUrl(u) }))
}
