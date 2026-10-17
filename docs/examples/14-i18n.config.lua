-- HZMM config demo: multi-language labels
-- Schema: 14-i18n.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   14-i18n.hzmm.config.json  as  <ModName>\hzmm.config.json
--   14-i18n.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   local hp = math.floor(Config.MaxHealth)

local Config = {

    -- ====[ General ]====
    MaxHealth = 100,
    TickRate = 10,
}

return Config
