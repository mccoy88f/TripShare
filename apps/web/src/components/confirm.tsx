import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Testo del pulsante di conferma; di default "Elimina" o "Conferma". */
  confirmLabel?: string;
  /** Pulsante rosso per le azioni distruttive (default true). */
  destructive?: boolean;
  /** Se presente, l'utente deve scrivere questo testo per confermare. */
  typeToConfirm?: string;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Chiede conferma con il modale dell'app al posto di window.confirm.
 * Restituisce true se l'utente conferma.
 */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { title: options } : options;
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { destructive: true, ...opts, resolve };
    emit();
  });
}

function close(ok: boolean) {
  current?.resolve(ok);
  current = null;
  emit();
}

/** Da montare una volta nella radice dell'app. */
export function ConfirmHost() {
  const pending = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return pending ? <ConfirmModal key={pending.title} pending={pending} /> : null;
}

function ConfirmModal({ pending }: { pending: Pending }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const blocked =
    pending.typeToConfirm !== undefined && typed.trim() !== pending.typeToConfirm.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && close(false)}>
      <DialogContent title={pending.title} description={pending.description}>
        <form
          className="grid grid-cols-1 gap-4 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) close(true);
          }}
        >
          {pending.typeToConfirm !== undefined && (
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={pending.typeToConfirm}
              aria-label={t('common.typeToConfirm', { text: pending.typeToConfirm })}
            />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant={pending.destructive ? 'destructive' : 'default'}
              disabled={blocked}
              autoFocus={pending.typeToConfirm === undefined}
            >
              {pending.confirmLabel ??
                (pending.destructive ? t('common.delete') : t('common.confirm'))}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
