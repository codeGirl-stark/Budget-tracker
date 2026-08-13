/**
 * Base de données. Le test qui compte vraiment ici est celui de l'isolation :
 * personne ne doit pouvoir lire ni écraser le plan de quelqu'un d'autre.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Base } from '../server/db.js';
import { stateInitial } from '../shared/model.js';

const neuve = () => new Base(':memory:');

const inscrire = (base, email) => base.creerUtilisateur({
  email,
  nom: email.split('@')[0],
  motDePasse: `empreinte-de-${email}`,
});

/* ---------------------------------------------------------------- *
 * Utilisateurs
 * ---------------------------------------------------------------- */

test('un compte se crée et se retrouve par e-mail', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  assert.ok(awa.id);
  assert.equal(base.utilisateurParEmail('awa@example.sn').id, awa.id);
  assert.equal(base.compterUtilisateurs(), 1);
  base.fermer();
});

test('l’e-mail est unique, insensible à la casse', () => {
  const base = neuve();
  inscrire(base, 'awa@example.sn');
  assert.throws(() => inscrire(base, 'AWA@example.sn'), /UNIQUE/i);
  assert.equal(base.compterUtilisateurs(), 1);
  base.fermer();
});

test('la recherche par e-mail ignore la casse', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  assert.equal(base.utilisateurParEmail('AWA@EXAMPLE.SN')?.id, awa.id);
  base.fermer();
});

test('un e-mail inconnu ne renvoie rien plutôt que de lever', () => {
  const base = neuve();
  assert.equal(base.utilisateurParEmail('personne@example.sn'), null);
  assert.equal(base.utilisateurParId(999), null);
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Isolation — le test central
 * ---------------------------------------------------------------- */

test('le plan d’un compte est invisible et intouchable depuis un autre', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  const moussa = inscrire(base, 'moussa@example.sn');

  const planAwa = stateInitial({ annee: 2026, revenu: 400000 });
  planAwa.years['2026'].months['0'].categories.loisirs.entries = [
    { id: 'a1', label: 'SECRET AWA', montant: 12345 },
  ];
  base.creerPlan(awa.id, planAwa);
  base.creerPlan(moussa.id, stateInitial({ annee: 2026, revenu: 250000 }));

  const luParMoussa = base.lirePlan(moussa.id);
  assert.equal(luParMoussa.state.years['2026'].months['0'].categories.loisirs.entries.length, 0);
  assert.equal(luParMoussa.state.years['2026'].months['0'].revenus[0].montant, 250000);

  // Moussa écrit chez lui : rien ne doit bouger chez Awa.
  const sien = luParMoussa.state;
  sien.years['2026'].months['0'].categories.loisirs.entries = [{ id: 'm1', label: 'MOUSSA', montant: 1 }];
  base.ecrirePlan(moussa.id, sien, luParMoussa.rev);

  const relu = base.lirePlan(awa.id);
  assert.equal(relu.state.years['2026'].months['0'].categories.loisirs.entries[0].label, 'SECRET AWA');
  base.fermer();
});

test('un compte sans plan renvoie null, pas le plan d’un autre', () => {
  const base = neuve();
  inscrire(base, 'awa@example.sn');
  const moussa = inscrire(base, 'moussa@example.sn');
  base.creerPlan(1, stateInitial({ annee: 2026 }));
  assert.equal(base.lirePlan(moussa.id), null);
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Écriture concurrente
 * ---------------------------------------------------------------- */

test('une écriture fondée sur une version périmée est refusée', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  base.creerPlan(awa.id, stateInitial({ annee: 2026 }));

  const onglet = base.lirePlan(awa.id); // les deux onglets lisent rev 1

  const recent = structuredClone(onglet.state);
  recent.currency = 'EUR';
  const premier = base.ecrirePlan(awa.id, recent, onglet.rev);
  assert.equal(premier.conflit, false);
  assert.equal(premier.rev, 2);

  const perime = structuredClone(onglet.state);
  perime.currency = 'USD';
  const second = base.ecrirePlan(awa.id, perime, onglet.rev); // toujours rev 1
  assert.equal(second.conflit, true, 'le conflit est signalé');
  assert.equal(second.rev, 2);

  assert.equal(base.lirePlan(awa.id).state.currency, 'EUR', 'la version récente survit');
  base.fermer();
});

test('sans numéro de version, l’écriture passe en force', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  base.creerPlan(awa.id, stateInitial({ annee: 2026 }));
  const state = base.lirePlan(awa.id).state;
  state.currency = 'USD';
  assert.equal(base.ecrirePlan(awa.id, state, null).conflit, false);
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Historique
 * ---------------------------------------------------------------- */

test('chaque écriture archive la version précédente', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  base.creerPlan(awa.id, stateInitial({ annee: 2026 }));

  let courant = base.lirePlan(awa.id);
  for (const devise of ['EUR', 'USD', 'MAD']) {
    const state = structuredClone(courant.state);
    state.currency = devise;
    base.ecrirePlan(awa.id, state, courant.rev);
    courant = base.lirePlan(awa.id);
  }

  const sauvegardes = base.listerSauvegardes(awa.id);
  assert.equal(sauvegardes.length, 3);
  assert.equal(base.lireSauvegarde(awa.id, sauvegardes[0].id).state.currency, 'USD', 'l’avant-dernière version');
  base.fermer();
});

test('l’historique ne dépasse pas vingt versions', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  base.creerPlan(awa.id, stateInitial({ annee: 2026 }));

  for (let i = 0; i < 30; i += 1) {
    const courant = base.lirePlan(awa.id);
    const state = structuredClone(courant.state);
    state.revenuMensuelDefaut = 400000 + i;
    base.ecrirePlan(awa.id, state, courant.rev);
  }
  assert.equal(base.listerSauvegardes(awa.id).length, 20);
  base.fermer();
});

test('on ne lit pas la sauvegarde d’un autre compte', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  const moussa = inscrire(base, 'moussa@example.sn');
  base.creerPlan(awa.id, stateInitial({ annee: 2026 }));

  const courant = base.lirePlan(awa.id);
  const state = structuredClone(courant.state);
  state.currency = 'EUR';
  base.ecrirePlan(awa.id, state, courant.rev);

  const [sauvegarde] = base.listerSauvegardes(awa.id);
  assert.ok(sauvegarde, 'Awa a bien une sauvegarde');
  assert.equal(base.lireSauvegarde(moussa.id, sauvegarde.id), null, 'Moussa ne peut pas la lire');
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Sessions
 * ---------------------------------------------------------------- */

test('une session valide identifie son propriétaire', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  base.creerSession({
    jeton: 'empreinte-a',
    utilisateurId: awa.id,
    expireLe: new Date(Date.now() + 60000).toISOString(),
    agent: 'test',
  });
  assert.equal(base.utilisateurParSession('empreinte-a').id, awa.id);
  assert.equal(base.utilisateurParSession('empreinte-inconnue'), null);
  base.fermer();
});

test('une session expirée ne vaut plus rien et disparaît', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  base.creerSession({
    jeton: 'perimee',
    utilisateurId: awa.id,
    expireLe: new Date(Date.now() - 1000).toISOString(),
    agent: '',
  });
  assert.equal(base.utilisateurParSession('perimee'), null);
  assert.equal(base.utilisateurParSession('perimee'), null, 'et elle a été purgée');
  base.fermer();
});

