# HZMM Config Schema Standard

> `hzmm.config.json` specification for mod authors who want rich UI in HZMM's config editor.
>
> Version: **1.3** | Supported: HZMM v1.3.6+

---

## Overview

Place a `hzmm.config.json` file alongside your `config.lua`. HZMM will use it to render
a polished, localized config editor instead of relying on comment parsing.

```
YourMod/
  main.lua
  config.lua            <-- actual values (mod reads this)
  hzmm.config.json      <-- UI schema (HZMM reads this)
```

If `hzmm.config.json` is not present, HZMM falls back to comment-based parsing.

---

## What's New

### 1.3 — Description tokens, reset to defaults, polish

| Feature | Where | Summary |
|---------|-------|---------|
| `{value}` token | `description` | Inline placeholder replaced with the key's current value as a string. |
| `{eval: <expr>}` token | `description` | JS expression evaluated live; `value` is the parsed-float current value. Integer results print as int, otherwise `.toFixed(2)`. Lets the help text show derived results (e.g. `{eval: 35*(1+value/100)} kg`) as the player drags the slider. Requires `'unsafe-eval'` CSP — HZMM 1.3.6+ has it on by default. |
| Reset-to-defaults button | UI only | Footer button restores every key to its schema `default`. Disabled when every key with a `default` already matches it. Replaces the older "discard unsaved changes" affordance from earlier versions. |
| Auto-collapse threshold | UI only | Schemas with more than 10 sections start with every section folded (prevents render spike on huge configs). Author can override per-section with `collapsed: false`. |

### 1.2 — Sliders, multi-select, lists, optional keys, unified dropdown

| Feature | Where | Summary |
|---------|-------|---------|
| `widget: "slider"` | key | Range slider with companion number input — for `int` / `float` keys that have `min` and `max` |
| `type: "multi-select"` | key | Multi-pick stored as a Lua array string (`'{"Pistol","Rifle"}'`) |
| `type: "list"` | key | Free-form string list with inline `+` / `×` controls |
| `optional: true` | key | Per-row toggle decides whether the key is written to `config.lua` at all. Off → the line is removed and Lua sees `Config.X == nil`. Lets one key replace the old `X` + `X_Enabled` pair pattern |
| Unified dropdown UI | UI only | Shared chrome for `select` (≥3 options) and `multi-select` — glass panel, full-width align, click-outside to close |

### 1.1 — Color, keybind, collapsed sections

| Feature | Where | Summary |
|---------|-------|---------|
| `color` type | key | Hex color picker (`#RRGGBB`) |
| `keybind` type | key | Keyboard shortcut capture (`Ctrl+Shift+F`, `F6`, …) |
| `collapsed` | section | Section starts folded; click header to expand |
| Default reset | key (UI only) | When a key has `default`, HZMM shows a hover-only ↺ button to restore it. No schema change required |

All additions through 1.3 are backward compatible — schemas written for 1.0 keep working unchanged.

---

## Quick Start

**config.lua:**
```lua
local Config = {
  MaxHealth = 100,
  Difficulty = "normal",
}
return Config
```

**hzmm.config.json:**
```json
{
  "configFile": "config.lua",
  "sections": {
    "General": {
      "label": { "en": "General", "zh-TW": "一般" },
      "keys": {
        "MaxHealth": {
          "type": "int",
          "default": 100,
          "min": 1,
          "max": 9999,
          "label": { "en": "Max Health", "zh-TW": "最大生命值" },
          "description": { "en": "Maximum player health", "zh-TW": "玩家最大血量" }
        },
        "Difficulty": {
          "type": "select",
          "default": "normal",
          "label": { "en": "Difficulty", "zh-TW": "難度" },
          "options": [
            { "value": "easy" },
            { "value": "normal" },
            { "value": "hard" }
          ]
        }
      }
    }
  }
}
```

---

## Schema Structure

