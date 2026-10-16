// Keybind format shared by the capture widget and the Lua side of a mod.
//
// A keybind is stored as optional modifiers Ctrl / Shift / Alt (always in that
// order) + the main key's name in UE4SS's Lua `Key` table, joined by '+':
// "F6", "Ctrl+T", "Ctrl+Shift+F", "Alt+ONE", "NUM_ONE", "UP_ARROW", "OEM_COMMA".
// A mod passes the main key straight to `Key[name]` and maps the modifiers to
// ModifierKey.CONTROL / SHIFT / ALT. UE4SS registers no Win/Meta modifier
// (RE-UE4SS UE4SS/src/Mod/LuaMod.cpp, register_input_globals: ModifierKey has
// only SHIFT, CONTROL, ALT), so Meta is never recorded.
//
// UE4SS's Key values are Windows virtual-key (VK) codes, and the VK a key sends
// depends on the active keyboard layout (QWERTZ's printed Z sends VK_Z from
// the US-Y position; German Ü sends VK_OEM_1). So the main key comes from
// e.keyCode, which Chromium on Windows reports as that layout-dependent VK:
// the key the player presses here is the one UE4SS sees in game. e.key would
// record Shift+1 as "!", and e.code is the US-QWERTY physical position, which
// names the wrong key on other layouts. e.code is only a fallback when there
// is no VK (keyCode 0, or 229 while an IME is composing). OEM_* names are the
// Windows VK_OEM_* codes, so the printed character behind one varies by layout.

const DIGIT_NAMES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

// KeyboardEvent.code → UE4SS Key name. Only names that exist in UE4SS's Key
// table; any other code (modifiers, media keys, IME keys, …) has no entry.
const CODE_TO_KEY = new Map<string, string>([
  ['Space', 'SPACE'],
  ['Enter', 'RETURN'],
  ['NumpadEnter', 'RETURN'],
  ['Tab', 'TAB'],
  ['Escape', 'ESCAPE'],
  ['Backspace', 'BACKSPACE'],
  ['Insert', 'INS'],
  ['Delete', 'DEL'],
  ['Home', 'HOME'],
  ['End', 'END'],
  ['PageUp', 'PAGE_UP'],
  ['PageDown', 'PAGE_DOWN'],
  ['ArrowUp', 'UP_ARROW'],
  ['ArrowDown', 'DOWN_ARROW'],
  ['ArrowLeft', 'LEFT_ARROW'],
  ['ArrowRight', 'RIGHT_ARROW'],
  ['CapsLock', 'CAPS_LOCK'],
  ['NumLock', 'NUM_LOCK'],
  ['ScrollLock', 'SCROLL_LOCK'],
  ['Pause', 'PAUSE'],
  ['PrintScreen', 'PRINT_SCREEN'],
  ['ContextMenu', 'APPS'],
  ['NumpadMultiply', 'MULTIPLY'],
  ['NumpadAdd', 'ADD'],
  ['NumpadSubtract', 'SUBTRACT'],
  ['NumpadDecimal', 'DECIMAL'],
  ['NumpadDivide', 'DIVIDE'],
  ['Semicolon', 'OEM_ONE'],
  ['Equal', 'OEM_PLUS'],
  ['Comma', 'OEM_COMMA'],
  ['Minus', 'OEM_MINUS'],
  ['Period', 'OEM_PERIOD'],
  ['Slash', 'OEM_TWO'],
  ['Backquote', 'OEM_THREE'],
  ['BracketLeft', 'OEM_FOUR'],
  ['Backslash', 'OEM_FIVE'],
  ['BracketRight', 'OEM_SIX'],
  ['Quote', 'OEM_SEVEN'],
  ['IntlBackslash', 'OEM_102'],
]);
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(65 + i);
  CODE_TO_KEY.set(`Key${letter}`, letter);
}
DIGIT_NAMES.forEach((name, d) => {
  CODE_TO_KEY.set(`Digit${d}`, name);
  CODE_TO_KEY.set(`Numpad${d}`, `NUM_${name}`);
});
for (let n = 1; n <= 24; n++) CODE_TO_KEY.set(`F${n}`, `F${n}`);

