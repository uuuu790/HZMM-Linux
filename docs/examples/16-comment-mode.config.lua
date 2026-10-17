-- HZMM config demo: comment mode (no schema)
--
-- Without an hzmm.config.json, HZMM builds the editor from this file's
-- comments. To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save
-- this file as <ModName>\config.lua - in the mod root, NOT in Scripts\:
-- comment mode never reads files under Scripts\, and only reads .lua files
-- whose name contains "config".
--
-- Because config.lua sits in the mod root, Scripts\main.lua has to add the
-- mod root to package.path first:
--   local scriptDir = debug.getinfo(1, "S").source:gsub("^@", ""):match("^(.*[/\\])") or ""
--   package.path = scriptDir .. "../?.lua;" .. package.path
--   local Config = require("config")
--
-- What comment mode understands:
--   -- ====[ Name ]====                  a section header
--   -- Key - text                        the row's description
--   -- Key.zh-TW - text                  the description for that app language
--   -- "Value" : text  (two or more)     pill buttons for a string key
--   Active when Mode is set (see below)  the row is only enabled while it holds
--   a key starting with Enable = false   disables the keys after it in the section
-- Comment mode has no defaults, ranges, sliders, colors, keybinds or lists.
-- For anything beyond simple values, ship an hzmm.config.json instead.

local Config = {

-- ====[ General ]====

-- EnableMod - Turn the whole mod on or off
-- EnableMod.zh-TW - 開啟或關閉整個模組
EnableMod = true,

-- MaxHealth - Maximum player health
-- MaxHealth.zh-TW - 玩家最大生命值
MaxHealth = 100,

-- PlayerName - Name shown in the greeting
-- PlayerName.zh-TW - 問候語中顯示的名稱
PlayerName = "Survivor",

-- ====[ Radius ]====

-- "Multiplier" : Multiplier
-- "Fixed" : Fixed
-- Mode - Radius mode
-- Mode.zh-TW - 半徑模式
Mode = "Multiplier",

-- Active when Mode = "Multiplier"
-- MultiplierValue - Radius multiplier
-- MultiplierValue.zh-TW - 半徑倍率
MultiplierValue = 3.0,

-- Active when Mode = "Fixed"
-- FixedValue - Fixed radius
-- FixedValue.zh-TW - 固定半徑
FixedValue = 1800,

}

return Config
