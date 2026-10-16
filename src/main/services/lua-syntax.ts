import fs from 'fs'
import luaparse, { type ParseOptions } from 'luaparse'

// Syntax-only parse: no comments / locations / scope tracking. '5.3' is the
// newest grammar luaparse supports — Lua 5.4-only syntax (<const>, <close>)
// fails here, which is why assertLuaConfigSaveable skips files that already
// fail on disk instead of blocking them.
const PARSE_OPTIONS: ParseOptions = { luaVersion: '5.3', comments: false, scope: false, locations: false, ranges: false }

// Returns null when `text` parses as Lua, otherwise luaparse's message
// (e.g. "[3:0] '}' expected near '<eof>'").
export function getLuaSyntaxError(text: unknown): string | null {
  try {
    // Lua's loadfile skips a leading UTF-8 BOM; luaparse would reject it.
    luaparse.parse(String(text).replace(/^\uFEFF/, ''), PARSE_OPTIONS)
    return null
  } catch (err) {
    return (err as Error).message
  }
}

// Refuse a *.lua config write whose new content no longer parses — a broken
// config.lua makes the mod's require/dofile fail and the mod silently stops
// working. If the on-disk file already fails to parse, don't block the save:
// the file may use syntax luaparse doesn't know, and refusing would lock the
// user out of editing it. Non-.lua files are never validated.
export function assertLuaConfigSaveable(filePath: string, relativePath: string, content: unknown): void {
  if (!/\.lua$/i.test(relativePath)) return
  const newError = getLuaSyntaxError(content)
  if (!newError) return
  if (fs.existsSync(filePath) && getLuaSyntaxError(fs.readFileSync(filePath, 'utf-8'))) return
  throw new Error(`Lua syntax error in ${relativePath}: ${newError}`)
}
