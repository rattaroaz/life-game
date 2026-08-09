# LifeSim testing

## Run

```bash
# all packages
npm test

# sim only (fast iteration)
npm run test:sim

# watch mode
npm run test:watch
```

## Layout

| Package | Suite focus |
|---------|-------------|
| `@lifesim/shared` | Shared constants / contracts |
| `@lifesim/sim` | **Primary** — clock, lot, path, RNG, relationships, world, systems, commands, save, observability, integration |
| `@lifesim/content` | Catalog integrity (unique ids, ref resolution, careers) |

Sim tests live next to sources: `packages/sim/src/**/*.test.ts`.

Fixtures: `packages/sim/src/test/fixtures.ts` (minimal content pack).  
Setup: `packages/sim/src/test/setup.ts` (quiet observability reset).

## Categories (sim)

1. **Unit** — pure functions (rng, clock, lot, path, relationships, metrics)
2. **Systems** — needs, mood, interactions/slots, careers, social, autonomy, pause
3. **Commands / HUD projection** — player API surface
4. **Persistence** — MessagePack round-trip, RNG stream state, localStorage polyfill
5. **Integration** — full `loadBuiltinContent()` catalog + long tick run
6. **Observability** — hub, ring buffer, log levels

## Writing new tests

```ts
import { minimalContent, makeTestWorld, spawnTestPair, tick } from './test/fixtures.js';
import { runSimTick } from './systems.js';

it('does a thing', () => {
  const content = minimalContent();
  const world = makeTestWorld(1);
  spawnTestPair(world, content);
  tick(world, content, 10, runSimTick);
  // assert…
});
```

Prefer **deterministic seeds** (`makeTestWorld(seed)`). Avoid wall-clock sleeps.

## CI expectations

- `npm test` exits 0
- `npm run typecheck` exits 0 (test files excluded from sim `tsc` rootDir)

Optional later: Playwright for UI smoke; `vitest --coverage` with `@vitest/coverage-v8`.
