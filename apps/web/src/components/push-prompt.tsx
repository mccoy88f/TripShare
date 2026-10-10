import { Bell, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { usePush } from '@/lib/push';

const SNOOZE_KEY = 'tripshare.pushPromptUntil';

const snoozed = () => {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
};
const snooze = (days: number) => {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86_400_000));
  } catch {
    // ignorato: al peggio l'invito si ripropone
  }
};

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Invito ad attivare le notifiche del browser dopo l'accesso o l'installazione. Il permesso si
 * può chiedere solo da un tocco, quindi è un banner con un pulsante. Compare dopo l'invito a
 * installare, non si ripropone se rifiutato o ignorato (per qualche giorno) e non su iOS finché
 * l'app non è installata.
 */
export function PushPrompt() {
  const { t } = useTranslation();
  const push = usePush();
  const [open, setOpen] = useState(false);
  const eligible = push.status === 'off' && !snoozed();

  useEffect(() => {
    if (!eligible) return;
    // Installata: subito; nel browser si lascia prima spazio all'invito a installare.
    const timer = window.setTimeout(() => setOpen(true), standalone() ? 1500 : 13_000);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  // Attivate (qui o altrove) o bloccate: l'invito non serve più.
  useEffect(() => {
    if (push.status !== 'off') setOpen(false);
  }, [push.status]);

  if (!open) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-40 mx-auto max-w-sm overflow-hidden rounded-full border bg-card/95 shadow-md backdrop-blur lg:top-4 lg:right-4 lg:left-auto lg:mx-0"
    >
      <div className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-2.5">
        <Bell className="size-6 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm leading-tight font-medium">{t('push.promptTitle')}</p>
        <Button
          size="sm"
          className="h-8 shrink-0 rounded-full"
          disabled={push.busy}
          onClick={async () => {
            await push.enable();
            snooze(30);
            setOpen(false);
          }}
        >
          {t('push.promptEnable')}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label={t('common.close')}
          onClick={() => {
            snooze(14);
            setOpen(false);
          }}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
