// BBCode + HTML → sanitized HTML for Nexus Mods descriptions.
//
// Nexus's v1 API returns description as a raw soup of BBCode + HTML (users
// can paste HTML like `<div style="text-align:center">`, `<font color="red">`,
// `<h2>`, `<table>`, etc. directly into the mod's description editor).
//
// Pipeline:
//   1. Convert BBCode tags (`[b]`, `[url]`, `[img]`, `[list]`…) to HTML.
//      Leave existing HTML untouched at this stage.
//   2. Normalize whitespace (newline → <br>, collapse <br>s hugging blocks).
//   3. Run the whole thing through DOMPurify.
//      DOMPurify is a battle-tested XSS sanitizer — it strips <script>,
//      <iframe>, event handlers, `javascript:`/`data:` URLs, and any other
//      known-dangerous construct while keeping Nexus's layout HTML intact
//      (divs with style, font color/size, headings, tables, etc.).
//
// This approach matches how Nexus's own website renders the content — we
// trust the full HTML+BBCode output and rely on DOMPurify for safety instead
// of maintaining our own allow-list.

import DOMPurify from 'dompurify'

const MAX_NEST_DEPTH = 20

// Only allow http(s) and mailto for BBCode-produced links. DOMPurify handles
// the same check for HTML-sourced links, so this covers the BBCode side.
function safeUrl(url) {
  if (!url) return '#'
  const trimmed = String(url).trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return 'https://' + trimmed
  return '#'
}

function extractYoutubeId(raw) {
  const s = String(raw).trim()
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^&]*&)*v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  return null
}

function bbSizeToEm(n) {
  const clamped = Math.max(1, Math.min(7, parseInt(n, 10) || 4))
  return (0.5 + clamped * 0.15).toFixed(2) + 'em'
}

