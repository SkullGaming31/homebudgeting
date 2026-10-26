# Home Budgeting — Electron (TypeScript)

Quick scaffold for a local Electron app that stores budgets and transactions in a JSON file inside Electron `userData`.

Getting started

1. Install dev dependencies:

```powershell
npm install
```

2. Build and run (production):

```powershell
npm install
npm run build
npm run start
```

Development (renderer + main process in separate terminals):

```powershell
# Terminal 1: compile main process continuously
npm run dev:main

# Terminal 2: run Vite dev server for renderer
npm run dev:renderer

# Optionally build main and open Electron (for quick test)
npm run build:main && electron .
```

Notes
- All main source files live under `src` as requested.
- IPC API exposed on `window.api` via the preload script.
