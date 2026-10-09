import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

/**
 * Aggiornamenti dell'app: il service worker nuovo si attiva da solo e la pagina si ricarica.
 * Si controlla se c'è una nuova versione all'avvio, ogni 30 minuti e quando l'app torna in
 * primo piano (sul telefono una PWA resta aperta anche per giorni).
 */
export function PwaUpdater() {
  const { t } = useTranslation();
  const {
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => undefined);
      };
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    toast.success(t('app.offlineReady'));
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, t]);

  return null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Banner "Installa l'app" sui browser che supportano beforeinstallprompt. */
export function InstallBanner() {
  const { t } = useTranslation();
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('tripshare-install-dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!event || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('tripshare-install-dismissed', '1');
    } catch {
      // ignorato
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <img src="/favicon.svg" alt="" className="size-10 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('app.installTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('app.installText')}</p>
      </div>
      <Button
        size="sm"
        onClick={async () => {
          await event.prompt();
          await event.userChoice;
          setEvent(null);
        }}
      >
        <Download />
        {t('app.install')}
      </Button>
      <Button size="icon" variant="ghost" onClick={dismiss} aria-label={t('common.cancel')}>
        <X />
      </Button>
    </div>
  );
}
