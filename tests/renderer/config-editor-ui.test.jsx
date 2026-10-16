// @vitest-environment happy-dom
// UI smoke tests for the config editor: read-only rows (pill, one note,
// cleaned preview, a11y), widget type inference (schema without a type,
// comment mode), enableKey gating, save-failure / refusal toasts, useToast.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, useState, useImperativeHandle, forwardRef } from 'react'
import { createRoot } from 'react-dom/client'
import SchemaRenderer, { inferRowType } from '../../src/renderer/src/components/modals/config-editor/SchemaRenderer.jsx'
import CommentModeRenderer, { commentValueType } from '../../src/renderer/src/components/modals/config-editor/CommentModeRenderer.jsx'
import { READONLY_NOTE_ID } from '../../src/renderer/src/components/modals/config-editor/SchemaRow.jsx'
import ConfigEditorModal, { describeSaveFailure } from '../../src/renderer/src/components/modals/ConfigEditorModal.jsx'
import { useToast, TOAST_DURATION_MS, TOAST_LONG_DURATION_MS } from '../../src/renderer/src/hooks/useToast.js'
import { parseConfigFile, normalizeSchema, appendKeyval } from '../../src/renderer/src/utils/config-parser'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

// Pass-through spy, so one test can make appendKeyval refuse (its contract:
// the same array back) whatever the parser does for a given file shape.
vi.mock('../../src/renderer/src/utils/config-parser', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, appendKeyval: vi.fn(mod.appendKeyval) }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const RO_TEXT = { badge: 'RO-BADGE', hint: 'RO-HINT', noteTitle: 'RO-TITLE', note: 'RO-NOTE' }
const zh = UI_TEXT['zh-TW']

const mounted = []
function mount(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  mounted.push({ root, el })
  return el
}
afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  vi.useRealTimers()
  delete window.api
})

const lua = (text) => parseConfigFile(text, { syntax: 'lua' })

// Schema editor with real entry state, like ConfigEditorModal's updateValue.
function SchemaHarness({ text, schema, onUpdate = () => {}, ...props }) {
  const [entries, setEntries] = useState(() => lua(text))
  return (
    <SchemaRenderer
      schema={normalizeSchema(schema)}
      entries={entries}
      lang="en"
      onUpdateValue={(i, v) => { onUpdate(i, v); setEntries(p => p.map((e, j) => (j === i ? { ...e, value: v } : e))) }}
      onAddOptional={props.onAddOptional || (() => {})}
      onRemoveOptional={props.onRemoveOptional || (() => {})}
      readonlyText={RO_TEXT}
      {...props}
    />
  )
}

function CommentHarness({ text }) {
  const [entries, setEntries] = useState(() => lua(text))
  return (
    <CommentModeRenderer
      entries={entries}
      lang="en"
      onUpdateValue={(i, v) => setEntries(p => p.map((e, j) => (j === i ? { ...e, value: v } : e)))}
      readonlyText={RO_TEXT}
    />
  )
}

