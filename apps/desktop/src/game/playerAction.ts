import { useGameStore } from './store';

/**
 * If the Sim is mid-action or at work, ask before stopping them.
 * On yes: interrupt (work skips can lead to firing), then run the new command.
 */
export async function runPlayerAction(
  simId: number | null | undefined,
  run: () => void,
): Promise<void> {
  const store = useGameStore.getState();
  const cmd = store.commands;
  if (!cmd || simId == null) {
    run();
    return;
  }

  const busy = cmd.getBusyInfo(simId);
  if (!busy.busy) {
    run();
    flushCommandToasts();
    store.reproject();
    return;
  }

  const ok = await store.askConfirm({
    title: 'Stop current activity?',
    message: `${busy.name} is ${busy.activityLabel}. Are you sure you want them to stop?`,
    detail: busy.atWork
      ? 'Leaving work early hurts their job. Skip too often and they can get fired.'
      : 'They will drop everything they are doing right now.',
    confirmLabel: 'Yes, stop them',
    cancelLabel: 'Keep going',
  });
  if (!ok) return;

  cmd.interruptForPlayer(simId);
  flushCommandToasts();
  run();
  flushCommandToasts();
  store.reproject();
}

function flushCommandToasts(): void {
  const store = useGameStore.getState();
  const cmd = store.commands;
  if (!cmd) return;
  for (const m of cmd.drainEvents()) store.pushToast(m);
}
