// @vitest-environment happy-dom
// Regression tests: gating (enableKey / Enable*, showWhen / "Active when")
// compares a read-only line's own value, not its whole multi-statement text;
// a field on the root table's closing line (`Enabled = false }`) previews
// without the `}`; capping a long value never splits a surrogate pair.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import SchemaRenderer, { inferRowType } from '../../src/renderer/src/components/modals/config-editor/SchemaRenderer.jsx'
import CommentModeRenderer, { commentValueType } from '../../src/renderer/src/components/modals/config-editor/CommentModeRenderer.jsx'
import {
  readonlyPreview, readonlyFullValue, readonlyTooltip, valueShape, gateValue,
} from '../../src/renderer/src/utils/readonly-preview'
import { parseConfigFile, normalizeSchema } from '../../src/renderer/src/utils/config-parser'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const lua = (text) => parseConfigFile(text, { syntax: 'lua' })
const entryOf = (text, key) => lua(text).find(e => e.type === 'keyval' && e.key === key)
const table = (...lines) => ['local Config = {', ...lines, '}', 'return Config', ''].join('\n')

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
})

const labelOf = (el, text) => [...el.querySelectorAll('label')].find(l => l.textContent === text)
function rowOf(el, label) {
  const lbl = labelOf(el, label)
  if (!lbl) throw new Error(`no row ${label}`)
  return lbl.closest('div.py-3\\.5')
}
const inputDisabled = (el, label) => {
  const input = rowOf(el, label).querySelector('input')
  return input.hasAttribute('disabled') || !!input.closest('fieldset[disabled]')
}

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
const renderComment = (text) => mount(<CommentModeRenderer entries={lua(text)} lang="en" onUpdateValue={() => {}} />)

describe('gateValue', () => {
  it('returns an editable entry\'s value unchanged', () => {
    expect(gateValue(entryOf(table('  Mode = "Hard",'), 'Mode'))).toBe('Hard')
    expect(gateValue(entryOf(table('  Enabled = false,'), 'Enabled'))).toBe('false')
    expect(gateValue(undefined)).toBeUndefined()
  })

  it('reduces a read-only line to this key\'s own scalar', () => {
    expect(gateValue(entryOf(table('  Enabled = false, Debug = false,'), 'Enabled'))).toBe('false')
    expect(gateValue(entryOf(table('  Speed = 5; Other = 1'), 'Speed'))).toBe('5')
    expect(gateValue(entryOf('Enabled = false; Speed = 5\nX = 1\n', 'Enabled'))).toBe('false')
  })

  it('strips one layer of quotes from a plain string', () => {
    expect(gateValue(entryOf(table('  Mode = "Hard", Other = 1,'), 'Mode'))).toBe('Hard')
    expect(gateValue(entryOf(table("  Mode = 'it\"s', Other = 1,"), 'Mode'))).toBe('it"s')
  })

  it('is null for a value that isn\'t a plain scalar', () => {
    expect(gateValue(entryOf(table('  Mode = "a\\"b", Other = 1,'), 'Mode'))).toBeNull()
    expect(gateValue(entryOf(table('  List = { 1, 2 }, Other = 1,'), 'List'))).toBeNull()
    expect(gateValue(entryOf(table('  Items = {', '    "a",', '  },'), 'Items'))).toBeNull()
    expect(gateValue(entryOf(table('  Fn = function() return 1 end, Other = 1,'), 'Fn'))).toBeNull()
  })

  it('drops the root table\'s closing brace on the same line', () => {
    const text = 'local Config = {\n    A = 1,\n    Enabled = false }\nreturn Config\n'
    expect(gateValue(entryOf(text, 'Enabled'))).toBe('false')
  })
})

describe('ownValue stops at an unmatched closing bracket (root `}` on the line)', () => {
  it('previews, types and shapes the value without the brace', () => {
    expect(readonlyPreview('false }')).toBe('false')
    expect(readonlyPreview('2 } -- end')).toBe('2')
    expect(readonlyPreview('{"a", "b"} }')).toBe('{"a", "b"}')
    expect(readonlyPreview('{ x = 1 } }')).toBe('{ x = 1 }')
    expect(valueShape('{"a", "b"} }')).toBe('list')
    expect(valueShape('{ x = 1 } }')).toBe('table')
    // a string's `}` is still not a bracket
    expect(readonlyPreview('"a }" }')).toBe('"a }"')
  })

  it('badges a closing-line field by its own value', () => {
    const e = entryOf('local Config = {\n    A = 1,\n    B = 2 } -- end\nreturn Config\n', 'B')
    expect(e.readonly).toBe(true)
    expect(commentValueType(e)).toBe('int')
    expect(inferRowType({}, e)).toBe('int')
  })
})

