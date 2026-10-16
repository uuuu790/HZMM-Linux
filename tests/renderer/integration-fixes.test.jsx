// @vitest-environment happy-dom
// Cross-group integration regressions for the config editor: a sniffed file
// is re-parsed after a save with the syntax it was loaded as; the
// multi-select summary is localized through the same readonlyText bundle as
// the keybind strings; gateValue treats the entries the parser now marks
// read-only (undecodable escapes, leading-operator continuations) as "no
// plain value"; a layout-aware keybind reaches the saved file end to end.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ConfigEditorModal from '../../src/renderer/src/components/modals/ConfigEditorModal.jsx'
import SchemaRenderer from '../../src/renderer/src/components/modals/config-editor/SchemaRenderer.jsx'
import MultiSelectInput from '../../src/renderer/src/components/modals/config-editor/MultiSelectInput.jsx'
import { parseConfigFile, normalizeSchema } from '../../src/renderer/src/utils/config-parser'
import { gateValue } from '../../src/renderer/src/utils/readonly-preview'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

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
const table = (...lines) => ['local Config = {', ...lines, '}', 'return Config', ''].join('\n')
const labelOf = (el, text) => [...el.querySelectorAll('label')].find(l => l.textContent === text)
function rowOf(el, label) {
  const lbl = labelOf(el, label)
  if (!lbl) throw new Error(`no row ${label}`)
  return lbl.closest('div.py-3\\.5')
}
function typeInto(input, value) {
  act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const saveButton = (el) => [...el.querySelectorAll('button')].find(b => b.querySelector('.lucide-save'))
const textInputWith = (el, value) => [...el.querySelectorAll('input')].find(i => i.value === value)

// ConfigEditorModal against a fake window.api; `schema` null → comment mode.
async function openModal({ schema = null, text, file = 'config.lua', t = UI_TEXT.en, lang = 'en' }) {
  const saveConfig = vi.fn(async () => {})
  window.api = {
    mods: {
      getConfigSchema: vi.fn(async () => schema),
      readConfig: vi.fn(async () => text),
      getConfigFiles: vi.fn(async () => [{ name: file, relativePath: file }]),
      saveConfig,
    },
  }
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  mounted.push({ root, el })
  await act(async () => {
    root.render(<ConfigEditorModal isOpen mod={{ filename: 'TestMod' }} onClose={() => {}} t={t} lang={lang} addToast={vi.fn()} />)
  })
  await act(async () => {})
  return { el, saveConfig }
}

describe('a sniffed file keeps its syntax across a save', () => {
  it('a `{` typed into a header-less INI value does not re-parse the file as Lua', async () => {
    const text = '; Server settings\nName = Bob ; the name\nMotd = hi there\nCount = 3\n'
    const { el, saveConfig } = await openModal({ text, file: 'settings.txt' })
    typeInto(textInputWith(el, 'Bob'), '{Clan} Bob')
    await act(async () => { saveButton(el).click() })
    expect(saveConfig.mock.calls[0][2]).toBe('; Server settings\nName = {Clan} Bob ; the name\nMotd = hi there\nCount = 3\n')

    // Still INI in the session: Name stays editable, and the next edit is
    // written INI-style (no Lua quotes).
    expect(textInputWith(el, '{Clan} Bob')).toBeTruthy()
    typeInto(textInputWith(el, 'hi there'), 'hello all')
    await act(async () => { saveButton(el).click() })
    expect(saveConfig.mock.calls[1][2]).toBe('; Server settings\nName = {Clan} Bob ; the name\nMotd = hello all\nCount = 3\n')
  })

  it('a sniffed Lua file is re-parsed with the hybrid (non-strict) rules it was loaded with', async () => {
    const text = '-- c\nMaxZombies = 50\n*** Loot ***\nLootRate = 2\n'
    const { el, saveConfig } = await openModal({ text, file: 'config.txt' })
    typeInto(textInputWith(el, '50'), '60')
    await act(async () => { saveButton(el).click() })
    expect(saveConfig.mock.calls[0][2]).toBe('-- c\nMaxZombies = 60\n*** Loot ***\nLootRate = 2\n')
    // both rows still editable after the re-parse
    expect(textInputWith(el, '60')).toBeTruthy()
    expect(textInputWith(el, '2')).toBeTruthy()
  })
})

describe('multi-select summary follows the app language', () => {
  const schema = {
    configFile: 'config.lua',
    sections: { S: { label: 'S', keys: {
      Empty: { type: 'multi-select', options: ['a', 'b', 'c'] },
      Many: { type: 'multi-select', options: ['a', 'b', 'c'] },
    } } },
  }
  const text = table('    Empty = {},', '    Many = {"a", "b", "c"},')

  for (const lang of Object.keys(UI_TEXT)) {
    it(`${lang}: none / N selected`, async () => {
      const t = UI_TEXT[lang]
      const { el } = await openModal({ schema, text, t, lang })
      expect(rowOf(el, 'Empty').querySelector('fieldset button').textContent).toBe(t.configMultiSelectNone)
      expect(rowOf(el, 'Many').querySelector('fieldset button').textContent)
        .toBe(t.configMultiSelectCount.split('{count}').join('3'))
    })
  }

  it('every locale has the strings, with a {count} slot', () => {
    for (const [lang, t] of Object.entries(UI_TEXT)) {
      expect(t.configMultiSelectNone, lang).toBeTruthy()
      expect(t.configMultiSelectCount, lang).toContain('{count}')
    }
  })

  it('English fallbacks without localized strings, no hard-coded Chinese', () => {
    const el = mount(<MultiSelectInput value="{}" options={[{ value: 'a' }]} onChange={() => {}} />)
    expect(el.querySelector('button').textContent).toBe('None')
    const many = mount(<MultiSelectInput value='{"a", "b", "c"}' options={[{ value: 'a' }]} onChange={() => {}} />)
    expect(many.querySelector('button').textContent).toBe('3 selected')
  })
})

describe('gateValue on the entries the parser marks read-only', () => {
  const entries = lua(table(
    '    A = "\\72ard",',
    '    B = "caf\\u{E9}",',
    '    C = "Hard",',
    '    D = {"\\x41", "b"},',
    '    E = 60',
    '        * 5,',
    '    F = false',
    '        or true,',
    '    G = "Ha"',
    '        .. "rd",',
  ))
  const entry = (key) => entries.find(e => e.type === 'keyval' && e.key === key)

  it('an undecodable escape or a continued expression has no plain value', () => {
    for (const k of ['A', 'B', 'D', 'E', 'F', 'G']) {
      expect(entry(k).readonly, k).toBe(true)
      expect(gateValue(entry(k)), k).toBeNull()
    }
    expect(gateValue(entry('C'))).toBe('Hard')
  })

  const renderSchema = (text, schema) => mount(
    <SchemaRenderer
      schema={normalizeSchema(schema)}
      entries={lua(text)}
      lang="en"
      onUpdateValue={() => {}}
      onAddOptional={() => {}}
      onRemoveOptional={() => {}}
    />,
  )

  it('showWhen does not hide a row behind a string it cannot decode', () => {
    const dep = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Mode: { type: 'string' }, HardBonus: { type: 'int', showWhen: { Mode: 'Hard' } } } } } }
    expect(labelOf(renderSchema(table('    Mode = "\\72ard",', '    HardBonus = 1,'), dep), 'HardBonus')).toBeTruthy()
  })

  it('enableKey is not switched off by a continued expression that starts with false', () => {
    const gated = { configFile: 'config.lua', sections: { S: { label: 'S', enableKey: 'Enabled', keys: { Enabled: { type: 'bool' }, Speed: { type: 'int' } } } } }
    const el = renderSchema(table('    Enabled = false', '        or true,', '    Speed = 5,'), gated)
    const input = rowOf(el, 'Speed').querySelector('input')
    expect(input.hasAttribute('disabled') || !!input.closest('fieldset[disabled]')).toBe(false)
  })
})

describe('keybind: localized widget + layout-aware capture, end to end', () => {
  it('QWERTZ Ctrl + the key printed Z is saved as Ctrl+Z', async () => {
    const t = UI_TEXT.de
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Hotkey: { type: 'keybind' } } } } }
    const { el, saveConfig } = await openModal({ schema, text: table('    Hotkey = "",'), t, lang: 'de' })
    const button = rowOf(el, 'Hotkey').querySelector('fieldset button')
    expect(button.textContent).toBe(t.configKeybindEmpty)
    await act(async () => { button.click() })
    expect(button.textContent).toBe(t.configKeybindRecording)
    // physical KeyY, which a QWERTZ layout reports as VK_Z (90)
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', code: 'KeyY', ctrlKey: true })
    Object.defineProperty(ev, 'keyCode', { value: 90 })
    await act(async () => { button.dispatchEvent(ev) })
    expect(button.textContent).toBe('Ctrl+Z')
    await act(async () => { saveButton(el).click() })
    expect(saveConfig.mock.calls[0][2]).toContain('    Hotkey = "Ctrl+Z",')
  })
})
