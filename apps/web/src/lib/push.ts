import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useTRPC } from './trpc';

export type PushStatus =
  /** Il browser non supporta le notifiche push. */
  | 'unsupported'
  /** iPhone/iPad: servono l'app installata nella schermata Home. */
  | 'ios-install'
  /** L'utente ha bloccato le notifiche nelle impostazioni del browser. */
  | 'denied'
  | 'off'
  | 'on';

function urlBase64ToUint8Array(base64: string) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Notifiche push di questo dispositivo: stato, attivazione, disattivazione e prova. */
export function usePush() {
  const trpc = useTRPC();
  const config = useQuery({ ...trpc.push.config.queryOptions(), staleTime: 60_000 });
  const subscribe = useMutation(trpc.push.subscribe.mutationOptions());
  const unsubscribe = useMutation(trpc.push.unsubscribe.mutationOptions());
  const test = useMutation(trpc.push.test.mutationOptions());
  const [status, setStatus] = useState<PushStatus>('off');
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported()) return setStatus(isIos() ? 'ios-install' : 'unsupported');
    if (Notification.permission === 'denied') return setStatus('denied');
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setStatus(sub && Notification.permission === 'granted' ? 'on' : 'off');
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Va chiamata da un gesto dell'utente (tocco): chiede il permesso e iscrive il dispositivo. */
  const enable = async () => {
    setError(false);
    try {
      const publicKey = config.data?.publicKey ?? (await config.refetch()).data?.publicKey;
      if (!publicKey) throw new Error('NO_KEY');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return await refresh();
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const json = sub.toJSON();
      await subscribe.mutateAsync({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        userAgent: navigator.userAgent.slice(0, 300),
      });
      await config.refetch();
    } catch {
      setError(true);
    }
    await refresh();
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await unsubscribe.mutateAsync({ endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
    await config.refetch();
    await refresh();
  };

  return {
    status,
    error,
    busy: subscribe.isPending || unsubscribe.isPending,
    enable,
    disable,
    test: () => test.mutateAsync(),
    testing: test.isPending,
    /** Quanti dispositivi dell'utente hanno le notifiche attive. */
    devices: config.data?.devices ?? 0,
  };
}
