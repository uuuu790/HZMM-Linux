// @vitest-environment happy-dom
// Regression tests for the config editor UI fixes: float clamping to a tiny
// bound, untyped optional keys typed by their default (array → list, string
// stays text), boolean select options rendering their text, keybind capture
// tied to focus, localized keybind strings, and schema-binding load failures.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import SchemaRenderer from '../../src/renderer/src/components/modals/config-editor/SchemaRenderer.jsx'
import SliderInput from '../../src/renderer/src/components/modals/config-editor/SliderInput.jsx'
import KeybindInput from '../../src/renderer/src/components/modals/config-editor/KeybindInput.jsx'
import ConfigEditorModal from '../../src/renderer/src/components/modals/ConfigEditorModal.jsx'
import { clampToRange, inferKeyType, prepareEntriesForSave } from '../../src/renderer/src/utils/widget-helpers'
import { parseConfigFile, normalizeSchema, buildEntryKeyDefMap, appendKeyval, serializeConfig } from '../../src/renderer/src/utils/config-parser'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

// Pass-through spy, so one test can make the schema binding throw on load.
vi.mock('../../src/renderer/src/utils/config-parser', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, buildEntryKeyDefMap: vi.fn(mod.buildEntryKeyDefMap) }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
  vi.restoreAllMocks()
  delete window.api
})

const lua = (text) => parseConfigFile(text, { syntax: 'lua' })

function typeInto(input, value) {
  act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const blur = (input) => act(() => input.blur())
const keydown = (target, init) => {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(ev) })
  return ev
}

function rowOf(el, label) {
  const lbl = [...el.querySelectorAll('label')].find(l => l.textContent === label)
  if (!lbl) throw new Error(`no row ${label}`)
  return lbl.closest('div.py-3\\.5')
}

describe('clampToRange keeps a clamped float at the bound itself (#9)', () => {
  it('a bound below the 4-decimal precision is not rounded to 0', () => {
    expect(clampToRange('1', { type: 'float', min: 0, max: 0.00004 })).toBe('0.00004')
    expect(clampToRange('5', { type: 'float', min: -0.00003, max: 0.00003 })).toBe('0.00003')
    expect(clampToRange('-5', { type: 'float', min: -0.00003, max: 0.00003 })).toBe('-0.00003')
  })

  it('a bound with more than 4 decimals is kept exactly', () => {
    expect(clampToRange('1', { type: 'float', min: 0, max: 0.00015 })).toBe('0.00015')
    expect(clampToRange('0', { type: 'float', min: 0.12345, max: 1 })).toBe('0.12345')
    expect(clampToRange('-1', { type: 'float', min: 0.00001, max: 1 })).toBe('0.00001')
  })

  it('int clamping and in-range values are unchanged', () => {
    expect(clampToRange('50', { type: 'int', min: 0, max: 10 })).toBe('10')
    expect(clampToRange('-3', { type: 'int', min: 0.5, max: 10 })).toBe('1')
    expect(clampToRange('3.0', { type: 'float', min: 0, max: 10 })).toBe('3.0')
  })

  it('the slider\'s text box clamps to a tiny max instead of 0', () => {
    const onChange = vi.fn()
    function Slider() {
      const [v, setV] = useState('0')
      return <SliderInput value={v} min={0} max={0.00004} step={0.00001} type="float" onChange={(x) => { onChange(x); setV(x) }} />
    }
    const el = mount(<Slider />)
    const text = el.querySelector('input[type="text"]')
    typeInto(text, '1')
    blur(text)
    expect(onChange).toHaveBeenLastCalledWith('0.00004')
  })

  it('a save clamps an out-of-range edit to the tiny bound', () => {
    const schema = normalizeSchema({ configFile: 'config.lua', sections: { S: { keys: { Rate: { type: 'float', min: 0, max: 0.00004 } } } } })
    const entries = lua('local Config = {\n    Rate = 0.00001,\n}\nreturn Config\n')
    const i = entries.findIndex(e => e.key === 'Rate')
    const edited = entries.map((e, j) => (j === i ? { ...e, value: '1' } : e))
    const saved = prepareEntriesForSave(edited, buildEntryKeyDefMap(edited, schema))
    expect(saved[i].value).toBe('0.00004')
  })
})

