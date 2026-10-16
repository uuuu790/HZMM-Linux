import { describe, it, expect } from 'vitest'
import {
  codeToUe4ssKey,
  vkToUe4ssKey,
  buildKeybind,
  normalizeKeybind,
  KEY_NAMES,
  MODIFIERS,
} from '../../src/renderer/src/utils/keybind'

const DIGITS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']

// Names registered in UE4SS's Lua `Key` table (RE-UE4SS UE4SS/src/Mod/LuaMod.cpp
// register_input_globals; also listed at the bottom of the bundled
// Mods/Keybinds/Scripts/main.lua). Everything HZMM emits must be in here.
const UE4SS_KEY_TABLE = new Set([
  'LEFT_MOUSE_BUTTON', 'RIGHT_MOUSE_BUTTON', 'CANCEL', 'MIDDLE_MOUSE_BUTTON', 'XBUTTON_ONE', 'XBUTTON_TWO',
  'BACKSPACE', 'TAB', 'CLEAR', 'RETURN', 'PAUSE', 'CAPS_LOCK', 'IME_KANA', 'IME_HANGUEL', 'IME_HANGUL',
  'IME_ON', 'IME_JUNJA', 'IME_FINAL', 'IME_HANJA', 'IME_KANJI', 'IME_OFF', 'ESCAPE', 'IME_CONVERT',
  'IME_NONCONVERT', 'IME_ACCEPT', 'IME_MODECHANGE', 'SPACE', 'PAGE_UP', 'PAGE_DOWN', 'END', 'HOME',
  'LEFT_ARROW', 'UP_ARROW', 'RIGHT_ARROW', 'DOWN_ARROW', 'SELECT', 'PRINT', 'EXECUTE', 'PRINT_SCREEN',
  'INS', 'DEL', 'HELP', ...DIGITS,
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  'LEFT_WIN', 'RIGHT_WIN', 'APPS', 'SLEEP', ...DIGITS.map((d) => `NUM_${d}`),
  'MULTIPLY', 'ADD', 'SEPARATOR', 'SUBTRACT', 'DECIMAL', 'DIVIDE',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'NUM_LOCK', 'SCROLL_LOCK', 'BROWSER_BACK', 'BROWSER_FORWARD', 'BROWSER_REFRESH', 'BROWSER_STOP',
  'BROWSER_SEARCH', 'BROWSER_FAVORITES', 'BROWSER_HOME', 'VOLUME_MUTE', 'VOLUME_DOWN', 'VOLUME_UP',
  'MEDIA_NEXT_TRACK', 'MEDIA_PREV_TRACK', 'MEDIA_STOP', 'MEDIA_PLAY_PAUSE', 'LAUNCH_MAIL',
  'LAUNCH_MEDIA_SELECT', 'LAUNCH_APP1', 'LAUNCH_APP2', 'OEM_ONE', 'OEM_PLUS', 'OEM_COMMA', 'OEM_MINUS',
  'OEM_PERIOD', 'OEM_TWO', 'OEM_THREE', 'OEM_FOUR', 'OEM_FIVE', 'OEM_SIX', 'OEM_SEVEN', 'OEM_EIGHT',
  'OEM_102', 'IME_PROCESS', 'PACKET', 'ATTN', 'CRSEL', 'EXSEL', 'EREOF', 'PLAY', 'ZOOM', 'PA1', 'OEM_CLEAR',
])

