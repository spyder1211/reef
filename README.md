<div align="center">

<img src="docs/assets/icon.png" alt="Reef" width="120" height="120" />

# Reef

**A fast, tab-unlimited MySQL client for macOS**

Connection management · table browsing · record editing · SQL execution · dump import/export — in one lightweight desktop app.

[English](README.md) · [日本語](README.ja.md)

<br/>

[![Download](https://img.shields.io/github/v/release/spyder1211/reef?label=download&logo=apple&logoColor=white&color=1f6feb)](https://github.com/spyder1211/reef/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platform: macOS arm64](https://img.shields.io/badge/platform-macOS%20arm64-000000?logo=apple&logoColor=white)
![Electron 31](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

</div>

Reef is a lightweight desktop app built with **Electron + React + TypeScript**. It covers connection management, table browsing, record editing, SQL execution, and dump import/export.

## Features

### Connection management
- Saved connection profiles (passwords are encrypted with Electron `safeStorage` and stored in `userData`)
- Two-level grouping (user-created groups × subgroups auto-derived from the environment tag `production` / `staging` / `development` / `local`)
- Drag-and-drop to move and reorder groups
- Right-click menu on a connection row (duplicate / edit / delete); duplicate copies the encrypted password, tags, and group assignment
- Window maximizes on connect; closing the window returns to the connection list

### Table browsing & editing
- Table list with name-based search jump
- `TRUNCATE` / `DROP` from the table list's right-click menu
- Record pagination, sorting, and filtering (quick filters: `=` `<>` `<` `>` `contains` `in` `between` `is null`, and more)
- Side-by-side split view of records
- Row detail pane
- Cell editing (`UPDATE`), row insert (`INSERT`), row delete (`DELETE`)
- Multi-row selection + right-click for bulk delete / duplicate / copy

### SQL editor
- CodeMirror-based SQL editor (SQL syntax highlighting)
- Run with `Cmd+Enter`; multiple statements (semicolon-separated) run sequentially
- Stop a long-running query (`KILL QUERY` via a dedicated connection)
- Automatic `LIMIT` on bare `SELECT` queries plus a hard result-row cap, to keep large results from freezing the app
- Virtualized result grid: only the visible window of rows is rendered, so large result sets stay smooth

### Import / export
- Export results to CSV
- Export SQL dumps (streaming, with progress)
- Import / restore SQL dumps (`.sql` and gzip-compressed `.sql.gz`; foreign-key checks are disabled during import, with progress and a result summary)
- These actions are available from the File menu

## Tech stack

| Area | Technology |
| --- | --- |
| Desktop runtime | Electron 31 |
| Build | electron-vite / Vite 5 |
| UI | React 18 + TypeScript |
| State | zustand |
| Grid | @tanstack/react-table + @tanstack/react-virtual |
| SQL editor | @uiw/react-codemirror + @codemirror/lang-sql |
| DB driver | mysql2 |
| Tests | Vitest |
| Packaging | electron-builder (macOS dmg) |

## Requirements

- Node.js 20 or later
- A MySQL server to connect to
- Distribution packages target macOS (Apple Silicon / arm64)

## Getting started

```bash
npm install
```

### Develop

```bash
npm run dev          # start in dev with electron-vite (hot reload)
```

### Type-check & test

```bash
npm run typecheck    # tsc --noEmit for both the main and web tsconfigs
npm run test         # run Vitest once
npm run test:watch   # run Vitest in watch mode
```

Integration tests need MySQL. You can start a test MySQL with `docker-compose.test.yml`:

```bash
docker compose -f docker-compose.test.yml up -d
```

### Build

```bash
npm run build        # electron-vite build (artifacts in out/)
npm run preview      # preview the built app
```

### macOS distribution package (dmg)

```bash
npm run dist:mac     # electron-vite build && electron-builder --mac --arm64
```

Artifacts are written to `dist/`. Distribution builds are unsigned (ad-hoc signed): `build/afterPack.cjs` re-applies an ad-hoc signature to the whole bundle after packing, to reduce the "damaged / can't be opened" Gatekeeper error on unsigned distribution. On first launch, right-click the app and choose "Open".

## Project layout

```
src/
├── main/          # Electron main process
│   ├── connection/  # ConnectionManager / ProfileStore / GroupStore, etc.
│   ├── dump/        # SQL dump export
│   ├── import/      # SQL dump import (incl. gzip / statement splitter)
│   ├── ipc/         # IPC handler registration
│   ├── index.ts     # entry point (BrowserWindow creation)
│   └── menu.ts      # app menu
├── preload/       # context bridge (exposes window.api)
├── renderer/      # React UI
│   └── src/
│       ├── home/       # connection list / connection form
│       ├── workspace/  # table browsing / SQL editor / result grid
│       ├── store/      # zustand store
│       └── lib/        # CSV / filter / search utilities
└── shared/        # types shared across main / preload / renderer (types.ts)
```

IPC return values never throw; they are returned as an `ApiResult<T>` discriminated union (`{ ok: true; data } | { ok: false; error }`) — see `src/shared/types.ts`.

## Release notes

See [RELEASE_NOTES.md](RELEASE_NOTES.md) ([日本語](RELEASE_NOTES.ja.md)).

## License

[MIT](LICENSE) © spyder1211
