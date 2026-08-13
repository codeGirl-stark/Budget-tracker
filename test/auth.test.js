/**
 * Authentification. Ces tests protègent la partie du code où une erreur
 * ne se voit pas à l'écran : elle se voit le jour où quelqu'un entre.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hacherMotDePasse, verifierMotDePasse,
  creerJeton, empreinteJeton, dateExpiration,
  validerEmail, validerMotDePasse, validerNom,
  autoriserTentative, enregistrerEchec, oublierEchecs,
  lireCookie, cookieSession, cookieEfface,
  LONGUEUR_MOT_DE_PASSE_MIN,
} from '../server/auth.js';

/* ---------------------------------------------------------------- *
 * Mots de passe
 * ---------------------------------------------------------------- */

test('un mot de passe se vérifie contre son empreinte', async () => {
  const empreinte = await hacherMotDePasse('correct horse battery');
  assert.equal(await verifierMotDePasse('correct horse battery', empreinte), true);
  assert.equal(await verifierMotDePasse('correct horse batterz', empreinte), false);
  assert.equal(await verifierMotDePasse('', empreinte), false);
});

test('le mot de passe n’apparaît jamais en clair dans ce qui est stocké', async () => {
  const secret = 'MotDePasseTresSecret42';
  const empreinte = await hacherMotDePasse(secret);
  assert.equal(empreinte.includes(secret), false);
  assert.ok(empreinte.startsWith('scrypt$'), 'le format porte son algorithme');
});

test('deux comptes au même mot de passe ont des empreintes différentes', async () => {
  // Sans sel, une seule table précalculée casserait tous les comptes d'un coup.
  const [a, b] = await Promise.all([hacherMotDePasse('identique'), hacherMotDePasse('identique')]);
  assert.notEqual(a, b);
  assert.equal(await verifierMotDePasse('identique', a), true);
  assert.equal(await verifierMotDePasse('identique', b), true);
});

test('une empreinte corrompue est refusée sans planter', async () => {
  for (const cassee of ['', 'nimporte quoi', 'scrypt$', 'bcrypt$1$2$3$4$5', null, undefined]) {
    assert.equal(await verifierMotDePasse('x', cassee), false, `empreinte : ${cassee}`);
  }
});

test('les mots de passe sont normalisés en Unicode', async () => {
  // « é » composé et « é » décomposé se ressemblent à l'écran : le clavier
  // de la personne ne doit pas décider si elle peut se connecter.
  const compose = 'cafépasselong';
  const decompose = 'cafépasselong';
  const empreinte = await hacherMotDePasse(compose);
  assert.equal(await verifierMotDePasse(decompose, empreinte), true);
});

/* ---------------------------------------------------------------- *
 * Jetons
 * ---------------------------------------------------------------- */

test('un jeton est imprévisible et n’est pas stocké en clair', () => {
  const a = creerJeton();
  const b = creerJeton();
  assert.notEqual(a.jeton, b.jeton);
  assert.ok(a.jeton.length >= 32, 'assez long pour ne pas se deviner');
  assert.notEqual(a.empreinte, a.jeton, 'la base ne voit qu’une empreinte');
  assert.equal(a.empreinte, empreinteJeton(a.jeton), 'l’empreinte est reproductible');
  assert.equal(a.empreinte.length, 64, 'sha256 en hexadécimal');
});

test('la date d’expiration est bien dans le futur', () => {
  const expire = new Date(dateExpiration()).getTime();
  assert.ok(expire > Date.now() + 20 * 24 * 3600 * 1000);
});

/* ---------------------------------------------------------------- *
 * Validation
 * ---------------------------------------------------------------- */

test('les adresses e-mail invalides sont refusées', () => {
  for (const mauvaise of ['', 'pasunemail', 'a@b', 'a b@c.fr', '@c.fr', 'a@.fr', null]) {
    assert.equal(validerEmail(mauvaise).ok, false, `refuse : ${mauvaise}`);
  }
});

test('les adresses valides sont normalisées en minuscules', () => {
  const resultat = validerEmail('  Awa.Diop@Example.SN  ');
  assert.equal(resultat.ok, true);
  assert.equal(resultat.valeur, 'awa.diop@example.sn');
});

test('un mot de passe trop court est refusé', () => {
  assert.equal(validerMotDePasse('a'.repeat(LONGUEUR_MOT_DE_PASSE_MIN - 1)).ok, false);
  assert.equal(validerMotDePasse('a'.repeat(LONGUEUR_MOT_DE_PASSE_MIN)).ok, true);
  assert.equal(validerMotDePasse('a'.repeat(201)).ok, false, 'et un trop long aussi');
});

test('le nom est tronqué, jamais rejeté', () => {
  assert.equal(validerNom('  Awa  '), 'Awa');
  assert.equal(validerNom('x'.repeat(200)).length, 80);
  assert.equal(validerNom(null), '');
});

/* ---------------------------------------------------------------- *
 * Limitation des tentatives
 * ---------------------------------------------------------------- */

test('le bourrinage finit par être bloqué', () => {
  const cle = `test:${Math.random()}`;
  oublierEchecs(cle);

  let autorisees = 0;
  for (let i = 0; i < 20; i += 1) {
    if (!autoriserTentative(cle).autorise) break;
    autorisees += 1;
    enregistrerEchec(cle);
  }

  assert.ok(autorisees <= 8, `bloqué après ${autorisees} tentatives`);
  assert.equal(autoriserTentative(cle).autorise, false);
  assert.ok(autoriserTentative(cle).attendreMs > 0, 'un délai d’attente est annoncé');
});

test('une connexion réussie remet le compteur à zéro', () => {
  const cle = `test:${Math.random()}`;
  for (let i = 0; i < 8; i += 1) enregistrerEchec(cle);
  assert.equal(autoriserTentative(cle).autorise, false);

  oublierEchecs(cle);
  assert.equal(autoriserTentative(cle).autorise, true);
});

/* ---------------------------------------------------------------- *
 * Cookies
 * ---------------------------------------------------------------- */

test('le cookie de session est lu parmi les autres', () => {
  assert.equal(lireCookie('theme=sombre; pf_session=abc123; autre=1'), 'abc123');
  assert.equal(lireCookie('pf_session=abc123'), 'abc123');
  assert.equal(lireCookie('theme=sombre'), null);
  assert.equal(lireCookie(''), null);
  assert.equal(lireCookie(undefined), null);
});

test('le cookie porte les protections attendues', () => {
  const cookie = cookieSession('jeton', { securise: true, expireLe: dateExpiration() });
  assert.ok(cookie.includes('HttpOnly'), 'inaccessible au JavaScript');
  assert.ok(cookie.includes('SameSite=Lax'), 'ne part pas depuis un autre site');
  assert.ok(cookie.includes('Secure'), 'HTTPS uniquement');
  assert.ok(cookie.includes('Path=/'));
});

test('sans HTTPS, l’attribut Secure est omis — sinon le cookie serait ignoré en local', () => {
  const cookie = cookieSession('jeton', { securise: false, expireLe: dateExpiration() });
  assert.equal(cookie.includes('Secure'), false);
  assert.ok(cookie.includes('HttpOnly'));
});

test('la déconnexion efface le cookie', () => {
  const cookie = cookieEfface({ securise: false });
  assert.ok(cookie.includes('Max-Age=0'));
});
