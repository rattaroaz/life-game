import { useEffect } from 'react';
import { useGameStore } from './game/store';
import { MainMenu } from './ui/MainMenu';
import { CasScreen } from './ui/CasScreen';
import { GameScreen } from './ui/GameScreen';

export function App() {
  const screen = useGameStore((s) => s.screen);
  const refreshSaves = useGameStore((s) => s.refreshSaves);

  useEffect(() => {
    refreshSaves();
  }, [refreshSaves]);

  if (screen === 'menu') return <MainMenu />;
  if (screen === 'cas') return <CasScreen />;
  return <GameScreen />;
}
