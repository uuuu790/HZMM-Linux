-- HZMM config demo: int / float with min and max
-- Schema: 03-number.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   03-number.hzmm.config.json  as  <ModName>\hzmm.config.json
--   03-number.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   local hp = math.floor(Config.MaxHealth)
--   local rate = Config.SpawnRate

local Config = {

    -- ====[ Numbers ]====
    MaxHealth = 100,
    SpawnRate = 1.0,
}

return Config
