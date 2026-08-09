import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

const STORAGE_KEY = 'lifesim.activityWindowPos';

type Pos = { x: number; y: number };

type Props = {
  name: string;
  label: string;
  detail: string | null;
  phase: 'idle' | 'moving' | 'doing' | 'work' | 'failed';
  /** Click the character name to jump camera back to them */
  onNameClick?: () => void;
};

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pos>;
    if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: p.x, y: p.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function savePos(pos: Pos): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function clampPos(x: number, y: number, el: HTMLElement): Pos {
  const parent = el.offsetParent as HTMLElement | null;
  const pw = parent?.clientWidth ?? window.innerWidth;
  const ph = parent?.clientHeight ?? window.innerHeight;
  const ew = el.offsetWidth;
  const eh = el.offsetHeight;
  return {
    x: Math.max(8, Math.min(pw - ew - 8, x)),
    y: Math.max(8, Math.min(ph - eh - 8, y)),
  };
}

export function ActivityWindow({ name, label, detail, phase, onNameClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => loadPos());
  const posRef = useRef<Pos | null>(pos);
  const drag = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Keep a saved position on-screen after resize
  useEffect(() => {
    if (!pos || !ref.current) return;
    const onResize = () => {
      const el = ref.current;
      if (!el || !posRef.current) return;
      const next = clampPos(posRef.current.x, posRef.current.y, el);
      setPos(next);
      savePos(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const parent = el.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const x = rect.left - parentRect.left;
    const y = rect.top - parentRect.top;
    drag.current = { ox: e.clientX, oy: e.clientY, sx: x, sy: y };
    movedRef.current = false;
    setPos({ x, y });
    setDragging(true);
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return;
    const dx = e.clientX - drag.current.ox;
    const dy = e.clientY - drag.current.oy;
    if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
    const nx = drag.current.sx + dx;
    const ny = drag.current.sy + dy;
    setPos(clampPos(nx, ny, ref.current));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const wasClick = !movedRef.current;
    const onName =
      wasClick &&
      onNameClick &&
      e.target instanceof Element &&
      e.target.closest('.activity-window-name');
    drag.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (posRef.current) savePos(posRef.current);
    if (onName) onNameClick();
  };

  const style: CSSProperties | undefined =
    pos != null ? { left: pos.x, top: pos.y, transform: 'none' } : undefined;

  return (
    <div
      ref={ref}
      className={`activity-window phase-${phase}${dragging ? ' dragging' : ''}`}
      style={style}
      aria-live="polite"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title="Drag to move"
    >
      <div className="activity-window-kicker">
        <span>Now doing</span>
        <span className="activity-window-grip" aria-hidden />
      </div>
      <button
        type="button"
        className="activity-window-name"
        title="Focus on this Sim"
        onClick={(e) => {
          // Click without drag is also handled in pointerup; stop bubbling to stage
          e.stopPropagation();
        }}
      >
        {name}
      </button>
      <div className="activity-window-label">{label}</div>
      {detail && <div className="activity-window-detail">{detail}</div>}
    </div>
  );
}
