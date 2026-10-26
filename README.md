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
- The Home view includes spending totals by category for the selected month and a six-month spending trend ending in that month. Positive transaction amounts count as spending; negative amounts are treated as credits.
- Settings includes a time zone selector (default: system time zone). It determines which day and month each transaction belongs to, and how transaction times are displayed.
- Budget alerts show inline and as toasts when category spending reaches the configurable monthly warning threshold (default 80%) or exceeds its limit.
- Recurring schedules support weekly and monthly reminders five days ahead; recording an occurrence is manual and advances its next due date.
