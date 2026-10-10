import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
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
  // Con la tastiera aperta (iOS e alcuni Android la sovrappongono alla pagina) il foglio
  // segue l'area davvero visibile, così i pulsanti in fondo non finiscono sotto la tastiera.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;
    const fit = () => {
      if (window.innerWidth >= 640) {
        el.style.bottom = '';
        el.style.maxHeight = '';
        return;
      }
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.bottom = `${covered}px`;
      el.style.maxHeight = `${Math.round(vv.height * 0.94)}px`;
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
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
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-muted sm:hidden" />
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
            className="-mt-1 -mr-2 rounded-full p-2 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
