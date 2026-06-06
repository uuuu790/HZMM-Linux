<p align="center">
  <img src="resources/icon.png" width="120" alt="HZMM Logo">
</p>

<h1 align="center">HZMM Manager (Linux)</h1>

<p align="center">
  <strong>HumanitZ Mod Manager — Linux edition</strong> for players running HumanitZ via Steam Proton.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Platform">
  <img src="https://img.shields.io/badge/electron-33-47848F?style=flat-square&logo=electron" alt="Electron">
</p>

---

## Proton Setup (read this first)

UE4SS injects through a proxy DLL, and Wine's default DLL resolver doesn't pick it up. To make UE4SS mods load under Proton:

1. **Add this to Steam game properties → Launch Options:**

   ```
   WINEDLLOVERRIDES="dwmapi=n,b" %command%
   ```

   HZMM has a one-click copy button for this string in **Settings → Proton Launch Option**.

2. **Use GE-Proton 10-14+ or Proton Experimental.** Older Proton versions have known UE4SS injection regressions.

3. HZMM automatically flattens the UE4SS `Win64/ue4ss/*` layout into `Win64/*` when deploying — the nested layout breaks under Wine.

PAK mods (resource mods) work without any of this — they're loaded by Unreal Engine's built-in mod loader and require no DLL injection.

## Features

### Mod Management
- **One-click install** — Drag & drop `.zip`, `.rar`, or `.pak` files to install mods instantly
- **PAK & UE4SS support** — Manage both resource mods (PAK) and script mods (UE4SS Lua/C++)
- **Inline rename** — Click any mod name to give it a custom display name
- **Mod config editor** — Visual editor for mod configs with auto-detected toggles, selectors, and inputs
- **Multi-language configs** — Config descriptions and options follow the app language ([standard](docs/CONFIG.md))
- **Mod conflict detection** — Scans PAK file indexes to detect resource-level conflicts between mods
- **Profile system** — Save and switch between mod configurations with one click

### Engine & Game
- **UE4SS engine management** — Auto-deploys, updates, and flattens the UE4SS framework for Wine/Proton
- **Game detection** — Auto-detects HumanitZ via native, Flatpak, and Snap Steam installs
- **Launch via Steam** — Starts HumanitZ through `steam://rungameid/2358160` so your Proton settings apply
- **Game running alert** — Warns you before modifying files while the game is running

### Backup & Update
- **World save backup** — Backup world saves with mod snapshot, restore anytime
- **Update check** — Detects new GitHub releases. Auto-install is currently Windows-only; on Linux, download the new AppImage/deb manually.

### User Experience
- **Multi-language** — 繁體中文, English, 日本語, 한국어, Русский, Deutsch, Français
- **6 theme presets** — Ember, Crimson, Toxic, Frost, Violet, Gold with Dark / Light mode
- **Logging** — Operations logged to `~/.config/hzmm-manager/hzmm.log`

## Download

Download the latest `.AppImage` or `.deb` from Releases.

- **AppImage** — `chmod +x` and run directly. No install required.
- **deb** — `sudo dpkg -i HZMM-Manager-<version>.deb` on Debian / Ubuntu / Mint.

## Supported Steam Install Types

HZMM auto-detects all three common Steam channels on Linux:

| Channel | Path |
|---------|------|
| Native (`.deb` / `.rpm` / `pacman`) | `~/.local/share/Steam` or `~/.steam/steam` |
| Flatpak (`com.valvesoftware.Steam`) | `~/.var/app/com.valvesoftware.Steam/data/Steam` |
| Snap (`canonical/steam`) | `~/snap/steam/common/.local/share/Steam` |

Steam Deck (SteamOS) is supported — it uses the native channel.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Electron](https://www.electronjs.org/) 33 |
| Frontend | [React](https://react.dev/) 18 + [Tailwind CSS](https://tailwindcss.com/) 4 |
| Build | [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/) |
| Archive | [node-stream-zip](https://github.com/nicow22/node-stream-zip) + [node-unrar-js](https://github.com/nicow22/node-unrar-js) |
| Icons | [Lucide React](https://lucide.dev/) |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) 9+
- Linux host (cross-compile from Windows requires Docker)

### Setup

```bash
git clone <repo-url>
cd HZMM_Linux
npm install
```

### Run in dev mode

```bash
npm run dev
```

### Build AppImage + deb

```bash
npm run package
```

Output: `dist/HZMM Manager-<version>.AppImage` and `dist/HZMM Manager-<version>.deb`

### Testing

```bash
npm run test          # unit tests (one-shot)
npm run test:watch    # unit tests (watch mode)
npx playwright test   # E2E tests (requires built Electron app)
```

## Relationship to upstream HZMM

This is a Linux fork of [HZMM](https://github.com/uuuu790/HZMM). The bulk of the codebase is shared; Linux-specific changes are concentrated in:

- `src/main/services/steam-detector.js` — Linux Steam path detection
- `src/main/services/process-detector.js` — `pgrep` instead of `tasklist`
- `src/main/ipc/game.js` — launch via `steam://` URL
- `src/main/ipc/ue4ss.js` — flatten Win64/ue4ss/ layout for Wine
- `electron-builder.yml` — AppImage / deb targets

## License

All rights reserved.
