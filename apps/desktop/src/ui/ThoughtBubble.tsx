import type { HudProjection } from '@lifesim/sim';

type ThoughtBubbleProps = {
  sim: HudProjection['selectedSim'];
};

export function ThoughtBubble({ sim }: ThoughtBubbleProps) {
  if (!sim) return null;

  const thought = getThoughtForSim(sim);
  if (!thought) return null;

  return (
    <div className="thought-bubble">
      <div className="thought-icon">{thought.emoji}</div>
      <div className="thought-text">{thought.text}</div>
    </div>
  );
}

function getThoughtForSim(sim: HudProjection['selectedSim']): { emoji: string; text: string } | null {
  if (!sim) return null;

  // Critical needs
  if (sim.needs.energy < 15) return { emoji: '😴', text: 'Need sleep...' };
  if (sim.needs.hunger < 15) return { emoji: '🍕', text: 'So hungry!' };
  if (sim.needs.bladder < 15) return { emoji: '🚽', text: 'Need toilet!' };
  if (sim.needs.hygiene < 15) return { emoji: '🧼', text: 'Feel dirty...' };

  // Urgent needs
  if (sim.needs.energy < 30) return { emoji: '😪', text: 'Feeling tired' };
  if (sim.needs.hunger < 30) return { emoji: '🍴', text: 'Getting hungry' };
  if (sim.needs.bladder < 30) return { emoji: '🚻', text: 'Need bathroom' };
  if (sim.needs.hygiene < 30) return { emoji: '🛁', text: 'Could use shower' };
  if (sim.needs.fun < 25) return { emoji: '😐', text: 'So bored...' };
  if (sim.needs.social < 25) return { emoji: '👋', text: 'Want to chat' };

  // Activity-based thoughts
  if (sim.activityLabel.includes('Sleep')) return { emoji: '💤', text: 'Zzz...' };
  if (sim.activityLabel.includes('Cook') || sim.activityLabel.includes('Eat')) {
    return { emoji: '😋', text: 'Yum!' };
  }
  if (sim.activityLabel.includes('Watch')) return { emoji: '📺', text: 'Entertaining!' };
  if (sim.activityLabel.includes('Read')) return { emoji: '📚', text: 'Learning' };
  if (sim.activityLabel.includes('Exercise')) return { emoji: '💪', text: 'Getting fit!' };
  if (sim.activityLabel.includes('Paint')) return { emoji: '🎨', text: 'Being creative' };
  if (sim.activityLabel.includes('Talk') || sim.activityLabel.includes('Chat')) {
    return { emoji: '💬', text: 'Nice chat!' };
  }
  if (sim.activityLabel.includes('Work')) return { emoji: '💼', text: 'Working hard' };

  // Mood-based thoughts
  if (sim.mood > 80) return { emoji: '🌟', text: 'Feeling great!' };
  if (sim.mood < 25) return { emoji: '😔', text: 'Not happy...' };

  // Career thoughts
  if (sim.career.trackId && Math.random() < 0.1) {
    return { emoji: '💼', text: 'Career goals!' };
  }

  // Good mood default
  if (sim.mood > 60) return { emoji: '😊', text: 'Doing well' };

  return null;
}