// Simple paired BBCode → HTML tag replacements.
const PAIRED_RULES = [
  [/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>'],
  [/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>'],
  [/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>'],
  [/\[s\]([\s\S]*?)\[\/s\]/gi, '<del>$1</del>'],
  [/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>'],
  [/\[right\]([\s\S]*?)\[\/right\]/gi, '<div style="text-align:right">$1</div>'],
  [/\[left\]([\s\S]*?)\[\/left\]/gi, '<div style="text-align:left">$1</div>'],
  [/\[heading\]([\s\S]*?)\[\/heading\]/gi, '<h3>$1</h3>'],
  [/\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>'],
  [/\[code\]([\s\S]*?)\[\/code\]/gi, '<pre><code>$1</code></pre>'],
  [/\[pre\]([\s\S]*?)\[\/pre\]/gi, '<pre>$1</pre>'],
  [/\[spoiler(?:=([^\]]+))?\]([\s\S]*?)\[\/spoiler\]/gi, (_m, label, body) =>
    `<details><summary>${label || 'Spoiler'}</summary>${body}</details>`],
]

// Nexus's description editor HTML-encodes whatever the author types (their
// website decodes back at render time). So the raw API payload often looks
// like `Extract here! &lt;br /&gt;*:&#92;SteamLibrary` — i.e. the `<br />`
// tags and backslashes are already entities. Decoding here is what lets the
// subsequent BBCode + DOMPurify pipeline see real tags instead of literal
// entity text. Decoding order matters: `&amp;` goes LAST so double-encoded
// inputs like `&amp;lt;` still render as `&lt;` instead of `<`.
function decodeHtmlEntities(str) {
  if (!str) return ''
  return String(str)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, '\u00A0')
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = parseInt(n, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, h) => {
      const code = parseInt(h, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m
    })
    .replace(/&amp;/gi, '&')
}

function bbcodeToRawHtml(input) {
  let s = decodeHtmlEntities(String(input))

  // Self-closing / standalone BBCode
  s = s.replace(/\[br\]/gi, '<br>')
  s = s.replace(/\[hr\]/gi, '<hr>')
  s = s.replace(/\[line\]/gi, '<hr>')

  for (let iter = 0; iter < MAX_NEST_DEPTH; iter++) {
    const before = s

    for (const [re, repl] of PAIRED_RULES) s = s.replace(re, repl)

    s = s.replace(/\[color=([#a-z0-9()\s,%.-]+)\]([\s\S]*?)\[\/color\]/gi,
      (_m, c, text) => `<span style="color:${c.trim()}">${text}</span>`)

    s = s.replace(/\[size=(\d+)\]([\s\S]*?)\[\/size\]/gi,
      (_m, n, text) => `<span style="font-size:${bbSizeToEm(n)}">${text}</span>`)

    s = s.replace(/\[font=([a-z0-9\s,'"-]+)\]([\s\S]*?)\[\/font\]/gi,
      (_m, f, text) => `<span style="font-family:${f.trim()}">${text}</span>`)

    s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
      (_m, url, text) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`)

    s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi,
      (_m, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`)

    s = s.replace(/\[email(?:=[^\]]*)?\]([\s\S]*?)\[\/email\]/gi,
      (_m, addr) => `<a href="mailto:${addr}">${addr}</a>`)

    s = s.replace(/\[img(?:\s+[^\]]*)?\]([\s\S]*?)\[\/img\]/gi, (_m, url) => {
      const u = safeUrl(url)
      if (u === '#') return ''
      return `<img src="${u}" alt="" loading="lazy">`
    })

    // CSP blocks iframes, so [youtube] degrades to a plain link.
    s = s.replace(/\[youtube\]([\s\S]*?)\[\/youtube\]/gi, (_m, v) => {
      const id = extractYoutubeId(v)
      if (!id) return ''
      const url = `https://www.youtube.com/watch?v=${id}`
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">▶ YouTube: ${url}</a>`
    })

    s = s.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (_m, body) => {
      const items = body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean)
      return `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`
    })
    s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, body) => {
      const items = body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean)
      return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
    })

    if (s === before) break
  }

  // Newline → <br>; collapse <br>s next to block-level tags to avoid
  // double-spacing around lists, quotes, tables, etc.
  s = s.replace(/\r\n/g, '\n').replace(/\n/g, '<br>')

  // Normalize self-closed <br />/<br/> into bare <br> so the collapse rules
  // below catch them too (Nexus emits all three variants interchangeably).
  s = s.replace(/<br\s*\/>/gi, '<br>')

  const BLOCK = 'blockquote|ul|ol|li|pre|h[1-6]|details|summary|hr|div|p|table|thead|tbody|tr|td|th|center|section|article|header|footer'
  s = s.replace(new RegExp(`<br>\\s*(<(?:\\/)?(?:${BLOCK})\\b)`, 'gi'), '$1')
  s = s.replace(new RegExp(`(<\\/(?:${BLOCK})>)\\s*<br>`, 'gi'), '$1')

  // Nexus authors often stack 3-5 <br>s for vertical space. Cap at 2
  // consecutive so a paragraph break renders as one blank line, not four.
  s = s.replace(/(?:<br>\s*){3,}/gi, '<br><br>')

  return s
}

// DOMPurify config — allow Nexus's rich layout HTML, block anything that
// could run code or fetch cross-origin in ways CSP might miss.
const PURIFY_CONFIG = {
  // Extend DOMPurify's default allow-list with tags Nexus uses but the
  // default may strip (center is deprecated but Nexus still emits it).
  ADD_TAGS: ['center'],
  // Allow target="_blank" and loading="lazy" on produced elements.
  ADD_ATTR: ['target', 'loading'],
  // Explicit deny-list — CSP already blocks these but make it obvious here.
  FORBID_TAGS: ['script', 'iframe', 'embed', 'object', 'form', 'input', 'style', 'link', 'meta'],
  // Drop any `on*` event handler attrs (DOMPurify does this by default too).
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // Keep style attr (Nexus uses text-align:center, color, font-size, etc.)
  // but DOMPurify still sanitizes its content (blocks expression(), url(), …).
}

export function bbcodeToHtml(input) {
  if (!input) return ''
  const raw = bbcodeToRawHtml(input)
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}

export const _testInternals = { safeUrl, extractYoutubeId, bbSizeToEm, bbcodeToRawHtml, decodeHtmlEntities }
