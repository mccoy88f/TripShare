import { useEffect, useState } from 'react';

/**
 * Stato della tastiera virtuale (mobile), ricavato da `visualViewport`: quando è aperta la
 * parte visibile della pagina si riduce. `inset` è lo spazio occupato dalla tastiera sotto la
 * parte visibile, per tenere un campo fisso in basso sempre sopra la tastiera.
 */
export function useKeyboard() {
  const [state, setState] = useState({ open: false, inset: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let tallest = vv.height;
    const update = () => {
      tallest = Math.max(tallest, vv.height);
      const open = tallest - vv.height > 150;
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setState((prev) =>
        prev.open === open && Math.abs(prev.inset - inset) < 1 ? prev : { open, inset },
      );
    };
    const reset = () => {
      tallest = vv.height;
      update();
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', reset);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', reset);
    };
  }, []);
  return state;
}
