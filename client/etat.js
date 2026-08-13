/**
 * État client : une seule source de vérité, sauvegardée toute seule.
 * L'utilisatrice ne doit jamais avoir à cliquer sur « Enregistrer ».
 */

import { normaliserState } from '/shared/model.js';
import { ErreurAuthentification } from './session.js';

const DELAI_SAUVEGARDE = 500;

let state = null;
let rev = 0;
let minuterie = null;
let sauvegardeEnCours = null;
let sale = false;

const abonnes = new Set();
const observateursStatut = new Set();

let statut = { code: 'pret', texte: 'Prêt' };

/* ------------------------------------------------------------------ *
 * Lecture
 * ------------------------------------------------------------------ */

export const lire = () => state;
export const revision = () => rev;
export const statutSauvegarde = () => statut;

/* ------------------------------------------------------------------ *
 * Abonnements
 * ------------------------------------------------------------------ */

/** Abonnement au contenu : déclenche un re-rendu de la vue courante. */
export function abonner(rappel) {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

/** Abonnement au seul indicateur de sauvegarde (pas de re-rendu de vue). */
export function abonnerStatut(rappel) {
  observateursStatut.add(rappel);
  rappel(statut);
  return () => observateursStatut.delete(rappel);
}

function notifier() {
  for (const rappel of abonnes) rappel(state);
}

function poserStatut(code, texte) {
  statut = { code, texte };
  for (const rappel of observateursStatut) rappel(statut);
}

/* ------------------------------------------------------------------ *
 * Chargement
 * ------------------------------------------------------------------ */

export async function charger() {
  const reponse = await fetch('/api/state', {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (reponse.status === 401) throw new ErreurAuthentification();
  if (!reponse.ok) throw new Error(`Chargement impossible (HTTP ${reponse.status})`);
  const charge = await reponse.json();
  state = normaliserState(charge.state);
  rev = Number.isInteger(charge.rev) ? charge.rev : 0;
  return state;
}

/** Remet le module à zéro à la déconnexion — sinon le plan suivant hériterait du précédent. */
export function reinitialiser() {
  clearTimeout(minuterie);
  state = null;
  rev = 0;
  sale = false;
  sauvegardeEnCours = null;
  poserStatut('pret', 'Prêt');
}

/** Appelé quand le serveur ne reconnaît plus la session pendant une sauvegarde. */
let surSessionPerdue = () => {};
export function auSessionPerdue(rappel) {
  surSessionPerdue = rappel;
}

/* ------------------------------------------------------------------ *
 * Mutation
 * ------------------------------------------------------------------ */

/**
 * Applique une modification et planifie la sauvegarde.
 * `rendu: false` quand l'appelant redessine lui-même (saisie en cours dans
 * un champ : on ne veut pas lui arracher le focus à chaque frappe).
 */
export function muter(modification, { rendu = true } = {}) {
  if (!state) return;
  const resultat = modification(state);
  if (resultat === false) return; // la modification a renoncé
  sale = true;
  if (rendu) notifier();
  planifier();
}

function planifier() {
  poserStatut('modifie', 'Modifications en cours…');
  clearTimeout(minuterie);
  minuterie = setTimeout(() => { sauvegarder(); }, DELAI_SAUVEGARDE);
}

/** Force l'écriture immédiate (changement de vue, fermeture d'onglet). */
export async function vider() {
  clearTimeout(minuterie);
  if (sale) await sauvegarder();
  else if (sauvegardeEnCours) await sauvegardeEnCours;
}

async function sauvegarder() {
  if (sauvegardeEnCours) {
    // Une écriture est déjà partie : on réessaiera juste après.
    await sauvegardeEnCours;
    if (sale) planifier();
    return;
  }
  if (!sale || !state) return;

  sale = false;
  poserStatut('enregistrement', 'Enregistrement…');
  const instantane = state;

  sauvegardeEnCours = (async () => {
    try {
      const reponse = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ state: instantane, rev }),
      });

      if (reponse.status === 401) {
        // Session expirée : on garde la modification en mémoire et on
        // renvoie vers la connexion plutôt que de perdre la saisie.
        sale = true;
        poserStatut('erreur', 'Session expirée — reconnecte-toi');
        surSessionPerdue();
        return;
      }

      const charge = await reponse.json().catch(() => ({}));

      if (reponse.status === 409 || charge.conflit) {
        // Un autre onglet a écrit entre-temps. On reprend sa version :
        // écraser en silence ferait perdre des données saisies ailleurs.
        state = normaliserState(charge.state);
        rev = charge.rev;
        sale = false;
        poserStatut('conflit', 'Rechargé depuis une autre fenêtre');
        notifier();
        return;
      }
      if (!reponse.ok) throw new Error(charge.erreur ?? `HTTP ${reponse.status}`);

      rev = charge.rev;
      poserStatut('enregistre', `Enregistré à ${horodatage()}`);
    } catch (erreur) {
      sale = true; // rien n'est perdu : on retentera
      poserStatut('erreur', `Non enregistré — ${erreur.message}`);
    } finally {
      sauvegardeEnCours = null;
    }
  })();

  await sauvegardeEnCours;
}

function horodatage() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------------ *
 * Sauvegarde / restauration manuelle (§8)
 * ------------------------------------------------------------------ */

export function telechargerExport() {
  const contenu = JSON.stringify(state, null, 2);
  const lien = document.createElement('a');
  const url = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
  lien.href = url;
  lien.download = `plan-financier-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Remplace l'état par un fichier importé (après confirmation côté appelant). */
export function importer(brut) {
  const candidat = normaliserState(brut?.state ?? brut);
  if (!candidat.years || Object.keys(candidat.years).length === 0) {
    throw new Error('Ce fichier ne contient aucune année exploitable.');
  }
  state = candidat;
  sale = true;
  notifier();
  planifier();
  return state;
}

/* ------------------------------------------------------------------ *
 * Filet de sécurité : on n'attend pas le débounce pour quitter la page.
 * ------------------------------------------------------------------ */

addEventListener('pagehide', () => {
  if (!sale || !state) return;
  clearTimeout(minuterie);
  fetch('/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, rev }),
    keepalive: true,
  }).catch(() => {});
});

addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && sale) sauvegarder();
});
