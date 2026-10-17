-- HZMM config demo: every widget in one mod
-- Schema: 17-all-in-one.hzmm.config.json   Script: 17-all-in-one.main.lua
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   17-all-in-one.hzmm.config.json  as  <ModName>\hzmm.config.json
--   17-all-in-one.config.lua        as  <ModName>\Scripts\config.lua
--   17-all-in-one.main.lua          as  <ModName>\Scripts\main.lua
-- Then enable the mod in HZMM and open its Config. With "Log settings on
-- load" on, the mod prints every setting to UE4SS.log; F6 and Ctrl+Numpad1
-- print a line each so you can check the hotkeys.
--
-- Kept inside what HZMM can edit safely:
--   * the table is returned (`return Config`), so its fields are the settings
--   * one `Key = value,` per line, every field ends with a comma
--   * arrays on a single line
--   * plain literals only (no expressions, no nested tables)
-- The `-- ====[ Name ]====` banners match the schema section ids, so keys that
-- a player switches on land in the right group.
--
-- Things to try:
--   * Switch on "Damage override": HZMM inserts `DamageOverride = 1.5,` under
--     the Overrides banner. Switch it off and the line goes away.
--   * Type "abc" into Spawn rate and click elsewhere: the value reverts.
--   * Enter C:\Games or Say "hi" as the player name and save: the string is
--     escaped in this file ("C:\\Games").
--   * Bind a hotkey with Ctrl+Shift+comma: it is stored as
--     "Ctrl+Shift+OEM_COMMA", which main.lua passes straight to Key[...].
--   * Turn "Mod enabled" off: the other General rows are greyed out until it
--     is back on.
--   * Split AllowedWeapons over several lines here and reopen the editor: the
--     row turns read-only, and saving leaves those lines as you wrote them.

local Config = {

    -- ====[ General ]====
    Enabled = true,
    PlayerName = "Survivor",
    Difficulty = "Normal",
    PermaDeath = false,
    LootMode = "Solo",

    -- ====[ Numbers ]====
    MaxHealth = 100,
    SpawnRate = 1.0,
    CarryBonus = 50,
    DamageMul = 1.0,
    DayLength = 30,

    -- ====[ Radius ]====
    RadiusMode = "Multiplier",
    RadiusMultiplier = 2.0,
    RadiusFixed = 1800,

    -- ====[ Appearance ]====
    AccentColor = "#3b82f6",
    HudScale = 1,

    -- ====[ Hotkeys ]====
    ToggleKey = "F6",
    TeleportKey = "Ctrl+NUM_ONE",

    -- ====[ Lists ]====
    AllowedWeapons = {"Pistol", "Rifle"},
    FriendNames = {"Alice", "Bob"},

    -- ====[ Overrides ]====
    -- Optional keys. HZMM adds or removes these lines when the player flips
    -- the row's switch; a missing line means "use the mod's own default".
    -- DamageOverride, WeatherOverride and BonusItems start switched off.
    GreetingOverride = "Welcome back!",

    -- ====[ Advanced ]====
    LogSettings = true,
    TickRate = 10,
}

return Config
