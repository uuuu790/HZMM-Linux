-- HZMM config demo: keybind
-- Schema: 07-keybind.hzmm.config.json
--
-- To try it, make a UE4SS mod folder (ue4ss\Mods\<ModName>\) and save:
--   07-keybind.hzmm.config.json  as  <ModName>\hzmm.config.json
--   07-keybind.config.lua        as  <ModName>\Scripts\config.lua
-- plus a Scripts\main.lua. Then open the mod's Config in HZMM.
--
-- Reading it in Scripts\main.lua:
--   local Config = require("config")
--   -- See 07-keybind.main.lua for turning the value into RegisterKeyBind arguments.

local Config = {

    -- ====[ Hotkeys ]====
    ToggleKey = "F6",
    TeleportKey = "Ctrl+NUM_ONE",
}

return Config