```
hzmm.config.json
  configFile          (string)     Target config file name
  sections            (object)     Grouped settings
    [SectionId]
      label           (i18n)       Section header text
      collapsed?      (bool)       Section starts folded (1.1+)
      enableKey?      (string)     Key that toggles this section
      keys            (object)     Settings in this section
        [KeyName]
          type         (string)    "bool" | "int" | "float" | "select" | "text"
                                   | "color" (1.1) | "keybind" (1.1)
                                   | "multi-select" (1.2) | "list" (1.2)
          widget?      (string)    "slider" — range slider for int/float (1.2)
          default?     (any)       Default value — also drives the hover ↺ reset button
          optional?    (bool)      When true, off-toggle removes the key from config.lua entirely (1.2)
          label        (i18n)      Display name
          description? (i18n)      Help text below the label
          min?         (number)    Minimum value (int/float only)
          max?         (number)    Maximum value (int/float only)
          step?        (number)    Increment step (int/float only)
          options?     (array)     Choices for select / multi-select
          showWhen?    (object)    Conditional visibility
          openPath?    (object)    Jump-to-file button { path, relativeTo, action }
```

---

## Field Reference

### `configFile`

**Required.** The config file this schema describes. Must be in the same directory.

```json
{ "configFile": "config.lua" }
```

### `sections`

**Required.** Groups keys under collapsible section headers. Each key in `sections` is a
unique section ID (used internally, not displayed).

```json
{
  "sections": {
    "Combat": { ... },
    "Farming": { ... }
  }
}
```

### Section → `label`

**Required.** Multi-language display name for the section header.

```json
{
  "label": { "en": "Combat", "zh-TW": "戰鬥", "ja": "戦闘" }
}
```

### Section → `collapsed` (1.1+)

**Optional.** When `true`, the section starts folded — only the header is visible until
the user clicks it to expand. Use this for "Advanced" or "Preview" groups so the editor
isn't overwhelming on first open.

```json
{
  "Advanced": {
    "label": { "en": "Advanced", "zh-TW": "進階設定" },
    "collapsed": true,
    "keys": { ... }
  }
}
```

Notes:
- Open/closed state is per-modal-mount; closing the editor and re-opening returns to the
  schema-declared default. The author's choice of "what to hide first" wins each time.
- Avoid combining `collapsed: true` with `enableKey` — the master toggle becomes invisible.

#### Auto-collapse threshold

When a schema declares **more than 10 sections** (e.g. one section per skill in a 100-skill mod), HZMM forces every section closed on first render to avoid a render spike from committing hundreds of rows at once. The author can still pin a section open by setting `collapsed: false` explicitly — that wins over the threshold. Sections with no `collapsed` field follow the auto-rule.

### Section → `enableKey`

**Optional.** Names a `bool` key within this section that acts as a master toggle.
When the key is `false`, all other keys in the section appear dimmed / disabled.

```json
{
  "enableKey": "Enabled",
  "keys": {
    "Enabled": { "type": "bool", "default": true, ... },
    "Speed": { "type": "int", "default": 5, ... }
  }
}
```

### Key → `type`

**Required.** Determines the input widget HZMM renders.

| Type | Widget | Value format |
|:-----|:-------|:-------------|
| `"bool"` | Toggle switch | `true` / `false` |
| `"int"` | Number input (or slider with `widget: "slider"`) | `42`, `-7` |
| `"float"` | Decimal input (or slider with `widget: "slider"`) | `1.5`, `0.01` |
| `"select"` | Pills (≤2 options) or dropdown (≥3 options) | `"easy"`, `"hard"` |
| `"text"` | Single-line text input | Any string (no multi-line / textarea) |
| `"color"` (1.1+) | Hex color picker | `"#3b82f6"` |
| `"keybind"` (1.1+) | Hotkey capture | `"Ctrl+Shift+F"`, `"F6"` |
| `"multi-select"` (1.2+) | Dropdown panel with checkboxes | `'{"Pistol","Rifle"}'` (Lua array string) |
| `"list"` (1.2+) | Editable string list with `+` / `×` | `'{"Alice","Bob"}'` (Lua array string) |

