/**
 * Authentification — uniquement des primitives natives de Node.
 *
 * Choix retenus, et pourquoi :
 *  - scrypt : coûteux en mémoire, donc coûteux à attaquer par GPU. Fourni par
 *    `node:crypto`, pas besoin de bcrypt ni d'argon2 en dépendance.
 *  - jeton opaque aléatoire, stocké **haché** en base : une fuite de la base
 *    ne permet pas de rejouer les sessions.
 *  - comparaisons à temps constant partout où l'on compare un secret.
 */

import {
  scrypt, randomBytes, timingSafeEqual, createHash,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/* Paramètres scrypt : 16384 × 8 × 1 ≈ 16 Mo par calcul. */
const N = 16384;
const R = 8;
const P = 1;
const LONGUEUR_CLE = 64;
const MAXMEM = 64 * 1024 * 1024;

export const DUREE_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
export const LONGUEUR_MOT_DE_PASSE_MIN = 10;

/* ------------------------------------------------------------------ *
 * Mots de passe
 * ------------------------------------------------------------------ */

/** Format stocké : scrypt$N$r$p$sel$empreinte — tout est relu depuis la chaîne. */
export async function hacherMotDePasse(motDePasse) {
  const sel = randomBytes(16);
  const cle = await scryptAsync(motDePasse.normalize('NFKC'), sel, LONGUEUR_CLE, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${sel.toString('base64')}$${cle.toString('base64')}`;
}

export async function verifierMotDePasse(motDePasse, stocke) {
  try {
    const [algo, n, r, p, selB64, empreinteB64] = String(stocke).split('$');
    if (algo !== 'scrypt') return false;

    const sel = Buffer.from(selB64, 'base64');
    const attendu = Buffer.from(empreinteB64, 'base64');
    const calcule = await scryptAsync(
      motDePasse.normalize('NFKC'),
      sel,
      attendu.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM },
    );
    return attendu.length === calcule.length && timingSafeEqual(attendu, calcule);
  } catch {
    return false;
  }
}

/**
 * Consomme le même temps qu'une vérification réelle, pour ne pas révéler
 * qu'une adresse est inconnue par la simple vitesse de la réponse.
 */
export async function verificationFactice() {
  await scryptAsync('mot de passe factice', randomBytes(16), LONGUEUR_CLE, { N, r: R, p: P, maxmem: MAXMEM });
  return false;
}

/* ------------------------------------------------------------------ *
 * Jetons de session
 * ------------------------------------------------------------------ */

/** Le client reçoit `jeton`, la base ne connaît que `empreinte`. */
export function creerJeton() {
  const jeton = randomBytes(32).toString('base64url');
  return { jeton, empreinte: empreinteJeton(jeton) };
}

export function empreinteJeton(jeton) {
  return createHash('sha256').update(String(jeton)).digest('hex');
}

export function dateExpiration(depuis = Date.now()) {
  return new Date(depuis + DUREE_SESSION_MS).toISOString();
}

/* ------------------------------------------------------------------ *
 * Validation des saisies
 * ------------------------------------------------------------------ */

const MOTIF_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validerEmail(brut) {
  const email = String(brut ?? '').trim().toLowerCase();
  if (!email) return { ok: false, erreur: 'L’adresse e-mail est obligatoire.' };
  if (email.length > 254) return { ok: false, erreur: 'Cette adresse e-mail est trop longue.' };
  if (!MOTIF_EMAIL.test(email)) return { ok: false, erreur: 'Cette adresse e-mail ne semble pas valide.' };
  return { ok: true, valeur: email };
}

export function validerMotDePasse(brut) {
  const motDePasse = String(brut ?? '');
  if (motDePasse.length < LONGUEUR_MOT_DE_PASSE_MIN) {
    return { ok: false, erreur: `Le mot de passe doit faire au moins ${LONGUEUR_MOT_DE_PASSE_MIN} caractères.` };
  }
  if (motDePasse.length > 200) {
    return { ok: false, erreur: 'Le mot de passe est trop long (200 caractères maximum).' };
  }
  return { ok: true, valeur: motDePasse };
}

export function validerNom(brut) {
  return String(brut ?? '').trim().slice(0, 80);
}

/* ------------------------------------------------------------------ *
 * Limitation des tentatives
 *
 * En mémoire : suffisant pour une instance unique, et remis à zéro au
 * redémarrage. Si l'application passe un jour sur plusieurs instances, ce
 * compteur devra vivre en base.
 * ------------------------------------------------------------------ */

const FENETRE_MS = 15 * 60 * 1000;
const MAX_TENTATIVES = 8;
const tentatives = new Map();

function nettoyer(maintenant) {
  for (const [cle, entree] of tentatives) {
    if (entree.jusqua < maintenant) tentatives.delete(cle);
  }
}

/** `true` si la clé (IP ou e-mail) a droit à un nouvel essai. */
export function autoriserTentative(cle) {
  const maintenant = Date.now();
  if (tentatives.size > 5000) nettoyer(maintenant);

  const entree = tentatives.get(cle);
  if (!entree || entree.jusqua < maintenant) return { autorise: true, restantes: MAX_TENTATIVES };
  if (entree.compte >= MAX_TENTATIVES) {
    return { autorise: false, attendreMs: entree.jusqua - maintenant, restantes: 0 };
  }
  return { autorise: true, restantes: MAX_TENTATIVES - entree.compte };
}

export function enregistrerEchec(cle) {
  const maintenant = Date.now();
  const entree = tentatives.get(cle);
  if (!entree || entree.jusqua < maintenant) {
    tentatives.set(cle, { compte: 1, jusqua: maintenant + FENETRE_MS });
    return;
  }
  entree.compte += 1;
  entree.jusqua = maintenant + FENETRE_MS; // fenêtre glissante : l'acharnement prolonge le blocage
}

export function oublierEchecs(cle) {
  tentatives.delete(cle);
}

/* ------------------------------------------------------------------ *
 * Cookie de session
 * ------------------------------------------------------------------ */

const NOM_COOKIE = 'pf_session';

export function lireCookie(entete, nom = NOM_COOKIE) {
  if (!entete) return null;
  for (const morceau of entete.split(';')) {
    const separateur = morceau.indexOf('=');
    if (separateur === -1) continue;
    if (morceau.slice(0, separateur).trim() === nom) {
      return decodeURIComponent(morceau.slice(separateur + 1).trim());
    }
  }
  return null;
}

export function cookieSession(jeton, { securise, expireLe }) {
  const parties = [
    `${NOM_COOKIE}=${encodeURIComponent(jeton)}`,
    'Path=/',
    'HttpOnly',              // inaccessible au JavaScript : une faille XSS ne vole pas la session
    'SameSite=Lax',          // le cookie ne part pas sur une requête déclenchée par un autre site
    `Expires=${new Date(expireLe).toUTCString()}`,
    `Max-Age=${Math.floor(DUREE_SESSION_MS / 1000)}`,
  ];
  if (securise) parties.push('Secure');
  return parties.join('; ');
}

export function cookieEfface({ securise }) {
  const parties = [`${NOM_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (securise) parties.push('Secure');
  return parties.join('; ');
}

export { NOM_COOKIE };
