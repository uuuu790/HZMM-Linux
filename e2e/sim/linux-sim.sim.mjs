// End-to-end simulation of the PACKAGED Linux build against a fake Steam +
// HumanitZ + Proton environment (see sim-env.mjs): game detection, UE4SS
// install/flatten, archive installs (zip/7z/rar/uppercase/backslash/UE4SS),
// conflicts + load order, toggles, config schema, Proton saves, profiles,
// launch + pgrep detection, vanilla launch, nxm:// registration and routing,
// XDG autostart, the manual updater path and uninstall.
//
// Run with `npm run test:sim` (Linux only; needs a display — on a headless box
// or WSL without WSLg use `xvfb-run -a npm run test:sim`). Point HZMM_SIM_BIN
// at another executable to test a different build.

import { test, expect, _electron as electron } from '@playwright/test';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSimEnv, HUMANITZ_APP_ID } from './sim-env.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = process.env.HZMM_SIM_BIN || path.join(REPO, 'dist/linux-unpacked/hzmm-linux-app');

test.skip(process.platform !== 'linux', 'Linux-only simulation');
test.describe.configure({ mode: 'serial' });

const ls = (d) => { try { return fs.readdirSync(d).sort(); } catch { return []; } };
const paks = (d) => ls(d).filter(f => f.toLowerCase().endsWith('.pak'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let sim, env, app, page, fakeGame = null;
let betterLoot = 'BetterLoot_P.pak'; // renamed by "make it win" below

const api = (fn, arg) => page.evaluate(fn, arg);
const opened = () => app.evaluate(() => globalThis.__opened);
const queueDialog = (filePaths) => app.evaluate((_, fp) => { globalThis.__dialogQueue.push({ canceled: false, filePaths: fp }); }, filePaths);
const switchTab = async (t) => { await page.locator(`label[for="tab-${t}"]`).click(); await sleep(600); };
const reloadUi = async () => {
  await page.reload();
  await page.waitForSelector('#tab-dashboard', { state: 'attached' });
  await page.waitForSelector('#splash-screen', { state: 'detached', timeout: 15_000 }).catch(() => {});
};
const shot = async (name) => test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' });

// A process whose command line carries the game exe, like Wine's preloader.
const startGame = () => {
  fakeGame = spawn('bash', ['-c', 'exec -a "wine64-preloader Z:/HumanitZ/HumanitZ-Win64-Shipping.exe -fullscreen" sleep 600'], { stdio: 'ignore' });
};
const stopGame = () => { try { fakeGame?.kill('SIGKILL'); } catch { /* already gone */ } fakeGame = null; };

test.beforeAll(async () => {
  expect(fs.existsSync(BIN), `packaged binary missing: ${BIN} — run npm run test:sim`).toBe(true);
  sim = buildSimEnv(fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-sim-')), REPO);
  env = {
    ...process.env,
    HOME: sim.home,
    XDG_CONFIG_HOME: path.join(sim.home, '.config'),
    XDG_DATA_HOME: path.join(sim.home, '.local/share'),
    LANG: 'en_US.UTF-8',
    LANGUAGE: 'en',
  };
  app = await electron.launch({ executablePath: BIN, args: ['--no-sandbox'], env, timeout: 30_000 });
  page = await app.firstWindow();
  await page.waitForSelector('#tab-dashboard', { state: 'attached', timeout: 20_000 });
  await page.waitForSelector('#splash-screen', { state: 'detached', timeout: 15_000 }).catch(() => {});
  // Record URLs instead of opening them (steam://, releases page) and answer
  // native file dialogs from a queue.
  await app.evaluate(({ shell, dialog }) => {
    globalThis.__opened = [];
    shell.openExternal = async (u) => { globalThis.__opened.push(u); };
    globalThis.__dialogQueue = [];
    dialog.showOpenDialog = async () => globalThis.__dialogQueue.shift() || { canceled: true, filePaths: [] };
  });
});

test.afterAll(async () => {
  stopGame();
  await app?.close();
  if (sim && !process.env.HZMM_SIM_KEEP) fs.rmSync(sim.home, { recursive: true, force: true });
});

test('detects the game in a second Steam library and reads its build', async () => {
  expect(await api(() => window.api.game.getPath())).toBe(sim.game);
  expect(JSON.stringify(await api(() => window.api.game.getVersionCached()))).toContain('20481234');
});

test('UE4SS from a local zip is flattened for Proton', async () => {
  expect((await api(() => window.api.ue4ss.getStatus())).status).toBe('uninstalled');
  await queueDialog([sim.ue4ssZip]);
  await api(() => window.api.ue4ss.installFromFile());
  for (const f of ['dwmapi.dll', 'UE4SS.dll', 'UE4SS-settings.ini']) {
    expect(fs.existsSync(path.join(sim.win64, f)), `Win64/${f}`).toBe(true);
  }
  expect(fs.existsSync(path.join(sim.ue4ssMods, 'BPModLoaderMod/Scripts/main.lua'))).toBe(true);
  expect((await api(() => window.api.ue4ss.getStatus())).status).toBe('installed');
});

test('installs every archive shape through the dashboard + preview', async () => {
  await reloadUi(); // pick up the UE4SS mods dir created above
  await switchTab('dashboard');
  await page.locator('input[type="file"]').first().setInputFiles(Object.values(sim.archives));
  const confirm = page.getByRole('button', { name: /Confirm Install/i });
  await confirm.waitFor({ timeout: 15_000 });
  await shot('install-preview');
  await confirm.click();

  const expectedPaks = ['BetterLoot_P.pak', 'CoolGuns_P.pak', 'LOUDMUSIC_P.PAK', 'WinZipped_P.pak'];
  if (sim.archives.mapMarkers) expectedPaks.push('MapMarkers_P.pak');
  await expect.poll(() => ls(sim.modsDir), { timeout: 20_000 }).toEqual(expect.arrayContaining(expectedPaks));
  expect(ls(sim.modsDir).some(f => f.includes('\\')), 'no literal backslash filenames').toBe(false);
  await expect.poll(() => fs.existsSync(path.join(sim.ue4ssMods, 'FullWidgetDemo/enabled.txt'))).toBe(true);

  const mods = await api(() => window.api.mods.scan());
  expect(mods.filter(m => m.enabled).map(m => m.filename)).toEqual(expect.arrayContaining([...expectedPaks, 'FullWidgetDemo']));
  await switchTab('modules');
  await shot('library');
});

test('finds the PAK conflict and "make it win" reorders it', async () => {
  const conflicts = await api(() => window.api.conflicts.scan());
  const loot = conflicts.find(c => c.resource.endsWith('Shared/Loot.uasset'));
  expect(loot?.mods.sort()).toEqual(['BetterLoot_P.pak', 'CoolGuns_P.pak']);

  const r = await api(() => window.api.mods.makePakWin('BetterLoot_P.pak', ['CoolGuns_P.pak']));
  expect(r.renamed).toBe(true);
  expect(r.filename.toLowerCase() > 'coolguns_p.pak').toBe(true);
  expect(ls(sim.modsDir)).toContain(r.filename);
  betterLoot = r.filename;
});

test('toggles PAKs (any extension case) and UE4SS mods on disk', async () => {
  await api((f) => window.api.mods.toggle(f), betterLoot);
  expect(ls(sim.modsDir)).toContain(`${betterLoot}.disabled`);
  await api((f) => window.api.mods.toggle(`${f}.disabled`), betterLoot);

  await api(() => window.api.mods.toggle('LOUDMUSIC_P.PAK'));
  expect(ls(sim.modsDir)).toContain('LOUDMUSIC_P.PAK.disabled');
  await api(() => window.api.mods.toggle('LOUDMUSIC_P.PAK.disabled'));
  expect(ls(sim.modsDir)).toContain('LOUDMUSIC_P.PAK');

  await api(() => window.api.mods.toggle('FullWidgetDemo'));
  expect(fs.existsSync(path.join(sim.ue4ssMods, 'FullWidgetDemo/enabled.txt'))).toBe(false);
  expect(fs.readFileSync(path.join(sim.ue4ssMods, 'mods.txt'), 'utf8')).toMatch(/FullWidgetDemo\s*:\s*0/);
  await api(() => window.api.mods.toggle('FullWidgetDemo'));
  expect(fs.existsSync(path.join(sim.ue4ssMods, 'FullWidgetDemo/enabled.txt'))).toBe(true);
});

test('loads the UE4SS mod config schema', async () => {
  const schema = await api(() => window.api.mods.getConfigSchema('FullWidgetDemo'));
  expect(schema?.configFile).toBe('Scripts/config.lua');
  expect(Object.keys(schema?.sections || {}).length).toBeGreaterThan(0);
  const files = await api(() => window.api.mods.getConfigFiles('FullWidgetDemo'));
  expect(files.map(f => f.relativePath)).toContain('Scripts/config.lua');
});

test('lists and backs up worlds inside the Proton prefix', async () => {
  const worlds = await api(() => window.api.saves.listWorlds());
  expect(worlds.map(w => w.name).sort()).toEqual(['Brookfield', 'Riverside']);
  await api(() => window.api.saves.backup(['Brookfield']));
  const backups = await api(() => window.api.saves.listBackups());
  expect(backups.length).toBe(1);
  const copied = ls(path.join(backups[0].path, 'worlds/Brookfield'));
  expect(copied).toEqual(['Brookfield_CharPreview.sav', 'Brookfield_Foliage.sav', 'Save_Brookfield.sav']);
});

test('applying a profile restores mod state and auto-backs up saves', async () => {
  await reloadUi();
  await switchTab('profiles');
  const name = page.getByPlaceholder(/profile name/i);
  await name.fill('All mods');
  await name.press('Enter');
  await sleep(500);

  const offPak = sim.archives.mapMarkers ? 'MapMarkers_P.pak' : 'WinZipped_P.pak';
  await api((f) => window.api.mods.toggle(f), offPak);
  await api(() => window.api.mods.toggle('FullWidgetDemo'));
  const before = (await api(() => window.api.saves.listBackups())).length;

  await page.getByRole('button', { name: /Apply/ }).first().click();
  await expect.poll(() => ls(sim.modsDir).includes(offPak) && fs.existsSync(path.join(sim.ue4ssMods, 'FullWidgetDemo/enabled.txt')), { timeout: 15_000 }).toBe(true);
  expect((await api(() => window.api.saves.listBackups())).length).toBe(before + 1);
  await shot('profiles');
});

test('launch goes through Steam, blocked while conflicts exist', async () => {
  const launch = page.locator('button[aria-label]').filter({ has: page.locator('svg.lucide-play') }).first();
  await switchTab('dashboard');
  await launch.click();
  await sleep(800);
  expect((await opened()).some(u => u.startsWith('steam://')), 'blocked by the unresolved conflict').toBe(false);

  await api((f) => window.api.mods.toggle(f), betterLoot); // resolve by disabling one side
  await reloadUi();
  await launch.click();
  await expect.poll(opened).toContain(`steam://rungameid/${HUMANITZ_APP_ID}`);
});

test('pgrep sees the Proton game process start and exit', async () => {
  startGame();
  await expect.poll(() => api(() => window.api.game.isRunning()), { timeout: 12_000 }).toBe(true);
  await sleep(5_500); // let the 5 s poller push the running state to the UI
  await shot('game-running');
  stopGame();
  await expect.poll(() => api(() => window.api.game.isRunning()), { timeout: 12_000 }).toBe(false);
  await api((f) => window.api.mods.toggle(`${f}.disabled`), betterLoot);
});

test('vanilla launch disables everything and restores it after the game exits', async () => {
  await sleep(5_500); // poller settles on "not running"
  const before = paks(sim.modsDir);
  expect(before.length).toBeGreaterThan(0);
  await api(() => window.api.game.launchVanilla());
  expect(paks(sim.modsDir)).toEqual([]);
  expect(fs.existsSync(path.join(sim.ue4ssMods, 'FullWidgetDemo/enabled.txt'))).toBe(false);

  startGame();
  await expect.poll(() => api(() => window.api.game.isRunning()), { timeout: 12_000 }).toBe(true);
  await sleep(6_500); // a real session outlasts the 5 s poller, which must SEE it running
  stopGame();
  await expect.poll(() => paks(sim.modsDir).length, { timeout: 20_000 }).toBe(before.length);
  expect(fs.existsSync(path.join(sim.ue4ssMods, 'FullWidgetDemo/enabled.txt'))).toBe(true);
});

test('reinstalling UE4SS keeps user settings and Lua mods', async () => {
  const ini = path.join(sim.win64, 'UE4SS-settings.ini');
  fs.writeFileSync(ini, '[General]\nEnableHotReloadSystem = 0\n; user edit\n');
  await queueDialog([sim.ue4ssZip]);
  await api(() => window.api.ue4ss.installFromFile());
  expect(fs.readFileSync(ini, 'utf8')).toContain('user edit');
  expect(fs.existsSync(path.join(sim.ue4ssMods, 'FullWidgetDemo/Scripts/main.lua'))).toBe(true);
});

test('nxm:// registers via .desktop + xdg-mime and routes second-instance links', async () => {
  test.skip(!fs.existsSync('/usr/bin/xdg-mime'), 'xdg-utils not installed');
  const desktop = path.join(sim.home, '.local/share/applications/hzmm-manager-nxm.desktop');
  await api(() => window.api.nxm.setEnabled(true));
  expect(fs.readFileSync(desktop, 'utf8')).toContain(`Exec="${BIN}" %u`);
  expect(execFileSync('xdg-mime', ['query', 'default', 'x-scheme-handler/nxm'], { env, encoding: 'utf8' }).trim())
    .toBe('hzmm-manager-nxm.desktop');

  await api(() => { window.__nxm = []; window.api.nxm.onEvent(e => window.__nxm.push(e)); });
  spawn(BIN, ['--no-sandbox', 'nxm://othergame/mods/1/files/2?key=k&expires=9999999999&user_id=1'], { env, stdio: 'ignore' });
  await expect.poll(() => api(() => window.__nxm.map(e => e.type)), { timeout: 15_000 }).toContain('wrong-game');
  spawn(BIN, ['--no-sandbox', 'nxm://humanitz/mods/123/files/456?key=k&expires=9999999999&user_id=1'], { env, stdio: 'ignore' });
  await expect.poll(() => api(() => window.__nxm.find(e => e.type === 'failed')?.error), { timeout: 15_000 }).toBe('NEXUS_API_KEY_REQUIRED');
  await shot('nxm-toasts');

  await api(() => window.api.nxm.setEnabled(false));
  expect(fs.existsSync(desktop)).toBe(false);
});

test('start on boot writes and removes an XDG autostart entry', async () => {
  const entry = path.join(sim.home, '.config/autostart/hzmm-manager.desktop');
  await api(() => window.api.system.setAutoStart(true));
  expect(fs.readFileSync(entry, 'utf8')).toContain(`Exec="${BIN}"`);
  expect(await api(() => window.api.system.getAutoStart())).toBe(true);
  await api(() => window.api.system.setAutoStart(false));
  expect(fs.existsSync(entry)).toBe(false);
});

test('outside an AppImage the updater falls back to the releases page', async () => {
  const r = await api(() => window.api.appUpdate.check());
  if (!r.error) { // network-dependent; the manual install path below is not
    expect(r.latestVersion).toMatch(/^v?\d+\.\d+\.\d+/);
    expect(r.autoInstall).toBe(false);
  }
  const i = await api(() => window.api.appUpdate.install());
  expect(i.manual).toBe(true);
  expect(await opened()).toContain('https://github.com/uuuu790/HZMM-Linux/releases/latest');
});

test('uninstall removes the pak', async () => {
  await api(() => window.api.mods.remove('WinZipped_P.pak'));
  expect(ls(sim.modsDir)).not.toContain('WinZipped_P.pak');
  await switchTab('settings');
  await shot('settings');
});