// React listens to `input` for onChange and focusin/focusout for focus/blur.
function typeInto(input, value) {
  act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const blur = (input) => act(() => input.blur())

// Row element for a label text (schema rows and comment rows share markup).
function rowOf(el, label) {
  const lbl = [...el.querySelectorAll('label')].find(l => l.textContent === label)
  if (!lbl) throw new Error(`no row ${label}`)
  return lbl.closest('div.py-3\\.5')
}
const badgesOf = (row) => [...row.querySelectorAll('span.rounded-full')].map(s => s.textContent)

const RO_CONFIG = [
  'local Config = {',
  '    Enabled = true,',
  '    AllowedWeapons = {',
  '        "Pistol",',
  '        "Rifle",',
  '    },',
  '    Width = 800, Height = 600,',
  '}',
  'return Config',
  '',
].join('\n')
const RO_SCHEMA = {
  configFile: 'config.lua',
  sections: {
    General: { label: 'General', keys: {
      Enabled: { type: 'bool' },
      AllowedWeapons: { type: 'list' },
      Width: { type: 'int' },
    } },
  },
}

describe('read-only rows — schema editor', () => {
  it('shows a cleaned, focusable, full-contrast preview, a pill, and ONE note', () => {
    const el = mount(<SchemaHarness text={RO_CONFIG} schema={RO_SCHEMA} />)
    const notes = el.querySelectorAll('[role="note"]')
    expect(notes).toHaveLength(1)
    expect(notes[0].id).toBe(READONLY_NOTE_ID)
    expect(notes[0].textContent).toContain('RO-TITLE')
    expect(notes[0].textContent).toContain('RO-NOTE')
    // the explanation is never repeated per row
    expect(el.textContent.split('RO-NOTE')).toHaveLength(2)

    const boxes = [...el.querySelectorAll('[role="textbox"][aria-readonly="true"]')]
    expect(boxes.map(b => b.textContent)).toEqual(['{ "Pistol", "Rifle" }', '800'])
    for (const b of boxes) {
      expect(b.tabIndex).toBe(0)
      expect(b.getAttribute('aria-describedby')).toBe(READONLY_NOTE_ID)
      expect(b.title).toContain('RO-HINT')
      // full contrast, not the old dimmed / dashed look
      expect(b.className).toContain('text-slate-700')
      expect(b.className).not.toMatch(/opacity-|border-dashed/)
      expect(b.closest('.opacity-40')).toBeNull()
    }
    expect(boxes[0].getAttribute('aria-label')).toBe('AllowedWeapons: { "Pistol", "Rifle" }')
    // the Width box names the whole line, the preview only Width's own value
    expect(boxes[1].getAttribute('aria-label')).toBe('Width: 800, Height = 600')
    // tooltip: the value as written (de-indented), then why
    expect(boxes[0].title).toBe('{\n    "Pistol",\n    "Rifle",\n}\n\nRO-HINT')

    const list = rowOf(el, 'AllowedWeapons')
    expect(badgesOf(list)).toEqual(['LIST', 'RO-BADGE'])
    expect(list.querySelector('[title="RO-HINT"]').textContent).toBe('RO-BADGE')
    expect(badgesOf(rowOf(el, 'Width'))).toEqual(['INT', 'RO-BADGE'])
    // no editable control for either read-only row
    expect(list.querySelector('input, button')).toBeNull()
    expect(rowOf(el, 'Width').querySelector('input, button')).toBeNull()
  })

  it('{value} / {eval:} in a read-only row\'s description use its own value', () => {
    const el = mount(
      <SchemaHarness
        text={'local C = {\n  DayLength = 30, NightLength = 10,\n}\nreturn C\n'}
        schema={{ configFile: 'c.lua', sections: { S: { keys: { DayLength: { type: 'int', description: '{value} min = {eval: value * 60} s' } } } } }}
      />
    )
    expect(rowOf(el, 'DayLength').querySelector('p').textContent).toBe('30 min = 1800 s')
  })

  it('shows no note without read-only rows, or when they are folded / filtered away', () => {
    const plain = mount(<SchemaHarness text={'local C = {\n  A = 1,\n}\nreturn C\n'} schema={{ configFile: 'c.lua', sections: { S: { keys: { A: { type: 'int' } } } } }} />)
    expect(plain.querySelector('[role="note"]')).toBeNull()

    const folded = { configFile: 'config.lua', sections: { General: { ...RO_SCHEMA.sections.General, collapsed: true } } }
    expect(mount(<SchemaHarness text={RO_CONFIG} schema={folded} />).querySelector('[role="note"]')).toBeNull()

    const matcher = (key) => key === 'Enabled'
    const filtered = mount(<SchemaHarness text={RO_CONFIG} schema={RO_SCHEMA} searchActive matcher={matcher} />)
    expect(filtered.querySelector('[role="note"]')).toBeNull()
    expect(filtered.querySelector('[role="textbox"]')).toBeNull()
  })
})

describe('widget type of a key without a schema type (break-F3)', () => {
  it('infers from the ORIGINAL value, never the value being typed', () => {
    expect(inferRowType({ default: 5 }, { origValue: '5', value: '1,5' })).toBe('int')
    expect(inferRowType({ type: 'number' }, { origValue: '1.5', value: 'fast' })).toBe('float')
    expect(inferRowType({}, { origValue: 'true', value: 'x' })).toBe('bool')
    // a quoted value is text even when it looks numeric
    expect(inferRowType({}, { origValue: '1234', value: '1234', isQuoted: true })).toBe('string')
    // a known schema type always wins
    expect(inferRowType({ type: 'text' }, { origValue: '5', value: '5' })).toBe('text')
  })

  it('a line switched on in this session: default decides, then its value', () => {
    expect(inferRowType({ default: 5 }, { value: '5' })).toBe('int')
    expect(inferRowType({ default: 2.5 }, { value: '2.5' })).toBe('float')
    expect(inferRowType({ default: true }, { value: 'true' })).toBe('bool')
    expect(inferRowType({ default: '10' }, { value: '10' })).toBe('string')
    expect(inferRowType({}, { value: '3' })).toBe('int')
  })

  it('a read-only value is badged by its shape or its own value', () => {
    expect(inferRowType({}, { readonly: true, origValue: '{\n  "a",\n}', value: '{\n  "a",\n}' })).toBe('list')
    expect(inferRowType({}, { readonly: true, origValue: '{\n  A = 1,\n}', value: '{\n  A = 1,\n}' })).toBe('table')
    expect(inferRowType({}, { readonly: true, origValue: '800, Height = 600', value: '800, Height = 600' })).toBe('int')
  })

  it('typing "1,5" keeps the number widget and blur reverts it', () => {
    const updates = []
    const el = mount(
      <SchemaHarness
        text={'local Config = {\n    Speed = 5,\n    Name = "x",\n}\nreturn Config\n'}
        schema={{ configFile: 'config.lua', sections: { S: { label: 'S', keys: { Speed: { default: 5 }, Name: {} } } } }}
        onUpdate={(i, v) => updates.push(v)}
      />
    )
    const input = rowOf(el, 'Speed').querySelector('input')
    expect(input.inputMode).toBe('numeric')
    typeInto(input, '1,5')
    // still the number widget after the keystroke
    const again = rowOf(el, 'Speed').querySelector('input')
    expect(again.inputMode).toBe('numeric')
    expect(badgesOf(rowOf(el, 'Speed'))).toEqual(['INT'])
    blur(again)
    expect(updates).toEqual(['1,5', '5'])
    expect(rowOf(el, 'Speed').querySelector('input').value).toBe('5')
  })
})

describe('comment mode', () => {
  it('an INI key holding regex syntax renders instead of crashing the app', () => {
    // `+Paths` / `C++` used to go into `new RegExp` unescaped → "Nothing to
    // repeat" → the whole React tree unmounted (black window).
    const entries = parseConfigFile('[Settings]\n; +Paths - folders to scan\n+Paths = a\nC++ = on\n', { syntax: 'ini' })
    let el
    expect(() => {
      el = mount(<CommentModeRenderer entries={entries} lang="zh-TW" onUpdateValue={() => {}} readonlyText={RO_TEXT} />)
    }).not.toThrow()
    expect(rowOf(el, '+Paths').textContent).toContain('folders to scan')
    expect(rowOf(el, 'C++')).toBeTruthy()
  })

  it('a quoted number is text; only unquoted numbers are numeric (review-F3)', () => {
    const text = 'local Config = {\n  -- Password - server password\n  Password = "1234",\n  -- Port - server port\n  Port = 7777,\n}\nreturn Config\n'
    const entries = lua(text)
    expect(commentValueType(entries.find(e => e.key === 'Password'))).toBe('string')
    expect(commentValueType(entries.find(e => e.key === 'Port'))).toBe('int')

    const el = mount(<CommentHarness text={text} />)
    const pw = rowOf(el, 'Password')
    expect(badgesOf(pw)).toEqual(['TEXT'])
    expect(pw.querySelector('input').inputMode).toBe('text')
    typeInto(pw.querySelector('input'), 'hunter2')
    blur(rowOf(el, 'Password').querySelector('input'))
    expect(rowOf(el, 'Password').querySelector('input').value).toBe('hunter2')

    const port = rowOf(el, 'Port')
    expect(badgesOf(port)).toEqual(['INT'])
    typeInto(port.querySelector('input'), 'abc')
    blur(rowOf(el, 'Port').querySelector('input'))
    expect(rowOf(el, 'Port').querySelector('input').value).toBe('7777')
  })

  it('read-only rows: LIST / TABLE badges, own-value preview, one note', () => {
    const text = [
      'local Config = {',
      '  -- Weapons - allowed weapon list',
      '  Weapons = {',
      '    "Pistol",',
      '    "Rifle",',
      '  },',
      '  -- Width - window size',
      '  Width = 800, Height = 600,',
      '  -- Loadout - starting gear',
      '  Loadout = {',
      '    Primary = "Rifle",',
      '  },',
      '  -- Speed - movement multiplier',
      '  Speed = 1.5,',
      '}',
      'return Config',
      '',
    ].join('\n')
    const el = mount(<CommentHarness text={text} />)
    expect(el.querySelectorAll('[role="note"]')).toHaveLength(1)
    expect(badgesOf(rowOf(el, 'Weapons'))).toEqual(['LIST', 'RO-BADGE'])
    expect(badgesOf(rowOf(el, 'Width'))).toEqual(['INT', 'RO-BADGE'])
    expect(badgesOf(rowOf(el, 'Loadout'))).toEqual(['TABLE', 'RO-BADGE'])
    expect(badgesOf(rowOf(el, 'Speed'))).toEqual(['FLOAT'])
    expect(rowOf(el, 'Weapons').querySelector('[role="textbox"]').textContent).toBe('{ "Pistol", "Rifle" }')
    expect(rowOf(el, 'Width').querySelector('[role="textbox"]').textContent).toBe('800')
    expect(rowOf(el, 'Loadout').querySelector('[role="textbox"]').textContent).toBe('{ Primary = "Rifle" }')
  })

  it('an Enable* switch set to false really disables its section', () => {
    const text = '-- ==[ Combat ]==\nEnableCombat = false\nDamage = 5\nMode = "Hard"\n'
    const el = mount(<CommentHarness text={text} />)
    const damage = rowOf(el, 'Damage').querySelector('input')
    expect(damage.hasAttribute('disabled')).toBe(true)
    expect(rowOf(el, 'Mode').querySelector('input').hasAttribute('disabled')).toBe(true)
    expect(rowOf(el, 'EnableCombat').querySelector('button').hasAttribute('disabled')).toBe(false)
    typeInto(damage, '9')
    expect(rowOf(el, 'Damage').querySelector('input').value).toBe('5')
  })
})

describe('enableKey gating really disables (DOC-ENABLEKEY-EDITABLE)', () => {
  const schema = {
    configFile: 'c.lua',
    sections: {
      S: { label: 'S', enableKey: 'Enabled', keys: {
        Enabled: { type: 'bool' },
        Speed: { type: 'int', default: 1 },
        Fast: { type: 'bool' },
        Mode: { type: 'select', options: [{ value: 'a' }, { value: 'b' }] },
        Level: { type: 'select', options: [{ value: 'x' }, { value: 'y' }, { value: 'z' }] },
        Tint: { type: 'color' },
        Hotkey: { type: 'keybind' },
        Items: { type: 'list' },
        Rate: { type: 'float', widget: 'slider', min: 0, max: 2 },
        Extra: { type: 'int', optional: true, default: 3 },
        Other: { type: 'int', optional: true, default: 1 },
      } },
    },
  }
  const config = (enabled) => [
    'local C = {',
    `  Enabled = ${enabled},`,
    '  Speed = 5,',
    '  Fast = true,',
    '  Mode = "a",',
    '  Level = "x",',
    '  Tint = "#ff0000",',
    '  Hotkey = "F6",',
    '  Items = {"one"},',
    '  Rate = 1.5,',
    '  Extra = 3,',
    '}',
    'return C',
    '',
  ].join('\n')

  it('every control of a gated row is disabled — mouse and keyboard', () => {
    const onUpdate = vi.fn()
    const onAddOptional = vi.fn()
    const onRemoveOptional = vi.fn()
    const el = mount(<SchemaHarness text={config('false')} schema={schema} onUpdate={onUpdate} onAddOptional={onAddOptional} onRemoveOptional={onRemoveOptional} />)
    for (const key of ['Speed', 'Fast', 'Mode', 'Level', 'Tint', 'Hotkey', 'Items', 'Rate', 'Extra', 'Other']) {
      const row = rowOf(el, key)
      const controls = [...row.querySelectorAll('input, button, select, textarea')]
      expect(controls.length, key).toBeGreaterThan(0)
      for (const c of controls) {
        // our own controls carry the attribute; ColorPicker / KeybindInput
        // controls are disabled by their <fieldset disabled> (Chromium)
        const disabled = c.hasAttribute('disabled') || !!c.closest('fieldset[disabled]')
        expect(disabled, `${key}: ${c.outerHTML.slice(0, 80)}`).toBe(true)
      }
    }
    // the optional switches carry the attribute themselves
    const toggles = [...el.querySelectorAll('button[title^="Disable"], button[title^="Enable"]')]
    expect(toggles).toHaveLength(2)
    for (const tg of toggles) expect(tg.hasAttribute('disabled')).toBe(true)
    act(() => toggles.forEach(tg => tg.click()))
    expect(onAddOptional).not.toHaveBeenCalled()
    expect(onRemoveOptional).not.toHaveBeenCalled()
    // keyboard path: a gated input can't write even if it gets an event
    typeInto(rowOf(el, 'Speed').querySelector('input'), '9')
    act(() => rowOf(el, 'Fast').querySelector('button').click())
    expect(onUpdate).not.toHaveBeenCalled()
    // the gate itself stays usable
    expect(rowOf(el, 'Enabled').querySelector('button').hasAttribute('disabled')).toBe(false)
  })

  it('switching the gate on enables the rows again', () => {
    const onAddOptional = vi.fn()
    const el = mount(<SchemaHarness text={config('false')} schema={schema} onAddOptional={onAddOptional} />)
    act(() => rowOf(el, 'Enabled').querySelector('button').click())
    expect(rowOf(el, 'Speed').querySelector('input').hasAttribute('disabled')).toBe(false)
    expect(rowOf(el, 'Speed').closest('fieldset[disabled]')).toBeNull()
    const other = rowOf(el, 'Other').querySelector('button[title^="Enable"]')
    expect(other.hasAttribute('disabled')).toBe(false)
    act(() => other.click())
    expect(onAddOptional).toHaveBeenCalledTimes(1)
    expect(onAddOptional.mock.calls[0].slice(0, 3)).toEqual(['Other', '1', 'int'])
  })
})

describe('save failures (review-F8)', () => {
  it('localizes a Lua syntax refusal with its line number', () => {
    expect(describeSaveFailure('config.lua', "Lua syntax error in config.lua: [3:14] '}' expected near 'Hard'", zh))
      .toEqual({ title: 'config.lua 第 3 行有語法錯誤，已取消儲存', detail: "'}' expected near 'Hard'" })
    expect(describeSaveFailure('config.lua', "Lua syntax error in Scripts/config.lua: [12:0] unexpected symbol near '='", UI_TEXT.en))
      .toEqual({ title: 'Syntax error on line 12 of config.lua — not saved', detail: "unexpected symbol near '='" })
  })

  it('a syntax refusal without a position, and any other failure', () => {
    expect(describeSaveFailure('config.lua', 'Lua syntax error in config.lua: Maximum call stack size exceeded', zh))
      .toEqual({ title: 'config.lua 有語法錯誤，已取消儲存', detail: 'Maximum call stack size exceeded' })
    expect(describeSaveFailure('config.lua', 'EPERM: operation not permitted', zh))
      .toEqual({ title: '設定檔儲存失敗: config.lua', detail: 'EPERM: operation not permitted' })
    expect(describeSaveFailure('config.lua', '', zh)).toEqual({ title: '設定檔儲存失敗: config.lua', detail: '' })
  })
})

// ConfigEditorModal against a fake window.api.
async function openModal({ schema, text, saveConfig, t = zh, lang = 'zh-TW' }) {
  const addToast = vi.fn()
  window.api = {
    mods: {
      getConfigSchema: vi.fn(async () => schema),
      readConfig: vi.fn(async () => text),
      getConfigFiles: vi.fn(async () => [{ name: 'config.lua', relativePath: 'config.lua' }]),
      saveConfig: vi.fn(saveConfig || (async () => {})),
    },
  }
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  mounted.push({ root, el })
  await act(async () => {
    root.render(<ConfigEditorModal isOpen mod={{ filename: 'TestMod' }} onClose={() => {}} t={t} lang={lang} addToast={addToast} />)
  })
  await act(async () => {})
  return { el, addToast }
}
const saveButton = (el) => [...el.querySelectorAll('button')].find(b => b.querySelector('.lucide-save'))
const toastText = (node) => {
  const holder = document.createElement('div')
  const r = createRoot(holder)
  act(() => r.render(<span>{node}</span>))
  const txt = holder.textContent
  act(() => r.unmount())
  return txt
}

describe('ConfigEditorModal toasts', () => {
  const commentText = 'local Config = {\n  -- Mode - difficulty preset name\n  Mode = Normal,\n  -- Rate - spawn rate\n  Rate = 5,\n}\nreturn Config\n'

  it('a refused save: localized, line-numbered, long-lived; a retry that works replaces it', async () => {
    let fail = true
    const { el, addToast } = await openModal({
      schema: null,
      text: commentText,
      saveConfig: async () => {
        if (fail) throw new Error("Error invoking remote method 'mods:save-config': Error: Lua syntax error in config.lua: [3:14] '}' expected near 'Hard'")
      },
    })
    typeInto(rowOf(el, 'Mode').querySelector('input'), 'Very Hard')
    await act(async () => { saveButton(el).click() })
    expect(addToast).toHaveBeenCalledTimes(1)
    const [message, type, options] = addToast.mock.calls[0]
    expect(type).toBe('error')
    expect(options.duration).toBeGreaterThanOrEqual(8000)
    expect(toastText(message)).toBe("config.lua 第 3 行有語法錯誤，已取消儲存'}' expected near 'Hard'")

    fail = false
    typeInto(rowOf(el, 'Mode').querySelector('input'), 'Hard')
    await act(async () => { saveButton(el).click() })
    expect(addToast).toHaveBeenCalledTimes(2)
    const [ok, okType, okOptions] = addToast.mock.calls[1]
    expect([ok, okType]).toEqual([zh.toastConfigSaved, 'success'])
    // same tag → ToastContainer swaps the stale error for the success
    expect(okOptions.tag).toBe(options.tag)
    expect(okOptions.duration).toBeUndefined()
  })

  it('an optional key appendKeyval refuses: one error toast, the switch stays off', async () => {
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Speed: { type: 'int' }, Extra: { type: 'int', optional: true, default: 7 } } } } }
    const { el, addToast } = await openModal({ schema, text: 'local Config = {\n    Speed = 1,\n}\nreturn Config\n' })
    appendKeyval.mockImplementationOnce((entries) => entries)
    const toggle = rowOf(el, 'Extra').querySelector('button[aria-pressed]')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { toggle.click() })
    expect(addToast).toHaveBeenCalledTimes(1)
    const [message, type, options] = addToast.mock.calls[0]
    expect(toastText(message)).toBe(zh.toastConfigOptionalRefused.replace('{key}', 'Extra').replace('{file}', 'config.lua'))
    expect(type).toBe('error')
    expect(options.duration).toBeGreaterThanOrEqual(8000)
    expect(rowOf(el, 'Extra').querySelector('button[aria-pressed]').getAttribute('aria-pressed')).toBe('false')

    // accepted → no toast, the switch turns on
    await act(async () => { rowOf(el, 'Extra').querySelector('button[aria-pressed]').click() })
    expect(addToast).toHaveBeenCalledTimes(1)
    expect(rowOf(el, 'Extra').querySelector('button[aria-pressed]').getAttribute('aria-pressed')).toBe('true')
  })

  it('hands appendKeyval the schema section id for its self-check', async () => {
    const schema = { configFile: 'config.lua', sections: { Main: { label: 'Main', keys: { Speed: { type: 'int' }, Extra: { type: 'int', optional: true, default: 7 } } } } }
    const { el } = await openModal({ schema, text: 'local Config = {\n    Speed = 1,\n}\nreturn Config\n' })
    appendKeyval.mockClear()
    await act(async () => { rowOf(el, 'Extra').querySelector('button[aria-pressed]').click() })
    expect(appendKeyval).toHaveBeenCalledTimes(1)
    expect(appendKeyval.mock.calls[0][3]).toMatchObject({ sectionId: 'Main' })
  })

  it('an optional key that can\'t be removed safely: one error toast, the switch stays on', async () => {
    // Removing the only global scalar would leave a lone table, which the
    // parser would then read as the config's root table → removal refused.
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Debug: { type: 'bool', optional: true, default: false } } } } }
    const { el, addToast } = await openModal({ schema, text: 'Debug = true\nWeapons = {\n    Pistol = 5,\n}\n' })
    const toggle = () => rowOf(el, 'Debug').querySelector('button[aria-pressed]')
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    await act(async () => { toggle().click() })
    expect(addToast).toHaveBeenCalledTimes(1)
    const [message, type, options] = addToast.mock.calls[0]
    expect(toastText(message)).toBe(zh.toastConfigOptionalRemoveRefused.replace('{key}', 'Debug').replace('{file}', 'config.lua'))
    expect(type).toBe('error')
    expect(options.duration).toBeGreaterThanOrEqual(8000)
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
  })

  it('passes the localized read-only strings to the renderer', async () => {
    const { el } = await openModal({ schema: null, text: RO_CONFIG })
    const note = el.querySelector('[role="note"]')
    expect(note.textContent).toContain(zh.configReadonlyNoteTitle)
    expect(badgesOf(rowOf(el, 'AllowedWeapons'))).toEqual(['LIST', zh.configReadonlyBadge])
  })
})

