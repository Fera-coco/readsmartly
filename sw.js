// ReadSmartly Service Worker — handles background push notifications
const CACHE_NAME = 'readsmartly-v1';

self.addEventListener('install', e => {
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(clients.claim());
});

// Handle push events from the server (Web Push API)
self.addEventListener('push', e => {
    let data = { title: 'ReadSmartly', body: 'You have a new notification.' };
    try { if (e.data) data = e.data.json(); } catch(_) {}
    e.waitUntil(
        self.registration.showNotification(data.title, {
            body:    data.body,
            icon:    '/favicon.ico',
            badge:   '/favicon.ico',
            tag:     data.tag || 'readsmartly',
            requireInteraction: data.requireInteraction || false,
            data:    data.url ? { url: data.url } : {},
        })
    );
});

// When user taps a notification, open or focus the app
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const url = e.notification.data?.url || '/home.html';
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            const existing = list.find(c => c.url.includes('home.html'));
            if (existing) return existing.focus();
            return clients.openWindow(url);
        })
    );
});