// KeyboardEvent.code → the keyCode Chromium on Windows reports for that key
// on the US layout (the Windows VK; NumLock on).
const US_VK = {
  Space: 0x20, Enter: 0x0d, NumpadEnter: 0x0d, Tab: 0x09, Escape: 0x1b, Backspace: 0x08,
  Insert: 0x2d, Delete: 0x2e, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27, CapsLock: 0x14,
  NumLock: 0x90, ScrollLock: 0x91, Pause: 0x13, PrintScreen: 0x2c, ContextMenu: 0x5d,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f,
  Semicolon: 0xba, Equal: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe, Slash: 0xbf, Backquote: 0xc0,
  BracketLeft: 0xdb, Backslash: 0xdc, BracketRight: 0xdd, Quote: 0xde, IntlBackslash: 0xe2,
  ControlLeft: 0x11, ControlRight: 0x11, ShiftLeft: 0x10, ShiftRight: 0x10, AltLeft: 0x12,
  AltRight: 0x12, MetaLeft: 0x5b, MetaRight: 0x5c,
}
for (let i = 0; i < 26; i++) US_VK[`Key${String.fromCharCode(65 + i)}`] = 0x41 + i
for (let d = 0; d < 10; d++) { US_VK[`Digit${d}`] = 0x30 + d; US_VK[`Numpad${d}`] = 0x60 + d }
for (let n = 1; n <= 24; n++) US_VK[`F${n}`] = 0x6f + n

// A keydown as Chromium delivers it: `code` is the physical (US-QWERTY)
// position, `keyCode` the layout's VK. Defaults to the US-layout VK.
const ev = (code, mods = {}, keyCode = US_VK[code]) => ({
  code, keyCode,
  ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
  ...mods,
})

describe('vkToUe4ssKey', () => {
  it('maps VK_A..VK_Z, VK_0..9, VK_NUMPAD0..9 and VK_F1..F24', () => {
    for (let i = 0; i < 26; i++) expect(vkToUe4ssKey(0x41 + i)).toBe(String.fromCharCode(65 + i))
    DIGITS.forEach((name, d) => {
      expect(vkToUe4ssKey(0x30 + d)).toBe(name)
      expect(vkToUe4ssKey(0x60 + d)).toBe(`NUM_${name}`)
    })
    for (let n = 1; n <= 24; n++) expect(vkToUe4ssKey(0x6f + n)).toBe(`F${n}`)
  })

  it('maps VK_OEM_* codes to the matching UE4SS names', () => {
    const table = {
      0xba: 'OEM_ONE', 0xbb: 'OEM_PLUS', 0xbc: 'OEM_COMMA', 0xbd: 'OEM_MINUS', 0xbe: 'OEM_PERIOD',
      0xbf: 'OEM_TWO', 0xc0: 'OEM_THREE', 0xdb: 'OEM_FOUR', 0xdc: 'OEM_FIVE', 0xdd: 'OEM_SIX',
      0xde: 'OEM_SEVEN', 0xdf: 'OEM_EIGHT', 0xe2: 'OEM_102',
    }
    for (const [vk, name] of Object.entries(table)) expect(vkToUe4ssKey(Number(vk))).toBe(name)
  })

  it('returns null for modifier VKs and VKs UE4SS has no name for', () => {
    for (const vk of [0, 229, 0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xb3, 0xff, undefined, null, '65']) {
      expect(vkToUe4ssKey(vk)).toBe(null)
    }
  })
})

