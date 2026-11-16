import { describe, expect, it } from 'bun:test'
import { externalStylesheetUrls, isSameOriginUrl, stylesheetUrls, tokenize } from '../stylesheet'

const urls = (css: string) => stylesheetUrls(css).map((u) => u.url)
const external = (css: string) => externalStylesheetUrls(css).map((f) => `${f.line} ${f.url}`)

describe('stylesheet URLs', () => {
  it('finds url() unquoted and quoted, with surrounding whitespace', () => {
    expect(urls(`a { background: url(a.png); b: url( "b.png" ); c: url(\n  'c.png'\n) }`)).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('finds every form of @import, in any case', () => {
    expect(
      urls(`@import "a.css"; @import 'b.css' layer(x); @IMPORT url(c.css); @import url("d.css") supports(display: grid); @import"e.css";`),
    ).toEqual(['a.css', 'b.css', 'c.css', 'd.css', 'e.css'])
    expect(stylesheetUrls('@import url("d.css");')[0]!.source).toBe('import')
  })

  it('finds image-set() strings and src(), but not other strings', () => {
    expect(urls(`a { b: image-set("x.png" 1x, url(y.png) 2x type("image/png")); c: -webkit-image-set('z.png' 1x); d: src("w.png"); content: "q.png" }`)).toEqual([
      'x.png',
      'y.png',
      'z.png',
      'w.png',
    ])
  })

  it('ignores comments, strings that merely contain url(, and the @namespace URL', () => {
    const css = `/* url(https://a.example.com/x.png) @import "https://b.example.com"; */
a::before { content: "url(https://c.example.com/x.png)"; }
@namespace svg url(http://www.w3.org/2000/svg);
@namespace "http://www.w3.org/1999/xhtml";
b { background: url(ok.png) }`
    expect(urls(css)).toEqual(['ok.png'])
  })

  it('resolves escapes in function names, at-keywords and URLs', () => {
    expect(urls(String.raw`a { b: \75 rl(https\:\/\/a.example.com/x.png); c: U\52 L("\68 ttps://b.example.com/y.png") } @\69mport "https://c.example.com/z.css";`)).toEqual([
      'https://a.example.com/x.png',
      'https://b.example.com/y.png',
      'https://c.example.com/z.css',
    ])
  })

  it('keeps a comment inside an unquoted url() as part of the URL, as a browser does', () => {
    expect(urls('a { b: url(/*x*/https://a.example.com) }')).toEqual(['/*x*/https://a.example.com'])
  })

  it('does not read a dimension followed by ( as url(', () => {
    expect(urls('a { width: 2url(https://a.example.com) }')).toEqual([])
  })

  it('drops a bad url and a bad string, which a browser ignores', () => {
    expect(urls(`a { b: url(https://a.example.com/x y.png); c: url('https://b.example.com/\n) }`)).toEqual([])
  })

  it('reports the line of each URL, counting \\r\\n, \\r and \\f as one line break', () => {
    const css = 'a {}\r\nb {}\rc { d: url(https://a.example.com/x.png) }\fe { f: url(//b.example.com/y.png) }\n'
    expect(external(css)).toEqual(['3 https://a.example.com/x.png', '4 //b.example.com/y.png'])
  })

  it('handles characters outside the BMP', () => {
    expect(urls('a { content: "😀"; b: url(😀.png) }')).toEqual(['😀.png'])
  })

  it('tokenizes to the end of an unterminated comment, string or url', () => {
    expect(tokenize('/* open').map((t) => t.type)).toEqual(['comment'])
    expect(urls('a { b: url("x.png')).toEqual(['x.png'])
    expect(urls('a { b: url(x.png')).toEqual(['x.png'])
  })
})

describe('same-origin URLs', () => {
  it('allows relative, root-relative, data: and fragment URLs', () => {
    for (const url of ['a.png', './a.png', '../a.png', '/a.png', '', 'tailwindcss', 'data:image/png;base64,AAAA', 'DATA:text/plain,x', '#clip', '?v=1']) {
      expect(isSameOriginUrl(url)).toBe(true)
    }
  })

  it('refuses absolute and protocol-relative URLs, however they are spelled', () => {
    for (const url of [
      'https://a.example.com/x.png',
      'HTTP://a.example.com',
      'ftp://a.example.com/x',
      'blob:https://a.example.com/1',
      '//a.example.com/x.png',
      '\\\\a.example.com\\x.png',
      '/\\a.example.com/x.png',
      ' https://a.example.com',
      'ht\ttps://a.example.com',
      '\n//a.example.com',
    ]) {
      expect(isSameOriginUrl(url)).toBe(false)
    }
  })

  it('says what was written and what to do instead', () => {
    const [url] = externalStylesheetUrls('a { b: url("https://images.example.com/hero.jpg") }')
    expect(url!.message).toBe(
      'url("https://images.example.com/hero.jpg") loads from another site. The stylesheet is also used on the platform\'s checkout and sign-in pages, ' +
        'where nothing may load from another site: put the file in public/ and reference it with a relative or root-relative URL, such as url("/hero.jpg").',
    )
    const [imported] = externalStylesheetUrls('@import "https://fonts.example.com/css2?family=Inter";')
    expect(imported!.message).toStartWith('@import "https://fonts.example.com/css2?family=Inter" loads from another site.')
    expect(imported!.message).toEndWith('For a web font, put its font files in public/ and declare them with @font-face.')
  })
})
