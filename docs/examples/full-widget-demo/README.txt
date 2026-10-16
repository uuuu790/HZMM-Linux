HZMM Widget Demo (full-widget-demo)
===================================

A small UE4SS Lua mod that uses every widget of the HZMM config schema
(spec 1.4, docs/CONFIG_SCHEMA.md). Copy it as a starting point for your own
mod's hzmm.config.json.

Files
-----
  full-widget-demo/
    hzmm.config.json     UI schema. Must sit in the mod root: HZMM only looks there.
    Scripts/main.lua     UE4SS entry point. Loads the config with require("config").
    Scripts/config.lua   The values. HZMM edits this file ("configFile": "Scripts/config.lua").
    README.txt           This file.

UE4SS puts the mod's Scripts/ folder on package.path, so require("config")
finds Scripts/config.lua with no extra path code.

Install
-------
1. Copy the whole full-widget-demo folder into
     <Steam>\steamapps\common\HumanitZ\HumanitZ\Binaries\Win64\ue4ss\Mods\
   HZMM doesn't look in the ...\Binaries\Win64\Mods\ folder that older UE4SS
   builds use, so keep this ue4ss\Mods layout. You can rename the folder; the
   folder name is the mod name.
2. Open HZMM, find the mod in the mod list and enable it (HZMM creates
   enabled.txt for you).
3. Open the mod's details and click Config to see the editor.
4. Start the game. With "Log settings on load" on, the mod prints every
   setting to the UE4SS console / UE4SS.log. F6 and Ctrl+Numpad1 print a line
   each so you can check the hotkeys.

What it demonstrates
--------------------
  General      bool as a section master switch (enableKey), text (escaping),
               select with 3 options (dropdown), select with 2 options (pills),
               showWhen with two conditions (Difficulty = Hard AND Enabled = true)
  Numbers      int with min/max, float without min/max, int and float sliders
               with step, {value} and {eval: ...} description tokens
  Radius       select that switches between two rows with showWhen
  Appearance   color, select whose option values are numbers (written unquoted)
  Hotkeys      keybind (stored as UE4SS Key names: "F6", "Ctrl+NUM_ONE")
  Lists        multi-select, list, openPath (relativeTo "mod", action "reveal")
  Overrides    optional keys: one present (text), three absent (float slider
               with a default, select without a default, list with a default)
  Advanced     collapsed section, openPath (relativeTo "game", action "open"),
               plain-string label and description instead of an i18n object

Things to try
-------------
  * Switch on "Damage override": HZMM inserts `DamageOverride = 1.5,` under the
    Overrides banner in Scripts/config.lua. Switch it off and the line goes away.
  * Type "abc" into Spawn rate and click elsewhere: the value reverts.
  * Enter C:\Games or Say "hi" as the player name, save, and open
    Scripts/config.lua: the string is escaped ("C:\\Games").
  * Bind a hotkey with Ctrl+Shift+comma: it is stored as "Ctrl+Shift+OEM_COMMA",
    which main.lua passes straight to Key[...] / RegisterKeyBind.
  * Turn "Mod enabled" off: the other General rows are greyed out and can't be
    changed with the mouse or the keyboard until it is back on.
  * Split AllowedWeapons over several lines in Scripts/config.lua and reopen
    the editor: the row turns read-only (lock icon, Read-only pill), and saving
    leaves those lines exactly as you wrote them.
