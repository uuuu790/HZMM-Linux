# HZMM Config Schema Standard

> `hzmm.config.json` specification for mod authors who want a rich config editor in HZMM.
>
> Version: **1.4**. The behavior described here ships in the first HZMM release after v1.6.0.
> Schemas written for 1.0–1.3 keep working unchanged. What HZMM writes did change: the [keybind format](#keybind), string escaping, and [quoting that follows the schema type](#how-values-are-written), so an edited value can come back as a different Lua type.

---

## Contents

- [Overview](#overview)
- [Mod layout](#mod-layout)
- [Quick start](#quick-start)
- [What's new](#whats-new)
- [config.lua requirements](#configlua-requirements)
- [Schema structure](#schema-structure)
- [Field reference](#field-reference)
- [Type details](#type-details)
- [How values are written](#how-values-are-written)
- [Reset behavior](#reset-behavior)
- [Saving](#saving)
- [Multi-language (i18n)](#multi-language-i18n)
- [Comment mode (no schema)](#comment-mode-no-schema)
- [Full example](#full-example)
- [Rules](#rules)
- [Troubleshooting for authors](#troubleshooting-for-authors)

---

## Overview

A mod that wants a proper settings screen in HZMM ships two files:

| File | Read by | Contains |
|:--|:--|:--|
| `config.lua` (or an `.ini`) | your mod, and HZMM | The values. HZMM rewrites only the lines the player changes. |
| `hzmm.config.json` | HZMM only | The UI: which keys to show, their types, labels, ranges, defaults. |

Players get typed widgets (switches, sliders, dropdowns, color pickers, hotkey capture, lists), a search box, per-key and whole-config reset, and labels in the app language.

HZMM edits `config.lua` as text, line by line. It never runs your Lua, and it only rewrites lines whose value changes. Everything else is written back byte for byte (comments, blank lines, spacing, quote style, line endings). The price is that `config.lua` has to stay within a simple subset of Lua. See [config.lua requirements](#configlua-requirements).

Without a schema, HZMM falls back to [comment mode](#comment-mode-no-schema), a simpler editor guessed from the comments in your config file.

---

## Mod layout

Recommended layout. It matches how UE4SS loads Lua mods:

```
MyMod/                      <- folder in ue4ss/Mods; the folder name is the mod name
  hzmm.config.json          <- UI schema. Must be here: HZMM only looks in the mod root
  Scripts/
    main.lua                <- UE4SS entry point
    config.lua              <- the values; main.lua loads it, HZMM edits it
```

```json
{ "configFile": "Scripts/config.lua", "sections": { } }
```

```lua
-- Scripts/main.lua
local Config = require("config")   -- finds Scripts/config.lua
```

`require("config")` works with no path code because UE4SS adds the mod's `Scripts/` folder to `package.path` before it runs `main.lua`.

- **`hzmm.config.json` must be in the mod root** (next to `Scripts/`, not inside it). HZMM looks for `<Mods>/<ModName>/hzmm.config.json` and nowhere else.
- **`configFile` is resolved relative to the mod root** and may include a sub-path: `"Scripts/config.lua"`, `"config.lua"`, `"settings/options.ini"`. Use forward slashes. A path that leaves the mod folder (`../`) is refused.
- One schema describes one file.
- [Comment mode](#comment-mode-no-schema) (no schema) never reads files under `Scripts/`. A config kept in `Scripts/` can only be edited in HZMM through a schema.

### Mods that keep config.lua in the mod root

`"configFile": "config.lua"` works as well. But UE4SS never puts the mod root on `package.path`, so a bare `require("config")` in `Scripts/main.lua` fails. Add the parent folder first:

```lua
-- Scripts/main.lua: make the mod root (the folder above Scripts/) searchable
local scriptDir = debug.getinfo(1, "S").source:gsub("^@", ""):match("^(.*[/\\])") or ""
package.path = scriptDir .. "../?.lua;" .. package.path
local Config = require("config")
```

This doesn't depend on the `Scripts` / `scripts` folder casing or on the path separator style.

If you move `config.lua` into `Scripts/` in an update, players' existing values stay in the old file. HZMM's updater restores config files at their old paths (see [Troubleshooting](#troubleshooting-for-authors)).

---

## Quick start

**Scripts/config.lua**

```lua
local Config = {
    MaxHealth = 100,
    Difficulty = "Normal",
}
return Config
```

**hzmm.config.json** (mod root)

```json
{
  "configFile": "Scripts/config.lua",
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
          "default": "Normal",
          "label": { "en": "Difficulty", "zh-TW": "難度" },
          "options": [
            { "value": "Easy" },
            { "value": "Normal" },
            { "value": "Hard" }
          ]
        }
      }
    }
  }
}
```

**Scripts/main.lua**

```lua
local Config = require("config")
if Config.Difficulty == "Hard" then
    -- ...
end
```

For a complete mod that uses every widget, see [`examples/full-widget-demo/`](examples/full-widget-demo/).

---

## What's new

### 1.4 — safe writes, UE4SS keybinds, stricter config.lua reading

| Change | Summary |
|:--|:--|
| Keybinds use UE4SS `Key` names | Keybind values are `Ctrl` / `Shift` / `Alt` + the name from UE4SS's `Key` table (`"Alt+ONE"`, `"NUM_ONE"`, `"UP_ARROW"`, `"OEM_COMMA"`), so `Key[name]` works directly. The key is named as UE4SS sees it under the player's keyboard layout. Meta/Win is no longer recorded. Values written by HZMM ≤ 1.6.0 (`"1"`, `"Numpad1"`, `"ArrowUp"`, `"Enter"`, `"Comma"`, `"Meta+…"`) are converted in the editor and written in the new form on the next save. |
| Quoting follows the schema type | An edited value is written quoted or bare according to its schema `type`, whatever the file had: an `int` stored as `"100"` comes back as `150`, a `select` with numeric options as `2`, a `multi-select` with numeric options as `{1, 3}`, and a bare `text` value gets quotes. What your mod reads can change type, so compare numbers with `tonumber(Config.X) == 2`, not `Config.X == "2"`. Keys without a `type` keep their form ([details](#how-values-are-written)). |
| Text escaping | Quoted Lua strings are unescaped when read (`\\` `\"` `\'` `\n` `\t` `\r`) and escaped when written. Quotes, apostrophes and Windows paths no longer break `config.lua`, and a backslash the player types stays a backslash (≤ 1.6.0 wrote it raw, so a typed `\t` became a tab). |
| `select` quoting | `select` values are written quoted when the options are strings, and bare when every option value is a number or boolean. Before, switching on an optional `select` wrote a bare identifier (`Mode = Hard,`, which Lua reads as `nil`). |
| Numeric validation | An `int` / `float` edit that isn't a valid number is never written. It reverts when the field loses focus, and again at save. No more `MaxHealth = ,`. A key without a `type` gets its widget from the value the file had, so typing can't turn a number box into a text box. |
| Lua syntax check | Before writing a `.lua` config, HZMM parses the new text. If it would not load, the save is refused, the file is left untouched and the toast names the line. The check is skipped when the file on disk already fails it (for example Lua 5.4's `<const>`). |
| Root table | HZMM reads the table your file returns. Only its first-level fields bind to schema rows; helper tables, other globals and keys inside sub-tables are ignored. See [Which table HZMM edits](#which-table-hzmm-edits). |
| Read-only values | A value HZMM can't rewrite safely (spread over several lines, sharing its line with another statement, a `function`, …) is shown read-only and written back unchanged. See [Read-only values](#read-only-values). |
| Optional keys | Switching a key on adds a missing comma to the line before it, expands a one-line empty root table (`return {}`), writes globals without a comma and before a trailing `return`, writes INI keys inside their `[Section]`, and keeps CRLF line endings. Switching it off removes every line of the key. When HZMM can't do either safely, it shows an error and the switch doesn't move. An optional `select` without a `default` starts at its first option. |
| All-optional configs | A config file with no keys yet (`local Config = {}` + `return Config`) still opens the schema editor, so optional keys can be switched on. |
| Schema tolerance | A section without `keys` is treated as empty, a `null` or non-object key definition is skipped, and `options` may be plain values (`["Easy", "Hard"]`, `[1, 2]`). |
| Consistent reset and clamping | Save-time clamping, both reset buttons and the "all at defaults" check use the same key binding as the rows, and compare numbers numerically (`25` equals default `25.0`). Save clamps only values the player edited or switched on. |
| `enableKey` really disables | While the switch is off, the section's other rows can't be changed with mouse or keyboard, including their optional switch and `openPath` button. |
| Syntax by file extension | `.lua` uses Lua rules, `.ini` / `.cfg` use INI rules (` ;` and ` #` start inline comments), other extensions are auto-detected. |
| Save errors | The error toast names the file and the reason, stays 12 seconds (close it with ×), and the next save's result replaces it. |

### 1.3 — Description tokens, reset to defaults, polish

| Feature | Where | Summary |
|:--|:--|:--|
| `{value}` token | `description` | Replaced with the key's current value. |
| `{eval: <expr>}` token | `description` | Arithmetic on the current value, e.g. `{eval: 35*(1+value/100)} kg`, updated live as the player drags a slider. First shipped as a JavaScript expression. Since HZMM v1.5.0 it is a sandboxed arithmetic evaluator (numbers, `value`, `+ - * / %`, parentheses): see [Description tokens](#description-tokens). |
| Reset-to-defaults button | UI only | Footer button restores every key to its schema `default`. Disabled when everything is already at its default. |
| Auto-collapse threshold | UI only | Schemas with more than 10 sections open with every section folded. Override per section with `collapsed: false`. |

### 1.2 — Sliders, multi-select, lists, optional keys, unified dropdown

| Feature | Where | Summary |
|:--|:--|:--|
| `widget: "slider"` | key | Range slider with a companion number box, for `int` / `float` keys that have `min` and `max`. |
| `type: "multi-select"` | key | Pick several values. Stored as a one-line Lua array of strings: `{"Pistol", "Rifle"}` (numeric options are written bare since 1.4, see [options](#key--options)). |
| `type: "list"` | key | Free-form string list with `+` / `×` controls, stored the same way. |
| `optional: true` | key | Per-row switch that decides whether the key is in `config.lua` at all. Off removes the line and Lua sees `nil`. One key replaces the old `X` + `X_Enabled` pair. |
| Unified dropdown UI | UI only | Shared look for `select` (3+ options) and `multi-select`. |

### 1.1 — Color, keybind, collapsed sections

| Feature | Where | Summary |
|:--|:--|:--|
| `color` type | key | Hex color picker (`#rrggbb`). |
| `keybind` type | key | Hotkey capture (format changed in 1.4, see [keybind](#keybind)). |
| `collapsed` | section | Section starts folded; click the header to expand. |
| Default reset | key (UI only) | A key with a `default` gets a hover ↺ button that restores it. |

All additions through 1.4 are backward compatible. Schemas written for 1.0 keep working unchanged.

---

## config.lua requirements

HZMM reads `config.lua` line by line and never runs it. Stay within the shapes and rules below and every key stays editable.

### Supported shapes

```lua
-- A. Local table + return (recommended)
local Config = {
    MaxHealth = 100,
    Difficulty = "Normal",
}
return Config
```

```lua
-- B. Returned table
return {
    MaxHealth = 100,
}
```

```lua
-- C. Global table
Config = {
    MaxHealth = 100,
}
```

```lua
-- D. Plain globals, no table
MaxHealth = 100
Difficulty = "Normal"
```

`.ini` / `.cfg` files use [INI rules](#ini-files).

### Which table HZMM edits

HZMM picks the part of the file that holds the settings by the first rule that matches:

| The file… | Settings are |
|:--|:--|
| has a chunk-level `return {` (shape B) | the fields of that returned table |
| has a chunk-level `return Name` (shape A) | the fields of the last `local Name = {` or `Name = {` before it (`local Name <const> = {` works too) |
| returns no table (shape C) | the fields of its only multi-line table, provided that table has at least one `Key = value` field and the file has no other chunk-level `Key = value` line |
| anything else (shape D) | every chunk-level `Key = value` line (plain globals) |

- With a root table (A–C), only its first-level fields are settings. Helper tables (`local Defaults = { … }`), other globals (`Debug = false`), `local` statements and keys inside sub-tables are ignored and written back unchanged.
- Shape C is fragile: a second multi-line table or any global `Key = value` line turns the file into shape D, where none of the table's fields bind (the global table itself becomes one read-only value). Add `return Config` at the end and the `return Name` rule applies instead.
- In shape D, a one-line table (`Blacklist = {}`) is an editable value and a multi-line one is read-only.
- An empty one-line root (`local Config = {}` + `return Config`, or `return {}`) is fine when every key is `optional`: HZMM expands it when the first key is switched on. A one-line root that has fields (`local Config = { MaxHealth = 100 }`) binds no rows and can't take new keys.
- Saving never changes which table HZMM reads. Switching an optional key off is refused if the removal would (for example, removing the last field of a shape-C table, or the only other global next to a table in shape D).

### Line rules

| Write this | Not this | Why |
|:--|:--|:--|
| The root table's `{` and `}` on their own lines | `local Config = { MaxHealth = 100 }`, or `B = 2 }` | A one-line root table has no editable rows, and a field on the line that closes the table is read-only. (An empty `{}` is fine.) |
| One field per line: `MaxHealth = 100,` | `A = 1, B = 2,` | A line with a second field or statement is read-only. |
| Arrays on one line: `Weapons = {"Pistol", "Rifle"},` | An array or table spread over several lines | A multi-line value is read-only. |
| A comma after every field | Leaving the last field without one | Not required, but it keeps hand edits safe. HZMM adds a missing comma itself when it inserts a key after that line. |
| Flat keys: `Pistol_Damage = 10,` | `Pistol = { Damage = 10 },` | Keys inside a sub-table are never bound to schema rows, even if a root key has the same name. |
| Identifier keys: `MaxHealth`, `Max_Health2` | `["Max Health"] = 1` | Only `Name = value` lines are recognized. |
| Fields inside the root table | `Config.MaxHealth = 100` | Dot assignments are not recognized. The row doesn't appear. |
| Literal values: `true`, `100`, `-2.5`, `"text"` | `60 * 5`, `OtherKey`, `math.huge` | HZMM can't show or validate expressions as numbers. Players have to replace the whole value with a valid number before it saves. |

HZMM also ignores comments (`--`, `--[[ ]]`, `--[==[ ]==]`; braces and `Key = value` text inside comments and strings don't count) and everything inside `function ... end`, `if ... end`, `do ... end` and loop blocks. In a `.lua` file a line starting with `;` is code, as in Lua (`;B = 2` inside a table is a field HZMM leaves alone); only files with other extensions that HZMM auto-detects as Lua also accept `;`, `#` and `//` comment lines.

### Read-only values

A bound key whose line can't be rewritten safely is read-only. HZMM never edits, clamps or resets it, and saving writes it back unchanged.

| Read-only when the line has… | Example |
|:--|:--|
| a value that continues on later lines: a table, a function body, a `[[long string]]`, an expression ending in an operator or continued by a line that starts with one, or no value before the line break | `Weapons = {` … `},` · `Delay = 60` … `* 5,` |
| a string continued on the next line (`\` or `\z` before the line break) | `Motd = "Welcome \z` … `the server",` |
| a `--[[` comment that continues on later lines (the whole span up to `]]` counts as the field) | `MaxSlots = 20, --[[ Slots` … `]]` |
| code after an inline block comment | `Damage = 5 --[[ base ]] + 3,` |
| a second field or statement | `A = 1, B = 2,` · `Width = 800 Height = 600` |
| a `function` value, even on one line | `OnLoad = function() end,` |
| the `}` that closes the table | `B = 2 }` |
| a string escape HZMM can't re-encode, also in an item of a one-line array | `"\x41"` `"\65"` `"\u{48}"` `"a\z b"` `{"\x41", "B"}` |
| an empty value | `Key = ,` |

A key set by the second statement of a read-only line (`B` in `A = 1, B = 2,`) counts as present: its optional switch can't add it, and if it also has a line of its own, switching that off is refused.

In the editor, a read-only row shows only this key's own value in a bordered box with a lock icon, and a **Read-only** pill next to the type badge. The box can be focused; hovering it shows the full value and why it's read-only. One note at the top of the editor explains read-only rows whenever at least one is visible. The type badge shows the schema type; without one (and in comment mode) a table is badged LIST or TABLE and a function CODE.

### Strings

- Use `"..."` or `'...'`. HZMM decodes `\\` `\"` `\'` `\n` `\t` `\r` for display and encodes them again on save, together with the line's own quote character.
- A string with any other escape (`\x41`, `\65`, `\u{…}`, `\z`), or one continued on the next line, is read-only in HZMM. So is a one-line array with such a string among its items.
- A one-line long string (`[[C:\Games]]`) is editable. Once the player changes it, HZMM writes it back as a `"..."` string.

### Numbers

- `int`: `100`, `-7`. `float`: `1.5`, `-0.25`, `.5`, `3.`, `1e3`, `2.5E-3`. Hex (`0x10`), a leading `+`, `inf` and `nan` are not valid numbers for HZMM.
- Keep shipped values inside `min` / `max`. HZMM clamps only values the player edits or switches on. A line the player doesn't touch is written back as it is, even out of range.

### Encoding and line endings

Save `config.lua` as UTF-8 (with or without BOM). LF and CRLF are both kept, including on inserted lines. Other encodings (Big5, GBK, Shift-JIS) are corrupted when HZMM saves.

### INI files

`.ini` and `.cfg` files are read with INI rules:

| Topic | Rule |
|:--|:--|
| Lines | `[Section]` headers (a trailing `; comment` is allowed: `[Video] ; display`) and `key = value` (or `key=value`) lines. A key is anything without `=`, whitespace, `;`, `#`, `[` or `]`, so `window-width`, `Audio.Volume` and `+Paths` work. |
| Sections | The schema section id must equal the `[Section]` name exactly, case included. Keys are only looked up inside that section. In a file with real `[Section]` headers, a comment banner (`; ====[ Audio ]====`) is just a comment; banners only group keys in an INI file without headers. |
| Comments | Comment lines start with `;` or `#` (`--` and `//` also work). After the value starts, ` ;`, ` #` and ` --` (with whitespace before) begin an inline comment. A `;` right after `= ` is a comment (`Key = ; note` is empty), but `#` and `--` there are part of the value (`Color = #FF0000`). |
| Quotes | Only a quote at the start of the value makes it a quoted value (`Title = Bob's Server` is plain text). There is no escaping. |
| Edited lines | Keep their `key<spacing>=<spacing>` prefix and inline comment. A trailing comma is part of the value and is never added or removed. A value that wouldn't read back bare (it contains ` ;`, ` #` or ` --`, starts with `;`, or is wrapped in quotes itself) is written quoted, with `'…'` if it contains `"`. Line breaks become spaces. |
| Empty values | Written as `Key =` (or `Key=`, following the line). A `;` comment is kept; a `#` or `--` comment is dropped because it would read back as the value. A line that was quoted becomes `Key = ""`. |
| New keys | Switched-on optional keys go inside their `[Section]` (added at the end of the file if missing), without a comma, copying a sibling's spacing. Without a `default`, the line gets the [type's seed](#key--optional-12), unquoted (`Key = false`, `Key = 0`, `Key = 0.0`, `Key = {}`, or a `select`'s first option); only `text`, `color` and `keybind` keys, and keys without a `type` or `options`, get `Key =`. |

---

## Schema structure

```
hzmm.config.json
  configFile          (string)         Config file path, relative to the mod root
  sections            (object)         Settings groups, rendered in JSON order
    [SectionId]
      label           (i18n | string)  Section header text
      collapsed?      (bool)           Section starts folded (1.1+)
      enableKey?      (string)         bool key in this section that gates the others
      keys            (object)         Settings in this section
        [KeyName]                      A root-level key in the config file
          type         (string)        "bool" | "int" | "float" | "select" | "text"
                                       | "color" (1.1) | "keybind" (1.1)
                                       | "multi-select" (1.2) | "list" (1.2)
          label        (i18n | string) Display name
          description? (i18n | string) Help text; supports {value} and {eval:} (1.3)
          default?     (any)           Default value: reset target, optional-key seed
          optional?    (bool)          Row gets a switch that adds/removes the line (1.2)
          widget?      (string)        "slider" for int/float with min and max (1.2)
          min? / max?  (number)        Range for int/float
          step?        (number)        Slider step
          options?     (array)         Choices for select / multi-select
          showWhen?    (object)        Show only when other keys have given values
          openPath?    (object)        Jump-to-file button { path, relativeTo, action }
```

---

## Field reference

### `configFile`

**Required.** The file this schema describes, relative to the mod root. Sub-folders are allowed.

```json
{ "configFile": "Scripts/config.lua" }
```

HZMM picks the syntax from the extension: `.lua` uses Lua rules, `.ini` / `.cfg` use INI rules, anything else is auto-detected. A file with `[Section]` lines is read as INI unless it also has a Lua table spread over several lines, or braces together with `--` / `local` / `return` / `function` lines; a brace inside an INI value (`Name = {Clan} Server`) doesn't count. A file without `[Section]` lines is Lua when it has a table (spread over several lines, or a one-line `Key = { ... }` field), `--` comment lines, `local` / `return` / `function` lines or lines ending in a comma, and INI otherwise (so `Name = {Clan} Bob` alone keeps it INI). Use a `.lua` or `.ini` name to skip the guess. If `configFile` is missing or the file can't be read, HZMM ignores the schema and uses comment mode.

### `sections`

**Required.** Groups keys under collapsible headers. Each property name is a section id.

```json
{
  "sections": {
    "Combat": { },
    "Farming": { }
  }
}
```

The id shows only as the header of a section without a `label` (and the search box matches it), but it is not just an internal name:

- **INI files:** the id must equal the `[Section]` name exactly, case included. A mismatch hides every row of that section.
- **Lua files:** the id is matched against comment banners (`-- ====[ Name ]====` or `--[[ ====[ Name ]==== ]]`). The match ignores case and punctuation and also accepts a single banner that starts with the id (`UPGRADE STORAGE EXTRA CAPACITY` matches `UpgradeStorage`). It decides where a switched-on optional key is inserted, and which line a key binds to when the same key name appears under several banners. A key name that appears once in the file binds no matter which section declares it. Without banners, the id only groups rows in the UI.
- Sections render in JSON order, except integer-like ids (`"2"`, `"10"`): JavaScript puts those first, in numeric order. Use names.

### Section → `label`

Display name for the section header: an [i18n object](#multi-language-i18n) or a plain string. Without it the header shows the section id.

```json
{ "label": { "en": "Combat", "zh-TW": "戰鬥", "ja": "戦闘" } }
```

### Section → `collapsed` (1.1+)

**Optional.** When `true`, the section starts folded. Only the header shows until the player clicks it. Good for "Advanced" groups.

```json
{
  "Advanced": {
    "label": { "en": "Advanced", "zh-TW": "進階設定" },
    "collapsed": true,
    "keys": { }
  }
}
```

- Open/closed state lasts until the editor closes. Reopening returns to the schema's choice.
- A folded section also hides its `enableKey` switch until expanded.

#### Auto-collapse threshold

With **more than 10 sections**, every section starts folded so the editor opens quickly. A section with an explicit `collapsed: false` stays open. Sections without `collapsed` follow the auto rule.

### Section → `enableKey`

**Optional.** Names a `bool` key in the same section that acts as a master switch. While its value is `false`, every other row in the section is dimmed and disabled for mouse and keyboard, including its optional switch and `openPath` button. Their values are kept and still saved. The switch itself stays editable. If the key is missing from the config file, the section isn't gated. A [read-only](#read-only-values) switch line counts by the key's own value (`Enabled = false, Debug = false` gates the section); a value that isn't plain (a table, a function, or a string with an escape HZMM can't decode, such as `\x41`) never gates it.

```json
{
  "enableKey": "Enabled",
  "keys": {
    "Enabled": { "type": "bool", "default": true },
    "Speed": { "type": "int", "default": 5 }
  }
}
```

### Key → `type`

Determines the widget, validation and how the value is written.

| Type | Widget | Value in config.lua |
|:--|:--|:--|
| `"bool"` | Switch | `true` / `false` |
| `"int"` | Text box (whole numbers only), or slider with `widget: "slider"` | `42`, `-7` |
| `"float"` | Text box (numbers only), or slider with `widget: "slider"` | `1.5`, `0.01` |
| `"select"` | Pills (2 options or fewer) or dropdown (3 or more) | `"Normal"`, or `2` when all options are numbers |
| `"text"` | Single-line text box | `"any string"` |
| `"color"` (1.1+) | Color picker | `"#3b82f6"` |
| `"keybind"` (1.1+) | Hotkey capture | `"Ctrl+Shift+F"`, `"F6"`, `"NUM_ONE"` |
| `"multi-select"` (1.2+) | Dropdown with checkboxes | `{"Pistol", "Rifle"}` |
| `"list"` (1.2+) | Editable string list with `+` / `×` | `{"Alice", "Bob"}` |

Always set `type`. If it's omitted or isn't one of the types above (`"boolean"`, `"number"`, `"slider"`), HZMM infers it from the value the file had when the editor opened: a quoted value is text, bare `true` / `false` is bool, a bare whole number is int, another bare number is float, anything else is text; with an array `default`, a one-line array is a list. Typing never changes the widget. A key that isn't in the file (an optional key that is off, or one switched on in the editor) is typed by its `default`: an array is a list, `true` / `false` a bool, a number an int or float, and a string text, so in Lua a `"0042"` or `"true"` default is written quoted. Such a key with `options` and a string default (or none) is quoted like a `select`. A `select` without `options` renders as a plain text box.

### Key → `default`

**Optional.** Used by:

1. the hover ↺ button and the footer "Reset to defaults" (see [Reset behavior](#reset-behavior));
2. switching on an `optional` key (the value that gets written);
3. the dimmed value shown while an optional key is off.

```json
{ "type": "int", "default": 100 }
```

- Match the type: a number for `int` / `float`, `true` / `false` for `bool`, a string for `text` / `color` / `keybind`, one of the `options` values for `select` (exact, case-sensitive), an array for `list` / `multi-select` (JSON numbers in it are written bare: `[1, 2]` → `{1, 2}`).
- Keep it equal to the value you ship in `config.lua`, so a fresh install shows everything at defaults.
- A whole-number `float` default is written with one decimal (`1.0`).
- Write `color` defaults in lowercase (`"#3b82f6"`). The picker writes lowercase, and colors are compared as text.

### Key → `optional` (1.2+)

**Optional.** When `true`, the row gets a small switch that decides whether the key is in `config.lua` at all.

- **Off:** every line of the key in the same table is removed (in Lua the root table or the globals, across banners; in INI the same `[Section]`), so the mod sees `Config.X == nil`.
- **On:** a line is inserted with the `default`. Without a `default`, HZMM writes a seed: `false` (bool), `0` (int), `0.0` (float), `{}` (list / multi-select), `""` (text / color / keybind; INI writes `Key =`), or the first option (select).
- While off, the row shows the default dimmed and the widget is disabled.

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

Where the inserted line goes:

| Config shape | Placement |
|:--|:--|
| Root table (shapes A–C) | After the last field under the banner that matches the section id (right below the banner when it has no fields yet). Otherwise after the table's last field, or just before its closing `}` when it has no fields yet. If the code line before the new one has no trailing comma, HZMM adds one (before any inline comment). The new line ends with a comma (none when the next code line starts with its own `,` or `;`, as in `;B = 2`) and copies its neighbor's indentation. An empty one-line root (`return {}`) is expanded to several lines first. |
| Plain globals | `Key = value` with no comma, after the last global and before a `return` statement (also one that shares a line with other code). If the file returns a value (`return Config`, `return setmetatable(...)`) HZMM couldn't read as its root table, a new global would never reach the mod, so switching on is refused. |
| INI | Inside the matching `[Section]` (added at the end of the file if it doesn't exist yet), no comma, copying a sibling's `=` spacing. |

CRLF files get CRLF lines.

When HZMM can't add or remove the line safely, it shows an error toast (for 12 seconds), the switch stays as it was and nothing changes. Edit the file by hand in that case.

- **Switching on is refused** when the root table is on one line and has fields, or never closes; when a plain-globals file returns a value; when the key can't be written as a plain key (a Lua keyword or non-identifier, or an INI key with `=`, whitespace, `;`, `#`, `[` or `]`); when the table or INI section already has a line for the key (a duplicate under another banner, or a key set on a [read-only](#read-only-values) line); or when re-reading the result doesn't find the new key on the inserted line with every other field unchanged.
- **Switching off is refused** when a line of the key is read-only, when the next code line in the table starts with its own `,` or `;` (`;B = 2`: without the field before it, that separator doesn't load), or when the removal would change [which table HZMM reads](#which-table-hzmm-edits).

Lua side. One key instead of carrying both `X` and `X_Enabled`:

```lua
-- Old pattern
if Config.DamageMul_Enabled then weapon.DamageMul = Config.DamageMul end

-- 1.2+ pattern
if Config.DamageMul ~= nil then weapon.DamageMul = Config.DamageMul end
```

You only need to ship the optional keys that have a non-default value. A config with no keys at all (`local Config = {}` and `return Config`) works too.

### Key → `label`

Display name next to the widget: an [i18n object](#multi-language-i18n) or a plain string. Falls back to the key name.

```json
{ "label": { "en": "Max Health", "zh-TW": "最大生命值" } }
```

### Key → `description`

**Optional.** Help text under the label, as an i18n object or a plain string.

```json
{ "description": { "en": "Player maximum HP (1-9999)", "zh-TW": "玩家最大血量 (1-9999)" } }
```

#### Description tokens

Two tokens are replaced at render time, so the help text can follow the current value:

| Token | Replaced with | Example |
|:--|:--|:--|
| `{value}` | The current value as stored, without quotes. Lists show their Lua array text. An optional key that is off shows its default. | `"Reduce stamina cost by {value}%"` → at 50: `Reduce stamina cost by 50%` |
| `{eval: <expr>}` | The result of an arithmetic expression on the current value. | `"Max carry {eval: 35*(1+value/100)} kg"` → at 100: `Max carry 70 kg` |

`{eval:}` accepts arithmetic only. The grammar is exactly:

```
expr   = term   (("+" | "-") term)*
term   = factor (("*" | "/" | "%") factor)*
factor = NUMBER | "value" | "(" expr ")" | ("+" | "-") factor
NUMBER = digits with an optional decimal part: 12   1.5   3.   .5
```

- `value` is the current value read as a number (`parseFloat`). Text that doesn't start with a number, `true` and `false` all count as `0`.
- Whitespace is allowed anywhere inside the expression, but the token must start with exactly `{eval:` (`{ eval: value }` is shown as-is). The token ends at the first `}`.
- `%` is JavaScript's remainder: the result takes the sign of the left operand (`-7 % 3` is `-1`, where Lua gives `2`).
- A whole-number result prints without decimals (`70`). Anything else prints with exactly two (`52.50`).
- If the expression uses anything outside the grammar, or the result isn't a finite number (division by zero), the token is left as-is and the player sees `{eval: …}`.

| Works | Result at value = 50 |
|:--|:--|
| `{eval: value * 60}` | `3000` |
| `{eval: 35 * (1 + value / 100)}` | `52.50` |
| `{eval: (value - 32) * 5 / 9}` | `10` |
| `{eval: -value + 100}` | `50` |
| `{eval: value % 7}` | `1` |

| Doesn't work | Why |
|:--|:--|
| `{eval: Math.round(value)}`, `{eval: round(value)}` | No functions. |
| `{eval: value ** 2}`, `{eval: value ^ 2}` | No power operator. |
| `{eval: value > 50 ? 1 : 0}` | No comparisons or conditionals. |
| `{eval: value.toFixed(1)}` | No methods. |
| `{eval: 1e3 * value}` | No exponent notation in the expression. |
| `{eval: MaxHealth * 2}` | Only `value` (this key); other keys can't be referenced. |

Order of processing: the i18n object is resolved to one string for the current language, then every `{eval:}` token is replaced, then every `{value}`. Each language string can carry its own tokens:

```json
{ "description": { "en": "Weight {eval: 35*value} kg", "zh-TW": "重量 {eval: 35*value} 公斤" } }
```

### Key → `min` / `max`

**Optional.** For `int` and `float`.

- **Text box:** an out-of-range value is clamped when the box loses focus.
- **Slider:** the thumb can't leave `[min, max]`.
- **Save:** a value the player edited or switched on is clamped. A line the player didn't touch is written back as it is, even out of range, so ship values inside the range. Read-only rows are never clamped.
- All three use the same rule, and the result never lands outside the range: an `int` with fractional bounds clamps to `ceil(min)` / `floor(max)`.

```json
{ "type": "int", "min": 1, "max": 9999 }
```

### Key → `step`

**Optional.** Slider step only. Defaults: `1` for int, `0.1` for float. Plain text boxes have no spinner or arrow-key stepping.

```json
{ "type": "float", "widget": "slider", "min": 0.1, "max": 10.0, "step": 0.1 }
```

#### Float formatting

- Slider values inside the range are rounded to 4 decimal places and written without trailing zeros (`0.5`, `3`).
- A value clamped to `min` / `max` (or a slider at either end) is the bound itself, not rounded (`0.00004` stays `0.00004`), also without trailing zeros (a bound of `3.0` is written `3`).
- A value typed into a plain box is written as typed, once it is a valid number (`1.50` stays `1.50`).
- Reset writes the `default` (`1.0` for a whole-number float default).

In Lua 5.4, `3 == 3.0` is true, but `math.type()` and `tostring()` differ. Don't make mod logic depend on how the number is written.

### Key → `widget` (1.2+)

**Optional.** The only value is `"slider"`. It applies to `int` / `float` keys that have both `min` and `max`. Otherwise the key falls back to a plain text box.

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

### Key → `options`

**Required for `select` and `multi-select`.** The choices, as `{ "value": ... }` objects. Plain values are accepted too (`["Easy", "Hard"]`, `[1, 2, 3]`, 1.4+).

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

- **Players see the value itself.** There is no per-option label and no translation; a `label` on an option is ignored. Pick short, readable values (`"Hard"`, not `"hard_v2"`), and put explanations in the key's `description`.
- **Matching is exact and case-sensitive, as text.** The value in the file must equal an option (`"Normal"` is not `"normal"`), or no option is highlighted. `2` and `"2"` both match option `2`, but `2.0` doesn't.
- **Quoting follows the options.** String options are written quoted (`Difficulty = "Hard"`). When every option value is a number or boolean, the value is written bare (`HudScale = 2`), so compare with `Config.HudScale == 2` in Lua.
- `multi-select` writes an option whose JSON value is a number bare (`{1, 3}`) and every other item as a string. An item that is a bare number in the file stays bare while it's selected.
- `options` on an `int`, `float` or `text` key also renders pills / a dropdown; the value is written according to the key's type.

### Key → `showWhen`

**Optional.** Shows the row only while other keys have given values.

```json
{
  "MultiplierValue": { "type": "float", "showWhen": { "Mode": "Multiplier" } },
  "FixedValue":      { "type": "float", "showWhen": { "Mode": "Fixed" } }
}
```

Several conditions must all hold (AND). There is no OR or NOT.

```json
{ "showWhen": { "Enabled": true, "Mode": "Advanced" } }
```

- A failed condition **hides** the row (it isn't dimmed). Its value is kept and still saved.
- Comparison is textual: the dependency's value as written in the file against the JSON value turned into a string. `true` and `"true"` both work. `1` matches `1` but not `1.0`, so for float dependencies write the value exactly as the file has it, as a string (`"1.0"`).
- The dependency is looked up with the row's own section id. In INI files it must be in the same `[Section]`. In Lua files any root key with that name works if the name appears only once, but keep dependencies in the same section.
- If the dependency key is absent (for example an optional key that's switched off), the row is hidden.
- A [read-only](#read-only-values) dependency counts by the key's own value, without quotes (`Hard` in `Mode = "Hard", Other = 1`). If that isn't a plain value (a table, a function, or a string with an escape HZMM can't decode, such as `\x41`), the condition counts as met and the row stays visible.
- While the player is searching, `showWhen` is ignored so matching rows can be found.

### Key → `openPath`

**Optional.** Adds a small "jump to file" button to the row, e.g. next to a Debug switch to open the log it writes.

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
|:--|:--|:--|:--|
| `path` | string | (required) | Relative path under the chosen base. |
| `relativeTo` | `"game"` \| `"mod"` | `"game"` | `"game"` resolves under the HumanitZ install root. `"mod"` resolves under the mod's own folder. |
| `action` | `"open"` \| `"reveal"` | `"open"` | `"open"` opens the file with its default program. `"reveal"` opens the containing folder with the file selected. |

The path is resolved in the main process and may not leave its base (`..` escapes are blocked). Executable file types are always revealed, never opened. If the file doesn't exist, the player gets a "File not found" toast.

---

## Type details

### `color`

Stores a quoted hex string `"#rrggbb"`. The picker is the system color dialog behind a swatch and hex label.

```json
{
  "TitleColor": {
    "type": "color",
    "default": "#3b82f6",
    "label": { "en": "Window Title Color", "zh-TW": "視窗標題顏色" }
  }
}
```

**Reading from Lua:**

```lua
-- Config.TitleColor = "#3b82f6"
local hex = Config.TitleColor:sub(2)
local r = tonumber(hex:sub(1, 2), 16) / 255
local g = tonumber(hex:sub(3, 4), 16) / 255
local b = tonumber(hex:sub(5, 6), 16) / 255
```

The widget also displays `#fff` (3-digit) and `3b82f6` (no `#`), and writes the full lowercase `#rrggbb` form once the player picks a color.

### `keybind`

Click the field, then press the combo. `Esc`, or clicking anywhere else, cancels capture; the × button clears the binding (writes `""`).

```json
{
  "OpenHotkey": {
    "type": "keybind",
    "default": "F6",
    "label": { "en": "Open Trade Window", "zh-TW": "開啟交易視窗" }
  }
}
```

**Format (1.4):** optional modifiers `Ctrl`, `Shift`, `Alt` (always in that order), then the main key's name from UE4SS's `Key` table, joined by `+`:

`"F6"`, `"Ctrl+T"`, `"Ctrl+Shift+F"`, `"Alt+ONE"`, `"NUM_ONE"`, `"UP_ARROW"`, `"OEM_COMMA"`, `"SPACE"`, `"RETURN"`

- Meta / Win is never recorded: UE4SS has no Win modifier.
- Only the keys listed below can be captured. Others (media and browser keys, a lone modifier, Win) are ignored while capturing, and `Esc` cancels capture. UE4SS's `Key` table does have some of them (`MEDIA_PLAY_PAUSE`, `VOLUME_UP`, `BROWSER_BACK`, `SHIFT`, `LEFT_WIN`, …): a player can type one into `config.lua` by hand, and HZMM shows it as-is.

**Main-key names HZMM writes:**

| Group | Names |
|:--|:--|
| Letters | `A` … `Z` |
| Digit row | `ZERO` `ONE` `TWO` `THREE` `FOUR` `FIVE` `SIX` `SEVEN` `EIGHT` `NINE` |
| Numpad | `NUM_ZERO` … `NUM_NINE`, `MULTIPLY` `ADD` `SUBTRACT` `DECIMAL` `DIVIDE`, `SEPARATOR` (some layouts). Numpad Enter is `RETURN`. With NumLock off the digit keys record as the navigation names (`HOME`, `END`, `INS`, …) and 5 as `CLEAR` |
| Function keys | `F1` … `F24` |
| Navigation | `UP_ARROW` `DOWN_ARROW` `LEFT_ARROW` `RIGHT_ARROW` `HOME` `END` `PAGE_UP` `PAGE_DOWN` `INS` `DEL` |
| Other | `SPACE` `RETURN` (Enter) `TAB` `BACKSPACE` `CAPS_LOCK` `NUM_LOCK` `SCROLL_LOCK` `PAUSE` (`CANCEL` with Ctrl held) `PRINT_SCREEN` `APPS` (Menu key) |
| Punctuation | `OEM_*`, see below |

The main key is named after the Windows virtual-key code it sends under the player's current keyboard layout, which is also what UE4SS checks in game. So the key pressed in HZMM is the key that fires in game: on a German QWERTZ keyboard the key printed Z records as `Z` and `Ü` as `OEM_ONE`; on a French AZERTY keyboard the key printed A records as `A`.

Punctuation keys use the `VK_OEM_*` names, so the character behind each name depends on the layout. On a US keyboard:

| Key (US layout) | Name | Key (US layout) | Name |
|:--|:--|:--|:--|
| `;` | `OEM_ONE` | `` ` `` | `OEM_THREE` |
| `=` | `OEM_PLUS` | `[` | `OEM_FOUR` |
| `,` | `OEM_COMMA` | `\` | `OEM_FIVE` |
| `-` | `OEM_MINUS` | `]` | `OEM_SIX` |
| `.` | `OEM_PERIOD` | `'` | `OEM_SEVEN` |
| `/` | `OEM_TWO` | extra key left of Z (ISO keyboards) | `OEM_102` |

Some layouts also have an `OEM_EIGHT` key (`` ` `` on a UK keyboard, `!` on French AZERTY).

**Values from HZMM ≤ 1.6.0.** Older versions stored browser key names (`KeyboardEvent.code` without its `Key` / `Digit` prefix) and could add `Meta`. HZMM converts them in the editor and writes the new form the next time the player saves. Until then the file still holds the old value.

| Old value | Converted to |
|:--|:--|
| `"Alt+1"` | `"Alt+ONE"` |
| `"Numpad1"` | `"NUM_ONE"` |
| `"ArrowUp"` | `"UP_ARROW"` |
| `"Enter"` | `"RETURN"` |
| `"Comma"` | `"OEM_COMMA"` |
| `"Ctrl+Meta+F"` | `"Ctrl+F"` (Meta dropped) |

**Reading from Lua (UE4SS `RegisterKeyBind`):** the main key goes straight into `Key[...]`; `Ctrl` / `Shift` / `Alt` map to `ModifierKey.CONTROL` / `SHIFT` / `ALT`.

```lua
-- Turn an HZMM keybind string ("F6", "Ctrl+Shift+F", "Alt+NUM_ONE") into the
-- arguments RegisterKeyBind expects. Returns nil when no valid main key is set.
local function ParseKeybind(str)
    if type(str) ~= "string" or str == "" then return nil end
    local mainKey, mods = nil, {}
    for part in str:gmatch("[^+]+") do
        if part == "Ctrl" then table.insert(mods, ModifierKey.CONTROL)
        elseif part == "Shift" then table.insert(mods, ModifierKey.SHIFT)
        elseif part == "Alt" then table.insert(mods, ModifierKey.ALT)
        else mainKey = Key[part] end
    end
    if mainKey == nil then return nil end
    return mainKey, mods
end

local key, mods = ParseKeybind(Config.OpenHotkey)
if key == nil then
    -- empty, or an old value the player hasn't re-saved yet: use your default
    key, mods = Key.F6, {}
end
if #mods > 0 then
    RegisterKeyBind(key, mods, function() OpenTradeUI() end)
else
    RegisterKeyBind(key, function() OpenTradeUI() end)
end
```

### `multi-select` (1.2+)

Pick zero or more values from a fixed set. Stored as a one-line Lua array (strings quoted, numeric options bare; see [options](#key--options)). Items are written in `options` order, whatever order they were clicked in; values in the file that aren't in `options` are kept at the end.

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

The array in `config.lua` must be on one line (`AllowedWeapons = {"Pistol", "Rifle"},`). A multi-line array is read-only. Items may be separated with `,` or `;`; an edited array is written with `, `.

**Reading from Lua:**

```lua
-- Config.AllowedWeapons = {"Pistol", "Rifle"}
for _, w in ipairs(Config.AllowedWeapons) do
    print("Allowed:", w)
end
```

### `list` (1.2+)

Like `multi-select`, but the player types the entries. No `options`: the editor shows one text box per entry, `+` to add and `×` to remove. Stored the same way.

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

Not a type: a presentation hint for `int` and `float` keys with both `min` and `max`. `step` sets the thumb's increment (defaults `1` / `0.1`). The small box next to the slider accepts typed values and stays in sync with the thumb.

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

---

## How values are written

What a line looks like after the player edits it (or switches an optional key on):

| Schema type | Written as | Example |
|:--|:--|:--|
| `bool` | bare | `Enabled = true,` |
| `int` | bare whole number | `MaxHealth = 250,` |
| `float` | bare number | `DamageMul = 1.5,` |
| `select`, string options | quoted string | `Difficulty = "Hard",` |
| `select`, all options numbers or booleans | bare | `HudScale = 2,` |
| `text` | quoted string, escaped | `Name = "Say \"hi\"",` |
| `color` | quoted string | `Color = "#3b82f6",` |
| `keybind` | quoted string | `Hotkey = "Ctrl+Shift+F",` |
| `multi-select` | one-line Lua array; options whose JSON value is a number are bare | `Weapons = {"Pistol", "Rifle"},` `Slots = {1, 3},` |
| `list` | one-line Lua array of strings; an item equal to a number in the `default`, or a bare number already in the file, is written bare | `Banned = {"Alice", "Bob"},` |
| no `type`, or one HZMM doesn't know | a quoted value stays quoted; a bare number is validated (and clamped to `min` / `max`) like `int` / `float`; any other bare value (`nil`, a name, a table) stays bare only while the edit is a number or `true` / `false` (or a table replacing a table), otherwise it's quoted. With an array `default`, a one-line array is written like a `list`. A switched-on key is written by the type its `default` gives ([details](#key--type)) | `Mode = "Hard",` (the file had `Mode = nil`) |

- **Only lines whose value changes are rewritten:** the player's edits, inserted and removed lines, the line that gets a comma when a key is inserted after it, and keybinds in the [old format](#keybind). Every other line is written back byte for byte, including an out-of-range number the player didn't touch.
- **Formatting of edited lines is kept:** indentation, the original `Key = ` spacing, trailing comma, inline comment, and CRLF.
- **The schema type decides quoting.** An `int` your file has as `"100"` comes back as `150` once the player edits it, so what your mod reads can change from string to number. Compare with `tonumber(Config.MaxHealth)` if the file ever held it as a string. The line's quote character (`'` or `"`) is kept; new lines use `"`. [Comment mode](#comment-mode-no-schema) has its own rules.
- **Escaping (Lua):** `\` → `\\`, the quote character → `\"` or `\'`, newline → `\n`, CR → `\r`, tab → `\t`. INI values are not escaped (see [INI files](#ini-files)).
- **Numbers:** an invalid `int` / `float` edit is never written (it reverts to the last valid value on blur, and to the original value or the default at save). An edited value is clamped to `min` / `max`. Clearing a bare Lua value keeps the old line, so `Key = ,` is never written. See [float formatting](#float-formatting).
- **Optional keys:** switching off removes every line of the key; switching on inserts one (see [optional](#key--optional-12)).
- **Read-only lines** are always written back unchanged.

---

## Reset behavior

Both reset controls use the schema `default` and the same key binding as the rows. Read-only rows and lines that aren't bound to a schema key are never reset.

| Control | Scope | Effect | Unavailable when |
|:--|:--|:--|:--|
| Row ↺ (1.1+), shown on hover | One key | Sets the key to its `default`. Keys without a `default` have no button. | The value already equals the default, or the row is gated (`enableKey` off, optional key off) or read-only. |
| Footer "Reset to defaults" (1.3+) | Every bound key | Keys with a `default` get it. An optional key without a `default` is switched off (every line of it is removed; a key HZMM [can't remove safely](#key--optional-12) stays, so the button can stay enabled). A non-optional key without a `default` is left alone. Optional keys that are off stay off. | Every bound key already equals its default and no optional key without a default is on. |

"Equals" compares numbers numerically for `int` / `float` (`25` equals a default of `25.0`), `list` / `multi-select` item by item (`{1, 2}` equals `{"1", "2"}`), and text exactly for everything else.

Nothing is written until the player clicks Save. In comment mode there are no defaults: the footer button discards unsaved changes and there is no per-row button.

---

## Saving

- Before writing, HZMM reverts invalid numeric edits and clamps edited out-of-range numbers (see [min / max](#key--min--max)).
- **Lua syntax check (`.lua` files).** HZMM parses the new text (luaparse, Lua 5.3 grammar). If it fails to parse while the current file on disk parses fine (or doesn't exist yet), the save is refused and nothing is written. The toast reads "Syntax error on line N of `<file>` — not saved" in the app language, with luaparse's message (for example `'}' expected near 'Hard'`) underneath. If the file on disk already fails to parse (for example it uses Lua 5.4-only syntax such as `<const>`), the check is skipped rather than blocking saves. The check is syntax only. Files other than `.lua` are not validated.
- Writes are atomic (temp file, then rename). HZMM keeps no backup copy.
- If a save fails, the error toast names the file and the reason. It stays 12 seconds (other toasts 3), can be closed with ×, and the next save's result replaces it. The editor keeps the unsaved edits, so the player can fix the value and save again.
- Files are read and written as UTF-8.

---

## Multi-language (i18n)

A section's `label`, and a key's `label` and `description`, take either a plain string or an i18n object:

```json
{ "en": "English text", "zh-TW": "繁體中文", "ja": "日本語" }
```

Option values are not translatable (see [options](#key--options)).

### Supported language codes

| Code | Language |
|:--|:--|
| `en` | English |
| `zh-TW` | 繁體中文 |
| `ja` | 日本語 |
| `ko` | 한국어 |
| `ru` | Русский |
| `de` | Deutsch |
| `fr` | Français |

### Resolution order

1. Exact match for the current app language
2. `en`
3. The first language in the object

> **Tip:** you don't need all 7 languages. English plus your own language is enough.

---

## Comment mode (no schema)

HZMM uses comment mode when a mod has no usable schema: no `hzmm.config.json` in the mod root, invalid JSON, no `configFile` or `sections`, or a `configFile` that can't be read.

**Files it reads.** Everything in the mod folder, recursively, with the extensions `.ini .cfg .conf .json .toml .yaml .yml .lua .xml .txt`, except:

- anything under `Scripts/`, and any `main.lua`;
- `.lua` and `.txt` files whose name doesn't contain `config`;
- `enabled.txt` and `_hzmm_link.json`.

Only files with at least one `Key = value` line are shown, all in one list. JSON files use `:`, so they show nothing. Save rewrites every file shown; unchanged ones stay byte-for-byte.

**What it understands**

| In the file | Editor shows |
|:--|:--|
| `-- ====[ Name ]====`, `--[[ ====[ Name ]==== ]]`, INI `[Name]` | A section header |
| `Key = true` / `false` | A switch |
| `Key = 12` / `Key = 1.5` (unquoted) | A text box, validated as a number |
| `Key = "12"`, `Key = "text"` or anything else | A text box |
| A value HZMM can't rewrite safely | A [read-only](#read-only-values) box; a table is badged LIST or TABLE, a function CODE |
| Comment `-- Key - text` or `-- Key: text` above the key | The description |
| Comment `-- Key.zh-TW - text` above the key | The description for that app language (preferred over the plain one) |
| Two or more comment lines `-- "Value" : text` right above a string key | Pill buttons, one per value |
| Comment containing `OtherKey = "Value"` above the key | The row is disabled unless `OtherKey` currently equals `Value` |
| A key whose name starts with `Enable` set to `false` | The keys after it in the same section are disabled (mouse and keyboard), up to the next `Enable…` key |

A [read-only](#read-only-values) `OtherKey` or `Enable…` line counts by the key's own value (`EnableX = false, Other = 1` is `false`); one whose value isn't plain (a table, a function, or a string with an escape HZMM can't decode, such as `\x41`) disables nothing.

Without a `Key - text` comment, the description comes from, in order: the top line of the comment block directly above the key, the inline `-- comment`, or the comment directly below. As a last resort the key name is split into words. Descriptions are cut at 60 characters.

**Writing.** A quoted value stays quoted. An unquoted number only accepts numbers (anything else reverts). Any other unquoted value stays bare while the edit is a number, `true` / `false`, `nil`, a name (`Key.F7`) or a table (`{1, 2}`), so raw Lua stays editable; other text (`Very Hard`) is written quoted. Clearing an unquoted value keeps the old line.

**Limits.** Labels are the raw key names. There are no defaults, ranges, sliders, colors, keybinds or lists. Option pills are used whatever their count. Any `Word = "Value"` text in a comment above a key counts as a dependency, even in an example. The footer button only discards unsaved changes. For anything beyond simple values, ship a schema.

Example that comment mode renders well:

```lua
local Config = {

--[[ ====[ GENERATOR RADIUS ]==== ]]

-- "Multiplier" : Multiplier
-- "Fixed" : Fixed
-- Mode - Radius mode
Mode = "Multiplier",

-- Active when Mode = "Multiplier"
-- MultiplierValue - Radius multiplier
MultiplierValue = 3.0,

}
return Config
```

---

## Full example

[`examples/full-widget-demo/`](examples/full-widget-demo/) is a complete, loadable mod in the recommended layout. Copy it as a starting point.

| Section | Demonstrates |
|:--|:--|
| General | `enableKey` master switch, `text` (escaping), `select` as dropdown (3 options) and as pills (2 options), `showWhen` with two conditions |
| Numbers | `int` with `min`/`max`, `float` without range, `int` and `float` sliders with `step`, `{value}` and `{eval:}` tokens |
| Radius | `select` that switches between two rows with `showWhen` |
| Appearance | `color`; `select` with numeric options (written unquoted) |
| Hotkeys | `keybind`, read in `main.lua` with the helper above |
| Lists | `multi-select`, `list`, `openPath` (`relativeTo: "mod"`, `action: "reveal"`) |
| Overrides | `optional` keys: one present, three absent (float slider with default, select without default, list with default) |
| Advanced | `collapsed`, `openPath` (`relativeTo: "game"`), plain-string `label` / `description` |

`Scripts/main.lua` loads the config with `require("config")` and uses every value.

---

## Rules

1. **Put `hzmm.config.json` in the mod root.** `configFile` is relative to the mod root.
2. **`configFile` and `sections` are required.** Without either, HZMM uses comment mode.
3. **Key names match exactly** (case-sensitive) and name root-level keys in the config file.
4. **Keep `config.lua` editable:** return the config table, one field per line, arrays on one line, literal values, no nested keys ([requirements](#configlua-requirements)).
5. **Set `type` and `label` on every key.** Without them HZMM guesses the type from the value and shows the key name.
6. **Give `select` and `multi-select` an `options` list**, and keep every `default` inside it.
7. **Keep defaults equal to the shipped values**, within `min` / `max`.
8. **Include `en`** in every i18n object.
9. **Order matters.** Sections and keys render in JSON order. Don't use integer-like section ids.
10. **No decorative entries.** The schema is for editable settings. Static text, links, version history and credits belong in the mod's README.
11. **One definition per key name.** In a Lua config, two sections that declare the same key name can bind to the same line. Don't give them different `type`, `options` or range: the first section in schema order decides quoting and clamping (HZMM doesn't check this).

---

## Troubleshooting for authors

HZMM reads the schema and the config file every time the editor opens, so you can fix a file and reopen the editor without restarting. Logs are in `%APPDATA%\hzmm-manager\hzmm.log`.

| Symptom | Check |
|:--|:--|
| The editor ignores the schema (comment-mode rows, or "No editable config files found") | `hzmm.config.json` must be in the mod root, not in `Scripts/`. It must be valid JSON (no comments, no trailing commas) saved as UTF-8 **without a BOM**: a BOM makes the parse fail (logged as `Failed to parse hzmm.config.json`). It needs both `configFile` and `sections`, and `configFile` must exist relative to the mod root. Only the JSON parse error is logged; the other cases fall back silently. |
| The mod has no Config button | No schema, and the config is under `Scripts/` or its file name doesn't contain `config`. Comment mode can't see it. Add a schema. |
| A row is missing | The key isn't in the config file and isn't `optional` (non-optional rows need a line). Or it isn't a first-level field of the table HZMM reads: it's in a sub-table, a helper table, a `local` statement, a global next to the returned table, a `function` / `if` / `do` block, or a `Config.X = ...` line. Or the file is read as plain globals because it returns no table and has a second table or a global beside the config table (add `return Config`), or the root table is written on one line. See [Which table HZMM edits](#which-table-hzmm-edits). Or the spelling or case differs. INI: the section id must equal the `[Section]` name. Lua: the same key name under several banners, with no banner matching the section id. Also check `showWhen`, the search box and folded sections. |
| A row shows a lock icon and a Read-only pill | The line can't be rewritten safely: see [Read-only values](#read-only-values). Hover the value for the reason. |
| A row is greyed out | The section's `enableKey` is `false`, or it's an optional key that is switched off. |
| Switching an optional key on or off shows an error | HZMM couldn't add or remove the line safely, and nothing changed. See [optional](#key--optional-12) for the reasons. |
| Save refused: "Syntax error on line N of …" | Nothing was written. HZMM refuses a save whose result wouldn't load. This usually means the file has a construct HZMM misread. Edit that part by hand, and please report the file on [HZMM's issue tracker](https://github.com/uuuu790/HZMM/issues). If the file on disk already fails the check (for example it uses `<const>`), HZMM can't check it and saves anyway, so test such files with Lua after editing. |
| No option highlighted, or ↺ always visible on a `select` | The value in the file (or the `default`) doesn't exactly match an option. Case matters, and so does `2` vs `2.0` (`2` and `"2"` are the same). |
| The description shows `{eval: …}` literally | The expression uses something outside the [grammar](#description-tokens), or divides by zero. |
| A hotkey doesn't fire | Use the [keybind helper](#keybind). Values saved by HZMM ≤ 1.6.0 (`"Ctrl+1"`) stay in the old form until the player saves again, so fall back to a default when `ParseKeybind` returns nil. |
| `require("config")` fails in-game | `config.lua` in the mod root isn't on UE4SS's `package.path`. Move it to `Scripts/` (and set `"configFile": "Scripts/config.lua"`), or add the [package.path line](#mods-that-keep-configlua-in-the-mod-root). |
| After a player updates the mod through HZMM, new keys are missing | HZMM's Nexus updater keeps the player's settings by restoring their old config files, whole, over the new version. That covers every `.ini` / `.cfg` / `.conf` / `.json` / `.toml` / `.yaml` / `.yml` / `.xml` file and every `.lua` / `.txt` file whose name contains `config`, anywhere in the mod; `hzmm.config.json`, `modmanifest.json` and `_hzmm_link.json` are not restored. Keys added in the update are therefore not in the restored file. Mark new keys `optional: true` so players can switch them on, and handle `nil` in Lua (`if Config.NewKey == nil then ... end`). Don't name code files `*config*.lua`: they'd be rolled back too. |
| A float comes back as `3` instead of `3.0` | Slider and clamped values drop trailing zeros. Lua 5.4 treats `3 == 3.0` as true. |
| A value is a number now, but the mod compared it as a string | HZMM writes by schema type: an `int` stored as `"100"` comes back as `150` after an edit. Compare with `tonumber(Config.X)`. |
| An out-of-range value survives a save | Save clamps only values the player edited or switched on. Ship values inside `min` / `max`. |

---

*This standard is maintained by the HZMM project.*
