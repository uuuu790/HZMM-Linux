export const BUILTIN_MODS: ReadonlySet<string> = new Set([
  'BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod',
  'ConsoleCommandsMod', 'ConsoleEnablerMod', 'Keybinds',
  'LineTraceMod', 'SplitScreenMod', 'shared',
  'ActorDumperMod', 'jsbLuaProfilerMod'
])

export const CONFIG_EXTENSIONS: readonly string[] = [
  '.ini', '.cfg', '.conf', '.json', '.toml',
  '.yaml', '.yml', '.lua', '.xml', '.txt'
]
