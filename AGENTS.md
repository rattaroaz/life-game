# AGENTS.md

## Cursor Cloud specific instructions

LifeSim is an npm-workspaces monorepo for a single Sims-inspired life simulation game (TypeScript + React 19 + PixiJS 8, with an optional Tauri 2 / Rust desktop shell). It is a fully client-side game — there is no backend, database, or network service. The update script already runs `npm install`, so dependencies are ready when a session starts.

### Services / how to run

- Web dev server (primary): `npm run dev` starts Vite on `http://127.0.0.1:1420/`. This is the main way to run and test the game end-to-end in a browser — no other services are required. When not running under Tauri, saves fall back to browser storage.
- Desktop shell (optional): `npm run tauri:dev` builds the Rust `lifesim` crate and opens a native window. Rust/Cargo is available, but this also needs system WebKitGTK/webview libraries that are not installed by the update script. Prefer web mode unless you specifically need to test native file-based save/load.

### Lint / typecheck / test / build

- Typecheck: `npm run typecheck` (runs `tsc` across all workspaces; there is no separate ESLint setup).
- Tests: `npm test` (Vitest across `@lifesim/shared`, `@lifesim/sim`, `@lifesim/content`). Use `npm run test:sim` for fast sim-only iteration. See `docs/TESTING.md`.
- Build (production, not needed for dev): `npm run build`.

### Notes / gotchas

- Requires Node >= 20 (VM has Node 22).
- Standard scripts live in the root `package.json` and `apps/desktop/package.json`; reference those rather than duplicating commands.
- "Quick Start" on the main menu spawns a demo household immediately, which is the fastest way to reach the live isometric game view for manual verification.