describe('codeToUe4ssKey', () => {
  it('maps letters KeyA..KeyZ to A..Z', () => {
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(codeToUe4ssKey(`Key${l}`)).toBe(l)
  })

  it('maps Digit0..9 to ZERO..NINE and Numpad0..9 to NUM_ZERO..NUM_NINE', () => {
    DIGITS.forEach((name, d) => {
      expect(codeToUe4ssKey(`Digit${d}`)).toBe(name)
      expect(codeToUe4ssKey(`Numpad${d}`)).toBe(`NUM_${name}`)
    })
  })

  it('maps F1..F24 to themselves', () => {
    for (let n = 1; n <= 24; n++) expect(codeToUe4ssKey(`F${n}`)).toBe(`F${n}`)
  })

  it('maps navigation / editing / lock keys', () => {
    const table = {
      ArrowUp: 'UP_ARROW', ArrowDown: 'DOWN_ARROW', ArrowLeft: 'LEFT_ARROW', ArrowRight: 'RIGHT_ARROW',
      Enter: 'RETURN', NumpadEnter: 'RETURN', Space: 'SPACE', Tab: 'TAB', Escape: 'ESCAPE',
      Backspace: 'BACKSPACE', Insert: 'INS', Delete: 'DEL', Home: 'HOME', End: 'END',
      PageUp: 'PAGE_UP', PageDown: 'PAGE_DOWN', CapsLock: 'CAPS_LOCK', NumLock: 'NUM_LOCK',
      ScrollLock: 'SCROLL_LOCK', Pause: 'PAUSE', PrintScreen: 'PRINT_SCREEN', ContextMenu: 'APPS',
    }
    for (const [code, name] of Object.entries(table)) expect(codeToUe4ssKey(code)).toBe(name)
  })

  it('maps numpad operators', () => {
    expect(codeToUe4ssKey('NumpadMultiply')).toBe('MULTIPLY')
    expect(codeToUe4ssKey('NumpadAdd')).toBe('ADD')
    expect(codeToUe4ssKey('NumpadSubtract')).toBe('SUBTRACT')
    expect(codeToUe4ssKey('NumpadDecimal')).toBe('DECIMAL')
    expect(codeToUe4ssKey('NumpadDivide')).toBe('DIVIDE')
  })

  it('maps OEM punctuation by US-layout position', () => {
    const table = {
      Semicolon: 'OEM_ONE', Equal: 'OEM_PLUS', Comma: 'OEM_COMMA', Minus: 'OEM_MINUS',
      Period: 'OEM_PERIOD', Slash: 'OEM_TWO', Backquote: 'OEM_THREE', BracketLeft: 'OEM_FOUR',
      Backslash: 'OEM_FIVE', BracketRight: 'OEM_SIX', Quote: 'OEM_SEVEN', IntlBackslash: 'OEM_102',
    }
    for (const [code, name] of Object.entries(table)) expect(codeToUe4ssKey(code)).toBe(name)
  })

  it('returns null for modifiers and keys UE4SS has no name for', () => {
    for (const code of [
      'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight',
      'MetaLeft', 'MetaRight', 'Fn', 'NumpadEqual', 'NumpadComma', 'IntlRo', 'Lang1',
      'Unidentified', '', undefined, null, 'constructor', 'toString', 'A', 'a',
    ]) {
      expect(codeToUe4ssKey(code)).toBe(null)
    }
  })

  it('only emits names that exist in the UE4SS Key table', () => {
    expect(KEY_NAMES.length).toBeGreaterThan(100)
    for (const name of KEY_NAMES) expect(UE4SS_KEY_TABLE.has(name)).toBe(true)
    // Every emitted name is already upper-case, so the pre-1.7 doc sample
    // `Key[name:upper()]` resolves it too.
    for (const name of KEY_NAMES) expect(name).toBe(name.toUpperCase())
  })
})

