import { Download, Share, X } from 'lucide-react';
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

const HIDE_KEY = 'tripshare-install-hidden-until';
const VISIBLE_MS = 10_000;
const TIP_MS = 15_000;
const DAY = 86_400_000;

const hiddenNow = () => {
  try {
    return Number(localStorage.getItem(HIDE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
};
const hideFor = (days: number) => {
  try {
    localStorage.setItem(HIDE_KEY, String(Date.now() + days * DAY));
  } catch {
    // ignorato
  }
};

/** iPhone e iPad (anche iPadOS che si presenta come Mac) in Safari, non ancora installata. */
const isIosBrowser = () => {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
};

/**
 * Invito a installare l'app, fluttuante in alto sotto l'intestazione e che sparisce da solo
 * dopo 10 secondi. Android e computer (Chrome, Edge) offrono l'installazione con un pulsante;
 * su iOS non esiste, quindi si spiega come fare dal menu Condividi di Safari.
 */
export function InstallBanner() {
  const { t } = useTranslation();
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios] = useState(isIosBrowser);
  const [open, setOpen] = useState(false);
  // Su iOS: dopo il tocco si apre il menu Condividi e il banner spiega cosa scegliere.
  const [iosTip, setIosTip] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const available = (!!event || ios) && !hiddenNow();
  useEffect(() => {
    if (available) setOpen(true);
  }, [available]);
  useEffect(() => {
    if (!open) return;
    // Sparita da sola: non si ripropone per qualche giorno.
    const timer = window.setTimeout(
      () => {
        hideFor(3);
        setOpen(false);
      },
      iosTip ? TIP_MS : VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, iosTip]);

  if (!open) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-40 mx-auto max-w-sm overflow-hidden rounded-full border bg-card/95 shadow-md backdrop-blur lg:top-4 lg:right-4 lg:left-auto lg:mx-0"
    >
      <div className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-2.5">
        <img src="/favicon.svg" alt="" className="size-7 shrink-0 rounded-lg" />
        <p className="min-w-0 flex-1 text-sm leading-tight font-medium">
          {iosTip ? t('app.installIosTip') : t('app.installTitle')}
        </p>
        {(event || ios) && !iosTip && (
          <Button
            size="icon"
            className="size-8 shrink-0"
            title={t('app.install')}
            aria-label={t('app.install')}
            onClick={async () => {
              if (event) {
                await event.prompt();
                await event.userChoice;
                setEvent(null);
                setOpen(false);
                return;
              }
              // iOS non ha un'installazione da codice: si apre il menu Condividi di Safari,
              // dove c'è «Aggiungi alla schermata Home», e il banner lo ricorda.
              setIosTip(true);
              try {
                await navigator.share?.({ title: 'TripShare', url: location.origin });
              } catch {
                // chiuso senza scegliere: il suggerimento resta visibile
              }
            }}
          >
            {event ? <Download /> : <Share />}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          onClick={() => {
            hideFor(30);
            setOpen(false);
          }}
          aria-label={t('common.close')}
        >
          <X />
        </Button>
      </div>
      <div className="h-0.5 bg-muted">
        <div
          key={String(iosTip)}
          className="install-progress h-full bg-primary"
          style={{ animationDuration: `${(iosTip ? TIP_MS : VISIBLE_MS) / 1000}s` }}
        />
      </div>
    </div>
  );
}
