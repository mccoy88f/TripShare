import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomImage } from '@/components/zoom-image';
import { cn } from '@/lib/utils';

export interface ViewerSlide {
  key: string;
  src: string;
  /** Immagine di riserva se `src` non si carica. */
  fallback?: string;
  alt?: string;
}

/** Pulsante tondo sul nero, come nel visualizzatore dei ricordi. */
export const viewerButton =
  'rounded-full bg-black/50 p-2.5 text-white backdrop-blur hover:bg-black/70 [&_svg]:size-5';

/**
 * Swipe in giù per chiudere un visualizzatore a schermo intero: la schermata segue il dito e si
 * chiude se si è scesi abbastanza (o con un gesto veloce), altrimenti torna su. Non parte con
 * due dita, con l'immagine ingrandita (lì il dito la sposta) né con un gesto orizzontale (che
 * scorre tra le immagini).
 */
/** Restituisce la funzione da passare come `ref` all'elemento a schermo intero. */
export function useSwipeDownClose(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  // L'elemento arriva dopo il primo render (il portale si monta più tardi): si tiene nello stato.
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;
    let mode: 'none' | 'down' | 'other' = 'none';
    let dy = 0;
    let v = 0;
    let last = { y: 0, t: 0 };
    const reset = (animate: boolean) => {
      el.style.transition = animate ? 'transform 0.2s ease, opacity 0.2s ease' : '';
      el.style.transform = '';
      el.style.opacity = '';
    };
    const onStart = (e: TouchEvent) => {
      const zoomed = (e.target as HTMLElement | null)?.closest('[data-zoomed="true"]');
      if (e.touches.length !== 1 || zoomed) {
        start = null;
        return;
      }
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY, t: performance.now() };
      last = { y: t.clientY, t: start.t };
      mode = 'none';
      dy = 0;
      v = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) {
        if (mode === 'down') reset(true);
        start = null;
        return;
      }
      const t = e.touches[0]!;
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (mode === 'none' && (Math.abs(mx) > 8 || Math.abs(my) > 8))
        mode = my > 0 && Math.abs(my) > Math.abs(mx) ? 'down' : 'other';
      if (mode !== 'down') return;
      e.preventDefault();
      const now = performance.now();
      v = (t.clientY - last.y) / Math.max(1, now - last.t);
      last = { y: t.clientY, t: now };
      dy = Math.max(0, my);
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      el.style.opacity = String(Math.max(0.3, 1 - dy / 500));
    };
    const onEnd = () => {
      if (mode === 'down') {
        if (dy > 120 || (dy > 40 && v > 0.6)) close.current();
        else reset(true);
      }
      start = null;
      mode = 'none';
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [el]);
  return setEl;
}

/**
 * Anteprima a schermo intero di una o più immagini, con lo stesso aspetto di quella dei ricordi:
 * fondo nero, barra in alto con titolo, contatore e pulsanti, scorrimento di lato, zoom a pizzico
 * e frecce su computer. Il contenuto della barra e del piede lo decide chi la usa.
 */
export function ImageViewer({
  slides,
  index,
  onIndex,
  onClose,
  title,
  subtitle,
  actions,
  footer,
  loadingMore,
  hasMore,
}: {
  slides: ViewerSlide[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Pulsanti in alto, prima della chiusura. */
  actions?: ReactNode;
  /** Testo o pulsanti in basso, sulla foto in vista. */
  footer?: ReactNode;
  /** Si stanno caricando altre immagini / ce ne possono essere altre (il contatore mostra "+"). */
  loadingMore?: boolean;
  hasMore?: boolean;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useSwipeDownClose(onClose);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const scrollTo = (i: number, behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior });
  };
  // All'apertura si parte dall'immagine scelta.
  useLayoutEffect(() => {
    scrollTo(index, 'instant');
    // solo al montaggio
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < slides.length) {
      onIndex(next);
      scrollTo(next);
    }
  };
  const settle = useRef<number | undefined>(undefined);
  const onScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      if (i !== index && i >= 0 && i < slides.length) onIndex(i);
    }, 80);
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={frame}
          className="fixed inset-0 z-50 bg-black text-white outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {subtitle ?? title}
          </DialogPrimitive.Description>
          <div
            ref={scroller}
            onScroll={onScroll}
            className="flex h-dvh snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {slides.map((s, i) => (
              <div
                key={s.key}
                className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center"
              >
                {Math.abs(i - index) <= 2 && (
                  <ZoomImage
                    src={failed.has(s.key) && s.fallback ? s.fallback : s.src}
                    alt={s.alt ?? ''}
                    referrerPolicy="no-referrer"
                    onError={() => setFailed((f) => new Set(f).add(s.key))}
                    wrapperClassName="h-full w-full"
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </div>
            ))}
            {slides.length === 0 && (
              <div className="grid h-full w-full place-items-center">
                {loadingMore ? <Loader2 className="animate-spin text-white/70" /> : null}
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <div className="pointer-events-auto min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{title}</p>
              <p className="flex items-center gap-1.5 truncate text-xs text-white/75">
                {subtitle}
                {slides.length > 0 && (
                  <span className={cn(subtitle && 'ml-1')}>
                    {index + 1} / {slides.length}
                    {hasMore && '+'}
                  </span>
                )}
                {loadingMore && slides.length > 0 && <Loader2 className="size-3 animate-spin" />}
              </p>
            </div>
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className={cn(viewerButton, 'pointer-events-auto')}
            >
              <X />
            </button>
          </div>

          {index > 0 && (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t('common.back')}
              className={cn(
                viewerButton,
                'absolute top-1/2 left-3 hidden -translate-y-1/2 sm:block',
              )}
            >
              <ChevronLeft />
            </button>
          )}
          {index < slides.length - 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t('steps.next')}
              className={cn(
                viewerButton,
                'absolute top-1/2 right-3 hidden -translate-y-1/2 sm:block',
              )}
            >
              <ChevronRight />
            </button>
          )}

          {footer && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/75 to-transparent p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="pointer-events-auto min-w-0 flex-1 text-sm">{footer}</div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
