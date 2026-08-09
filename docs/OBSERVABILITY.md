# LifeSim Observability Framework

In-game diagnostics for performance, simulation health, and debugging. No production PII is collected.

## Quick use

| Key | Action |
|-----|--------|
| **F3** | Toggle overlay |
| **F4** | Export JSON dump (while overlay open, or use Export button) |

Overlay tabs: **perf** · **logs** · **events** · **metrics**

## Architecture

```
packages/sim/src/observability/
  hub.ts        — ObservabilityHub (session facade)
  logger.ts     — structured levels + categories + ring buffer
  metrics.ts    — counters, gauges, rolling histograms
  tracer.ts     — timed spans (sim tick / systems)
  ringBuffer.ts — fixed-capacity circular buffers
  types.ts      — shared contracts
```

Access the global hub:

```ts
import { getObs, initObs } from '@lifesim/sim';

initObs({ minLevel: 'debug', console: true });
getObs().logger.info('ui', 'hello', { screen: 'menu' });
getObs().event('buy.place', 'buy', { defId: 'object.bed_double' });
getObs().metrics.inc('custom.counter');
```

## What is instrumented

| Area | Signals |
|------|---------|
| **Frame loop** | FPS (EMA), frame interval ms, UI project ms, render ms, sim ticks/frame |
| **Sim tick** | Total tick ms, **per-system** histograms (Time, Mood, Path, Autonomy, …) |
| **Pathfinding** | success / fail counters + debug logs |
| **Actions** | succeed / fail + reason fields |
| **Autonomy** | pick count + chosen interaction / score |
| **Save/load** | serialize/deserialize ms + byte size events |
| **UI** | mode changes, buy/build tools, game start |
| **Content** | missing object def warnings (`warnOnce`) |

## Log levels

`trace` &lt; `debug` &lt; `info` &lt; `warn` &lt; `error`

Change live from the overlay or:

```ts
getObs().setMinLevel('warn');
```

High-volume `trace` logs are sampled (`traceSampleRate`, default `0.2`).

## Categories

`boot` · `sim` · `system` · `ai` · `path` · `action` · `social` · `career` · `build` · `buy` · `save` · `render` · `ui` · `input` · `content` · `perf` · `general`

## Export

`getObs().exportJson()` returns:

- full snapshot (frame + sim + metrics)
- complete log / event / span ring buffers
- session id + timestamps

Use for bug reports or offline analysis. Does **not** include save-game household PII beyond what you already put in log fields (avoid logging names in production builds if desired).

## Budgets (design targets)

| Metric | Target |
|--------|--------|
| FPS | ≥ 60 (UI) |
| Sim tick | ≤ 4 ms avg @ 8 Sims |
| Frame work | &lt; 16.7 ms |

Overlay highlights FPS / tick when outside budget.

## Tests

```bash
npm run test -w @lifesim/sim
```

Covers ring buffer, histograms, hub tick instrumentation, log level filtering.
