import type { KeyboardEvent, PointerEvent } from 'react';

export default function ResizeDivider({
  value,
  min,
  max,
  growDirection,
  label,
  onChange,
  onResizeStart,
  onResizeEnd,
}: {
  value: number;
  min: number;
  max: number;
  growDirection: 1 | -1;
  label: string;
  onChange: (value: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startValue = value;
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    onResizeStart?.();

    const move = (next: globalThis.PointerEvent) => {
      onChange(clamp(startValue + (next.clientX - startX) * growDirection));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      onResizeEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange(event.key === 'Home' ? min : max);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const physicalDelta = event.key === 'ArrowRight' ? 16 : -16;
    onChange(clamp(value + physicalDelta * growDirection));
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} 像素`}
      tabIndex={0}
      title={`${label}（可拖动，方向键可微调）`}
      onPointerDown={startResize}
      onKeyDown={resizeWithKeyboard}
      className="group relative z-20 hidden w-2 shrink-0 cursor-col-resize touch-none select-none items-stretch outline-none lg:flex"
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/[0.07] transition-[width,background-color] duration-150 group-hover:w-0.5 group-hover:bg-[#4285f4] group-focus-visible:w-0.5 group-focus-visible:bg-[#4285f4]" />
    </div>
  );
}
