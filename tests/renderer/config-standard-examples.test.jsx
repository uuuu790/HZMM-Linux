// @vitest-environment happy-dom
// The Config Standard examples (docs/examples, shipped to mod authors) must
// load in HZMM's own parser and editor: every schema key binds to its line,
// defaults equal the shipped values, quoting follows the schema, {eval:}
// tokens resolve, and the comment-mode example renders its descriptions,
// pills and dependency gating.
import { describe, it, expect, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import SchemaRenderer from '../../src/renderer/src/components/modals/config-editor/SchemaRenderer.jsx'
import CommentModeRenderer from '../../src/renderer/src/components/modals/config-editor/CommentModeRenderer.jsx'
import { parseConfigFile, normalizeSchema, buildEntryKeyDefMap, isKnownType, keyDefNeedsQuote, parseLuaArray, resolveI18n } from '../../src/renderer/src/utils/config-parser'
import { evalArithmetic } from '../../src/renderer/src/utils/safe-expr'
import { getLuaSyntaxError } from '../../src/main/services/lua-syntax'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
// vitest runs from the repo root (happy-dom gives import.meta.url an http: scheme).
const DIR = join(process.cwd(), 'docs', 'examples')
const RO = { badge: 'RO', hint: 'RO', noteTitle: 'RO', note: 'RO' }
const mounted = []
function mount(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  mounted.push({ root, el })
  return el
}
afterEach(() => { for (const { root, el } of mounted.splice(0)) { act(() => root.unmount()); el.remove() } })

const lua = (t) => parseConfigFile(t, { syntax: 'lua' })
const demos = readdirSync(DIR).filter(f => f.endsWith('.hzmm.config.json')).map(f => f.replace('.hzmm.config.json', ''))

function Harness({ text, schema, lang }) {
  const [entries] = useState(() => lua(text))
  return <SchemaRenderer schema={schema} entries={entries} lang={lang} onUpdateValue={() => {}} onAddOptional={() => {}} onRemoveOptional={() => {}} readonlyText={RO} />
}

describe.each(demos)('%s', (id) => {
  const raw = JSON.parse(readFileSync(`${DIR}/${id}.hzmm.config.json`, 'utf8'))
  const text = readFileSync(`${DIR}/${id}.config.lua`, 'utf8')
  const schema = normalizeSchema(raw)
  const entries = lua(text)
  const map = buildEntryKeyDefMap(entries, schema)
  const bound = Object.fromEntries(Object.entries(map).map(([i, d]) => [d.keyName, entries[i]]))

  it('is a valid schema + lua pair', () => {
    expect(raw.configFile).toBe('Scripts/config.lua')
    expect(getLuaSyntaxError(text)).toBeNull()
    expect(entries.filter(e => e.type === 'keyval' && e.readonly).map(e => e.key)).toEqual([])
    for (const [sid, sec] of Object.entries(schema.sections)) {
      if (typeof sec.label === 'object') expect(sec.label.en, `${sid} label en`).toBeTruthy()
      if (sec.enableKey) expect(sec.keys[sec.enableKey]?.type).toBe('bool')
      for (const [k, d] of Object.entries(sec.keys)) {
        const tag = `${sid}.${k}`
        expect(isKnownType(d.type), `${tag} type`).toBe(true)
        if (typeof d.label === 'object') expect(d.label.en, `${tag} label en`).toBeTruthy()
        if (typeof d.description === 'object') expect(d.description.en, `${tag} desc en`).toBeTruthy()
        if (['select', 'multi-select'].includes(d.type)) expect(d.options?.length, `${tag} options`).toBeGreaterThan(0)
        if (d.widget === 'slider') { expect(d.min, tag).toBeDefined(); expect(d.max, tag).toBeDefined() }
        if (d.showWhen) for (const dep of Object.keys(d.showWhen)) expect(sec.keys[dep], `${tag} showWhen ${dep}`).toBeDefined()
        const e = bound[k]
        if (!e) { expect(d.optional, `${tag} absent but not optional`).toBe(true); continue }
        expect(e.isQuoted, `${tag} quoting`).toBe(keyDefNeedsQuote(d))
        if (d.default === undefined) continue
        if (Array.isArray(d.default)) expect(parseLuaArray(e.value), `${tag} default`).toEqual(d.default.map(String))
        else if (typeof d.default === 'number') expect(Number(e.value), `${tag} default`).toBe(d.default)
        else expect(e.value, `${tag} default`).toBe(String(d.default))
        if (d.type === 'select') expect(d.options.map(o => String(o.value))).toContain(String(d.default))
        if (d.type === 'multi-select') for (const v of d.default) expect(d.options.map(o => o.value)).toContain(v)
        if (typeof d.default === 'number' && d.min !== undefined) expect(d.default).toBeGreaterThanOrEqual(d.min)
        if (typeof d.default === 'number' && d.max !== undefined) expect(d.default).toBeLessThanOrEqual(d.max)
        for (const lang of ['en', 'zh-TW']) {
          const desc = resolveI18n(d.description, lang) || ''
          for (const m of desc.matchAll(/\{eval:([^}]*)\}/g)) expect(evalArithmetic(m[1], Number(d.default)), `${tag} ${m[0]}`).not.toBeNull()
        }
      }
    }
  })

  it.each(['en', 'zh-TW'])('renders in %s', (lang) => {
    const el = mount(<Harness text={text} schema={schema} lang={lang} />)
    const labels = [...el.querySelectorAll('label')].map(l => l.textContent)
    for (const sec of Object.values(schema.sections)) {
      if (sec.collapsed) continue
      for (const [k, d] of Object.entries(sec.keys)) {
        if (d.showWhen) continue
        expect(labels, `${k} label`).toContain(resolveI18n(d.label, lang) || k)
      }
    }
    expect(el.textContent).not.toMatch(/\{eval:|\{value\}/)
  })
})

describe('16-comment-mode', () => {
  const text = readFileSync(`${DIR}/16-comment-mode.config.lua`, 'utf8')
  it('parses and renders descriptions, pills and dependencies', () => {
    expect(getLuaSyntaxError(text)).toBeNull()
    const entries = lua(text)
    const keys = entries.filter(e => e.type === 'keyval').map(e => e.key)
    expect(keys).toEqual(['EnableMod', 'MaxHealth', 'PlayerName', 'Mode', 'MultiplierValue', 'FixedValue'])
    expect(entries.filter(e => e.type === 'section').map(e => e.name)).toEqual(['General', 'Radius'])
    const el = mount(<CommentModeRenderer entries={entries} lang="zh-TW" onUpdateValue={() => {}} readonlyText={RO} />)
    const txt = el.textContent
    for (const s of ['開啟或關閉整個模組', '玩家最大生命值', '問候語中顯示的名稱', '半徑模式', '半徑倍率', '固定半徑']) expect(txt, s).toContain(s)
    const buttons = [...el.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(buttons).toEqual(expect.arrayContaining(['Multiplier', 'Fixed']))
    const row = (label) => [...el.querySelectorAll('label')].find(l => l.textContent === label)?.closest('div.py-3\\.5')
    const disabled = (label) => [...row(label).querySelectorAll('input,button')].every(i => i.disabled)
    expect(disabled('FixedValue'), 'FixedValue gated by Mode').toBe(true)
    expect(disabled('MultiplierValue'), 'MultiplierValue active').toBe(false)
    expect(disabled('MaxHealth'), 'MaxHealth active while EnableMod on').toBe(false)
  })
})
