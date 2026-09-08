/*
 * Flow's service worker. It exists for one thing: showing a push notification
 * when the tab is closed, and taking the person to the right place when they
 * tap it. No caching, no offline — the app is live data, and a stale board
 * is worse than a loading one.
 */

self.addEventListener('push', (event) => {
  let data = { title: 'Flow', body: '', url: '/workspace', tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data ? event.data.text() : '';
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag,
      data: { url: data.url },
      // One notification per task rather than a pile of near-duplicates.
      renotify: Boolean(data.tag),
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/workspace';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse a Flow tab that is already open rather than spawning another.
      for (const client of list) {
        if ('focus' in client && new URL(client.url).origin === self.location.origin) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
