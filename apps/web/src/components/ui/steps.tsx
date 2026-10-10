import { ChevronLeft, ChevronRight, Loader2, Pencil } from 'lucide-react';
import {
  Children,
  isValidElement,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DIALOG_FOOTER } from '@/components/dialog-footer';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface StepProps {
  title: string;
  children: ReactNode;
}

/** Un passaggio di `StepForm`. */
export function Step({ children }: StepProps) {
  return <>{children}</>;
}

/**
 * Modulo diviso in 2-3 passaggi, per non avere fogli dal basso lunghissimi. Tutti i passaggi
 * restano montati (lo stato non si perde); "Avanti" controlla i campi obbligatori del passaggio.
 * In modifica (`freeNavigation`) si può saltare direttamente a qualsiasi passaggio.
 */
export function StepForm({
  onSubmit,
  submitLabel,
  submitDisabled,
  pending,
  leading,
  freeNavigation = false,
  readOnly = false,
  onEdit,
  className,
  children,
}: {
  onSubmit: (e: FormEvent) => void;
  submitLabel: ReactNode;
  submitDisabled?: boolean;
  pending?: boolean;
  /** Azioni a sinistra del piè di pagina (es. elimina). */
  leading?: ReactNode;
  freeNavigation?: boolean;
  /** Modalità "dettaglio": campi non modificabili e matita al posto di "Salva". */
  readOnly?: boolean;
  onEdit?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const steps = Children.toArray(children).filter(isValidElement) as ReactElement<StepProps>[];
  const [index, setIndex] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const last = index === steps.length - 1;

  const invalidField = (i: number) =>
    [
      ...(refs.current[i]?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input, select, textarea') ?? []),
    ].find((f) => !f.checkValidity());
  /** Mostra il primo campo non valido del passaggio corrente. */
  const valid = () => {
    const field = invalidField(index);
    field?.reportValidity();
    return !field;
  };
  const go = (next: number) => {
    if (next > index && !readOnly && !valid()) return;
    setIndex(next);
    refs.current[next]?.closest('.overflow-y-auto')?.scrollTo({ top: 0 });
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        if (!last) {
          e.preventDefault();
          go(index + 1);
          return;
        }
        if (readOnly) {
          e.preventDefault();
          return;
        }
        // Controllo di tutti i passaggi: si torna al primo con un campo da correggere.
        const wrong = steps.findIndex((_, i) => invalidField(i));
        if (wrong >= 0) {
          e.preventDefault();
          setIndex(wrong);
          setTimeout(() => invalidField(wrong)?.reportValidity(), 0);
          return;
        }
        onSubmit(e);
      }}
      className={cn('grid grid-cols-1 gap-5 pt-1', className)}
    >
      {steps.length > 1 && (
        <ol className="flex items-center gap-1.5" aria-label={t('steps.label')}>
          {steps.map((s, i) => (
            <li key={i} className="flex min-w-0 flex-1 items-center gap-1.5">
              <button
                type="button"
                disabled={!freeNavigation && i > index}
                onClick={() => (freeNavigation || i < index ? go(i) : undefined)}
                aria-current={i === index ? 'step' : undefined}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-full px-1 py-1 text-left text-xs font-semibold transition',
                  i === index ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px]',
                    i === index
                      ? 'bg-primary text-primary-foreground'
                      : i < index
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted',
                  )}
                >
                  {i + 1}
                </span>
                <span className="truncate">{s.props.title}</span>
              </button>
              {i < steps.length - 1 && <span className="h-px w-3 shrink-0 bg-border" />}
            </li>
          ))}
        </ol>
      )}
      {steps.map((s, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          hidden={i !== index}
        >
          <fieldset disabled={readOnly} className="m-0 grid min-w-0 grid-cols-1 gap-5 border-0 p-0">
            {s}
          </fieldset>
        </div>
      ))}
      <div className={DIALOG_FOOTER}>
        {leading}
        {readOnly && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onEdit}
            aria-label={t('common.edit')}
            title={t('common.edit')}
          >
            <Pencil />
          </Button>
        )}
        <div className="flex-1" />
        {index > 0 && (
          <Button type="button" variant="ghost" onClick={() => go(index - 1)}>
            <ChevronLeft />
            {t('steps.back')}
          </Button>
        )}
        {last && readOnly ? (
          <DialogClose asChild>
            <Button key="close" type="button" size="lg">
              {t('common.close')}
            </Button>
          </DialogClose>
        ) : last ? (
          <Button key="save" type="submit" size="lg" disabled={pending || submitDisabled}>
            {pending && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        ) : (
          <Button key="next" type="submit" size="lg">
            {t('steps.next')}
            <ChevronRight />
          </Button>
        )}
      </div>
    </form>
  );
}
