// Fake Linux Steam + HumanitZ + Proton environment and mod archives for the
// packaged-app simulation (linux-sim.sim.mjs). Everything lives under one
// throwaway HOME, so nothing touches the real Steam install, mime defaults,
// autostart entries or HZMM config of the machine running the suite.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { path7za } from '7zip-bin';

export const HUMANITZ_APP_ID = '1766060';

const mk = (p) => { fs.mkdirSync(p, { recursive: true }); return p; };
const put = (p, data = '') => { mk(path.dirname(p)); fs.writeFileSync(p, data); };

// --- minimal UE 4.27 pak (v11): names live in the FullDirectoryIndex ---------
const fstring = (s) => { const b = Buffer.from(s + '\0'); const l = Buffer.alloc(4); l.writeInt32LE(b.length); return Buffer.concat([l, b]); };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

export function pakV11(files /* ['HumanitZ/Content/X.uasset', ...] */) {
  const dirs = new Map();
  for (const f of files) {
    const d = f.slice(0, f.lastIndexOf('/') + 1);
    if (!dirs.has(d)) dirs.set(d, []);
    dirs.get(d).push(f.slice(d.length));
  }
  const fdi = Buffer.concat([i32(dirs.size), ...[...dirs].flatMap(([d, names]) =>
    [fstring(d), i32(names.length), ...names.flatMap((n, i) => [fstring(n), i32(i)])])]);
  const primary = Buffer.concat([
    fstring('../../../'), i32(files.length), u64(0x1234n),
    i32(0), // no PathHashIndex
    i32(1), i64(0), i64(fdi.length), Buffer.alloc(20), // FullDirectoryIndex at offset 0
    i32(0), i32(0),
  ]);
  const body = Buffer.concat([fdi, primary]);
  const footer = Buffer.concat([u32(0x5a6f12e1), i32(11), i64(fdi.length), i64(primary.length)]);
  return Buffer.concat([body, Buffer.alloc(Math.max(0, 221 - body.length - footer.length)), footer]);
}

// --- stored (uncompressed) zip writer --------------------------------------
// Entry names are written verbatim, so a `\` separator produces the same kind
// of archive Windows' built-in zipper / Compress-Archive does.
export function writeZip(file, entries /* { name: Buffer|string } */) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const count = Object.keys(entries).length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(count, 8); eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  put(file, Buffer.concat([...locals, cd, eocd]));
}