### Key → `default`

**Optional.** The default value. Two purposes:

1. Documents the "expected" value for readers of the schema.
2. **Powers the hover ↺ reset button** — when the current value differs from `default`,
   hovering the row reveals a small reset icon that restores it. Keys with no `default`
   get no reset button.

```json
{ "type": "int", "default": 100 }
```

The reset button is purely a UI affordance; the schema field itself is unchanged from 1.0.

### Key → `optional` (1.2+)

**Optional.** When `true`, the row gains a small toggle that decides whether the key is written to `config.lua` at all.

- Toggle **off** → the key's line is removed from `config.lua` → mod sees `Config.X == nil`.
- Toggle **on** → the schema's `default` is written back into `config.lua`.

```json
{
  "DamageMul": {
    "type": "float",
    "optional": true,
    "default": 1.5,
    "min": 0.1,
    "max": 10.0,
    "label": { "en": "Damage Multiplier" }
  }
}
```

Lua side — instead of carrying both `X` and `X_Enabled`:

```lua
-- Old pattern
if Config.DamageMul_Enabled then weapon.DamageMul = Config.DamageMul end

-- 1.2+ pattern
if Config.DamageMul ~= nil then weapon.DamageMul = Config.DamageMul end
```

This shrinks "I want a couple of overrides, leave everything else default" mods from one toggle + one value per attribute down to a single value per attribute. Authoring config.lua next to a schema with `optional` keys, you only need to commit the keys that already have a non-default value.

### Key → `label`

**Required.** Multi-language display name shown next to the input.

```json
{ "label": { "en": "Max Health", "zh-TW": "最大生命值" } }
```

### Key → `description`

**Optional.** Multi-language help text shown below the label in smaller font.

```json
{ "description": { "en": "Player maximum HP (1-9999)", "zh-TW": "玩家最大血量 (1-9999)" } }
```

#### Description tokens

`description` strings support two interpolation tokens that resolve at render time, so the help text can reflect the player's current value without writing extra UI logic:

| Token | Replaced with | Example |
|---|---|---|
| `{value}` | The current value of this key as a string. | `"Reduce stamina cost by {value}%"` → at slider 50: `"Reduce stamina cost by 50%"` |
| `{eval: <expr>}` | Result of `<expr>` evaluated as JS. The variable `value` inside the expression is the current value coerced to a number (`parseFloat(currentValue) \|\| 0`). Integer results print as integers, non-integer results as `.toFixed(2)`. | `"Max carry weight {eval: 35*(1+value/100)} kg"` → at slider 100: `"Max carry weight 70 kg"` |

If the expression throws or returns a non-finite number, the original token is left as-is — rendering won't crash. Schemas without these tokens are unaffected (the regex finds nothing and returns the string unchanged).

`{eval:}` runs through `new Function('value', ...)`. Treat it as code authored by the mod developer (you), not user input — players cannot edit the schema, so injection isn't a concern, but don't paste untrusted strings into a schema either.

**Resolution order** (so authors can predict what gets interpolated):

1. The i18n object is resolved against the current app language (`zh-TW` → `en` → first available).
2. The selected string is then scanned for `{value}` and `{eval:}` tokens.
3. Tokens are replaced; the final string is what the row renders.

Mixing tokens with i18n is fine — each language string can have its own tokens, e.g. `"zh-TW"` writes `"重量 {eval: 35*value} 公斤"` while `"en"` writes `"Weight {eval: 35*value} kg"`. Tokens replace independently per language.

**CSP requirement** (relevant if you fork HZMM or read older builds): `{eval:}` needs `'unsafe-eval'` in the renderer's `Content-Security-Policy`. HZMM 1.3.6+ has it enabled. On 1.3.5 and earlier, `new Function()` is blocked and the token harmlessly falls back to displaying the original `{eval: ...}` text — `{value}` still works.

### Key → `min` / `max`

**Optional.** For `int` and `float` types.

