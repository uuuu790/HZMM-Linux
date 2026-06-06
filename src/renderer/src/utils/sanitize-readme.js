// README rendering pipeline — markdown → HTML → DOMPurify.
//
// README content comes from untrusted mod authors. The renderer CSP
// allows 'unsafe-inline' on script-src so a raw <script>/<img onerror>
// embedded in a README.md would execute with full window.api access
// (filesystem, install, settings, etc.) if rendered without sanitization.
//
// DOMPurify strips script/iframe/embed/object/form/input/style/link/meta
// tags, all event-handler attributes, and javascript:/data: URLs while
// preserving the markdown elements marked emits (p/a/ul/li/code/pre/h*/
// img/blockquote/table).

import { marked } from 'marked';
import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'embed', 'object', 'form', 'input', 'style', 'link', 'meta'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

export function sanitizeReadme(markdownText) {
  if (!markdownText) return '';
  return DOMPurify.sanitize(marked.parse(markdownText, { breaks: true }), PURIFY_CONFIG);
}
