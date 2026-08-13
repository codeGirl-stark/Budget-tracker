/**
 * Formatage et lecture des montants côté client.
 * `lireMontant` est le point d'entrée de toute saisie d'argent : une erreur
 * ici corrompt des sommes sans rien signaler.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nombre, montant, montantSigne, pourcent, compact, lireMontant, symboleDevise, pluriel,
} from '../client/lib/format.js';

/** Intl sépare les milliers par une espace fine insécable : on normalise. */
const norm = (texte) => String(texte).replace(/[\s  ]+/g, ' ');

/* ---------------------------------------------------------------- */
test('les milliers sont séparés à la française', () => {
  assert.equal(norm(nombre(400000)), '400 000');
  assert.equal(nombre(0), '0');
  assert.equal(norm(nombre(1250000)), '1 250 000');
});

test('les décimales sont arrondies — le FCFA n’a pas de centimes', () => {
  assert.ok(!nombre(1500.4).includes(','), 'aucune décimale affichée');
  assert.equal(nombre(0.6), '1');
  assert.equal(nombre(1500.4), norm(nombre(1500)).replace(' ', nombre(1500).includes(' ') ? ' ' : ' '));
});

test('une valeur illisible retombe sur zéro plutôt que NaN', () => {
  assert.equal(nombre('abc'), '0');
  assert.equal(nombre(undefined), '0');
  assert.equal(nombre(Infinity), '0');
});

/* ---------------------------------------------------------------- */
test('la devise XOF s’affiche « FCFA »', () => {
  assert.equal(symboleDevise('XOF'), 'FCFA');
  assert.equal(symboleDevise('EUR'), '€');
  assert.equal(symboleDevise('inconnue'), 'inconnue', 'un code inconnu est rendu tel quel');
  assert.ok(montant(400000, 'XOF').endsWith('FCFA'));
});

/* ---------------------------------------------------------------- */
test('un écart porte son signe, avec un vrai signe moins', () => {
  assert.ok(montantSigne(2000).startsWith('+'));
  assert.ok(montantSigne(-2000).startsWith('−'), 'U+2212, pas un trait d’union');
  assert.equal(montantSigne(0).startsWith('+'), false);
  assert.equal(montantSigne(0).startsWith('−'), false);
});

/* ---------------------------------------------------------------- */
test('un pourcentage absent se lit « — », pas « 0 % »', () => {
  assert.equal(pourcent(null), '—');
  assert.equal(pourcent(undefined), '—');
  assert.equal(pourcent(Number.NaN), '—');
  assert.equal(norm(pourcent(0)), '0 %');
  assert.equal(norm(pourcent(1.2)), '120 %');
  assert.equal(norm(pourcent(0.125)), '13 %', 'arrondi à l’entier par défaut');
  assert.equal(norm(pourcent(0.125, { decimale: true })), '12,5 %');
});

/* ---------------------------------------------------------------- */
test('les axes de graphique se lisent en k et en M', () => {
  assert.equal(norm(compact(45000)), '45 k');
  assert.equal(norm(compact(1250000)), '1,3 M');
  assert.equal(norm(compact(12000000)), '12 M');
  assert.equal(compact(800), '800');
  assert.equal(compact(0), '0');
  assert.ok(compact(-45000).startsWith('−'));
});

/* ---------------------------------------------------------------- *
 * Le cœur : lecture d'une saisie humaine
 * ---------------------------------------------------------------- */

test('lireMontant accepte les séparateurs que l’on tape vraiment', () => {
  assert.equal(lireMontant('40000'), 40000);
  assert.equal(lireMontant('40 000'), 40000, 'espace normale');
  assert.equal(lireMontant('40 000'), 40000, 'espace fine insécable (copier-coller)');
  assert.equal(lireMontant('40 000'), 40000, 'espace insécable');
  assert.equal(lireMontant('1.250.000'), 1250000, 'points de milliers');
  assert.equal(lireMontant('40000,5'), 40001, 'virgule décimale arrondie');
});

test('lireMontant refuse le négatif et l’absurde', () => {
  assert.equal(lireMontant('-5000'), 0);
  assert.equal(lireMontant('abc'), 0);
  assert.equal(lireMontant(''), 0);
  assert.equal(lireMontant(null), 0);
  assert.equal(lireMontant(undefined), 0);
  assert.equal(lireMontant('0'), 0);
});

test('lireMontant est stable en aller-retour avec l’affichage', () => {
  // Ce cycle a lieu à chaque perte de focus d'un champ : il ne doit rien dériver.
  for (const valeur of [0, 1, 999, 40000, 400000, 1250000, 7]) {
    assert.equal(lireMontant(nombre(valeur)), valeur, `aller-retour sur ${valeur}`);
  }
});

test('lireMontant accepte un nombre déjà propre', () => {
  assert.equal(lireMontant(40000), 40000);
  assert.equal(lireMontant(40000.6), 40001);
  assert.equal(lireMontant(-3), 0);
});

/* ---------------------------------------------------------------- */
test('le pluriel suit le compteur', () => {
  assert.ok(pluriel(1, 'mois', 'mois').endsWith('mois'));
  assert.ok(pluriel(2, 'écriture').endsWith('écritures'));
  assert.ok(pluriel(1, 'écriture').endsWith('écriture'));
});
