import type { ReactNode } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/confirm';
import { DIALOG_FOOTER } from '@/components/dialog-footer';
import { CloseButton, EditButton } from '@/components/edit-button';

/** Cestino (solo icona) delle schede di dettaglio: chiede conferma (se `confirm` è dato) e poi esegue `onDelete`. */
export function DeleteButton({
  confirm,
  onDelete,
  disabled,
  label,
}: {
  confirm?: string;
  onDelete: () => void | Promise<void>;
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? t('expense.delete');
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-destructive"
      aria-label={text}
      title={text}
      disabled={disabled}
      onClick={async () => {
        if (confirm && !(await confirmDialog(confirm))) return;
        await onDelete();
      }}
    >
      <Trash2 />
    </Button>
  );
}

/**
 * Barra in fondo alle schede di dettaglio: cestino, matita, ✨ a sinistra;
 * a destra "Chiudi" in sola lettura oppure "Salva".
 */
export function DetailFooter({
  readOnly,
  onEdit,
  remove,
  ask,
  pending,
  submitLabel,
  submitDisabled,
}: {
  readOnly: boolean;
  onEdit: () => void;
  /** Pulsante di eliminazione (di solito un `DeleteButton`); assente per gli elementi nuovi. */
  remove?: ReactNode;
  /** Pulsante "Chiedi a Nina", mostrato solo in sola lettura. */
  ask?: ReactNode;
  pending?: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
}) {
  return (
    <div className={DIALOG_FOOTER}>
      {remove}
      {readOnly && <EditButton onClick={onEdit} />}
      {readOnly && ask}
      <div className="flex-1" />
      {readOnly ? (
        <CloseButton />
      ) : (
        <Button type="submit" size="lg" disabled={pending || submitDisabled}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      )}
    </div>
  );
}
