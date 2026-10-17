-- HZMM config demo: select (dropdown, pills, number options)
-- Schema: 05-select.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   05-select.hzmm.config.json  as  <ModName>\hzmm.config.json
--   05-select.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   if Config.Difficulty == "Hard" then
--       -- ...
--   end
--   local scale = Config.HudScale  -- a number: compare with == 2, not == "2"

local Config = {

    -- ====[ Choices ]====
    Difficulty = "Normal",
    LootMode = "Solo",
    HudScale = 1,
}

return Config