describe('buildKeybind', () => {
  it('returns the bare key name without modifiers', () => {
    expect(buildKeybind(ev('F6'))).toBe('F6')
    expect(buildKeybind(ev('Numpad1'))).toBe('NUM_ONE')
    expect(buildKeybind(ev('ArrowUp'))).toBe('UP_ARROW')
    expect(buildKeybind(ev('Comma'))).toBe('OEM_COMMA')
    expect(buildKeybind(ev('Space'))).toBe('SPACE')
    expect(buildKeybind(ev('Enter'))).toBe('RETURN')
  })

  it('orders modifiers Ctrl, Shift, Alt regardless of event flag order', () => {
    expect(buildKeybind(ev('KeyT', { ctrlKey: true }))).toBe('Ctrl+T')
    expect(buildKeybind(ev('KeyF', { altKey: true, shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+Alt+F')
    expect(buildKeybind(ev('KeyF', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+F')
    expect(buildKeybind(ev('Digit1', { altKey: true }))).toBe('Alt+ONE')
    expect(buildKeybind(ev('Digit1', { shiftKey: true, altKey: true }))).toBe('Shift+Alt+ONE')
  })

  it('never records Meta / Win', () => {
    expect(buildKeybind(ev('KeyA', { metaKey: true }))).toBe('A')
    expect(buildKeybind(ev('KeyA', { metaKey: true, ctrlKey: true }))).toBe('Ctrl+A')
  })

  it('returns null for lone modifiers and unmappable keys (caller keeps recording)', () => {
    expect(buildKeybind(ev('ControlLeft', { ctrlKey: true }))).toBe(null)
    expect(buildKeybind(ev('ShiftRight', { shiftKey: true }))).toBe(null)
    expect(buildKeybind(ev('AltRight', { ctrlKey: true, altKey: true }))).toBe(null) // AltGr
    expect(buildKeybind(ev('AltRight', { ctrlKey: true, altKey: true }, 0x11))).toBe(null) // AltGr's fake Ctrl
    expect(buildKeybind(ev('MetaLeft', { metaKey: true }))).toBe(null)
    expect(buildKeybind(ev('MetaRight', { metaKey: true }))).toBe(null)
    expect(buildKeybind(ev('ShiftLeft', { shiftKey: true }, 0xa0))).toBe(null) // VK_LSHIFT
    expect(buildKeybind(ev('NumpadEqual', {}, 0x92))).toBe(null) // VK_OEM_NEC_EQUAL
    expect(buildKeybind(ev('MediaPlayPause', {}, 0xb3))).toBe(null)
    expect(buildKeybind({})).toBe(null)
    expect(buildKeybind(null)).toBe(null)
  })

  it('emits the same names as the US-layout physical key for every US keyCode', () => {
    for (const [code, vk] of Object.entries(US_VK)) {
      if (codeToUe4ssKey(code) === null) continue // modifiers
      expect(buildKeybind(ev(code))).toBe(codeToUe4ssKey(code))
      expect(vkToUe4ssKey(vk)).toBe(codeToUe4ssKey(code))
    }
  })

  it('follows the layout VK, not the physical position (QWERTZ)', () => {
    // Printed Z sits at the US-Y position and sends VK_Z; printed Y sends VK_Y.
    expect(buildKeybind(ev('KeyY', { ctrlKey: true }, 0x5a))).toBe('Ctrl+Z')
    expect(buildKeybind(ev('KeyZ', {}, 0x59))).toBe('Y')
    // Ü (US [) sends VK_OEM_1, ß (US -) VK_OEM_4, # (US \) VK_OEM_2.
    expect(buildKeybind(ev('BracketLeft', {}, 0xba))).toBe('OEM_ONE')
    expect(buildKeybind(ev('Minus', {}, 0xdb))).toBe('OEM_FOUR')
    expect(buildKeybind(ev('Backslash', {}, 0xbf))).toBe('OEM_TWO')
    // < > | left of Y on ISO boards.
    expect(buildKeybind(ev('IntlBackslash', {}, 0xe2))).toBe('OEM_102')
  })

  it('follows the layout VK, not the physical position (AZERTY)', () => {
    expect(buildKeybind(ev('KeyQ', {}, 0x41))).toBe('A')
    expect(buildKeybind(ev('KeyA', {}, 0x51))).toBe('Q')
    expect(buildKeybind(ev('KeyZ', {}, 0x57))).toBe('W')
    expect(buildKeybind(ev('KeyW', {}, 0x5a))).toBe('Z')
    expect(buildKeybind(ev('Semicolon', {}, 0x4d))).toBe('M')
    // The & / 1 key on the top row still sends VK_1; ! sends VK_OEM_8.
    expect(buildKeybind(ev('Digit1', { altKey: true }, 0x31))).toBe('Alt+ONE')
    expect(buildKeybind(ev('Slash', {}, 0xdf))).toBe('OEM_EIGHT')
  })

  it('records the navigation VK a NumLock-off numpad key sends', () => {
    expect(buildKeybind(ev('Numpad7', {}, 0x24))).toBe('HOME')
    expect(buildKeybind(ev('Numpad5', {}, 0x0c))).toBe('CLEAR')
    expect(buildKeybind(ev('NumpadDecimal', {}, 0x2e))).toBe('DEL')
  })

  it('falls back to e.code only when the event carries no VK', () => {
    expect(buildKeybind(ev('KeyY', { ctrlKey: true }, 229))).toBe('Ctrl+Y') // IME composing
    expect(buildKeybind(ev('F6', {}, 0))).toBe('F6')
    expect(buildKeybind(ev('Comma', {}, undefined))).toBe('OEM_COMMA')
    // A VK with no UE4SS name is not second-guessed from the physical position.
    expect(buildKeybind(ev('Comma', {}, 0xb3))).toBe(null)
  })

  it('output is already normalized', () => {
    const flags = [{}, { ctrlKey: true }, { shiftKey: true, altKey: true }, { ctrlKey: true, shiftKey: true, altKey: true }]
    for (const code of ['KeyQ', 'Digit7', 'Numpad0', 'F12', 'Quote', 'PageDown']) {
      for (const f of flags) {
        const kb = buildKeybind(ev(code, f))
        expect(normalizeKeybind(kb)).toBe(kb)
      }
    }
    for (let vk = 1; vk < 256; vk++) {
      const kb = buildKeybind(ev('Unidentified', { ctrlKey: true }, vk))
      if (kb !== null) expect(normalizeKeybind(kb)).toBe(kb)
    }
  })
})

describe('normalizeKeybind', () => {
  it('returns valid P14 strings unchanged', () => {
    for (const s of [
      'F6', 'Ctrl+T', 'Ctrl+Shift+F', 'Alt+ONE', 'NUM_ONE', 'UP_ARROW', 'OEM_COMMA', 'SPACE',
      'RETURN', 'Ctrl+Shift+Alt+F24', 'Shift+OEM_102', 'A', 'Z', 'ZERO',
    ]) {
      expect(normalizeKeybind(s)).toBe(s)
    }
  })

  it('converts HZMM <= 1.6.0 main keys to UE4SS names', () => {
    const table = {
      1: 'ONE', 0: 'ZERO', 9: 'NINE',
      Numpad1: 'NUM_ONE', Numpad0: 'NUM_ZERO', NumpadEnter: 'RETURN', NumpadAdd: 'ADD',
      NumpadDecimal: 'DECIMAL',
      ArrowUp: 'UP_ARROW', ArrowDown: 'DOWN_ARROW', ArrowLeft: 'LEFT_ARROW', ArrowRight: 'RIGHT_ARROW',
      Enter: 'RETURN', Comma: 'OEM_COMMA', Period: 'OEM_PERIOD', Semicolon: 'OEM_ONE',
      Slash: 'OEM_TWO', Backquote: 'OEM_THREE', BracketLeft: 'OEM_FOUR', Backslash: 'OEM_FIVE',
      BracketRight: 'OEM_SIX', Quote: 'OEM_SEVEN', Minus: 'OEM_MINUS', Equal: 'OEM_PLUS',
      IntlBackslash: 'OEM_102', Space: 'SPACE', Tab: 'TAB', Escape: 'ESCAPE', Backspace: 'BACKSPACE',
      Insert: 'INS', Delete: 'DEL', Home: 'HOME', End: 'END', PageUp: 'PAGE_UP', PageDown: 'PAGE_DOWN',
      CapsLock: 'CAPS_LOCK', NumLock: 'NUM_LOCK', ScrollLock: 'SCROLL_LOCK', Pause: 'PAUSE',
      PrintScreen: 'PRINT_SCREEN', ContextMenu: 'APPS', F6: 'F6', A: 'A',
    }
    for (const [legacy, name] of Object.entries(table)) {
      expect(normalizeKeybind(String(legacy))).toBe(name)
    }
  })

  it('converts legacy combos, drops Meta and re-orders modifiers', () => {
    expect(normalizeKeybind('Alt+1')).toBe('Alt+ONE')
    expect(normalizeKeybind('Ctrl+Numpad1')).toBe('Ctrl+NUM_ONE')
    expect(normalizeKeybind('Shift+ArrowUp')).toBe('Shift+UP_ARROW')
    expect(normalizeKeybind('Ctrl+Shift+Enter')).toBe('Ctrl+Shift+RETURN')
    expect(normalizeKeybind('Meta+Comma')).toBe('OEM_COMMA')
    expect(normalizeKeybind('Ctrl+Meta+A')).toBe('Ctrl+A')
    expect(normalizeKeybind('Ctrl+Shift+Alt+Meta+F6')).toBe('Ctrl+Shift+Alt+F6')
    expect(normalizeKeybind('Shift+Ctrl+F')).toBe('Ctrl+Shift+F')
    expect(normalizeKeybind('Alt+Shift+Ctrl+Digit2')).toBe('Ctrl+Shift+Alt+TWO')
    expect(normalizeKeybind('Ctrl+Ctrl+F')).toBe('Ctrl+F')
  })

  it('accepts the old doc example "Meta+," and hand-written variants', () => {
    expect(normalizeKeybind('Meta+,')).toBe('OEM_COMMA')
    expect(normalizeKeybind('Ctrl+.')).toBe('Ctrl+OEM_PERIOD')
    expect(normalizeKeybind('ctrl+shift+f')).toBe('Ctrl+Shift+F')
    expect(normalizeKeybind('CONTROL+space')).toBe('Ctrl+SPACE')
    expect(normalizeKeybind('f6')).toBe('F6')
    expect(normalizeKeybind('arrowup')).toBe('UP_ARROW')
    expect(normalizeKeybind(' Ctrl + T ')).toBe('Ctrl+T')
  })

  it('returns input unchanged when it cannot be interpreted', () => {
    for (const s of [
      '', ' ', 'Ctrl+', '+', 'Ctrl++', 'Ctrl', 'Shift', 'Meta', 'Hyper+F', 'Key.F6', 'BOGUS',
      'Ctrl+Bogus', 'NumpadEqual', 'F25', 'BROWSER_BACK', 'constructor', 'Ctrl+toString', '¥',
    ]) {
      expect(normalizeKeybind(s)).toBe(s)
    }
  })

  it('never throws on non-string input and returns it unchanged', () => {
    for (const v of [undefined, null, 42, true, {}, []]) {
      expect(() => normalizeKeybind(v)).not.toThrow()
      expect(normalizeKeybind(v)).toBe(v)
    }
  })

  it('is idempotent', () => {
    const inputs = [
      'Alt+1', 'Meta+Comma', 'Shift+Ctrl+Numpad5', 'ArrowLeft', 'Ctrl+Shift+F', 'Meta+,',
      'ctrl+enter', 'Key.F6', '', 'BOGUS', ...KEY_NAMES,
    ]
    for (const s of inputs) {
      const once = normalizeKeybind(s)
      expect(normalizeKeybind(once)).toBe(once)
    }
  })

  it('round-trips every main key with every modifier combination', () => {
    const combos = [[], ['Ctrl'], ['Shift'], ['Alt'], ['Ctrl', 'Shift'], ['Ctrl', 'Alt'], ['Shift', 'Alt'], MODIFIERS]
    for (const name of KEY_NAMES) {
      for (const mods of combos) {
        const s = [...mods, name].join('+')
        expect(normalizeKeybind(s)).toBe(s)
      }
    }
  })
})
