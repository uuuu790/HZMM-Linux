-- HZMM config demo: showWhen
-- Schema: 10-show-when.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   10-show-when.hzmm.config.json  as  <ModName>\hzmm.config.json
--   10-show-when.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   local radius = Config.RadiusMode == "Fixed" and Config.RadiusFixed or 900 * Config.RadiusMultiplier

local Config = {

    -- ====[ Radius ]====
    Debug = false,
    RadiusMode = "Multiplier",
    RadiusMultiplier = 2.0,
    RadiusFixed = 1800,
    DrawRadius = false,
}

return Config