// Windows VK code (KeyboardEvent.keyCode) → UE4SS Key name. Same rule as
// CODE_TO_KEY: modifiers (VK_SHIFT / CONTROL / MENU / L*/R*, LWIN / RWIN) and
// any VK without a UE4SS name have no entry. Numpad keys with NumLock off send
// the navigation VKs (VK_HOME, VK_CLEAR, ...) and Ctrl+Pause sends VK_CANCEL;
// those are recorded as sent because that is what UE4SS will see too.
const VK_TO_KEY = new Map<number, string>([
  [0x03, 'CANCEL'],
  [0x08, 'BACKSPACE'],
  [0x09, 'TAB'],
  [0x0c, 'CLEAR'],
  [0x0d, 'RETURN'],
  [0x13, 'PAUSE'],
  [0x14, 'CAPS_LOCK'],
  [0x1b, 'ESCAPE'],
  [0x20, 'SPACE'],
  [0x21, 'PAGE_UP'],
  [0x22, 'PAGE_DOWN'],
  [0x23, 'END'],
  [0x24, 'HOME'],
  [0x25, 'LEFT_ARROW'],
  [0x26, 'UP_ARROW'],
  [0x27, 'RIGHT_ARROW'],
  [0x28, 'DOWN_ARROW'],
  [0x2c, 'PRINT_SCREEN'],
  [0x2d, 'INS'],
  [0x2e, 'DEL'],
  [0x5d, 'APPS'],
  [0x6a, 'MULTIPLY'],
  [0x6b, 'ADD'],
  [0x6c, 'SEPARATOR'],
  [0x6d, 'SUBTRACT'],
  [0x6e, 'DECIMAL'],
  [0x6f, 'DIVIDE'],
  [0x90, 'NUM_LOCK'],
  [0x91, 'SCROLL_LOCK'],
  [0xba, 'OEM_ONE'],
  [0xbb, 'OEM_PLUS'],
  [0xbc, 'OEM_COMMA'],
  [0xbd, 'OEM_MINUS'],
  [0xbe, 'OEM_PERIOD'],
  [0xbf, 'OEM_TWO'],
  [0xc0, 'OEM_THREE'],
  [0xdb, 'OEM_FOUR'],
  [0xdc, 'OEM_FIVE'],
  [0xdd, 'OEM_SIX'],
  [0xde, 'OEM_SEVEN'],
  [0xdf, 'OEM_EIGHT'],
  [0xe2, 'OEM_102'],
]);
for (let i = 0; i < 26; i++) VK_TO_KEY.set(0x41 + i, String.fromCharCode(65 + i));
DIGIT_NAMES.forEach((name, d) => {
  VK_TO_KEY.set(0x30 + d, name);
  VK_TO_KEY.set(0x60 + d, `NUM_${name}`);
});
for (let n = 1; n <= 24; n++) VK_TO_KEY.set(0x6f + n, `F${n}`);

// keyCode values that carry no VK: 0 (unidentified) and 229 (IME composing).
const NO_VK = new Set<number>([0, 229]);

// Every main-key name HZMM can emit (a subset of UE4SS's Key table).
export const KEY_NAMES = [...new Set([...CODE_TO_KEY.values(), ...VK_TO_KEY.values()])];
const KEY_NAME_SET = new Set(KEY_NAMES);
export const MODIFIERS = ['Ctrl', 'Shift', 'Alt'] as const;
export type Modifier = (typeof MODIFIERS)[number];