- **Text input**: clamps on `blur` if the entered value falls outside `[min, max]`.
- **Slider widget**: the thumb is constrained to `[min, max]` continuously while dragging — no blur needed.

```json
{ "type": "int", "min": 1, "max": 9999 }
```

### Key → `step`

**Optional.** For `int` and `float` types. Increment for arrow-key / spinner steps and for the slider widget. Defaults: `1` for int, `0.1` for float.

```json
{ "type": "float", "min": 0.1, "max": 10.0, "step": 0.1 }
```

#### Float precision ceiling

Float values are always rounded to **4 decimal places** before being written back — both slider movement and text-input blur run through `parseFloat(n.toFixed(4))`. Practical rules:

- `step: 0.001` is fine and exact.
- `step: 0.0001` is the boundary — anything finer will quietly snap to 4 dp.
- Trailing zeros are stripped on save (`0.5`, not `0.5000`), so reading the file back doesn't preserve them. The mod logic shouldn't depend on textual zero-padding.

### Key → `widget` (1.2+)

**Optional.** Override the default input widget. Currently the only value is `"slider"`, which applies to `int` / `float` and requires both `min` and `max`.

```json
{
  "DamageMul": {
    "type": "float",
    "widget": "slider",
    "min": 0,
    "max": 10,
    "step": 0.1,
    "default": 1.0,
    "label": { "en": "Damage Multiplier" }
  }
}
```

The slider draws a track + draggable thumb with a small companion number input on the right; both stay in sync. Without `widget: "slider"` (or if `min` / `max` is missing), the same key falls back to a regular number input.

### Key → `options`

**Required for `select` and `multi-select` types.** Array of selectable values. HZMM displays the raw `value` on buttons / dropdown rows — use clear, readable value names.

```json
{
  "type": "select",
  "options": [
    { "value": "Easy" },
    { "value": "Normal" },
    { "value": "Hard" }
  ]
}
```

> ⚠ **Each option object accepts only `value`.** A `label` field on individual options is **ignored** by the renderer — there is no way to translate option text. Pick `value` strings that are already short, readable, and language-neutral (or already in your target language). Translations belong on the key's `label` / `description`, not per-option.

> **Tip:** For human-readable values, use `"Easy"` / `"Normal"` / `"Hard"` rather than `"easy_v2"` / `"hard_2024"` — the value string is what players see.

### Key → `showWhen`

**Optional.** Conditionally show this key only when another key has a specific value.
When the condition is not met, the key is hidden or dimmed.

```json
{
  "MultiplierValue": {
    "type": "float",
    "showWhen": { "Mode": "Multiplier" }
  },
  "FixedValue": {
    "type": "float",
    "showWhen": { "Mode": "Fixed" }
  }
}
```

Multiple conditions (AND logic):

```json
{ "showWhen": { "Enabled": "true", "Mode": "Advanced" } }
```

### Key → `openPath`

**Optional.** Add a small "jump to file" button next to the entry. Handy for
things like a Debug toggle where the user probably wants one-click access to
the log file it writes.

```json
{
  "Debug": {
    "type": "bool",
    "label": { "en": "Enable Debug Logs" },
    "openPath": {
      "path": "HumanitZ/Binaries/Win64/ue4ss/UE4SS.log",
      "relativeTo": "game",
      "action": "open"
    }
  }
}
```

| Field | Values | Default | Description |
|-------|--------|---------|-------------|
| `path` | string | (required) | Relative path under the chosen base |
| `relativeTo` | `"game"` \| `"mod"` | `"game"` | `"game"` resolves under the HumanitZ install root. `"mod"` resolves under the mod's own folder (`ue4ss/Mods/<modName>/`). |
| `action` | `"open"` \| `"reveal"` | `"open"` | `"open"` launches the file with the OS default program. `"reveal"` opens the containing folder with the file highlighted. |

Main-process security: the path is resolved with `resolveWithin(base, path)`,
so `..` segments that escape the chosen base are blocked. If the file doesn't
exist, the renderer shows a toast instead of silently failing.

---

## Type Deep Dive

