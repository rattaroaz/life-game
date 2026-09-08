import type { HudProjection, ContentPack } from '@lifesim/sim';

type ActionQueueProps = {
  sim: HudProjection['selectedSim'];
  content: ContentPack;
};

export function ActionQueue({ sim, content }: ActionQueueProps) {
  if (!sim || sim.queue.length === 0) return null;

  const queueItems = sim.queue.map((q) => {
    if (q.interactionId === '__walk__') return { id: q.interactionId, label: 'Walk', icon: '🚶' };
    if (q.interactionId.startsWith('__travel__:')) {
      const place = q.interactionId.split(':')[1];
      return { id: q.interactionId, label: `Travel to ${place}`, icon: '🚗' };
    }
    
    const interaction = content.interactions.find((i) => i.id === q.interactionId);
    const label = interaction?.nameKey ?? q.interactionId.split('.').pop()?.replace(/_/g, ' ') ?? q.interactionId;
    const icon = getInteractionIcon(q.interactionId);
    
    return { id: q.interactionId, label, icon };
  });

  const current = queueItems[0];
  const upcoming = queueItems.slice(1);

  return (
    <div className="action-queue-panel">
      <div className="action-queue-header">Action Queue</div>
      <div className="action-queue-current">
        <span className="action-icon">{current.icon}</span>
        <span className="action-label">{current.label}</span>
        <span className="action-status">{sim.activityPhase === 'doing' ? '⏳' : '...'}</span>
      </div>
      {upcoming.length > 0 && (
        <div className="action-queue-upcoming">
          {upcoming.map((item, i: number) => (
            <div key={`${item.id}-${i}`} className="action-queue-item">
              <span className="action-icon-small">{item.icon}</span>
              <span className="action-label-small">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getInteractionIcon(interactionId: string): string {
  if (interactionId.includes('sleep')) return '💤';
  if (interactionId.includes('eat') || interactionId.includes('meal') || interactionId.includes('snack')) return '🍽️';
  if (interactionId.includes('cook')) return '👨‍🍳';
  if (interactionId.includes('toilet')) return '🚽';
  if (interactionId.includes('shower') || interactionId.includes('hygiene') || interactionId.includes('wash')) return '🚿';
  if (interactionId.includes('tv') || interactionId.includes('watch')) return '📺';
  if (interactionId.includes('read') || interactionId.includes('book')) return '📚';
  if (interactionId.includes('computer')) return '💻';
  if (interactionId.includes('exercise') || interactionId.includes('fitness') || interactionId.includes('punch')) return '💪';
  if (interactionId.includes('paint') || interactionId.includes('easel')) return '🎨';
  if (interactionId.includes('dance')) return '💃';
  if (interactionId.includes('guitar') || interactionId.includes('music')) return '🎸';
  if (interactionId.includes('chat') || interactionId.includes('talk')) return '💬';
  if (interactionId.includes('flirt')) return '💕';
  if (interactionId.includes('joke')) return '😄';
  if (interactionId.includes('hug')) return '🤗';
  if (interactionId.includes('sit') || interactionId.includes('relax')) return '🪑';
  if (interactionId.includes('chess')) return '♟️';
  if (interactionId.includes('arcade') || interactionId.includes('game')) return '🎮';
  return '✨';
}
