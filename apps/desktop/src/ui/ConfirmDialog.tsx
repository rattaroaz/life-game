import { useGameStore } from '../game/store';

export function ConfirmDialog() {
  const dialog = useGameStore((s) => s.confirmDialog);
  const resolveConfirm = useGameStore((s) => s.resolveConfirm);
  if (!dialog) return null;

  return (
    <div className="confirm-backdrop" role="presentation">
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h2 id="confirm-title">{dialog.title}</h2>
        <p id="confirm-body">{dialog.message}</p>
        {dialog.detail && <p className="confirm-detail">{dialog.detail}</p>}
        <div className="confirm-actions">
          <button type="button" onClick={() => resolveConfirm(false)}>
            {dialog.cancelLabel ?? 'No'}
          </button>
          <button type="button" className="active" onClick={() => resolveConfirm(true)}>
            {dialog.confirmLabel ?? 'Yes'}
          </button>
        </div>
      </div>
    </div>
  );
}
