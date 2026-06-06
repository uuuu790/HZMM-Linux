// Static anti-pattern scanner for HZMM.
//
// Run via `npm run audit`. Scans src/ for the regression patterns the
// 2026-05-14 audit pass identified — script blocks reaching DOMPurify-
// less render paths, IPC handlers taking renderer-supplied path
// segments without validation, HTTP requests without timeouts, etc.
//
// Findings are reported as `<SEV> <CHECK-ID> <file>:<line>  <msg>`.
// HIGH findings cause exit code 1; MEDIUM/LOW are advisory.
//
// Add a new check by appending to the `checks` array. Each check
// receives the relative file path + file contents and returns either
// `null` (clean), an object `{line, severity, msg}`, or an array of
// such objects (multiple hits per file).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const checks = [
  {
    id: 'XSS-MARKED-RAW',
    description: 'marked.parse output reaches dangerouslySetInnerHTML without a sanitizer',
    test: (file, content) => {
      if (!/marked\.parse\(/.test(content)) return null;
      if (!/dangerouslySetInnerHTML/.test(content)) return null;
      if (/DOMPurify|sanitizeReadme|bbcodeToHtml/.test(content)) return null;
      return { line: findLine(content, /marked\.parse\(/), severity: 'HIGH',
        msg: 'marked.parse output reaches dangerouslySetInnerHTML without DOMPurify' };
    },
  },
  {
    id: 'IPC-NO-SEGMENT-CHECK',
    description: 'IPC handler accepts filename/modFilename/worldName param without assertSafeSegment',
    test: (file, content) => {
      if (!file.startsWith('src/main/')) return null;
      const findings = [];
      const re = /ipcMain\.handle\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*(?:\{|serializeModWrite)/g;
      for (const m of content.matchAll(re)) {
        const channel = m[1];
        const params = m[2];
        if (!/\b(filename|modFilename|worldName)\b/.test(params)) continue;
        // Inspect ~800 chars after the handler open for assertSafeSegment.
        const start = m.index + m[0].length;
        const block = content.slice(start, start + 1500);
        if (!/assertSafeSegment/.test(block)) {
          findings.push({ line: lineAt(content, m.index), severity: 'HIGH',
            msg: `IPC '${channel}' accepts a renderer-supplied path segment without assertSafeSegment` });
        }
      }
      return findings.length ? findings : null;
    },
  },
  {
    id: 'NEW-FUNCTION-RENDERER',
    description: 'new Function(...) in renderer — audit value source for renderer-controlled input',
    test: (file, content) => {
      if (!file.startsWith('src/renderer/')) return null;
      const m = /new\s+Function\s*\(/.exec(content);
      if (!m) return null;
      return { line: lineAt(content, m.index), severity: 'MEDIUM',
        msg: 'new Function() in renderer — CSP unsafe-eval is required, verify input source is trusted' };
    },
  },
  {
    id: 'HTTP-NO-TIMEOUT',
    description: 'http(s).get / .request without a req.setTimeout — UI can hang on stalled server',
    test: (file, content) => {
      if (!file.startsWith('src/main/')) return null;
      const findings = [];
      const seen = new Set();
      for (const m of content.matchAll(/\b(?:https?|protocol)\.(?:get|request)\s*\(/g)) {
        const start = m.index;
        // Look in a ~3500-char window around the call for setTimeout —
        // big enough to span the full callback body of a typical
        // download/api helper (which can run 80-100 lines).
        const window = content.slice(Math.max(0, start - 200), start + 3500);
        if (/setTimeout\(/.test(window)) continue;
        const line = lineAt(content, start);
        if (seen.has(line)) continue;
        seen.add(line);
        findings.push({ line, severity: 'MEDIUM',
          msg: 'HTTP request without setTimeout — UI may hang indefinitely on stalled server' });
      }
      return findings.length ? findings : null;
    },
  },
  {
    id: 'NON-ATOMIC-CONFIG-WRITE',
    description: 'config-store writes CONFIG_FILE without tmp + rename',
    test: (file, content) => {
      if (!file.endsWith('config-store.js')) return null;
      const m = /writeFileSync\(\s*CONFIG_FILE/.exec(content);
      if (!m) return null;
      const window = content.slice(m.index, m.index + 400);
      if (/renameSync/.test(window)) return null;
      return { line: lineAt(content, m.index), severity: 'LOW',
        msg: 'Direct writeFileSync(CONFIG_FILE) — use tmp + rename so crash mid-write does not corrupt config' };
    },
  },
  {
    id: 'INSTALL-NO-ROLLBACK',
    description: 'mods-install destructive clean called without withRollback wrapper',
    test: (file, content) => {
      if (!file.endsWith('mods-install.js')) return null;
      // Old API was cleanExistingMod(); the rollback-aware replacement is
      // withRollback() + rotateModsToBackup(). Flag any reintroduction.
      if (/\bcleanExistingMod\s*\(/.test(content)) {
        return { line: findLine(content, /cleanExistingMod\s*\(/), severity: 'HIGH',
          msg: 'cleanExistingMod() called — wrap destructive cleanup in withRollback() so extract failure restores the old version' };
      }
      return null;
    },
  },
  {
    id: 'KEYBIND-USES-EKEY',
    description: 'KeybindInput emits combo from e.key instead of physical e.code',
    test: (file, content) => {
      if (!file.endsWith('KeybindInput.jsx')) return null;
      if (/parts\.push\(\s*e\.key/.test(content)) {
        return { line: findLine(content, /parts\.push\(\s*e\.key/), severity: 'MEDIUM',
          msg: 'KeybindInput should use codeToMainKey(e.code), not e.key — Shift+1 otherwise records as Shift+!' };
      }
      return null;
    },
  },
  {
    id: 'TOGGLE-NO-MUTEX',
    description: 'mods:toggle / mods:remove handler not wrapped in serializeModWrite',
    test: (file, content) => {
      if (!file.endsWith('main/ipc/mods.js')) return null;
      const findings = [];
      for (const channel of ['mods:toggle', 'mods:remove']) {
        const re = new RegExp(`ipcMain\\.handle\\(\\s*['"]${channel.replace(':', ':')}['"]\\s*,\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*(\\w+)`, 'g');
        for (const m of content.matchAll(re)) {
          if (m[1] === 'serializeModWrite') continue;
          findings.push({ line: lineAt(content, m.index), severity: 'MEDIUM',
            msg: `'${channel}' is not wrapped in serializeModWrite — concurrent install can corrupt state` });
        }
      }
      return findings.length ? findings : null;
    },
  },
  {
    id: 'DANGEROUS-HTML-NO-SANITIZE',
    description: 'dangerouslySetInnerHTML without DOMPurify or a known sanitizer in the same file',
    test: (file, content) => {
      if (!file.startsWith('src/renderer/')) return null;
      if (!/dangerouslySetInnerHTML/.test(content)) return null;
      if (/DOMPurify|sanitizeReadme|bbcodeToHtml/.test(content)) return null;
      return { line: findLine(content, /dangerouslySetInnerHTML/), severity: 'HIGH',
        msg: 'dangerouslySetInnerHTML in a component that does not import DOMPurify or a sanitizer helper' };
    },
  },
  {
    id: 'APP-UPDATE-TRUSTS-RENDERER',
    description: 'app-update:download IPC accepts URL/hash from renderer instead of re-fetching canonical',
    test: (file, content) => {
      if (!file.endsWith('main/ipc/app-update.js')) return null;
      const re = /ipcMain\.handle\(\s*['"]app-update:download['"]\s*,\s*async\s*\(\s*_\s*,\s*(downloadUrl|url)/;
      const m = re.exec(content);
      if (!m) return null;
      return { line: lineAt(content, m.index), severity: 'HIGH',
        msg: 'app-update:download takes URL/hash from renderer — re-fetch canonical via checkForUpdate() instead' };
    },
  },
];

function lineAt(content, idx) {
  return content.slice(0, idx).split('\n').length;
}

function findLine(content, regex) {
  const m = regex.exec(content);
  return m ? lineAt(content, m.index) : 0;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) yield full;
  }
}

// Suppression: a `// audit:allow <CHECK-ID>` comment on the same line as
// the finding, or on either of the two preceding lines, opts that finding
// out. Use for intentional patterns (e.g. `new Function` for the schema
// {eval:} feature) — the comment is the contract that future readers see.
function isSuppressed(lines, lineNumber, checkId) {
  // Look back up to 6 lines so an `audit:allow` at the top of an
  // explanatory comment block can still cover the line below it.
  for (let i = Math.max(0, lineNumber - 6); i < lineNumber; i++) {
    const text = lines[i] || '';
    const m = text.match(/audit:allow\s+([\w,-]+)/);
    if (!m) continue;
    const ids = m[1].split(',').map(s => s.trim());
    if (ids.includes(checkId)) return true;
  }
  return false;
}

let totalFiles = 0;
const findings = [];
for (const file of walk(SRC)) {
  totalFiles++;
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  for (const check of checks) {
    const out = check.test(rel, content);
    if (!out) continue;
    const list = Array.isArray(out) ? out : [out];
    for (const f of list) {
      if (isSuppressed(lines, f.line, check.id)) continue;
      findings.push({ file: rel, check: check.id, ...f });
    }
  }
}

if (findings.length === 0) {
  console.log(`audit: clean — ${totalFiles} files, ${checks.length} checks, 0 findings`);
  process.exit(0);
}

findings.sort((a, b) => {
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return (order[a.severity] - order[b.severity]) || a.file.localeCompare(b.file) || a.line - b.line;
});

const bySev = { HIGH: 0, MEDIUM: 0, LOW: 0 };
for (const f of findings) {
  console.log(`${f.severity.padEnd(6)} ${f.check.padEnd(28)} ${f.file}:${f.line}  ${f.msg}`);
  bySev[f.severity]++;
}
console.log(`\naudit: ${findings.length} finding(s) — HIGH=${bySev.HIGH} MEDIUM=${bySev.MEDIUM} LOW=${bySev.LOW}`);
process.exit(bySev.HIGH > 0 ? 1 : 0);
