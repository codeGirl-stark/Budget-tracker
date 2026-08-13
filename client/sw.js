/**
 * Service worker — installation sur l'écran d'accueil et consultation hors-ligne.
 *
 * Règle non négociable : **rien de /api/ n'est mis en cache.** Les montants
 * doivent toujours venir du serveur, et un cache de données financières
 * traînerait sur l'appareil après une déconnexion.
 *
 * Pour le reste, on est « réseau d'abord » : en ligne, on sert toujours la
 * dernière version du code ; hors-ligne, on retombe sur la dernière connue.
 */

const VERSION = 'v1';
const CACHE_COQUE = `plan-financier-coque-${VERSION}`;
const CACHE_DURABLE = `plan-financier-durable-${VERSION}`;

/** Ce qu'il faut pour afficher quelque chose sans réseau. */
const COQUE = [
  '/',
  '/styles.css',
  '/fonts.css',
  '/app.js',
  '/etat.js',
  '/session.js',
  '/lib/dom.js',
  '/lib/format.js',
  '/lib/composants.js',
  '/lib/graphiques.js',
  '/vues/connexion.js',
  '/vues/tableau-bord.js',
  '/vues/budget.js',
  '/vues/fonds.js',
  '/vues/grand-livre.js',
  '/vues/reglages.js',
  '/shared/model.js',
  '/shared/categories.js',
  '/app.webmanifest',
];

/** Ressources qui ne changent pas : on les garde sans revalider. */
const estDurable = (url) => url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icones/');

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE_COQUE)
      // `reload` : on ne veut pas peupler le cache depuis le cache HTTP.
      .then((cache) => cache.addAll(COQUE.map((chemin) => new Request(chemin, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()), // une ressource manquante ne doit pas bloquer l'installation
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(
      noms
        .filter((nom) => nom.startsWith('plan-financier-') && nom !== CACHE_COQUE && nom !== CACHE_DURABLE)
        .map((nom) => caches.delete(nom)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;

  // Les données ne passent jamais par le cache.
  if (url.pathname.startsWith('/api/')) return;

  if (estDurable(url)) {
    evenement.respondWith(cacheDAbord(requete, CACHE_DURABLE));
    return;
  }

  evenement.respondWith(reseauDAbord(requete));
});

async function cacheDAbord(requete, nomCache) {
  const cache = await caches.open(nomCache);
  const enCache = await cache.match(requete);
  if (enCache) return enCache;

  const reponse = await fetch(requete);
  if (reponse.ok) cache.put(requete, reponse.clone());
  return reponse;
}

async function reseauDAbord(requete) {
  const cache = await caches.open(CACHE_COQUE);
  try {
    const reponse = await fetch(requete);
    if (reponse.ok) cache.put(requete, reponse.clone());
    return reponse;
  } catch (erreur) {
    const enCache = await cache.match(requete);
    if (enCache) return enCache;

    // Navigation hors-ligne vers une route inconnue : on sert la coque.
    if (requete.mode === 'navigate') {
      const racine = await cache.match('/');
      if (racine) return racine;
    }
    throw erreur;
  }
}

/** Permet à la page de forcer la bascule vers un nouveau worker. */
self.addEventListener('message', (evenement) => {
  if (evenement.data === 'passer-au-suivant') self.skipWaiting();
});
