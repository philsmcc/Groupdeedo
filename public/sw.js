// Groupdeedo Service Worker for PWA functionality
const CACHE_NAME = 'groupdeedo-v1';
const urlsToCache = [
    '/',
    '/styles.css',
    '/app.js',
    '/groupdeedo-app-icon.png',
    '/manifest.json'
];

// Install event - cache essential resources
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request)
            .then(function(response) {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                return fetch(event.request);
            }
        )
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Handle background sync for offline message queuing
self.addEventListener('sync', function(event) {
    if (event.tag === 'background-sync') {
        console.log('Background sync triggered');
    }
});

// Handle push notifications (for future use)
self.addEventListener('push', function(event) {
    const title = 'Groupdeedo';
    const options = {
        body: event.data ? event.data.text() : 'New message available',
        icon: '/groupdeedo-app-icon.png',
        badge: '/groupdeedo-app-icon.png',
        tag: 'groupdeedo-notification'
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});