### `color`

Stores a hex color string `#RRGGBB`. The picker is the OS-native color dialog,
wrapped in a glass-style swatch + hex label so it matches the rest of the editor.

```json
{
  "TitleColor": {
    "type": "color",
    "default": "#3b82f6",
    "label": { "en": "Window Title Color", "zh-TW": "視窗標題顏色" },
    "description": { "en": "Used for the BetterTrade window header", "zh-TW": "BetterTrade 視窗標題使用" }
  }
}
```

**Reading from Lua:**
```lua
-- Config.TitleColor = "#3b82f6"
local hex = Config.TitleColor:sub(2)
local r = tonumber(hex:sub(1,2), 16) / 255
local g = tonumber(hex:sub(3,4), 16) / 255
local b = tonumber(hex:sub(5,6), 16) / 255
myWidget:SetColorAndOpacity({ R = r, G = g, B = b, A = 1 })
```

The widget tolerates `#fff` (3-digit) and `3b82f6` (no `#`) on input but always
writes back the full `#rrggbb` form.

### `keybind`

Stores a keyboard shortcut as a `+`-joined string. Click the field, then press
the desired combo — modifiers are detected automatically. `Esc` cancels capture,
the X button clears the binding.

```json
{
  "OpenHotkey": {
    "type": "keybind",
    "default": "F6",
    "label": { "en": "Open Trade Window", "zh-TW": "開啟交易視窗" }
  }
}
```

Format examples: `"F6"`, `"Ctrl+T"`, `"Ctrl+Shift+F"`, `"Alt+1"`, `"Meta+,"`.

**Reading from Lua (with UE4SS `RegisterKeyBind`):**
```lua
-- Config.OpenHotkey = "Ctrl+Shift+F"
local parts = {}
for p in string.gmatch(Config.OpenHotkey, "[^+]+") do table.insert(parts, p) end
local mainKey = Key[table.remove(parts):upper()]
local mods = {}
for _, m in ipairs(parts) do
  if m == "Ctrl" then table.insert(mods, ModifierKey.CONTROL)
  elseif m == "Shift" then table.insert(mods, ModifierKey.SHIFT)
  elseif m == "Alt" then table.insert(mods, ModifierKey.ALT)
  end
end
RegisterKeyBind(mainKey, mods, function() openTradeUI() end)
```

### `multi-select` (1.2+)

Pick zero or more values from a fixed set. Stored as a Lua array string so it round-trips cleanly through `config.lua`. Order in `options` is the storage order — clicking order doesn't matter and the result is stable across saves.

```json
{
  "AllowedWeapons": {
    "type": "multi-select",
    "default": [],
    "label": { "en": "Allowed Weapons", "zh-TW": "允許的武器" },
    "options": [
      { "value": "Pistol" },
      { "value": "Rifle" },
      { "value": "Shotgun" }
    ]
  }
}
```

The widget is a dropdown panel with checkboxes — same chrome as the unified `select` dropdown.

**Reading from Lua:**
```lua
-- Config.AllowedWeapons = {"Pistol", "Rifle"}
for _, w in ipairs(Config.AllowedWeapons) do
  print("Allowed:", w)
end
```

### `list` (1.2+)

Like `multi-select`, but the user types entries freely instead of picking from a fixed set. No `options` field — the editor renders an editable list with `+` to add a row and `×` to remove one. Stored as the same Lua array string.

```json
{
  "BannedPlayers": {
    "type": "list",
    "default": [],
    "label": { "en": "Banned Players" }
  }
}
```

**Reading from Lua:**
```lua
-- Config.BannedPlayers = {"Alice", "Bob"}
local banned = {}
for _, name in ipairs(Config.BannedPlayers) do banned[name] = true end
```

### `widget: "slider"` (1.2+)

Not a type — a presentation hint for `int` and `float`. Requires `min` and `max`. `step` is honored for both keyboard nudges and the slider thumb (defaults: `1` for int, `0.1` for float).

