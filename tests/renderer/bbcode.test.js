// @vitest-environment happy-dom
// ^ DOMPurify needs a DOM (document, Element) to run. happy-dom gives us a
// lightweight browser env for this file only, so the rest of the unit tests
// keep running under the default `node` environment.

import { describe, it, expect } from 'vitest'
import { bbcodeToHtml, _testInternals } from '../../src/renderer/src/utils/bbcode.js'

const { safeUrl, extractYoutubeId, bbSizeToEm, bbcodeToRawHtml, decodeHtmlEntities } = _testInternals

describe('bbcode decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    expect(decodeHtmlEntities('&lt;br /&gt;')).toBe('<br />')
    expect(decodeHtmlEntities('&quot;hi&quot;')).toBe('"hi"')
    expect(decodeHtmlEntities('a&apos;b')).toBe("a'b")
  })
  it('decodes numeric entities (backslash, emoji)', () => {
    expect(decodeHtmlEntities('C:&#92;foo')).toBe('C:\\foo')
    expect(decodeHtmlEntities('&#128512;')).toBe('😀')
  })
  it('decodes hex entities', () => {
    expect(decodeHtmlEntities('&#x5C;')).toBe('\\')
    expect(decodeHtmlEntities('&#X5c;')).toBe('\\')
  })
  it('decodes &nbsp; to a non-breaking space', () => {
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a\u00A0b')
  })
  it('handles &amp; last so double-encoded input survives', () => {
    // &amp;lt; should render as literal "&lt;" text — decoding must leave
    // exactly one layer alone.
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;')
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;')
  })
  it('passes through when nothing to decode', () => {
    expect(decodeHtmlEntities('plain text')).toBe('plain text')
  })
  it('realistic Nexus description payload', () => {
    const raw = 'Extract here! &lt;br /&gt;*:&#92;SteamLibrary&#92;steamapps'
    expect(decodeHtmlEntities(raw)).toBe('Extract here! <br />*:\\SteamLibrary\\steamapps')
  })
})

describe('bbcode safeUrl', () => {
  it('allows http, https, mailto', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com')
    expect(safeUrl('http://example.com')).toBe('http://example.com')
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
  })
  it('rewrites javascript: to #', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#')
    expect(safeUrl('JavaScript:alert(1)')).toBe('#')
  })
  it('rewrites data: and file: to #', () => {
    expect(safeUrl('data:text/html,<script>')).toBe('#')
    expect(safeUrl('file:///c:/secret')).toBe('#')
  })
  it('auto-prefixes bare domains with https', () => {
    expect(safeUrl('example.com/foo')).toBe('https://example.com/foo')
  })
  it('returns # for empty/null', () => {
    expect(safeUrl('')).toBe('#')
    expect(safeUrl(null)).toBe('#')
  })
})