describe('useToast', () => {
  const Probe = forwardRef(function Probe(_, ref) {
    const api = useToast()
    useImperativeHandle(ref, () => api)
    return null
  })
  const setup = () => {
    vi.useFakeTimers()
    const ref = { current: null }
    mount(<Probe ref={ref} />)
    return ref
  }

  it('keeps the 3 s default; honours a longer duration', () => {
    const ref = setup()
    act(() => { ref.current.addToast('plain', 'error'); ref.current.addToast('long', 'error', { duration: TOAST_LONG_DURATION_MS }) })
    expect(ref.current.toasts.map(t => t.message)).toEqual(['plain', 'long'])
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS) })
    expect(ref.current.toasts.map(t => t.message)).toEqual(['long'])
    act(() => { vi.advanceTimersByTime(TOAST_LONG_DURATION_MS - TOAST_DURATION_MS) })
    expect(ref.current.toasts).toEqual([])
  })

  it('a toast with the same tag replaces the one still showing', () => {
    const ref = setup()
    act(() => { ref.current.addToast('failed', 'error', { duration: TOAST_LONG_DURATION_MS, tag: 'save' }) })
    act(() => { ref.current.addToast('other', 'info') })
    act(() => { ref.current.addToast('saved', 'success', { tag: 'save' }) })
    expect(ref.current.toasts.map(t => t.message)).toEqual(['other', 'saved'])
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS) })
    expect(ref.current.toasts).toEqual([])
    // the replaced toast's timer is gone too — nothing left to fire
    expect(vi.getTimerCount()).toBe(0)
  })

  it('0 keeps a toast until it is dismissed', () => {
    const ref = setup()
    act(() => { ref.current.addToast('sticky', 'error', { duration: 0 }) })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(ref.current.toasts).toHaveLength(1)
    act(() => { ref.current.dismissToast(ref.current.toasts[0].id) })
    expect(ref.current.toasts).toEqual([])
  })
})