```json
{
  "Range": {
    "type": "float",
    "widget": "slider",
    "default": 1.0,
    "min": 0.0,
    "max": 5.0,
    "step": 0.1,
    "label": { "en": "Detection Range", "zh-TW": "偵測範圍" }
  }
}
```

The companion number input on the right of the slider stays in sync with the thumb. Omit `widget` (or leave out `min` / `max`) to fall back to a regular number input.

---

## Lua Serialization

How each schema type is written back into `config.lua`. Mod authors need to know the exact form to parse the file correctly from Lua.

| Schema type | Lua written form | Example line | Lua read |
|:---|:---|:---|:---|
| `bool` | bareword | `Enabled = true` | `if Config.Enabled then ... end` |
| `int` | bareword number | `MaxHealth = 100` | `local hp = Config.MaxHealth` |
| `float` | bareword number (4 dp max) | `Damage = 1.5` | `local mul = Config.Damage` |
| `select` | quoted string | `Difficulty = "Normal"` | `if Config.Difficulty == "Hard" then` |
| `text` | quoted string | `Name = "Steve"` | `local n = Config.Name` |
| `color` | quoted hex string | `Color = "#3b82f6"` | (see Type Deep Dive → `color` for hex parse) |
| `keybind` | quoted shortcut string | `Hotkey = "Ctrl+Shift+F"` | (see Type Deep Dive → `keybind`) |
| `multi-select` | Lua array literal of strings | `Weapons = {"Pistol", "Rifle"}` | `for _, w in ipairs(Config.Weapons) do` |
| `list` | Lua array literal of strings | `Banned = {"Alice", "Bob"}` | `for _, n in ipairs(Config.Banned) do` |

Notes:

- Embedded `"` inside `text` / `list` entries is auto-escaped (`\"`) by the renderer.
- `multi-select` and `list` write as a single-line, flat array of quoted strings. Nested tables, mixed types, and trailing commas are not produced.
- For `optional` keys toggled off, the entire `Key = ...` line is removed from the file — Lua then sees `Config.Key == nil`. Toggle back on to re-emit the line under its declared section.
- HZMM also accepts INI-style files (`[Section]` headers, unquoted numbers) on read as a fallback for legacy mods, but writes back canonical Lua module style.

---

## Reset Behavior

HZMM's config editor offers two levels of reset, both driven by schema-declared `default` values.

| Affordance | Scope | Trigger | Effect | Disabled when |
|:---|:---|:---|:---|:---|
| Per-row ↺ button (1.1+) | A single key | Hover the row, click the ↺ icon | Resets that one key to its `default`. Keys without a `default` show no button at all. | Current value already equals `default`, or the row is gated off (`enableKey` parent is false / `optional` toggle off). |
| Footer "Reset to defaults" (1.3+) | All keys in the modal | Click the button at the bottom-left of the editor footer | Walks every keyval entry and writes each one back to its schema `default`. Keys without a `default` keep their current value. | Every key with a declared `default` already matches it (no-op state). |

Footer button = heavy hammer (player tweaked many things, wants a clean slate). Per-row button = precise tool (fix one knob without losing the others).

Comment-mode (no `hzmm.config.json` schema) has no `default` concept, so the footer button there falls back to "discard unsaved changes" and the per-row button is unavailable.

---

## Multi-Language (i18n)

All `label`, `description`, and option `label` fields use the same i18n object format:

```json
{ "en": "English text", "zh-TW": "繁體中文", "ja": "日本語" }
```

### Supported Language Codes

| Code | Language |
|:-----|:---------|
| `en` | English |
| `zh-TW` | 繁體中文 |
| `ja` | 日本語 |
| `ko` | 한국어 |
| `ru` | Русский |
| `de` | Deutsch |
| `fr` | Francais |

### Resolution Order

1. Exact match for current app language
2. `en` (English fallback)
3. First available language in the object

> **Tip:** You don't need all 7 languages. English + your native language is enough.

---

## Full Example

A complete `hzmm.config.json` demonstrating features through 1.3:

