import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';

/** Matita (solo icona) che, nella scheda "Dettaglio", abilita la modifica. */
export function EditButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      aria-label={t('common.edit')}
      title={t('common.edit')}
    >
      <Pencil />
    </Button>
  );
}

/** "Chiudi" della scheda "Dettaglio": prende il posto di "Salva". */
export function CloseButton() {
  const { t } = useTranslation();
  return (
    <DialogClose asChild>
      <Button type="button" size="lg">
        {t('common.close')}
      </Button>
    </DialogClose>
  );
}