describe('bbcode extractYoutubeId', () => {
  it('parses standard watch URLs', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses shortened youtu.be URLs', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses embed URLs', () => {
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('accepts bare 11-char IDs', () => {
    expect(extractYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for garbage', () => {
    expect(extractYoutubeId('hello')).toBeNull()
    expect(extractYoutubeId('')).toBeNull()
  })
})

describe('bbcode bbSizeToEm', () => {
  it('clamps values above 7', () => {
    expect(bbSizeToEm(99)).toBe(bbSizeToEm(7))
  })
  it('defaults unparseable values to 4 (baseline)', () => {
    expect(bbSizeToEm(0)).toBe(bbSizeToEm(4))
    expect(bbSizeToEm('garbage')).toBe(bbSizeToEm(4))
  })
  it('produces em-suffixed strings', () => {
    expect(bbSizeToEm(4)).toMatch(/em$/)
  })
  it('1 → smallest, 7 → largest', () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7].map(n => parseFloat(bbSizeToEm(n)))
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
  })
})

describe('bbcodeToRawHtml — BBCode tags', () => {
  it('converts bold / italic / underline', () => {
    expect(bbcodeToRawHtml('[b]bold[/b]')).toBe('<strong>bold</strong>')
    expect(bbcodeToRawHtml('[i]italic[/i]')).toBe('<em>italic</em>')
    expect(bbcodeToRawHtml('[u]under[/u]')).toBe('<u>under</u>')
  })

  it('handles nested tags', () => {
    const out = bbcodeToRawHtml('[b][i]both[/i][/b]')
    expect(out).toContain('<strong>')
    expect(out).toContain('<em>')
    expect(out.indexOf('<strong>')).toBeLessThan(out.indexOf('<em>'))
  })

  it('is case insensitive', () => {
    expect(bbcodeToRawHtml('[B]x[/B]')).toContain('<strong>x</strong>')
  })

  it('converts URL tag with text', () => {
    const out = bbcodeToRawHtml('[url=https://example.com]link[/url]')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('>link<')
  })

  it('blocks javascript: in [url]', () => {
    const out = bbcodeToRawHtml('[url=javascript:alert(1)]click[/url]')
    expect(out).toContain('href="#"')
    expect(out).not.toContain('javascript:')
  })

  it('produces <img> with loading=lazy', () => {
    const out = bbcodeToRawHtml('[img]https://x.com/a.png[/img]')
    expect(out).toContain('<img')
    expect(out).toContain('loading="lazy"')
    expect(out).toContain('src="https://x.com/a.png"')
  })

  it('drops [img] with unsafe URL', () => {
    expect(bbcodeToRawHtml('[img]javascript:1[/img]')).toBe('')
  })

  it('renders [img=URL]...[/img] attribute form', () => {
    const out = bbcodeToRawHtml('[img=https://x.com/a.png][/img]')
    expect(out).toContain('<img')
    expect(out).toContain('src="https://x.com/a.png"')
    expect(out).not.toContain('[img=')
  })

  it('renders standalone [img=URL] without a closing tag', () => {
    const out = bbcodeToRawHtml('[img=https://x.com/b.png]')
    expect(out).toContain('src="https://x.com/b.png"')
    expect(out).not.toContain('[img=')
  })

  it('drops [img=URL] with unsafe URL', () => {
    expect(bbcodeToRawHtml('[img=javascript:alert(1)][/img]')).toBe('')
  })

  it('converts [youtube] to external link', () => {
    const out = bbcodeToRawHtml('[youtube]dQw4w9WgXcQ[/youtube]')
    expect(out).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"')
    expect(out).not.toContain('<iframe')
  })

  it('renders unordered and ordered lists', () => {
    expect(bbcodeToRawHtml('[list][*]one[*]two[/list]')).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(bbcodeToRawHtml('[list=1][*]one[*]two[/list]')).toContain('<ol><li>one</li><li>two</li></ol>')
  })

  it('handles [*]item[/*] paired closers and bare [*] without [list]', () => {
    // Paired [/*] closer must not survive inside [list].
    expect(bbcodeToRawHtml('[list][*]one[/*][*]two[/*][/list]'))
      .toContain('<ul><li>one</li><li>two</li></ul>')
    expect(bbcodeToRawHtml('[list=1][*]one[/*][*]two[/*][/list]'))
      .toContain('<ol><li>one</li><li>two</li></ol>')
    // Bare [*] with no [list] wrapper still becomes a <ul>.
    expect(bbcodeToRawHtml('[*]one[/*][*]two[/*]'))
      .toContain('<ul><li>one</li><li>two</li></ul>')
    // No [/*] residue anywhere.
    expect(bbcodeToRawHtml('[list][*]a[/*][/list]')).not.toContain('[/*]')
    expect(bbcodeToRawHtml('[*]a[/*]')).not.toContain('[/*]')
  })

  it('keeps legitimate [color] values (keyword, hex, rgb)', () => {
    expect(bbcodeToRawHtml('[color=red]x[/color]')).toBe('<span style="color:red">x</span>')
    expect(bbcodeToRawHtml('[color=#ff0000]x[/color]')).toBe('<span style="color:#ff0000">x</span>')
    expect(bbcodeToRawHtml('[color=rgb(255,0,0)]x[/color]')).toBe('<span style="color:rgb(255,0,0)">x</span>')
  })

  it('drops junk [color] payloads (keeps text, no style)', () => {
    // IE-era CSS expression() injection — must not survive into the style attr.
    const out = bbcodeToRawHtml('[color=a)expression(1)]x[/color]')
    expect(out).toBe('x')
    expect(out).not.toContain('expression')
    expect(out).not.toContain('style=')
  })

  it('renders spoiler as <details>', () => {
    const out = bbcodeToRawHtml('[spoiler]hidden[/spoiler]')
    expect(out).toContain('<details>')
    expect(out).toContain('<summary>Spoiler</summary>')
    expect(out).toContain('hidden')
  })

  it('renders spoiler with custom label', () => {
    expect(bbcodeToRawHtml('[spoiler=Click me]body[/spoiler]')).toContain('<summary>Click me</summary>')
  })

  it('renders quote as blockquote', () => {
    expect(bbcodeToRawHtml('[quote]said[/quote]')).toContain('<blockquote>said</blockquote>')
  })

  it('renders code as <pre><code>', () => {
    expect(bbcodeToRawHtml('[code]let x = 1[/code]')).toContain('<pre><code>let x = 1</code></pre>')
  })

  it('converts newlines to <br>', () => {
    expect(bbcodeToRawHtml('line one\nline two')).toContain('line one<br>line two')
  })

  it('suppresses <br> adjacent to block tags', () => {
    const out = bbcodeToRawHtml('before\n[quote]q[/quote]\nafter')
    expect(out).not.toMatch(/<br>\s*<blockquote/)
    expect(out).not.toMatch(/<\/blockquote>\s*<br>/)
  })
})

describe('bbcodeToHtml — full pipeline with DOMPurify', () => {
  it('strips <script> entirely', () => {
    const out = bbcodeToHtml('hello <script>alert(1)</script> world')
    expect(out).not.toContain('<script')
    expect(out).not.toMatch(/alert\(/)  // inline content also removed
    expect(out).toContain('hello')
    expect(out).toContain('world')
  })

  it('strips <iframe>', () => {
    const out = bbcodeToHtml('before<iframe src="https://evil.com"></iframe>after')
    expect(out).not.toContain('<iframe')
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  it('strips onerror and other event handlers', () => {
    const out = bbcodeToHtml('<img src="https://x.com/a.png" onerror="alert(1)">')
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/alert/i)
  })

  it('strips javascript: in href', () => {
    const out = bbcodeToHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
  })

  it('keeps style attribute for layout (text-align, color, font-size)', () => {
    const out = bbcodeToHtml('<div style="text-align:center; color:red">x</div>')
    expect(out).toContain('<div')
    expect(out.toLowerCase()).toContain('text-align')
  })

  it('keeps <center> (Nexus still uses the deprecated tag)', () => {
    const out = bbcodeToHtml('<center>centered</center>')
    expect(out.toLowerCase()).toContain('<center>')
  })

  it('keeps <h1>..<h6> headings', () => {
    const out = bbcodeToHtml('<h1>Big</h1><h4>Smaller</h4>')
    expect(out).toContain('<h1>')
    expect(out).toContain('<h4>')
  })

  it('keeps <font color size> (Nexus emits the old tag)', () => {
    const out = bbcodeToHtml('<font color="red" size="5">x</font>')
    // DOMPurify may rewrite <font> but must keep either the tag or its content
    expect(out).toContain('x')
  })

  it('keeps <table>/<tr>/<td>', () => {
    const out = bbcodeToHtml('<table><tr><td>cell</td></tr></table>')
    expect(out).toContain('<table>')
    expect(out).toContain('<td>')
  })

  it('keeps <br /> line breaks from Nexus', () => {
    const out = bbcodeToHtml('line one<br />line two')
    expect(out).toContain('<br')
    expect(out).not.toContain('&lt;br')
  })
})

describe('bbcodeToHtml — realistic Nexus descriptions', () => {
  it('mixed BBCode + HTML + line breaks survives', () => {
    const input = 'Check out [b]HZMM[/b]<br /><br />One-click install here: <a href="https://github.com/uuuu790/HZMM">GitHub</a>.'
    const out = bbcodeToHtml(input)
    expect(out).toContain('<strong>HZMM</strong>')
    expect(out).toContain('<br')
    expect(out).toContain('href="https://github.com/uuuu790/HZMM"')
    expect(out).not.toContain('&lt;br')
  })

  it('centered heading with emoji stays centered', () => {
    const input = '<div style="text-align:center"><h2>🔥 Key Features</h2></div>'
    const out = bbcodeToHtml(input)
    expect(out).toContain('🔥 Key Features')
    expect(out.toLowerCase()).toContain('text-align')
    expect(out).toContain('<h2>')
  })

  it('handles <font color> inside [b]', () => {
    const out = bbcodeToHtml('[b]<font color="red">Warning</font>[/b]')
    expect(out).toContain('<strong>')
    expect(out).toContain('Warning')
  })
})

describe('bbcodeToHtml — edge cases', () => {
  it('returns empty string for null / empty', () => {
    expect(bbcodeToHtml(null)).toBe('')
    expect(bbcodeToHtml(undefined)).toBe('')
    expect(bbcodeToHtml('')).toBe('')
  })

  it('does not infinite-loop on malformed nesting', () => {
    const out = bbcodeToHtml('[b]a[i]b[/b]c[/i]')
    expect(out).toBeTruthy()
    expect(out.length).toBeLessThan(1000)
  })
})

describe('Steam heading tags', () => {
  it('renders [h1]/[h2]/[h3] as heading elements (not literal text)', () => {
    const html = bbcodeToHtml('[h1]Title[/h1][h2]Sub[/h2][h3]Small[/h3]')
    expect(html).not.toContain('[h1]')
    expect(html).not.toContain('[/h3]')
    expect(html).toMatch(/<h[1-6][^>]*>Title<\/h[1-6]>/)
    expect(html).toMatch(/<h[1-6][^>]*>Sub<\/h[1-6]>/)
    expect(html).toMatch(/<h[1-6][^>]*>Small<\/h[1-6]>/)
  })
})
