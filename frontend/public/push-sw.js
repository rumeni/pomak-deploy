/* Push handling, imported into the generated service worker (vite-plugin-pwa importScripts).
   A notification carries only who did what and where it opens; never message text. */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/'
  event.waitUntil(self.registration.showNotification(data.title || 'POMAK', {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue
      await client.focus()
      if ('navigate' in client) await client.navigate(target).catch(() => undefined)
      return
    }
    await self.clients.openWindow(target)
  })())
})
