/**
 * Serveur du plan financier — multi-utilisateur, zéro dépendance.
 * Fichiers statiques + API JSON protégée par session.
 */

import http from 'node:http';
import path from 'node:path';
import { readFile, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Base } from './db.js';
import {
  hacherMotDePasse, verifierMotDePasse, verificationFactice,
  creerJeton, empreinteJeton, dateExpiration, DUREE_SESSION_MS,
  validerEmail, validerMotDePasse, validerNom,
  autoriserTentative, enregistrerEchec, oublierEchecs,
  lireCookie, cookieSession, cookieEfface,
} from './auth.js';
import { normaliserState, stateInitial } from '../shared/model.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER_CLIENT = path.join(RACINE, 'client');
const DOSSIER_PARTAGE = path.join(RACINE, 'shared');
const DOSSIER_DONNEES = process.env.DATA_DIR || path.join(RACINE, 'data');
const PORT = Number(process.env.PORT) || 4173;
const HOTE = process.env.HOST || '127.0.0.1';
const TAILLE_MAX_CORPS = 8 * 1024 * 1024;
const DERRIERE_PROXY = process.env.TRUST_PROXY === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const base = new Base(path.join(DOSSIER_DONNEES, 'plan-financier.db'));

/** Plan de l'ancienne version mono-utilisateur, repris par le premier compte. */
let planHerite = null;
const FICHIER_HERITE = path.join(DOSSIER_DONNEES, 'plan-financier.json');

/* ------------------------------------------------------------------ *
 * Réponses
 * ------------------------------------------------------------------ */

function json(reponse, code, charge, entetes = {}) {
  const corps = JSON.stringify(charge);
  reponse.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(corps),
    'cache-control': 'no-store',
    ...entetes,
  });
  reponse.end(corps);
}

function lireCorps(requete) {
  return new Promise((resoudre, rejeter) => {
    const morceaux = [];
    let taille = 0;
    requete.on('data', (morceau) => {
      taille += morceau.length;
      if (taille > TAILLE_MAX_CORPS) {
        rejeter(Object.assign(new Error('Corps de requête trop volumineux'), { code: 413 }));
        requete.destroy();
        return;
      }
      morceaux.push(morceau);
    });
    requete.on('end', () => {
      const texte = Buffer.concat(morceaux).toString('utf8');
      if (!texte) return resoudre({});
      try {
        resoudre(JSON.parse(texte));
      } catch {
        rejeter(Object.assign(new Error('JSON invalide'), { code: 400 }));
      }
    });
    requete.on('error', rejeter);
  });
}

/* ------------------------------------------------------------------ *
 * Sécurité de transport
 * ------------------------------------------------------------------ */

const enHttps = (requete) => DERRIERE_PROXY && requete.headers['x-forwarded-proto'] === 'https';

function adresse(requete) {
  if (DERRIERE_PROXY) {
    const transmise = requete.headers['x-forwarded-for'];
    if (transmise) return String(transmise).split(',')[0].trim();
  }
  return requete.socket.remoteAddress ?? 'inconnue';
}

/**
 * Défense CSRF : une requête modifiante venue d'un autre site est refusée.
 * Les clients à jeton (application mobile) n'envoient pas de cookie et ne
 * sont donc pas concernés.
 */
function origineAcceptable(requete) {
  const origine = requete.headers.origin;
  if (!origine) return true; // pas de navigateur, ou navigation directe
  try {
    return new URL(origine).host === requete.headers.host;
  } catch {
    return false;
  }
}

function entetesSecurite(requete) {
  const entetes = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  };
  if (enHttps(requete)) entetes['strict-transport-security'] = 'max-age=15552000';
  return entetes;
}

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

function jetonDeLaRequete(requete) {
  const entete = requete.headers.authorization;
  if (entete?.startsWith('Bearer ')) return { jeton: entete.slice(7).trim(), parCookie: false };
  const cookie = lireCookie(requete.headers.cookie);
  return cookie ? { jeton: cookie, parCookie: true } : { jeton: null, parCookie: false };
}

