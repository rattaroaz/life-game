import type { HudProjection } from '@lifesim/sim';

type MoodletsProps = {
  sim: HudProjection['selectedSim'];
};

export function Moodlets({ sim }: MoodletsProps) {
  if (!sim || sim.moodModifiers.length === 0) return null;

  return (
    <div className="moodlets-panel">
      <div className="moodlets-title">Moodlets</div>
      <div className="moodlets-grid">
        {sim.moodModifiers.map((mod, i) => {
          const isPositive = mod.amount > 0;
          const emoji = getMoodletEmoji(mod.id);
          return (
            <div
              key={`${mod.id}-${i}`}
              className={`moodlet ${isPositive ? 'positive' : 'negative'}`}
              title={`${formatMoodletName(mod.id)}: ${mod.amount > 0 ? '+' : ''}${mod.amount} mood`}
            >
              <div className="moodlet-icon">{emoji}</div>
              <div className="moodlet-value">{mod.amount > 0 ? '+' : ''}{mod.amount}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getMoodletEmoji(id: string): string {
  if (id.includes('well_fed')) return '🍽️';
  if (id.includes('energized')) return '⚡';
  if (id.includes('clean')) return '✨';
  if (id.includes('social')) return '💬';
  if (id.includes('fun')) return '🎮';
  if (id.includes('tired')) return '😴';
  if (id.includes('hungry')) return '🍔';
  if (id.includes('dirty')) return '💩';
  if (id.includes('lonely')) return '😢';
  if (id.includes('stressed')) return '😰';
  return '🌟';
}

function formatMoodletName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