describe('an untyped optional key is typed by its default (#18, #19)', () => {
  it('inferKeyType: array default → list, string default → text, absent or switched on', () => {
    expect(inferKeyType({ optional: true, default: ['a', 1] }, null)).toBe('list')
    expect(inferKeyType({ optional: true, type: 'array', default: ['a', 1] }, null)).toBe('list')
    expect(inferKeyType({ optional: true, default: ['a', 1] }, { value: '{"a", 1}', isQuoted: false })).toBe('list')
    expect(inferKeyType({ optional: true, default: '0042' }, null)).toBe('string')
    expect(inferKeyType({ optional: true, default: 'true' }, null)).toBe('string')
    expect(inferKeyType({ optional: true, default: 5 }, null)).toBe('int')
    expect(inferKeyType({ optional: true, default: false }, null)).toBe('bool')
    expect(inferKeyType({ optional: true }, null)).toBe('string')
  })

  it('inferKeyType: a one-line array in the file stays a list when the default is an array', () => {
    expect(inferKeyType({ default: ['a'] }, { origValue: '{"a", 1}', value: '{"a", 1}' })).toBe('list')
    // without an array default, an untyped table is still text
    expect(inferKeyType({}, { origValue: '{"a", 1}', value: '{"a", 1}' })).toBe('string')
    expect(inferKeyType({ default: ['a'] }, { origValue: '5', value: '5' })).toBe('int')
  })

  it('prepareEntriesForSave keeps a switched-on array-default line a bare table after an edit', () => {
    const schema = normalizeSchema({ configFile: 'config.lua', sections: { S: { keys: { A: { type: 'int' }, Items: { optional: true, default: ['a', 1] } } } } })
    const base = lua('local Config = {\n    A = 1,\n}\nreturn Config\n')
    const added = appendKeyval(base, 'Items', '{"a", 1}', { isQuoted: false, format: 'lua', sectionId: 'S' })
    const i = added.findIndex(e => e.key === 'Items')
    const edited = added.map((e, j) => (j === i ? { ...e, value: '{"a", "1", "b"}' } : e))
    const saved = prepareEntriesForSave(edited, buildEntryKeyDefMap(edited, schema))
    expect(saved[i].isQuoted).toBe(false)
    // 1 is a JSON number in the default → stays a bare number
    expect(saved[i].value).toBe('{"a", 1, "b"}')
  })
})

