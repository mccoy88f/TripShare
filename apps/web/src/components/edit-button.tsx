import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** Matita che, nella scheda "Dettaglio", abilita la modifica. */
export function EditButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button type="button" size="lg" onClick={onClick} aria-label={t('common.edit')}>
      <Pencil />
      <span className="hidden sm:inline">{t('common.edit')}</span>
    </Button>
  );
}
