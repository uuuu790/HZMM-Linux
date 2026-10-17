-- HZMM config demo: keybind - reading the values in Scripts\main.lua
-- Pairs with 07-keybind.hzmm.config.json and 07-keybind.config.lua.
--
-- HZMM stores a keybind as optional modifiers (Ctrl, Shift, Alt, in that
-- order) plus a UE4SS Key name, joined by "+": "F6", "Ctrl+NUM_ONE".

local Config = require("config")

-- Turn an HZMM keybind string into the arguments RegisterKeyBind expects.
-- Returns nil when no valid main key is set.
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

local function BindHotkey(str, fallbackKey, callback)
    local key, mods = ParseKeybind(str)
    if key == nil then
        -- Empty, or an old value the player hasn't re-saved yet: use your default.
        key, mods = fallbackKey, {}
    end
    if #mods > 0 then
        RegisterKeyBind(key, mods, callback)
    else
        RegisterKeyBind(key, callback)
    end
end

BindHotkey(Config.ToggleKey, Key.F6, function()
    print("[KeybindDemo] overlay toggled\n")
end)

BindHotkey(Config.TeleportKey, Key.NUM_ONE, function()
    print("[KeybindDemo] teleport home\n")
end)
