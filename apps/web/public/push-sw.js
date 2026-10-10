/*
 * Notifiche push: questo file viene caricato dal service worker dell'app (importScripts).
 * Riceve i messaggi del server, mostra la notifica e, al tocco, apre il viaggio giusto.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const show = async () => {
    // Con l'app in primo piano l'avviso compare già dentro l'app. Su iOS ogni push deve però
    // mostrare una notifica, altrimenti il sistema revoca l'iscrizione.
    const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!ios && open.some((c) => c.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'TripShare', {
      body: data.body || '',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      tag: data.tag,
      data: { url: data.url || '/app' },
    });
  };
  event.waitUntil(show());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/app',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('navigate' in client && 'focus' in client) {
          await client.focus();
          return client.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
