-- HZMM config demo: sections: enableKey and collapsed
-- Schema: 11-sections.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   11-sections.hzmm.config.json  as  <ModName>\hzmm.config.json
--   11-sections.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   if not Config.Enabled then return end

local Config = {

    -- ====[ General ]====
    Enabled = true,
    Speed = 5,
    Volume = 0.8,

    -- ====[ Advanced ]====
    TickRate = 10,
}

return Config
