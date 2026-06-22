// Push handlers, imported into the Workbox-generated service worker via
// vite-plugin-pwa's `workbox.importScripts` (see astro.config.mjs). Kept as a
// plain JS file in public/ so it ships verbatim and runs in the SW scope.
//
// Expected push payload (JSON):
//   { "title": "...", "body": "...", "url": "/stock/SM", "ticker": "SM" }

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'ArciStocks PH', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'ArciStocks PH';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.ticker || 'arcistocks',
    data: { url: data.url || '/dashboard' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if one is already open, else open a new one.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
