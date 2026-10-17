-- HZMM config demo: toggle (bool)
-- Schema: 01-toggle.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   01-toggle.hzmm.config.json  as  <ModName>\hzmm.config.json
--   01-toggle.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   if Config.ShowHud then
--       -- ...
--   end

local Config = {

    -- ====[ General ]====
    ShowHud = true,
    DebugLog = false,
}

return Config