/** Renvoie { utilisateur, parCookie } ou null. */
function authentifier(requete) {
  const { jeton, parCookie } = jetonDeLaRequete(requete);
  if (!jeton) return null;

  const empreinte = empreinteJeton(jeton);
  const utilisateur = base.utilisateurParSession(empreinte);
  if (!utilisateur) return null;

  // Un compte suspendu perd l'accès immédiatement, même session en cours.
  if (utilisateur.suspendu) {
    base.supprimerSession(empreinte);
    return null;
  }

  // Session glissante : on prolonge quand il reste moins d'un tiers du temps.
  const reste = new Date(utilisateur.expire_le).getTime() - Date.now();
  if (reste < DUREE_SESSION_MS / 3) base.prolongerSession(empreinte, dateExpiration());

  return { utilisateur, parCookie, empreinte };
}

const profilPublic = (utilisateur) => ({
  id: utilisateur.id,
  email: utilisateur.email,
  nom: utilisateur.nom,
  role: utilisateur.role,
  creeLe: utilisateur.cree_le,
});

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();

/** Crée la session et renvoie les en-têtes à poser. */
function ouvrirSession(requete, utilisateur) {
  const { jeton, empreinte } = creerJeton();
  const expireLe = dateExpiration();
  base.creerSession({
    jeton: empreinte,
    utilisateurId: utilisateur.id,
    expireLe,
    agent: requete.headers['user-agent'] ?? '',
  });
  return {
    jeton,
    entetes: { 'set-cookie': cookieSession(jeton, { securise: enHttps(requete), expireLe }) },
  };
}

/* ------------------------------------------------------------------ *
 * Routes d'authentification
 * ------------------------------------------------------------------ */

async function inscription(requete, reponse) {
  const corps = await lireCorps(requete);

  const email = validerEmail(corps.email);
  if (!email.ok) return json(reponse, 400, { erreur: email.erreur, champ: 'email' });

  const motDePasse = validerMotDePasse(corps.motDePasse);
  if (!motDePasse.ok) return json(reponse, 400, { erreur: motDePasse.erreur, champ: 'motDePasse' });

  if (base.utilisateurParEmail(email.valeur)) {
    return json(reponse, 409, { erreur: 'Un compte existe déjà avec cette adresse.', champ: 'email' });
  }

  const hash = await hacherMotDePasse(motDePasse.valeur);

  // Le tout premier compte administre l'instance. `ADMIN_EMAIL` permet de
  // désigner explicitement l'administrateur si l'ordre d'inscription varie.
  const estAdmin = base.compterUtilisateurs() === 0
    || (ADMIN_EMAIL !== '' && email.valeur === ADMIN_EMAIL);

  let utilisateur;
  try {
    utilisateur = base.creerUtilisateur({
      email: email.valeur,
      nom: validerNom(corps.nom),
      motDePasse: hash,
      role: estAdmin ? 'admin' : 'membre',
    });
  } catch (erreur) {
    // Course entre deux inscriptions simultanées : la contrainte UNIQUE tranche.
    if (String(erreur.message).includes('UNIQUE')) {
      return json(reponse, 409, { erreur: 'Un compte existe déjà avec cette adresse.', champ: 'email' });
    }
    throw erreur;
  }

  // Le tout premier compte hérite du plan de l'ancienne version mono-utilisateur.
  const planDepart = planHerite ?? stateInitial({ annee: new Date().getFullYear() });
  base.creerPlan(utilisateur.id, planDepart);
  if (planHerite) {
    planHerite = null;
    await rename(FICHIER_HERITE, `${FICHIER_HERITE}.importe`).catch(() => {});
    console.log(`[migration] plan repris par ${utilisateur.email}`);
  }

  const session = ouvrirSession(requete, utilisateur);
  oublierEchecs(`ip:${adresse(requete)}`);
  return json(reponse, 201, { utilisateur: profilPublic(utilisateur), jeton: session.jeton }, session.entetes);
}

