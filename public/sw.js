// Service worker de CAMILOREY — solo existe para recibir
// notificaciones push del navegador cuando el sitio no está abierto.
// No cachea nada más (no es un service worker de "app offline").

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'CAMILOREY', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'CAMILOREY';
  const options = {
    body: payload.body || '',
    tag: payload.tag || undefined,
    // Con el mismo tag, renotify:true hace que el navegador REEMPLACE
    // el aviso anterior de ese partido (con sonido/vibración de nuevo)
    // en vez de apilar uno nuevo al lado — sin esto, seguir un partido
    // de principio a fin dejaba 4-5 notificaciones sueltas.
    renotify: Boolean(payload.tag),
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    // Solo Android/Chrome respeta este patrón (ms: vibra, pausa, vibra) —
    // en iOS/desktop el navegador simplemente lo ignora sin romper nada.
    vibrate: [200, 100, 200],
    data: { url: payload.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Al hacer click en la notificación, enfoca una pestaña ya abierta del
// sitio si existe, o abre una nueva.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