test('changer de mot de passe permet de couper toutes les sessions', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  const futur = new Date(Date.now() + 60000).toISOString();
  base.creerSession({ jeton: 'tel', utilisateurId: awa.id, expireLe: futur, agent: '' });
  base.creerSession({ jeton: 'ordi', utilisateurId: awa.id, expireLe: futur, agent: '' });

  base.supprimerSessionsDe(awa.id);
  assert.equal(base.utilisateurParSession('tel'), null);
  assert.equal(base.utilisateurParSession('ordi'), null);
  base.fermer();
});

test('la purge ne touche que les sessions expirées', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  base.creerSession({ jeton: 'vivante', utilisateurId: awa.id, expireLe: new Date(Date.now() + 60000).toISOString(), agent: '' });
  base.creerSession({ jeton: 'morte', utilisateurId: awa.id, expireLe: new Date(Date.now() - 60000).toISOString(), agent: '' });

  assert.equal(base.purgerSessionsExpirees(), 1);
  assert.ok(base.utilisateurParSession('vivante'));
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Suppression de compte
 * ---------------------------------------------------------------- */

test('supprimer un compte emporte son plan, ses sessions et son historique', () => {
  const base = neuve();
  const awa = inscrire(base, 'awa@example.sn');
  const moussa = inscrire(base, 'moussa@example.sn');
  base.creerPlan(awa.id, stateInitial({ annee: 2026 }));
  base.creerPlan(moussa.id, stateInitial({ annee: 2026 }));
  base.creerSession({ jeton: 'j', utilisateurId: awa.id, expireLe: new Date(Date.now() + 60000).toISOString(), agent: '' });

  const courant = base.lirePlan(awa.id);
  base.ecrirePlan(awa.id, courant.state, courant.rev); // crée une sauvegarde

  base.supprimerUtilisateur(awa.id);

  assert.equal(base.utilisateurParId(awa.id), null);
  assert.equal(base.lirePlan(awa.id), null);
  assert.equal(base.utilisateurParSession('j'), null);
  assert.equal(base.listerSauvegardes(awa.id).length, 0);

  assert.ok(base.lirePlan(moussa.id), 'le compte voisin est intact');
  base.fermer();
});
