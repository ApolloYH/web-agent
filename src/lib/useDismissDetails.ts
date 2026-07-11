import { useEffect, useRef } from 'react';

export function useDismissDetails() {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) ref.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  return ref;
}
