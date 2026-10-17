-- HZMM config demo: openPath
-- Schema: 13-open-path.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   13-open-path.hzmm.config.json  as  <ModName>\hzmm.config.json
--   13-open-path.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   -- openPath only adds a button in HZMM; the mod reads the values as usual.

local Config = {

    -- ====[ Files ]====
    LogSettings = true,
    ProfileName = "Default",
}

return Config
