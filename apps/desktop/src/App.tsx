import { lazy, Suspense, useEffect } from 'react';
import { useGameStore } from './game/store';
import { DebugOverlay } from './ui/DebugOverlay';
import { MainMenu } from './ui/MainMenu';

// Lazy-load game/CAS so PixiJS is not imported until needed (avoids blank menu if WebGL init fails early)
const CasScreen = lazy(() =>
  import('./ui/CasScreen').then((m) => ({ default: m.CasScreen })),
);
const GameScreen = lazy(() =>
  import('./ui/GameScreen').then((m) => ({ default: m.GameScreen })),
);

function Loading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0b1020',
        color: '#5eead4',
      }}
    >
      Loading…
    </div>
  );
}

export function App() {
  const screen = useGameStore((s) => s.screen);
  const refreshSaves = useGameStore((s) => s.refreshSaves);

  useEffect(() => {
    try {
      refreshSaves();
    } catch (e) {
      console.warn('refreshSaves failed', e);
    }
  }, [refreshSaves]);

  return (
    <>
      {screen === 'menu' && <MainMenu />}
      {screen === 'cas' && (
        <Suspense fallback={<Loading />}>
          <CasScreen />
        </Suspense>
      )}
      {screen === 'game' && (
        <Suspense fallback={<Loading />}>
          <GameScreen />
        </Suspense>
      )}
      <DebugOverlay />
    </>
  );
}