// ConfigEditorModal against a fake window.api.
async function openModal({ schema, text, t = UI_TEXT.en, lang = 'en' }) {
  const addToast = vi.fn()
  const saveConfig = vi.fn(async () => {})
  window.api = {
    mods: {
      getConfigSchema: vi.fn(async () => schema),
      readConfig: vi.fn(async () => text),
      getConfigFiles: vi.fn(async () => [{ name: 'config.lua', relativePath: 'config.lua' }]),
      saveConfig,
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
  return { el, addToast, saveConfig }
}
const saveButton = (el) => [...el.querySelectorAll('button')].find(b => b.querySelector('.lucide-save'))
const toggleOf = (el, label) => rowOf(el, label).querySelector('button[aria-pressed]')

describe('switching on an untyped optional key writes it as its default\'s type (#18, #19)', () => {
  it('string defaults stay text, an array default is a table, numbers / bools stay bare', async () => {
    const schema = {
      configFile: 'config.lua',
      sections: { S: { label: 'S', keys: {
        A: { type: 'int' },
        Code: { optional: true, default: '0042' },
        Flag: { optional: true, default: 'true' },
        Items: { optional: true, default: ['a', 1] },
        Arr: { optional: true, type: 'array', default: ['x'] },
        Num: { optional: true, default: 7 },
        On: { optional: true, default: true },
        Pick: { optional: true, options: [1, 2] },
      } } },
    }
    const { el, saveConfig } = await openModal({ schema, text: 'local Config = {\n    A = 1,\n}\nreturn Config\n' })
    // an absent key already shows its default's widget
    expect([...rowOf(el, 'Items').querySelectorAll('span.rounded-full')].map(s => s.textContent)).toContain('LIST')
    for (const k of ['Code', 'Flag', 'Items', 'Arr', 'Num', 'On', 'Pick']) {
      await act(async () => { toggleOf(el, k).click() })
      expect(toggleOf(el, k).getAttribute('aria-pressed')).toBe('true')
    }
    await act(async () => { saveButton(el).click() })
    expect(saveConfig).toHaveBeenCalledTimes(1)
    const written = saveConfig.mock.calls[0][2]
    expect(written).toContain('    Code = "0042",')
    expect(written).toContain('    Flag = "true",')
    expect(written).toContain('    Items = {"a", 1},')
    expect(written).toContain('    Arr = {"x"},')
    expect(written).toContain('    Num = 7,')
    expect(written).toContain('    On = true,')
    expect(written).toContain('    Pick = 1,')

    // reopened: the saved lines read back as the same types
    const reopened = lua(written)
    const typeOf = (key) => inferKeyType(normalizeSchema(schema).sections.S.keys[key], reopened.find(e => e.key === key))
    expect(['Code', 'Flag', 'Items', 'Arr', 'Num', 'On'].map(typeOf)).toEqual(['string', 'string', 'list', 'list', 'int', 'bool'])
  })

  it('the round trip through serializeConfig keeps the quoting', () => {
    const base = lua('local Config = {\n    A = 1,\n}\nreturn Config\n')
    const added = appendKeyval(base, 'Code', '0042', { isQuoted: true, format: 'lua' })
    const schema = normalizeSchema({ configFile: 'config.lua', sections: { S: { keys: { A: { type: 'int' }, Code: { optional: true, default: '0042' } } } } })
    const saved = serializeConfig(prepareEntriesForSave(added, buildEntryKeyDefMap(added, schema)))
    expect(saved).toContain('Code = "0042",')
  })
})

// Schema editor with real entry state.
function SchemaHarness({ text, schema }) {
  const [entries, setEntries] = useState(() => lua(text))
  return (
    <SchemaRenderer
      schema={normalizeSchema(schema)}
      entries={entries}
      lang="en"
      onUpdateValue={(i, v) => setEntries(p => p.map((e, j) => (j === i ? { ...e, value: v } : e)))}
      onAddOptional={() => {}}
      onRemoveOptional={() => {}}
    />
  )
}

describe('boolean select options render their text (#15)', () => {
  const schema = {
    configFile: 'config.lua',
    sections: { S: { label: 'S', keys: {
      Hardcore: { type: 'select', options: [true, false] },
      Mode: { type: 'select', options: [{ value: true }, { value: false }, { value: 'auto' }] },
      Flags: { type: 'multi-select', options: [true, false, 'x'] },
    } } },
  }
  const text = 'local Config = {\n    Hardcore = false,\n    Mode = true,\n    Flags = {"x"},\n}\nreturn Config\n'

  it('pills show true / false, and the active one is the file\'s value', () => {
    const el = mount(<SchemaHarness text={text} schema={schema} />)
    const pills = [...rowOf(el, 'Hardcore').querySelectorAll('button[aria-pressed]')]
    expect(pills.map(b => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['true', 'false'], ['false', 'true']])
  })

  it('dropdown items show true / false', () => {
    const el = mount(<SchemaHarness text={text} schema={schema} />)
    const row = rowOf(el, 'Mode')
    act(() => { row.querySelector('fieldset button').click() })
    const items = [...row.querySelectorAll('fieldset div.absolute button')].map(b => b.textContent)
    expect(items).toEqual(['true', 'false', 'auto'])
  })

  it('multi-select items show true / false', () => {
    const el = mount(<SchemaHarness text={text} schema={schema} />)
    const row = rowOf(el, 'Flags')
    act(() => { row.querySelector('fieldset button').click() })
    const items = [...row.querySelectorAll('fieldset div.absolute button')].map(b => b.textContent)
    expect(items).toEqual(['true', 'false', 'x'])
  })
})

function TwoKeybinds({ log }) {
  const [a, setA] = useState('F1')
  const [b, setB] = useState('F2')
  return (
    <div>
      <div id="a"><KeybindInput value={a} onChange={(v) => { log.push(['A', v]); setA(v) }} /></div>
      <div id="b"><KeybindInput value={b} onChange={(v) => { log.push(['B', v]); setB(v) }} /></div>
      <input id="search" />
    </div>
  )
}

describe('keybind capture is tied to focus (#11)', () => {
  it('clicking another keybind stops the first: one key changes one binding', () => {
    const log = []
    const el = mount(<TwoKeybinds log={log} />)
    const btnA = el.querySelector('#a button')
    const btnB = el.querySelector('#b button')
    act(() => btnA.click())
    expect(btnA.textContent).toBe('Press any key…')
    act(() => btnB.click())
    expect(btnA.textContent).toBe('F1')
    keydown(btnB, { key: 'F6', code: 'F6' })
    expect(log).toEqual([['B', 'F6']])
    expect(btnA.textContent).toBe('F1')
    expect(btnB.textContent).toBe('F6')
  })

  it('focus moving to the search box stops recording and the key reaches the box', () => {
    const log = []
    const el = mount(<TwoKeybinds log={log} />)
    const btnA = el.querySelector('#a button')
    const search = el.querySelector('#search')
    act(() => btnA.click())
    act(() => search.focus())
    expect(btnA.textContent).toBe('F1')
    const ev = keydown(search, { key: 'f', code: 'KeyF' })
    expect(ev.defaultPrevented).toBe(false)
    expect(log).toEqual([])
  })

  it('a key pressed while focus is elsewhere (no blur seen) is not captured', () => {
    const log = []
    const el = mount(<TwoKeybinds log={log} />)
    const btnA = el.querySelector('#a button')
    const search = el.querySelector('#search')
    act(() => btnA.click())
    // move focus without React seeing a blur on the button
    const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(search)
    const ev = keydown(search, { key: 'f', code: 'KeyF' })
    spy.mockRestore()
    expect(ev.defaultPrevented).toBe(false)
    expect(log).toEqual([])
    expect(btnA.textContent).toBe('F1')
  })

  it('still records the next key while focused, and Escape cancels', () => {
    const log = []
    const el = mount(<TwoKeybinds log={log} />)
    const btnA = el.querySelector('#a button')
    act(() => btnA.click())
    keydown(btnA, { key: 'Escape', code: 'Escape' })
    expect(btnA.textContent).toBe('F1')
    act(() => btnA.click())
    keydown(btnA, { key: 'F7', code: 'F7' })
    expect(log).toEqual([['A', 'F7']])
  })
})

describe('keybind strings follow the app language (#13, #16)', () => {
  const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Hotkey: { type: 'keybind' }, Other: { type: 'keybind' } } } } }
  const text = 'local Config = {\n    Hotkey = "",\n    Other = "F6",\n}\nreturn Config\n'

  for (const lang of Object.keys(UI_TEXT)) {
    it(`${lang}: placeholder, recording prompt and clear button`, async () => {
      const t = UI_TEXT[lang]
      const { el } = await openModal({ schema, text, t, lang })
      const button = rowOf(el, 'Hotkey').querySelector('fieldset button')
      expect(button.textContent).toBe(t.configKeybindEmpty)
      await act(async () => { button.click() })
      expect(button.textContent).toBe(t.configKeybindRecording)
      expect(rowOf(el, 'Other').querySelector(`button[title="${t.configKeybindClear}"]`)).not.toBeNull()
    })
  }

  it('the translations are not English copies', () => {
    for (const lang of Object.keys(UI_TEXT)) {
      if (lang === 'en') continue
      for (const k of ['configKeybindRecording', 'configKeybindEmpty', 'configKeybindClear']) {
        expect(UI_TEXT[lang][k], `${lang}.${k}`).not.toBe(UI_TEXT.en[k])
      }
    }
  })

  it('English fallbacks without localized strings, no hard-coded Chinese', () => {
    const el = mount(<KeybindInput value="" onChange={() => {}} />)
    const button = el.querySelector('button')
    expect(button.textContent).toBe('Click to set')
    act(() => button.click())
    expect(button.textContent).toBe('Press any key…')
  })
})

