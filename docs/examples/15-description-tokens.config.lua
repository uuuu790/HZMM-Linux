-- HZMM config demo: description tokens {value} and {eval:}
-- Schema: 15-description-tokens.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   15-description-tokens.hzmm.config.json  as  <ModName>\hzmm.config.json
--   15-description-tokens.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   local limitKg = 35 * (1 + Config.CarryBonus / 100)

local Config = {

    -- ====[ Tokens ]====
    CarryBonus = 50,
    DayLength = 30,
    HeatWarning = 95,
}

return Config
