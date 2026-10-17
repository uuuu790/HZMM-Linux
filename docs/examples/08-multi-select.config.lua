-- HZMM config demo: multi-select
-- Schema: 08-multi-select.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   08-multi-select.hzmm.config.json  as  <ModName>\hzmm.config.json
--   08-multi-select.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   for _, w in ipairs(Config.AllowedWeapons) do
--       print("Allowed:", w)
--   end

local Config = {

    -- ====[ Lists ]====
    AllowedWeapons = {"Pistol", "Rifle"},
    ActiveSlots = {1, 3},
}

return Config
