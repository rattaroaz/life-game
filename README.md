# LifeSim

A modern Sims-inspired life simulation built with **TypeScript** and **Tauri 2**.

## Features (v1)

- Create-A-Sim (preset appearance, traits, aspirations)
- Needs, moods, skills, and autonomy AI
- Object interactions with slots, pathfinding, and multi-step cooking chains
- Build & buy mode (walls, doors, catalog placement)
- Two careers: **Office Worker** and **Chef** (abstract off-lot work)
- Multi-sim relationships and social interactions
- Save / load (MessagePack + local or Tauri FS)
- Day/night cycle, weather, isometric lot view

## Quick start (web / Vite)

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:1420`).

## Desktop (Tauri)

Requires [Rust](https://rustup.rs/) and a WebView2 runtime (Windows).

```bash
npm install
npm run tauri:dev
```

## Workspace layout

| Path | Role |
|------|------|
| `apps/desktop` | React UI + Tauri shell |
| `packages/sim` | Pure simulation (ECS, AI, pathfinding) — no DOM |
| `packages/render` | PixiJS isometric world |
| `packages/content` | Zod schemas + catalog loaders |
| `packages/shared` | Shared types / IPC contracts |
| `content/` | JSON definitions (objects, careers, …) |

## Design

See `LifeSim-v1-design-doc.md` for architecture, Clock Contract, and PR plan.

## License

Game code: MIT (or as chosen). Ship fonts/audio as open-source or CC0 only.