describe('cap never splits a surrogate pair', () => {
  it('readonlyFullValue / readonlyTooltip stay well-formed at the cut', () => {
    const full = readonlyFullValue('{ "' + 'a'.repeat(295) + '😀😀😀" }')
    expect(full.isWellFormed()).toBe(true)
    expect(full.endsWith('…')).toBe(true)
    expect(full.length).toBeLessThanOrEqual(300)
    expect(readonlyFullValue('x'.repeat(298) + '😀😀', { isQuoted: true }).isWellFormed()).toBe(true)
    const tip = readonlyTooltip('{ "' + 'b'.repeat(1995) + '😀😀😀" }')
    expect(tip.isWellFormed()).toBe(true)
    expect(tip.length).toBeLessThanOrEqual(2000)
  })

  it('still cuts at max - 1 when no pair straddles it', () => {
    const full = readonlyFullValue('y'.repeat(400), { isQuoted: true })
    expect(full).toBe('y'.repeat(299) + '…')
  })
})

describe('SchemaRenderer gating on a read-only gate / dependency', () => {
  const gated = {
    configFile: 'config.lua',
    sections: { S: { label: 'S', enableKey: 'Enabled', keys: { Enabled: { type: 'bool' }, Speed: { type: 'int' } } } },
  }

  it('enableKey false on a two-statement line disables the section', () => {
    const el = renderSchema(table('    Enabled = false, Debug = false,', '    Speed = 5,'), gated)
    expect(inputDisabled(el, 'Speed')).toBe(true)
  })

  it('enableKey true on a two-statement line leaves it enabled', () => {
    const el = renderSchema(table('    Enabled = true, Debug = false,', '    Speed = 5,'), gated)
    expect(inputDisabled(el, 'Speed')).toBe(false)
  })

  it('enableKey false on the root table\'s closing line disables the section', () => {
    const el = renderSchema('local Config = {\n    Speed = 5,\n    Enabled = false }\nreturn Config\n', gated)
    expect(inputDisabled(el, 'Speed')).toBe(true)
  })

  const dep = {
    configFile: 'config.lua',
    sections: { S: { label: 'S', keys: { Mode: { type: 'string' }, HardBonus: { type: 'int', showWhen: { Mode: 'Hard' } } } } },
  }

  it('showWhen matches a read-only dependency\'s own (unquoted) value', () => {
    expect(labelOf(renderSchema(table('    Mode = "Hard", Other = 1,', '    HardBonus = 1,'), dep), 'HardBonus')).toBeTruthy()
    expect(labelOf(renderSchema(table('    Mode = "Easy", Other = 1,', '    HardBonus = 1,'), dep), 'HardBonus')).toBeUndefined()
  })

  it('a read-only dependency without a plain value never hides the row', () => {
    const el = renderSchema(table('    Mode = { "Hard" }, Other = 1,', '    HardBonus = 1,'), dep)
    expect(labelOf(el, 'HardBonus')).toBeTruthy()
  })
})

describe('CommentModeRenderer gating on a read-only gate / dependency', () => {
  it('"Active when" matches a read-only dependency\'s own value', () => {
    const on = renderComment(table('    Mode = "Fixed", Other = 1,', '    -- Active when Mode = "Fixed"', '    FixedRadius = 1800,'))
    expect(inputDisabled(on, 'FixedRadius')).toBe(false)
    const off = renderComment(table('    Mode = "Free", Other = 1,', '    -- Active when Mode = "Fixed"', '    FixedRadius = 1800,'))
    expect(inputDisabled(off, 'FixedRadius')).toBe(true)
  })

  it('a read-only dependency without a plain value never disables the row', () => {
    const el = renderComment(table('    Mode = { "Fixed" }, Other = 1,', '    -- Active when Mode = "Fixed"', '    FixedRadius = 1800,'))
    expect(inputDisabled(el, 'FixedRadius')).toBe(false)
  })

  it('an Enable* key false on a two-statement line disables its siblings', () => {
    const el = renderComment(table('    EnableRadius = false, RadiusMode = "Fixed",', '    Speed = 2,'))
    expect(inputDisabled(el, 'Speed')).toBe(true)
    const on = renderComment(table('    EnableRadius = true, RadiusMode = "Fixed",', '    Speed = 2,'))
    expect(inputDisabled(on, 'Speed')).toBe(false)
  })
})
