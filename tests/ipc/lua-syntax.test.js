import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { registerModsConfigIpc } from '../../src/main/ipc/mods-config'
import { getLuaSyntaxError } from '../../src/main/services/lua-syntax'

// 'mods:save-config' parses *.lua content with luaparse before writing and
// refuses content that would no longer load (a broken config.lua makes the
// mod's require/dofile fail). Rules pinned here:
//   - only *.lua (case-insensitive) is validated; .ini/.txt/... never are
//   - if the on-disk file ALREADY fails to parse (e.g. Lua 5.4-only syntax
//     luaparse doesn't know), validation is skipped instead of blocking saves
//   - on rejection nothing is written: target unchanged, no .tmp left behind
//
// The handler is exercised for real: electron's ipcMain is mocked to capture
// the registered handlers (vi.mock is hoisted above the imports), and the
// game/mods paths point at a temp dir.

const state = vi.hoisted(() => ({ handlers: new Map(), gamePath: null, modsPath: null }))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => state.handlers.set(channel, fn) },
  shell: {},
}))
vi.mock('../../src/main/services/config-store', () => ({
  default: { get: (key) => (key === 'gamePath' ? state.gamePath : undefined), getConfigDir: () => state.gamePath },
}))
vi.mock('../../src/main/services/steam-detector', () => ({
  getUe4ssModsPath: () => state.modsPath,
}))

const MOD = 'TestMod'
let tempDir
let modDir

beforeAll(() => {
  registerModsConfigIpc()
})
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-lua-syntax-test-'))
  state.gamePath = tempDir
  state.modsPath = path.join(tempDir, 'Mods')
  modDir = path.join(state.modsPath, MOD)
  fs.mkdirSync(modDir, { recursive: true })
})
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function save(relativePath, content) {
  return state.handlers.get('mods:save-config')({}, MOD, relativePath, content)
}
function seed(relativePath, content) {
  const full = path.join(modDir, relativePath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return full
}
function read(relativePath) {
  return fs.readFileSync(path.join(modDir, relativePath), 'utf-8')
}
function tmpFiles() {
  return fs.readdirSync(modDir, { recursive: true }).filter(f => String(f).endsWith('.tmp'))
}

const VALID = 'local Config = {\n  Speed = 1.5,\n  Name = "Bob",\n}\nreturn Config\n'
// The unescaped-quote bug the P5 escaping fix targets: inside a table the
// stray `hi` is a syntax error. (A bare global `A = "He said "hi""` is valid
// Lua — it parses as `A = "He said "` followed by the call `hi""`.)
const UNESCAPED_QUOTE = 'local Config = {\n  Greeting = "He said "hi"",\n}\nreturn Config\n'

describe('getLuaSyntaxError', () => {
  it.each([
    ['local table + return', VALID],
    ['return table', 'return {\n  A = 1,\n  B = { 1, 2, 3 },\n}\n'],
    ['global table', 'Config = {\n  A = true -- no trailing comma\n}\n'],
    ['plain globals', 'A = 1\nB = "x"\n'],
    ['empty root tables', 'local Config = {}\nreturn Config\n'],
    ['CRLF + non-ASCII comments/strings', '-- 設定\r\nlocal C = { Name = "中文" }\r\nreturn C\r\n'],
    ['leading UTF-8 BOM (Lua loadfile skips it)', '\uFEFFA = 1\n'],
    ['Lua 5.3 operators', 'A = 7 // 2\nB = 1 << 4\n'],
    ['long strings and block comments', 'A = [[x]]\n--[==[ } ]==]\nB = [=[ { ]=]\n'],
  ])('accepts %s', (_, text) => {
    expect(getLuaSyntaxError(text)).toBeNull()
  })

  it.each([
    ['empty value', 'X = ,'],
    ['unbalanced braces', 'local Config = {\n  A = 1,\n'],
    ['extra closing brace', 'local Config = {\n  A = 1,\n}}\n'],
    ['unescaped quote in a table', UNESCAPED_QUOTE],
    ['missing comma between fields', 'return {\n  A = 1\n  B = 2\n}\n'],
  ])('rejects %s', (_, text) => {
    expect(getLuaSyntaxError(text)).toMatch(/^\[\d+:\d+\] /)
  })
})

describe('mods:save-config — Lua syntax check', () => {
  it('writes valid Lua and leaves no .tmp', () => {
    seed('config.lua', VALID)
    const next = VALID.replace('1.5', '2')
    expect(save('config.lua', next)).toBe(true)
    expect(read('config.lua')).toBe(next)
    expect(tmpFiles()).toEqual([])
  })

  it.each([
    ['X = ,', 'local Config = {\n  X = ,\n}\nreturn Config\n'],
    ['unbalanced braces', 'local Config = {\n  A = 1,\n\nreturn Config\n'],
    ['unescaped quotes', UNESCAPED_QUOTE],
  ])('refuses %s over a parseable file and writes nothing', (_, bad) => {
    seed('config.lua', VALID)
    expect(() => save('config.lua', bad)).toThrow(/^Lua syntax error in config\.lua: \[\d+:\d+\] /)
    expect(read('config.lua')).toBe(VALID)
    expect(tmpFiles()).toEqual([])
  })

  it('refuses invalid Lua for a file that does not exist yet', () => {
    expect(() => save('config.lua', 'X = ,')).toThrow('Lua syntax error in config.lua:')
    expect(fs.existsSync(path.join(modDir, 'config.lua'))).toBe(false)
    expect(tmpFiles()).toEqual([])
  })

  it('names the renderer-supplied relative path and matches .lua case-insensitively', () => {
    seed('Scripts/lib/Config.LUA', VALID)
    expect(() => save('Scripts/lib/Config.LUA', 'X = ,'))
      .toThrow(/^Lua syntax error in Scripts\/lib\/Config\.LUA: /)
    expect(read('Scripts/lib/Config.LUA')).toBe(VALID)
  })

  it('skips validation when the on-disk file already fails to parse', () => {
    // Lua 5.4 <const> is valid for UE4SS but unknown to luaparse (5.3 grammar).
    const lua54 = 'local MAX <const> = 10\nlocal Config = { Max = MAX }\nreturn Config\n'
    seed('config.lua', lua54)
    const edited = lua54.replace('10', '20')
    expect(save('config.lua', edited)).toBe(true)
    expect(read('config.lua')).toBe(edited)
  })

  it.each([
    ['settings.ini', '[General]\nX = ,\n'],
    ['config.txt', 'X = {'],
    ['options.cfg', 'A = "He said "hi there""'],
  ])('never validates non-.lua files (%s)', (rel, content) => {
    expect(save(rel, content)).toBe(true)
    expect(read(rel)).toBe(content)
  })
})