async function connexion(requete, reponse) {
  const corps = await lireCorps(requete);
  const cleIp = `ip:${adresse(requete)}`;
  const cleEmail = `email:${String(corps.email ?? '').toLowerCase().trim()}`;

  for (const cle of [cleIp, cleEmail]) {
    const controle = autoriserTentative(cle);
    if (!controle.autorise) {
      const minutes = Math.ceil(controle.attendreMs / 60000);
      return json(reponse, 429, {
        erreur: `Trop de tentatives. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
      });
    }
  }

  const email = validerEmail(corps.email);
  const utilisateur = email.ok ? base.utilisateurParEmail(email.valeur) : null;

  // Même coût de calcul que l'adresse existe ou non : le temps de réponse
  // ne doit pas révéler quels comptes sont enregistrés.
  const valide = utilisateur
    ? await verifierMotDePasse(String(corps.motDePasse ?? ''), utilisateur.mot_de_passe)
    : await verificationFactice();

  if (!valide) {
    enregistrerEchec(cleIp);
    enregistrerEchec(cleEmail);
    return json(reponse, 401, { erreur: 'Adresse e-mail ou mot de passe incorrect.' });
  }

  if (utilisateur.suspendu) {
    // Le mot de passe était bon : inutile de compter ça comme une attaque.
    oublierEchecs(cleIp);
    oublierEchecs(cleEmail);
    return json(reponse, 403, { erreur: 'Ce compte a été suspendu. Contacte l’administrateur.' });
  }

  oublierEchecs(cleIp);
  oublierEchecs(cleEmail);
  base.marquerVu(utilisateur.id);

  const session = ouvrirSession(requete, utilisateur);
  return json(reponse, 200, { utilisateur: profilPublic(utilisateur), jeton: session.jeton }, session.entetes);
}

function deconnexion(requete, reponse, contexte) {
  if (contexte?.empreinte) base.supprimerSession(contexte.empreinte);
  return json(reponse, 200, { ok: true }, { 'set-cookie': cookieEfface({ securise: enHttps(requete) }) });
}

/* ------------------------------------------------------------------ *
 * Routes du plan (protégées)
 * ------------------------------------------------------------------ */

function lirePlanDe(utilisateur) {
  const plan = base.lirePlan(utilisateur.id);
  if (plan) return plan;
  // Filet : un compte sans plan (import interrompu) en reçoit un neuf.
  return base.creerPlan(utilisateur.id, stateInitial({ annee: new Date().getFullYear() }));
}

async function ecrirePlan(requete, reponse, utilisateur) {
  const corps = await lireCorps(requete);
  if (!corps || typeof corps.state !== 'object' || corps.state === null) {
    return json(reponse, 400, { erreur: 'Champ "state" manquant' });
  }
  const rev = Number.isInteger(corps.rev) ? corps.rev : null;
  const resultat = base.ecrirePlan(utilisateur.id, normaliserState(corps.state), rev);
  return json(reponse, resultat.conflit ? 409 : 200, resultat);
}

function exporter(reponse, utilisateur) {
  const { state } = lirePlanDe(utilisateur);
  const corps = JSON.stringify(state, null, 2);
  const nom = `plan-financier-${new Date().toISOString().slice(0, 10)}.json`;
  reponse.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="${nom}"`,
    'content-length': Buffer.byteLength(corps),
    'cache-control': 'no-store',
  });
  reponse.end(corps);
}

async function changerMotDePasse(requete, reponse, contexte) {
  const corps = await lireCorps(requete);
  const actuel = String(corps.actuel ?? '');
  const nouveau = validerMotDePasse(corps.nouveau);
  if (!nouveau.ok) return json(reponse, 400, { erreur: nouveau.erreur, champ: 'nouveau' });

  const complet = base.utilisateurParId(contexte.utilisateur.id);
  if (!await verifierMotDePasse(actuel, complet.mot_de_passe)) {
    return json(reponse, 401, { erreur: 'Mot de passe actuel incorrect.', champ: 'actuel' });
  }

  base.changerMotDePasse(complet.id, await hacherMotDePasse(nouveau.valeur));
  // Toutes les autres sessions tombent : c'est le but d'un changement de mot de passe.
  base.supprimerSessionsDe(complet.id);
  const session = ouvrirSession(requete, complet);
  return json(reponse, 200, { ok: true, jeton: session.jeton }, session.entetes);
}

async function supprimerCompte(requete, reponse, contexte) {
  const corps = await lireCorps(requete);
  const complet = base.utilisateurParId(contexte.utilisateur.id);
  if (!await verifierMotDePasse(String(corps.motDePasse ?? ''), complet.mot_de_passe)) {
    return json(reponse, 401, { erreur: 'Mot de passe incorrect.' });
  }
  base.supprimerUtilisateur(complet.id);
  return json(reponse, 200, { ok: true }, { 'set-cookie': cookieEfface({ securise: enHttps(requete) }) });
}

/* ------------------------------------------------------------------ *
 * Administration des comptes
 *
 * Ces routes gèrent les comptes — création, suspension, suppression, rôle.
 * Aucune ne donne accès au plan financier de qui que ce soit : le contenu
 * budgétaire reste privé, y compris pour l'administrateur.
 * ------------------------------------------------------------------ */

function listerComptes(reponse, moi) {
  const comptes = base.listerUtilisateurs().map((ligne) => ({
    id: ligne.id,
    email: ligne.email,
    nom: ligne.nom,
    role: ligne.role,
    suspendu: Boolean(ligne.suspendu),
    creeLe: ligne.cree_le,
    vuLe: ligne.vu_le,
    sessionsActives: ligne.sessions_actives,
    aUnPlan: Boolean(ligne.a_un_plan),
    moi: ligne.id === moi.id,
  }));
  return json(reponse, 200, { comptes, admins: base.compterAdmins() });
}

/** Récupère la cible d'une action d'administration, avec les refus évidents. */
function cibleAdmin(url, moi, { interdireSoi = false } = {}) {
  const id = Number(url.pathname.split('/')[4]);
  if (!Number.isInteger(id)) return { erreur: 'Identifiant invalide.', code: 400 };

  const compte = base.utilisateurParId(id);
  if (!compte) return { erreur: 'Ce compte n’existe pas.', code: 404 };
  if (interdireSoi && compte.id === moi.id) {
    return { erreur: 'Tu ne peux pas appliquer cette action à ton propre compte.', code: 400 };
  }
  return { compte };
}

/** Empêche de retirer le dernier administrateur actif — sinon plus personne n'administre. */
function resteUnAdmin(compte, { versRole = null, versSuspension = null }) {
  const etaitAdminActif = compte.role === 'admin' && !compte.suspendu;
  if (!etaitAdminActif) return true;
  const devientInactif = versRole === 'membre' || versSuspension === true;
  if (!devientInactif) return true;
  return base.compterAdmins() > 1;
}

async function gererAdmin(requete, reponse, url, moi) {
  const methode = requete.method;

  if (url.pathname === '/api/admin/comptes' && methode === 'GET') {
    return listerComptes(reponse, moi);
  }

  if (url.pathname.startsWith('/api/admin/comptes/') && methode === 'POST') {
    const action = url.pathname.split('/')[5];

    if (action === 'suspendre' || action === 'reactiver') {
      const suspendre = action === 'suspendre';
      const { compte, erreur, code } = cibleAdmin(url, moi, { interdireSoi: suspendre });
      if (erreur) return json(reponse, code, { erreur });
      if (!resteUnAdmin(compte, { versSuspension: suspendre })) {
        return json(reponse, 400, { erreur: 'Impossible : ce serait le dernier administrateur actif.' });
      }
      base.definirSuspension(compte.id, suspendre);
      return json(reponse, 200, { ok: true });
    }

    if (action === 'role') {
      const corps = await lireCorps(requete);
      const role = corps.role === 'admin' ? 'admin' : 'membre';
      const { compte, erreur, code } = cibleAdmin(url, moi);
      if (erreur) return json(reponse, code, { erreur });
      if (!resteUnAdmin(compte, { versRole: role })) {
        return json(reponse, 400, { erreur: 'Impossible : ce serait le dernier administrateur actif.' });
      }
      base.definirRole(compte.id, role);
      return json(reponse, 200, { ok: true });
    }

    if (action === 'sessions') {
      const { compte, erreur, code } = cibleAdmin(url, moi);
      if (erreur) return json(reponse, code, { erreur });
      base.supprimerSessionsDe(compte.id);
      return json(reponse, 200, { ok: true });
    }
  }

  if (url.pathname.startsWith('/api/admin/comptes/') && methode === 'DELETE') {
    const { compte, erreur, code } = cibleAdmin(url, moi, { interdireSoi: true });
    if (erreur) return json(reponse, code, { erreur });
    if (!resteUnAdmin(compte, { versSuspension: true })) {
      return json(reponse, 400, { erreur: 'Impossible : ce serait le dernier administrateur actif.' });
    }
    base.supprimerUtilisateur(compte.id);
    return json(reponse, 200, { ok: true });
  }

  return json(reponse, 404, { erreur: 'Route inconnue' });
}

/* ------------------------------------------------------------------ *
 * Routage de l'API
 * ------------------------------------------------------------------ */

const ROUTES_PUBLIQUES = new Set(['POST /api/inscription', 'POST /api/connexion']);

async function gererApi(requete, reponse, url) {
  const cle = `${requete.method} ${url.pathname}`;

  // Toute écriture doit venir de notre propre origine et annoncer du JSON.
  if (requete.method !== 'GET' && requete.method !== 'HEAD') {
    if (!origineAcceptable(requete)) {
      return json(reponse, 403, { erreur: 'Origine non autorisée.' });
    }
    const type = requete.headers['content-type'] ?? '';
    if (type && !type.includes('application/json')) {
      return json(reponse, 415, { erreur: 'Le corps doit être du JSON.' });
    }
  }

  // Contrôle de santé de l'hébergeur : volontairement muet sur le contenu.
  if (cle === 'GET /api/sante') return json(reponse, 200, { ok: true });

  if (cle === 'POST /api/inscription') return inscription(requete, reponse);
  if (cle === 'POST /api/connexion') return connexion(requete, reponse);

  const contexte = authentifier(requete);

  if (cle === 'POST /api/deconnexion') return deconnexion(requete, reponse, contexte);

  if (!contexte) {
    if (ROUTES_PUBLIQUES.has(cle)) return json(reponse, 404, { erreur: 'Route inconnue' });
    return json(reponse, 401, { erreur: 'Connexion requise.' });
  }

  const { utilisateur } = contexte;

  if (cle === 'GET /api/moi') {
    return json(reponse, 200, { utilisateur: profilPublic(utilisateur) });
  }
  if (cle === 'GET /api/state') {
    return json(reponse, 200, lirePlanDe(utilisateur));
  }
  if (cle === 'PUT /api/state') {
    return ecrirePlan(requete, reponse, utilisateur);
  }
  if (cle === 'GET /api/export') {
    return exporter(reponse, utilisateur);
  }
  if (cle === 'GET /api/sauvegardes') {
    return json(reponse, 200, { sauvegardes: base.listerSauvegardes(utilisateur.id) });
  }
  if (cle === 'POST /api/mot-de-passe') {
    return changerMotDePasse(requete, reponse, contexte);
  }
  if (cle === 'POST /api/compte/supprimer') {
    return supprimerCompte(requete, reponse, contexte);
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (utilisateur.role !== 'admin') {
      // 404 plutôt que 403 : inutile de confirmer l'existence d'un volet d'admin.
      return json(reponse, 404, { erreur: 'Route inconnue' });
    }
    return gererAdmin(requete, reponse, url, utilisateur);
  }

  return json(reponse, 404, { erreur: 'Route inconnue' });
}

/* ------------------------------------------------------------------ *
 * Fichiers statiques
 * ------------------------------------------------------------------ */

function resoudreFichier(chemin) {
  let decode;
  try {
    decode = decodeURIComponent(chemin.split('?')[0]);
  } catch {
    return null;
  }
  if (decode.includes('\0')) return null;

  const relatif = decode === '/' ? '/index.html' : decode;
  const versPartage = relatif.startsWith('/shared/');
  const base_ = versPartage ? DOSSIER_PARTAGE : DOSSIER_CLIENT;
  const sousChemin = versPartage ? relatif.slice('/shared/'.length) : relatif.slice(1);
  const cible = path.resolve(base_, sousChemin);
  return cible === base_ || cible.startsWith(base_ + path.sep) ? cible : null;
}

async function servirStatique(requete, reponse, chemin) {
  const fichier = resoudreFichier(chemin);
  const securite = entetesSecurite(requete);

  if (!fichier) {
    reponse.writeHead(403, securite).end('Accès refusé');
    return;
  }

  try {
    const infos = await stat(fichier);
    if (!infos.isFile()) throw new Error('pas un fichier');

    const extension = path.extname(fichier);
    const immuable = extension === '.woff2';
    const etag = `"${infos.size.toString(16)}-${infos.mtimeMs.toString(16)}"`;
    const cache = immuable ? 'public, max-age=31536000, immutable' : 'no-cache';

    if (requete.headers['if-none-match'] === etag) {
      reponse.writeHead(304, { ...securite, etag, 'cache-control': cache });
      reponse.end();
      return;
    }

    reponse.writeHead(200, {
      ...securite,
      'content-type': TYPES[extension] ?? 'application/octet-stream',
      'content-length': infos.size,
      etag,
      'last-modified': new Date(infos.mtimeMs).toUTCString(),
      'cache-control': cache,
    });
    reponse.end(requete.method === 'HEAD' ? undefined : await readFile(fichier));
  } catch {
    // Application mono-page : toute route inconnue retombe sur index.html.
    if (!path.extname(fichier)) {
      const html = await readFile(path.join(DOSSIER_CLIENT, 'index.html'));
      reponse.writeHead(200, { ...securite, 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
      reponse.end(html);
      return;
    }
    reponse.writeHead(404, { ...securite, 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
  }
}

/* ------------------------------------------------------------------ *
 * Serveur
 * ------------------------------------------------------------------ */

const serveur = http.createServer(async (requete, reponse) => {
  const url = new URL(requete.url, `http://${requete.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await gererApi(requete, reponse, url);
      return;
    }
    if (requete.method !== 'GET' && requete.method !== 'HEAD') {
      return json(reponse, 405, { erreur: 'Méthode non autorisée' });
    }
    await servirStatique(requete, reponse, url.pathname);
  } catch (erreur) {
    console.error('[serveur]', erreur);
    if (!reponse.headersSent) json(reponse, erreur.code ?? 500, { erreur: erreur.message });
    else reponse.end();
  }
});

/* ------------------------------------------------------------------ *
 * Démarrage
 * ------------------------------------------------------------------ */

async function reprendreAncienPlan() {
  if (!existsSync(FICHIER_HERITE)) return;
  if (base.compterUtilisateurs() > 0) return; // des comptes existent déjà : on ne touche à rien
  try {
    const brut = JSON.parse(await readFile(FICHIER_HERITE, 'utf8'));
    planHerite = normaliserState(brut.state ?? brut);
    console.log('  Un plan de l’ancienne version a été trouvé : le premier compte créé le récupérera.');
  } catch (erreur) {
    console.error(`[migration] fichier illisible, ignoré : ${erreur.message}`);
  }
}

const purge = setInterval(() => {
  try {
    base.purgerSessionsExpirees();
  } catch (erreur) {
    console.error('[purge]', erreur.message);
  }
}, 60 * 60 * 1000);
purge.unref();

await reprendreAncienPlan();

serveur.listen(PORT, HOTE, () => {
  console.log(`\n  Plan financier — http://${HOTE}:${PORT}`);
  console.log(`  Base : ${path.join(DOSSIER_DONNEES, 'plan-financier.db')}`);
  console.log(`  Comptes enregistrés : ${base.compterUtilisateurs()}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    serveur.close(() => {
      base.fermer();
      process.exit(0);
    });
  });
}
