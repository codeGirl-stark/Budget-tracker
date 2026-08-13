/**
 * Administration des comptes.
 *
 * Deux promesses sont testées ici :
 *  1. un administrateur gère les comptes ;
 *  2. il ne peut pas lire les finances des autres — la couche d'accès aux
 *     données n'offre aucune méthode pour ça, et ce test le verrouille.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Base } from '../server/db.js';
import { stateInitial } from '../shared/model.js';

const neuve = () => new Base(':memory:');

const inscrire = (base, email, role = 'membre') => base.creerUtilisateur({
  email, nom: email.split('@')[0], motDePasse: 'empreinte', role,
});

/* ---------------------------------------------------------------- *
 * Rôles
 * ---------------------------------------------------------------- */

test('un compte est membre par défaut', () => {
  const base = neuve();
  assert.equal(inscrire(base, 'a@test.sn').role, 'membre');
  base.fermer();
});

test('un rôle inconnu retombe sur membre', () => {
  const base = neuve();
  assert.equal(inscrire(base, 'a@test.sn', 'superviseur').role, 'membre');
  base.fermer();
});

test('le rôle se change dans les deux sens', () => {
  const base = neuve();
  const a = inscrire(base, 'a@test.sn');
  base.definirRole(a.id, 'admin');
  assert.equal(base.utilisateurParId(a.id).role, 'admin');
  base.definirRole(a.id, 'membre');
  assert.equal(base.utilisateurParId(a.id).role, 'membre');
  base.fermer();
});

