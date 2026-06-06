import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { scanConfigDir } from '../../src/main/ipc/mods-config.js'
import { CONFIG_EXTENSIONS } from '../../src/main/ipc/constants.js'

// scanConfigDir is the file-discovery half of the comment-mode config editor.
// It walks a mod folder and feeds each config-shaped file to a collector.
// Two non-obvious rules to pin:
//   - `.lua` / `.txt` only count when the filename contains "config"
//     (otherwise main.lua / readme.txt / debug.log noise floods the picker).
//   - excludeFiles set wins even for matching extensions (enabled.txt etc).

let tempDir
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-mods-config-test-'))
})
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function seed(structure) {
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(tempDir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}

function collect(extra = {}) {
  const exts = new Set(extra.exts || CONFIG_EXTENSIONS)
  const excl = new Set(extra.excl || ['enabled.txt', '_hzmm_link.json'])
  const out = []
  scanConfigDir(tempDir, '', exts, excl, (relPath, fullPath, stat) => {
    out.push({ relPath, name: path.basename(fullPath), size: stat.size })
  })
  return out
}

describe('scanConfigDir', () => {
  it('collects nothing from an empty directory', () => {
    expect(collect()).toEqual([])
  })

  it('collects a top-level .ini config', () => {
    seed({ 'settings.ini': 'a=1' })
    const out = collect()
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('settings.ini')
    expect(out[0].relPath).toBe('settings.ini')
  })

  it('uses forward-slash relative paths even on Windows', () => {
    seed({ 'sub/dir/options.json': '{}' })
    const out = collect()
    expect(out[0].relPath).toBe('sub/dir/options.json')
  })

  it('keeps .lua only when filename contains "config"', () => {
    seed({
      'config.lua': '-- yes',
      'main.lua': '-- no',
      'utils.lua': '-- no',
    })
    const names = collect().map(o => o.name).sort()
    expect(names).toEqual(['config.lua'])
  })

  it('keeps .txt only when filename contains "config"', () => {
    seed({
      'config.txt': '',
      'README.txt': '',
      'debug.txt': '',
    })
    const names = collect().map(o => o.name).sort()
    expect(names).toEqual(['config.txt'])
  })

  it('excludes files in the exclude set even with a matching extension', () => {
    seed({
      'enabled.txt': '',
      '_hzmm_link.json': '{}',
      'real-config.json': '{}',
    })
    const names = collect().map(o => o.name).sort()
    expect(names).toEqual(['real-config.json'])
  })

  it('recurses into subdirectories', () => {
    seed({
      'top.ini': '',
      'a/middle.ini': '',
      'a/b/deep.ini': '',
    })
    const rels = collect().map(o => o.relPath).sort()
    expect(rels).toEqual(['a/b/deep.ini', 'a/middle.ini', 'top.ini'])
  })

  it('skips files with extensions not in the allow set', () => {
    seed({
      'README.md': '',
      'icon.png': '',
      'config.ini': '',
    })
    const names = collect().map(o => o.name).sort()
    expect(names).toEqual(['config.ini'])
  })

  it('reports file size from fs.stat', () => {
    seed({ 'config.ini': 'hello world' })
    const out = collect()
    expect(out[0].size).toBe('hello world'.length)
  })

  it('handles all CONFIG_EXTENSIONS in the canonical set', () => {
    seed({
      'a.ini': '', 'b.cfg': '', 'c.conf': '', 'd.json': '{}',
      'e.toml': '', 'f.yaml': '', 'g.yml': '', 'h.xml': '',
      // .lua / .txt require "config" in filename — see other tests
    })
    const names = collect().map(o => o.name).sort()
    expect(names).toEqual(['a.ini', 'b.cfg', 'c.conf', 'd.json', 'e.toml', 'f.yaml', 'g.yml', 'h.xml'])
  })
})