// Lenient lookups for normalizeKeybind only.
const CODE_TO_KEY_LOWER = new Map([...CODE_TO_KEY].map(([code, name]) => [code.toLowerCase(), name]));
const PUNCT_TO_KEY = new Map<string, string>([
  [';', 'OEM_ONE'], ['=', 'OEM_PLUS'], [',', 'OEM_COMMA'], ['-', 'OEM_MINUS'], ['.', 'OEM_PERIOD'],
  ['/', 'OEM_TWO'], ['`', 'OEM_THREE'], ['[', 'OEM_FOUR'], ['\\', 'OEM_FIVE'], [']', 'OEM_SIX'], ["'", 'OEM_SEVEN'],
]);
// null = Meta / Win: UE4SS can't bind it, so it is dropped.
const MODIFIER_ALIASES = new Map<string, Modifier | null>([
  ['ctrl', 'Ctrl'], ['control', 'Ctrl'], ['shift', 'Shift'], ['alt', 'Alt'], ['meta', null],
]);

export function codeToUe4ssKey(code: string | null | undefined): string | null {
  return code == null ? null : (CODE_TO_KEY.get(code) ?? null);
}

export function vkToUe4ssKey(vk: number): string | null {
  return VK_TO_KEY.get(vk) ?? null;
}

function joinKeybind(mods: Set<Modifier>, mainKey: string): string {
  return [...MODIFIERS.filter((m) => mods.has(m)), mainKey].join('+');
}

/** The keydown fields buildKeybind reads — a DOM KeyboardEvent or React's synthetic one. */
export interface KeyEventLike {
  keyCode?: number;
  code?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

// keydown event → keybind string, or null when the key has no UE4SS Key
// equivalent (including a lone modifier press) so the caller keeps recording.
// The main key follows the layout's VK (e.keyCode); e.code is used only when
// the event carries no VK.
export function buildKeybind(e: KeyEventLike | null | undefined): string | null {
  const vk = e?.keyCode;
  const mainKey = typeof vk === 'number' && Number.isInteger(vk) && !NO_VK.has(vk) ? vkToUe4ssKey(vk) : codeToUe4ssKey(e?.code);
  if (!mainKey || !e) return null;
  const mods = new Set<Modifier>();
  if (e.ctrlKey) mods.add('Ctrl');
  if (e.shiftKey) mods.add('Shift');
  if (e.altKey) mods.add('Alt');
  return joinKeybind(mods, mainKey);
}

function resolveMainKey(k: string | undefined): string | null {
  if (!k) return null;
  if (KEY_NAME_SET.has(k)) return k;
  const byCode = codeToUe4ssKey(k);            // legacy "Numpad1", "ArrowUp", "Enter", "Comma"
  if (byCode) return byCode;
  if (/^[0-9]$/.test(k)) return DIGIT_NAMES[Number(k)]; // legacy Digit1 → "1"
  const upper = k.toUpperCase();               // "space", "f6", "a"
  if (KEY_NAME_SET.has(upper)) return upper;
  return CODE_TO_KEY_LOWER.get(k.toLowerCase()) ?? PUNCT_TO_KEY.get(k) ?? null;
}

// Convert a stored keybind to the current format. HZMM <= 1.6.0 wrote the main
// key as e.code minus the Key/Digit prefix ("1", "Numpad1", "ArrowUp", "Enter",
// "Comma") and could add "Meta"; those become "ONE", "NUM_ONE", "UP_ARROW",
// "RETURN", "OEM_COMMA" with Meta dropped and modifiers re-ordered. A value
// already in the current format comes back unchanged, and anything that can't
// be interpreted (empty, unknown key or modifier, non-string) is returned as-is.
export function normalizeKeybind(str: string): string;
export function normalizeKeybind<T>(str: T): T;
export function normalizeKeybind(str: unknown): unknown {
  if (typeof str !== 'string') return str;
  const parts = str.split('+').map((p) => p.trim());
  const mainKey = resolveMainKey(parts.pop());
  if (!mainKey) return str;
  const mods = new Set<Modifier>();
  for (const p of parts) {
    const mod = MODIFIER_ALIASES.get(p.toLowerCase());
    if (mod === undefined) return str;
    if (mod) mods.add(mod);
  }
  return joinKeybind(mods, mainKey);
}
