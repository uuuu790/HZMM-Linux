-- HZMM config demo: color
-- Schema: 06-color.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   06-color.hzmm.config.json  as  <ModName>\hzmm.config.json
--   06-color.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   local r, g, b = Config.AccentColor:match("^#(%x%x)(%x%x)(%x%x)$")
--   r, g, b = tonumber(r, 16) / 255, tonumber(g, 16) / 255, tonumber(b, 16) / 255

local Config = {

    -- ====[ Appearance ]====
    AccentColor = "#3b82f6",
    WarningColor = "#f59e0b",
}

return Config