function hasCommand(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

/**
 * Build the environment under `home` (wiped first). Returns the paths the
 * suite asserts against. `repoRoot` supplies the docs widget demo used as the
 * UE4SS mod with a config schema.
 */
export function buildSimEnv(home, repoRoot) {
  fs.rmSync(home, { recursive: true, force: true });

  // Native Steam root + a SECOND library that actually holds the game, so
  // libraryfolders.vdf parsing and the per-library Proton prefix are exercised.
  const steamRoot = path.join(home, '.local/share/Steam');
  const lib = path.join(home, 'Games/SteamLibrary');
  put(path.join(steamRoot, 'steamapps/libraryfolders.vdf'), [
    '"libraryfolders"', '{',
    '\t"0"', '\t{', `\t\t"path"\t\t"${steamRoot}"`, '\t}',
    '\t"1"', '\t{', `\t\t"path"\t\t"${lib}"`, `\t\t"apps" { "${HUMANITZ_APP_ID}" "0" }`, '\t}',
    '}', '',
  ].join('\n'));
  put(path.join(lib, `steamapps/appmanifest_${HUMANITZ_APP_ID}.acf`), [
    '"AppState"', '{', `\t"appid"\t\t"${HUMANITZ_APP_ID}"`, '\t"name"\t\t"HumanitZ"',
    '\t"installdir"\t\t"HumanitZ"', '\t"buildid"\t\t"20481234"', '\t"LastUpdated"\t\t"1791000000"', '}', '',
  ].join('\n'));

  const game = path.join(lib, 'steamapps/common/HumanitZ');
  put(path.join(game, 'HumanitZ.exe'), 'MZ');
  put(path.join(game, 'HumanitZ/Binaries/Win64/HumanitZ-Win64-Shipping.exe'), 'MZ');
  put(path.join(game, 'HumanitZ/Content/Paks/pakchunk0-WindowsNoEditor.pak'), 'base game pak');
  mk(path.join(game, 'HumanitZ/Content/Paks/~mods'));

  // World saves inside the Proton prefix (real naming: Save_<World>.sav + sidecars).
  const saves = path.join(lib, `steamapps/compatdata/${HUMANITZ_APP_ID}/pfx/drive_c/users/steamuser/AppData/Local/HumanitZ/Saved/SaveGames/SaveList/Default`);
  put(path.join(saves, 'Save_Brookfield.sav'), 'world one');
  put(path.join(saves, 'Brookfield_CharPreview.sav'), 'char');
  put(path.join(saves, 'Brookfield_Foliage.sav'), 'foliage');
  put(path.join(saves, 'Save_Riverside.sav'), 'world two');
  put(path.join(saves, 'LocalGlobal.sav'), 'global — not a world');
  put(path.join(saves, 'MinimapData.sav'), 'not a world');

  // Mod archives, one per supported shape.
  const modsIn = mk(path.join(home, 'mods-in'));
  const staging = mk(path.join(home, 'staging'));
  const archives = {};

  // zip, pak-only — overlaps BetterLoot on Shared/Loot.uasset (a real conflict)
  archives.coolGuns = path.join(modsIn, 'CoolGuns.zip');
  writeZip(archives.coolGuns, {
    'CoolGuns_P.pak': pakV11(['HumanitZ/Content/Weapons/Rifle.uasset', 'HumanitZ/Content/Shared/Loot.uasset']),
    'README.txt': 'Cool guns mod',
  });

  // 7z with the pak nested in a folder (spawns the bundled 7za)
  const bl = mk(path.join(staging, 'BetterLoot'));
  put(path.join(bl, 'BetterLoot/BetterLoot_P.pak'), pakV11(['HumanitZ/Content/Shared/Loot.uasset', 'HumanitZ/Content/Loot/Tables.uasset']));
  archives.betterLoot = path.join(modsIn, 'BetterLoot.7z');
  execFileSync(path7za, ['a', '-bd', archives.betterLoot, '.'], { cwd: bl, stdio: 'ignore' });

  // rar — only when the (non-free) `rar` tool is installed
  if (hasCommand('rar')) {
    const mm = mk(path.join(staging, 'MapMarkers'));
    put(path.join(mm, 'MapMarkers_P.pak'), pakV11(['HumanitZ/Content/UI/Map.uasset']));
    archives.mapMarkers = path.join(modsIn, 'MapMarkers.rar');
    execFileSync('rar', ['a', '-idq', archives.mapMarkers, '.'], { cwd: mm });
  }

  // UPPERCASE extension — Linux's fs is case-sensitive
  archives.loudMusic = path.join(modsIn, 'LoudMusic.zip');
  writeZip(archives.loudMusic, { 'LOUDMUSIC_P.PAK': pakV11(['HumanitZ/Content/Audio/Music.uasset']) });

  // UE4SS Lua mod with a config schema (the docs widget demo)
  const demo = path.join(repoRoot, 'docs/examples/full-widget-demo');
  archives.widgetDemo = path.join(modsIn, 'FullWidgetDemo.zip');
  writeZip(archives.widgetDemo, {
    'FullWidgetDemo/Scripts/main.lua': fs.readFileSync(path.join(demo, 'Scripts/main.lua')),
    'FullWidgetDemo/Scripts/config.lua': fs.readFileSync(path.join(demo, 'Scripts/config.lua')),
    'FullWidgetDemo/hzmm.config.json': fs.readFileSync(path.join(demo, 'hzmm.config.json')),
  });

  // Windows-made zip: backslash entry names
  archives.winZipped = path.join(modsIn, 'WinZipped.zip');
  writeZip(archives.winZipped, { 'Mods\\WinZipped_P.pak': pakV11(['HumanitZ/Content/Win/Thing.uasset']) });

  // Fake UE4SS experimental release: proxy dll + core under ue4ss/
  const ue4ssZip = path.join(modsIn, 'UE4SS_v3.0.1-fake.zip');
  writeZip(ue4ssZip, {
    'dwmapi.dll': 'proxy',
    'ue4ss/UE4SS.dll': 'core',
    'ue4ss/UE4SS-settings.ini': '[General]\nEnableHotReloadSystem = 1\n',
    'ue4ss/Mods/mods.txt': 'BPModLoaderMod : 1\n',
    'ue4ss/Mods/BPModLoaderMod/Scripts/main.lua': '-- bp loader',
    'ue4ss/Mods/BPModLoaderMod/enabled.txt': '',
  });

  const win64 = path.join(game, 'HumanitZ/Binaries/Win64');
  return {
    home,
    game,
    saves,
    modsDir: path.join(game, 'HumanitZ/Content/Paks/~mods'),
    win64,
    ue4ssMods: path.join(win64, 'ue4ss/Mods'),
    configDir: path.join(home, '.config/hzmm-manager'),
    archives,
    ue4ssZip,
  };
}