describe('schema load: a binding failure is not reported as a missing file', () => {
  it('logs the error and falls back to comment mode', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    buildEntryKeyDefMap.mockImplementationOnce(() => { throw new TypeError('boom') })
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Speed: { type: 'int' } } } } }
    const { el } = await openModal({ schema, text: 'local Config = {\n    -- Speed - how fast\n    Speed = 1,\n}\nreturn Config\n' })
    expect(err).toHaveBeenCalledWith('Config schema binding failed:', expect.any(TypeError))
    // comment mode still shows the file
    expect(rowOf(el, 'Speed')).toBeTruthy()
  })

  it('a file that can\'t be read falls back quietly', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Speed: { type: 'int' } } } } }
    window.api = {
      mods: {
        getConfigSchema: vi.fn(async () => schema),
        readConfig: vi.fn(async () => { throw new Error('ENOENT') }),
        getConfigFiles: vi.fn(async () => []),
        saveConfig: vi.fn(),
      },
    }
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    mounted.push({ root, el })
    await act(async () => {
      root.render(<ConfigEditorModal isOpen mod={{ filename: 'TestMod' }} onClose={() => {}} t={UI_TEXT.en} lang="en" addToast={vi.fn()} />)
    })
    await act(async () => {})
    expect(err).not.toHaveBeenCalled()
    expect(window.api.mods.getConfigFiles).toHaveBeenCalled()
  })
})
