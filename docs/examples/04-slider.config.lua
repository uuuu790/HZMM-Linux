-- HZMM config demo: slider (widget: "slider")
-- Schema: 04-slider.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   04-slider.hzmm.config.json  as  <ModName>\hzmm.config.json
--   04-slider.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   local bonus = Config.CarryBonus / 100

local Config = {

    -- ====[ Sliders ]====
    CarryBonus = 50,
    DamageMul = 1.0,
}

return Config