test('les administrateurs actifs se comptent, les suspendus ne comptent pas', () => {
  const base = neuve();
  const a = inscrire(base, 'a@test.sn', 'admin');
  inscrire(base, 'b@test.sn', 'admin');
  inscrire(base, 'c@test.sn');
  assert.equal(base.compterAdmins(), 2);

  base.definirSuspension(a.id, true);
  assert.equal(base.compterAdmins(), 1, 'un admin suspendu n’administre plus rien');
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Suspension
 * ---------------------------------------------------------------- */

test('suspendre coupe toutes les sessions ouvertes', () => {
  const base = neuve();
  const a = inscrire(base, 'a@test.sn');
  const futur = new Date(Date.now() + 60000).toISOString();
  base.creerSession({ jeton: 'tel', utilisateurId: a.id, expireLe: futur, agent: '' });
  base.creerSession({ jeton: 'ordi', utilisateurId: a.id, expireLe: futur, agent: '' });

  base.definirSuspension(a.id, true);

  assert.equal(base.utilisateurParSession('tel'), null);
  assert.equal(base.utilisateurParSession('ordi'), null);
  assert.equal(base.utilisateurParId(a.id).suspendu, 1);
  base.fermer();
});

test('suspendre ne détruit pas le plan — il est rendu à la réactivation', () => {
  const base = neuve();
  const a = inscrire(base, 'a@test.sn');
  const plan = stateInitial({ annee: 2026 });
  plan.years['2026'].months['0'].categories.loisirs.entries = [
    { id: 'x', label: 'À RETROUVER', montant: 4200 },
  ];
  base.creerPlan(a.id, plan);

  base.definirSuspension(a.id, true);
  base.definirSuspension(a.id, false);

  const relu = base.lirePlan(a.id);
  assert.equal(relu.state.years['2026'].months['0'].categories.loisirs.entries[0].label, 'À RETROUVER');
  assert.equal(base.utilisateurParId(a.id).suspendu, 0);
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Liste des comptes — ce qu'elle expose, et surtout ce qu'elle n'expose pas
 * ---------------------------------------------------------------- */

test('la liste des comptes ne contient aucune donnée financière', () => {
  const base = neuve();
  const admin = inscrire(base, 'admin@test.sn', 'admin');
  const membre = inscrire(base, 'membre@test.sn');

  base.creerPlan(admin.id, stateInitial({ annee: 2026 }));
  const planMembre = stateInitial({ annee: 2026, revenu: 777777 });
  planMembre.years['2026'].months['0'].categories.loisirs.entries = [
    { id: 'x', label: 'SECRET-DU-MEMBRE', montant: 98765 },
  ];
  base.creerPlan(membre.id, planMembre);

  const serialise = JSON.stringify(base.listerUtilisateurs());

  assert.equal(serialise.includes('SECRET-DU-MEMBRE'), false);
  assert.equal(serialise.includes('98765'), false);
  assert.equal(serialise.includes('777777'), false);
  assert.equal(serialise.includes('categories'), false);
  assert.equal(serialise.includes('revenus'), false);
  base.fermer();
});

test('la liste des comptes ne laisse pas fuiter les mots de passe', () => {
  const base = neuve();
  base.creerUtilisateur({ email: 'a@test.sn', nom: 'A', motDePasse: 'scrypt$EMPREINTE-SENSIBLE' });
  const serialise = JSON.stringify(base.listerUtilisateurs());
  assert.equal(serialise.includes('EMPREINTE-SENSIBLE'), false);
  assert.equal(serialise.includes('mot_de_passe'), false);
  base.fermer();
});

test('la liste expose bien ce qui sert à gérer un compte', () => {
  const base = neuve();
  const a = inscrire(base, 'a@test.sn', 'admin');
  base.creerPlan(a.id, stateInitial({ annee: 2026 }));
  base.creerSession({
    jeton: 'j', utilisateurId: a.id, expireLe: new Date(Date.now() + 60000).toISOString(), agent: '',
  });

  const [ligne] = base.listerUtilisateurs();
  assert.equal(ligne.email, 'a@test.sn');
  assert.equal(ligne.role, 'admin');
  assert.equal(ligne.suspendu, 0);
  assert.equal(ligne.sessions_actives, 1);
  assert.equal(ligne.a_un_plan, 1);
  assert.ok(ligne.cree_le);
  base.fermer();
});

test('les sessions expirées ne sont pas comptées comme actives', () => {
  const base = neuve();
  const a = inscrire(base, 'a@test.sn');
  base.creerSession({ jeton: 'vieille', utilisateurId: a.id, expireLe: new Date(Date.now() - 1000).toISOString(), agent: '' });
  assert.equal(base.listerUtilisateurs()[0].sessions_actives, 0);
  base.fermer();
});

test('les comptes sont listés du plus ancien au plus récent', () => {
  const base = neuve();
  inscrire(base, 'premier@test.sn');
  inscrire(base, 'second@test.sn');
  const emails = base.listerUtilisateurs().map((l) => l.email);
  assert.deepEqual(emails, ['premier@test.sn', 'second@test.sn']);
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Suppression
 * ---------------------------------------------------------------- */

test('supprimer un compte n’atteint jamais le voisin', () => {
  const base = neuve();
  const a = inscrire(base, 'a@test.sn', 'admin');
  const b = inscrire(base, 'b@test.sn');
  base.creerPlan(a.id, stateInitial({ annee: 2026 }));
  base.creerPlan(b.id, stateInitial({ annee: 2026 }));

  base.supprimerUtilisateur(b.id);

  assert.equal(base.utilisateurParId(b.id), null);
  assert.equal(base.lirePlan(b.id), null);
  assert.ok(base.lirePlan(a.id), 'le compte restant garde son plan');
  assert.equal(base.compterUtilisateurs(), 1);
  base.fermer();
});

/* ---------------------------------------------------------------- *
 * Migration d'une base créée avant l'ajout des rôles
 * ---------------------------------------------------------------- */

test('une base antérieure aux rôles se met à jour toute seule', () => {
  // On simule l'ancien schéma, puis on rouvre avec la classe actuelle.
  const fichier = path.join(tmpdir(), `pf-migration-${process.pid}.db`);
  const ancienne = new DatabaseSync(fichier);
  ancienne.prepare(`CREATE TABLE utilisateurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nom TEXT NOT NULL DEFAULT '',
    mot_de_passe TEXT NOT NULL,
    cree_le TEXT NOT NULL,
    vu_le TEXT)`).run();
  ancienne.prepare('INSERT INTO utilisateurs (email, nom, mot_de_passe, cree_le) VALUES (?,?,?,?)')
    .run('ancien@test.sn', 'Ancien', 'empreinte', new Date().toISOString());
  ancienne.close();

  const base = new Base(fichier);
  const compte = base.utilisateurParEmail('ancien@test.sn');
  assert.ok(compte, 'le compte existant survit à la migration');
  assert.equal(compte.role, 'membre', 'la colonne role est ajoutée avec un défaut sûr');
  assert.equal(compte.suspendu, 0);
  base.fermer();
  for (const suffixe of ['', '-wal', '-shm']) rmSync(`${fichier}${suffixe}`, { force: true });
});
