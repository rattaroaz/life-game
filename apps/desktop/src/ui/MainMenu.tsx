import { useGameStore } from '../game/store';

export function MainMenu() {
  const initNewDemo = useGameStore((s) => s.initNewDemo);
  const openCas = useGameStore((s) => s.openCas);
  const loadGame = useGameStore((s) => s.loadGame);
  const saves = useGameStore((s) => s.saves);

  return (
    <div className="menu-screen">
      <div className="menu-card">
        <h1>LifeSim</h1>
        <p>
          A modern life simulation — manage needs, build your home, chase careers,
          and let autonomy write the stories.
        </p>
        <div className="menu-actions">
          <button type="button" className="active" onClick={initNewDemo}>
            Quick Start (Demo Household)
          </button>
          <button type="button" onClick={openCas}>
            Create-A-Sim / New Game
          </button>
          {saves.length > 0 && (
            <>
              <div className="section-title">Load game</div>
              {saves.map((s) => (
                <button key={s.id} type="button" onClick={() => loadGame(s.id)}>
                  {s.name} — {s.householdName}
                  <br />
                  <small style={{ color: '#94a3b8' }}>{new Date(s.updatedAt).toLocaleString()}</small>
                </button>
              ))}
            </>
          )}
        </div>
        <p className="help-hint">
          Controls: click Sim/object · WASD/middle-mouse pan · wheel zoom · Live / Build / Buy modes ·
          1–3 speed keys after start
        </p>
      </div>
    </div>
  );
}
