-- HZMM Widget Demo - reads every setting from Scripts/config.lua and logs it.
--
-- UE4SS adds this mod's Scripts/ folder to package.path, so require("config")
-- finds Scripts/config.lua without any path code. (Keeping config.lua in the
-- mod root instead needs an extra package.path line - see CONFIG_SCHEMA.md.)

local Config = require("config")

local TAG = "[HZMMWidgetDemo]"
local function Log(fmt, ...)
    print(TAG .. " " .. string.format(fmt, ...) .. "\n")
end

-- ---------------------------------------------------------------------------
-- Keybind helper
-- Turn an HZMM keybind string ("F6", "Ctrl+Shift+F", "Alt+NUM_ONE") into the
-- arguments RegisterKeyBind expects. Returns nil when no valid main key is set.
-- ---------------------------------------------------------------------------
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

local function BindHotkey(name, str, callback)
    local key, mods = ParseKeybind(str)
    if key == nil then
        Log("%s: no valid hotkey in %q - not bound", name, tostring(str))
        return
    end
    if #mods > 0 then
        RegisterKeyBind(key, mods, callback)
    else
        RegisterKeyBind(key, callback)
    end
    Log("%s bound to %s", name, str)
end

-- ---------------------------------------------------------------------------
-- Small readers for the other widget types
-- ---------------------------------------------------------------------------

-- color: "#rrggbb" -> r, g, b in 0..1
local function HexToRGB(hex)
    local r, g, b = tostring(hex):match("^#?(%x%x)(%x%x)(%x%x)$")
    if not r then return 1, 1, 1 end
    return tonumber(r, 16) / 255, tonumber(g, 16) / 255, tonumber(b, 16) / 255
end

-- list / multi-select: Lua array of strings -> "a, b, c"
local function Join(list)
    if type(list) ~= "table" then return "(none)" end
    return #list > 0 and table.concat(list, ", ") or "(empty)"
end

-- multi-select as a lookup set
local function ToSet(list)
    local set = {}
    for _, v in ipairs(list or {}) do set[v] = true end
    return set
end

-- ---------------------------------------------------------------------------
-- Derived values (mirroring the {eval:} previews in hzmm.config.json)
-- ---------------------------------------------------------------------------
local carryLimitKg = 35 * (1 + Config.CarryBonus / 100)
local radius = (Config.RadiusMode == "Fixed") and Config.RadiusFixed
    or 900 * Config.RadiusMultiplier
local damage = Config.DamageMul
if Config.DamageOverride ~= nil then damage = Config.DamageOverride end -- optional key
local weather = Config.WeatherOverride or "(game default)"               -- optional select
local r, g, b = HexToRGB(Config.AccentColor)
local allowed = ToSet(Config.AllowedWeapons)

if Config.LogSettings then
    Log("Enabled=%s  PlayerName=%q  Difficulty=%s  PermaDeath=%s  LootMode=%s",
        tostring(Config.Enabled), Config.PlayerName, Config.Difficulty,
        tostring(Config.Difficulty == "Hard" and Config.PermaDeath), Config.LootMode)
    Log("MaxHealth=%d  SpawnRate=%.2f  CarryBonus=%d%% (limit %.1f kg)  DamageMul=%.2f  DayLength=%d min",
        math.floor(Config.MaxHealth), Config.SpawnRate, math.floor(Config.CarryBonus),
        carryLimitKg, Config.DamageMul, math.floor(Config.DayLength))
    Log("RadiusMode=%s -> radius %.0f", Config.RadiusMode, radius)
    Log("AccentColor=%s (r=%.2f g=%.2f b=%.2f)  HudScale=%d",
        Config.AccentColor, r, g, b, math.floor(Config.HudScale))
    Log("ToggleKey=%s  TeleportKey=%s", Config.ToggleKey, Config.TeleportKey)
    Log("AllowedWeapons=%s (Shotgun allowed: %s)  FriendNames=%s",
        Join(Config.AllowedWeapons), tostring(allowed.Shotgun == true), Join(Config.FriendNames))
    Log("GreetingOverride=%s  DamageOverride=%s  WeatherOverride=%s  BonusItems=%s",
        tostring(Config.GreetingOverride), tostring(Config.DamageOverride),
        tostring(Config.WeatherOverride), Join(Config.BonusItems))
    Log("Effective damage x%.2f, weather %s, tick every %.0f ms",
        damage, weather, 1000 / Config.TickRate)
end

if not Config.Enabled then
    Log("disabled in config - hotkeys not registered")
    return
end

local greeting = Config.GreetingOverride or ("Hello, " .. Config.PlayerName)

BindHotkey("ToggleKey", Config.ToggleKey, function()
    Log("%s (overlay toggled, HUD scale %d)", greeting, math.floor(Config.HudScale))
end)

BindHotkey("TeleportKey", Config.TeleportKey, function()
    Log("teleport home (difficulty %s)", Config.Difficulty)
end)
