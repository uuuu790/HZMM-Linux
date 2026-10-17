-- HZMM config demo: text
-- Schema: 02-text.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   02-text.hzmm.config.json  as  <ModName>\hzmm.config.json
--   02-text.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   print("Hello, " .. Config.PlayerName)

local Config = {

    -- ====[ General ]====
    PlayerName = "Survivor",
    WelcomeMessage = "Welcome back!",
}

return Config