```json
{
  "configFile": "config.lua",
  "sections": {
    "General": {
      "label": { "en": "General", "zh-TW": "一般" },
      "keys": {
        "ModEnabled": {
          "type": "bool",
          "default": true,
          "label": { "en": "Mod Enabled", "zh-TW": "啟用模組" },
          "description": { "en": "Master switch for this mod", "zh-TW": "模組總開關" }
        }
      }
    },
    "Combat": {
      "label": { "en": "Combat", "zh-TW": "戰鬥" },
      "keys": {
        "MaxHealth": {
          "type": "int",
          "default": 100,
          "min": 1,
          "max": 9999,
          "label": { "en": "Max Health", "zh-TW": "最大生命值" },
          "description": { "en": "Maximum player health", "zh-TW": "玩家最大血量" }
        },
        "DamageMultiplier": {
          "type": "float",
          "widget": "slider",
          "default": 1.0,
          "min": 0.1,
          "max": 10.0,
          "step": 0.1,
          "label": { "en": "Damage Multiplier", "zh-TW": "傷害倍率" }
        },
        "AllowedWeapons": {
          "type": "multi-select",
          "default": [],
          "label": { "en": "Allowed Weapons", "zh-TW": "允許的武器" },
          "options": [
            { "value": "Pistol" },
            { "value": "Rifle" },
            { "value": "Shotgun" }
          ]
        },
        "Difficulty": {
          "type": "select",
          "default": "normal",
          "label": { "en": "Difficulty", "zh-TW": "難度" },
          "options": [
            { "value": "Easy" },
            { "value": "Normal" },
            { "value": "Hard" }
          ]
        }
      }
    },
    "Appearance": {
      "label": { "en": "Appearance", "zh-TW": "外觀" },
      "keys": {
        "AccentColor": {
          "type": "color",
          "default": "#3b82f6",
          "label": { "en": "Accent Color", "zh-TW": "強調色" }
        },
        "OpenHotkey": {
          "type": "keybind",
          "default": "F6",
          "label": { "en": "Toggle Hotkey", "zh-TW": "切換熱鍵" }
        }
      }
    },
    "Advanced": {
      "label": { "en": "Advanced", "zh-TW": "進階" },
      "collapsed": true,
      "keys": {
        "TickRate": {
          "type": "int",
          "default": 60,
          "min": 1,
          "max": 240,
          "label": { "en": "Tick Rate", "zh-TW": "更新頻率" },
          "description": { "en": "Updates per second — only change if you know why", "zh-TW": "每秒更新次數 — 不確定就別改" }
        },
        "DamageOverride": {
          "type": "float",
          "optional": true,
          "default": 1.0,
          "min": 0.0,
          "max": 100.0,
          "label": { "en": "Damage Override", "zh-TW": "傷害覆寫" },
          "description": { "en": "Off = use base game value", "zh-TW": "關閉 = 使用遊戲原數值" }
        },
        "BannedPlayers": {
          "type": "list",
          "default": [],
          "label": { "en": "Banned Players", "zh-TW": "封鎖名單" }
        },
        "DebugLogs": {
          "type": "bool",
          "default": false,
          "label": { "en": "Enable Debug Logs" },
          "openPath": {
            "path": "HumanitZ/Binaries/Win64/ue4ss/UE4SS.log",
            "relativeTo": "game",
            "action": "open"
          }
        }
      }
    }
  }
}
```

---

## Rules

1. **Key names must match exactly** between `hzmm.config.json` and `config.lua`
2. **`configFile` is required** and must point to an existing file in the same directory
3. **At least one section** with at least one key is required
4. **`type` and `label` are required** for every key
5. **`options` is required** when `type` is `"select"` or `"multi-select"`
6. **`en` is recommended** as the fallback language in all i18n objects
7. **Order matters** — keys render in the order they appear in the JSON
8. **No decorative elements** — schema is for editable settings only. Static text,
   external links, version history, mod credits → put those in the mod's README, not here.

---

*This standard is maintained by the HZMM project.*
