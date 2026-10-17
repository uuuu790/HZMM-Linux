-- HZMM config demo: optional keys
-- Schema: 12-optional.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   12-optional.hzmm.config.json  as  <ModName>\hzmm.config.json
--   12-optional.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   if Config.DamageOverride ~= nil then
--       damage = Config.DamageOverride
--   end

local Config = {

    -- ====[ Overrides ]====
    -- Optional keys. HZMM adds or removes these lines when the player flips
    -- the row's switch; a missing line means "use the mod's own default".
    -- DamageOverride, WeatherOverride and BonusItems start switched off.
    GreetingOverride = "Welcome back!",
}

return Config
