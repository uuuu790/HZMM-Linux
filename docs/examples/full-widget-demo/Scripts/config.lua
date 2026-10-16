-- HZMM Widget Demo settings.
-- Edit them in HZMM (mod details -> Config) or by hand. main.lua loads this
-- file with require("config").
--
-- Kept inside what HZMM can edit safely:
--   * the table is returned (`return Config`), so its fields are the settings
--   * one `Key = value,` per line, every field ends with a comma
--   * arrays on a single line
--   * plain literals only (no expressions, no nested tables)
-- The `-- ====[ Name ]====` banners match the schema section ids, so keys that
-- a player switches on land in the right group.

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
