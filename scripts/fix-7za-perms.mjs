// postinstall: restore the executable bit on 7zip-bin's POSIX binaries.
//
// The 7zip-bin npm tarball ships linux/*/7za (and mac/*/7za) as 0644, so on
// Linux every spawn of path7za fails with EACCES — .7z mod installs break, and
// electron-builder packs the same 0644 file into the AppImage (a read-only
// squashfs, so it can't be fixed at runtime). chmod once here, right after
// npm install / npm ci, so dev runs, tests and packaged builds all get 0755.
// No-op on Windows (7za.exe needs no mode bits).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

if (process.platform !== 'win32') {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '7zip-bin');
  for (const os of ['linux', 'mac']) {
    const osDir = path.join(root, os);
    let arches = [];
    try { arches = fs.readdirSync(osDir); } catch { continue; }
    for (const arch of arches) {
      const bin = path.join(osDir, arch, '7za');
      try {
        fs.chmodSync(bin, 0o755);
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`fix-7za-perms: ${bin}: ${err.message}`);
      }
    }
  }
}
