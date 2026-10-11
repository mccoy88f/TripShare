import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 300;

interface View {
  scale: number;
  x: number;
  y: number;
}
const HOME: View = { scale: 1, x: 0, y: 0 };

/**
 * Immagine ingrandibile con il pizzico e il doppio tocco (su computer anche con la rotella):
 * lo zoom vale solo qui, non per tutta l'interfaccia. Senza ingrandimento un dito scorre la
 * pagina o il carosello come sempre; ingrandita, un dito sposta l'immagine.
 */
export function ZoomImage({
  className,
  wrapperClassName,
  ...img
}: ImgHTMLAttributes<HTMLImageElement> & { wrapperClassName?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(HOME);
  const current = useRef(view);
  current.current = view;
  const gesture = useRef<{
    startDist: number;
    startScale: number;
    lastX: number;
    lastY: number;
    pinching: boolean;
  } | null>(null);
  const lastTap = useRef({ time: 0, x: 0, y: 0 });

  // Cambiando immagine si riparte da zero.
  useEffect(() => setView(HOME), [img.src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    /** Tiene l'immagine dentro i bordi: ingrandita, non si può trascinare nel vuoto. */
    const clamp = (v: View): View => {
      if (v.scale <= 1) return HOME;
      const maxX = (el.clientWidth * (v.scale - 1)) / 2;
      const maxY = (el.clientHeight * (v.scale - 1)) / 2;
      return {
        scale: v.scale,
        x: Math.max(-maxX, Math.min(maxX, v.x)),
        y: Math.max(-maxY, Math.min(maxY, v.y)),
      };
    };
    const dist = (t: TouchList) =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const center = (t: TouchList) => ({
      x: (t[0]!.clientX + t[t.length - 1]!.clientX) / 2,
      y: (t[0]!.clientY + t[t.length - 1]!.clientY) / 2,
    });

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const c = center(e.touches);
        gesture.current = {
          startDist: dist(e.touches),
          startScale: current.current.scale,
          lastX: c.x,
          lastY: c.y,
          pinching: true,
        };
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0]!;
        const now = Date.now();
        const prev = lastTap.current;
        if (
          now - prev.time < DOUBLE_TAP_MS &&
          Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 30
        ) {
          // Doppio tocco: si ingrandisce nel punto toccato oppure si torna alla vista intera.
          e.preventDefault();
          lastTap.current = { time: 0, x: 0, y: 0 };
          const v = current.current;
          if (v.scale > 1) setView(HOME);
          else {
            const rect = el.getBoundingClientRect();
            const scale = 2.5;
            setView(
              clamp({
                scale,
                x: (rect.left + rect.width / 2 - t.clientX) * (scale - 1),
                y: (rect.top + rect.height / 2 - t.clientY) * (scale - 1),
              }),
            );
          }
          return;
        }
        lastTap.current = { time: now, x: t.clientX, y: t.clientY };
        gesture.current = {
          startDist: 0,
          startScale: current.current.scale,
          lastX: t.clientX,
          lastY: t.clientY,
          pinching: false,
        };
      }
    };

    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (e.touches.length === 2 && g.pinching) {
        e.preventDefault();
        const c = center(e.touches);
        const scale = Math.max(
          1,
          Math.min(MAX_SCALE, (g.startScale * dist(e.touches)) / g.startDist),
        );
        const v = current.current;
        setView(clamp({ scale, x: v.x + (c.x - g.lastX), y: v.y + (c.y - g.lastY) }));
        g.lastX = c.x;
        g.lastY = c.y;
        return;
      }
      // Un dito su un'immagine ingrandita la sposta; altrimenti scorre la pagina o il carosello.
      if (e.touches.length === 1 && !g.pinching && current.current.scale > 1) {
        e.preventDefault();
        const t = e.touches[0]!;
        const v = current.current;
        setView(clamp({ ...v, x: v.x + (t.clientX - g.lastX), y: v.y + (t.clientY - g.lastY) }));
        g.lastX = t.clientX;
        g.lastY = t.clientY;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) gesture.current = null;
      else if (e.touches.length === 1) {
        // Finito il pizzico, il dito rimasto non deve far "saltare" l'immagine.
        const t = e.touches[0]!;
        gesture.current = {
          startDist: 0,
          startScale: current.current.scale,
          lastX: t.clientX,
          lastY: t.clientY,
          pinching: false,
        };
      }
      if (current.current.scale < 1.02) setView(HOME);
    };

    // Computer: la rotella ingrandisce (con Ctrl o Cmd, come nei browser) e il doppio clic alterna.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const v = current.current;
      setView(
        clamp({
          ...v,
          scale: Math.max(1, Math.min(MAX_SCALE, v.scale * Math.exp(-e.deltaY / 200))),
        }),
      );
    };
    const onDouble = () => setView((v) => (v.scale > 1 ? HOME : clamp({ scale: 2.5, x: 0, y: 0 })));

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDouble);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDouble);
    };
  }, []);

  return (
    <div
      ref={box}
      className={cn(
        'flex max-h-full max-w-full items-center justify-center overflow-hidden',
        wrapperClassName,
      )}
    >
      <img
        {...img}
        draggable={false}
        className={cn('select-none', className)}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transition: gesture.current ? 'none' : 'transform 0.2s ease-out',
          ...img.style,
        }}
      />
    </div>
  );
}
