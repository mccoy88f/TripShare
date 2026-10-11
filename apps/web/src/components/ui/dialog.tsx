import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  useEffect,
  useRef,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;

/** Finestra modale: foglio dal basso su mobile, scheda centrata su desktop. */
export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: ReactNode; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** Altezza del foglio senza ingrandimento (si misura quando si inizia a trascinare). */
  const natural = useRef(0);
  const drag = useRef<{
    startY: number;
    baseH: number;
    lastY: number;
    lastT: number;
    v: number;
  } | null>(null);

  // Maniglia in alto (solo mobile): trascinando in su il foglio si alza, in giù si abbassa e,
  // oltre la sua altezza normale, si chiude. Un tocco alterna normale e alto.
  const maxHeight = () => Math.round((window.visualViewport?.height ?? window.innerHeight) * 0.94);
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!el.style.height) natural.current = el.offsetHeight;
    el.style.transition = 'none';
    drag.current = {
      startY: e.clientY,
      baseH: el.offsetHeight,
      lastY: e.clientY,
      lastT: performance.now(),
      v: 0,
    };
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const now = performance.now();
    d.v = (e.clientY - d.lastY) / Math.max(1, now - d.lastT);
    d.lastY = e.clientY;
    d.lastT = now;
    const proposed = d.baseH + (d.startY - e.clientY);
    if (proposed >= natural.current) {
      el.style.height = `${Math.min(proposed, maxHeight())}px`;
      el.style.transform = '';
    } else {
      el.style.height = `${natural.current}px`;
      el.style.transform = `translateY(${natural.current - proposed}px)`;
    }
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = 'transform 0.2s ease, height 0.2s ease';
    const moved = Math.abs(e.clientY - d.startY);
    const down = Number(/translateY\(([\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);
    if (moved < 5) {
      // Tocco: alterna altezza normale e massima.
      const expanded = el.offsetHeight > natural.current + 8;
      el.style.height = expanded ? '' : `${maxHeight()}px`;
    } else if (down > 110 || (down > 30 && d.v > 0.6)) {
      closeRef.current?.click();
    } else {
      el.style.transform = '';
      if (el.offsetHeight <= natural.current + 8) el.style.height = '';
    }
  };
  // Con la tastiera aperta (iOS e alcuni Android la sovrappongono alla pagina) il foglio
  // segue l'area davvero visibile, così i pulsanti in fondo non finiscono sotto la tastiera.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport;
    const editable = (t: EventTarget | null): t is HTMLElement =>
      t instanceof HTMLElement &&
      (t.matches('textarea, [contenteditable="true"]') ||
        (t instanceof HTMLInputElement &&
          !['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color'].includes(t.type)));
    // Il campo toccato si porta al centro dell'area visibile, sopra la tastiera.
    let timers: number[] = [];
    const reveal = (target: HTMLElement) => {
      timers.forEach((id) => window.clearTimeout(id));
      // La tastiera impiega un attimo ad aprirsi: si ripete quando ha finito.
      timers = [60, 350].map((ms) =>
        window.setTimeout(() => {
          if (target.isConnected && document.activeElement === target)
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, ms),
      );
    };
    const onFocusIn = (e: FocusEvent) => editable(e.target) && reveal(e.target);
    el.addEventListener('focusin', onFocusIn);

    // Con la tastiera aperta (iOS e alcuni Android la sovrappongono alla pagina) il foglio
    // segue l'area davvero visibile, così i pulsanti in fondo non finiscono sotto la tastiera.
    const fit = () => {
      if (!vv) return;
      if (window.innerWidth >= 640) {
        el.style.bottom = '';
        el.style.maxHeight = '';
        return;
      }
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.bottom = `${covered}px`;
      el.style.maxHeight = `${Math.round(vv.height * 0.94)}px`;
      const active = document.activeElement;
      if (editable(active) && el.contains(active)) reveal(active);
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      el.removeEventListener('focusin', onFocusIn);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
    };
  }, []);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[1.75rem] border bg-card shadow-2xl outline-none',
          'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          className="flex shrink-0 cursor-grab touch-none items-center justify-center pt-2.5 pb-1.5 active:cursor-grabbing sm:hidden"
        >
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-start gap-3 px-5 pt-4 pb-2 sm:px-6 sm:pt-6">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            ref={closeRef}
            className="-mt-1 -mr-2 rounded-full p-2 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
