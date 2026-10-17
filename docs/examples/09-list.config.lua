-- HZMM config demo: list
-- Schema: 09-list.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   09-list.hzmm.config.json  as  <ModName>\hzmm.config.json
--   09-list.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   local friends = {}
--   for _, name in ipairs(Config.FriendNames) do friends[name] = true end

local Config = {

    -- ====[ Lists ]====
    FriendNames = {"Alice", "Bob"},
    BannedPlayers = {},
}

return Config
