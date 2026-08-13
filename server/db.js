/**
 * Accès aux données — SQLite via le module natif de Node (aucune dépendance).
 *
 * Tout le SQL du projet est enfermé ici, derrière des méthodes métier. Changer
 * de moteur plus tard (D1, Turso, Postgres) revient à réécrire cette seule
 * classe : ni le serveur, ni le modèle, ni le client n'en savent rien.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** Schéma déclaré instruction par instruction — rien à découper à l'exécution. */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS utilisateurs (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
     nom           TEXT    NOT NULL DEFAULT '',
     mot_de_passe  TEXT    NOT NULL,
     role          TEXT    NOT NULL DEFAULT 'membre',
     suspendu      INTEGER NOT NULL DEFAULT 0,
     cree_le       TEXT    NOT NULL,
     vu_le         TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS plans (
     utilisateur_id INTEGER PRIMARY KEY REFERENCES utilisateurs(id) ON DELETE CASCADE,
     rev            INTEGER NOT NULL DEFAULT 1,
     contenu        TEXT    NOT NULL,
     maj_le         TEXT    NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     jeton          TEXT    PRIMARY KEY,
     utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
     cree_le        TEXT    NOT NULL,
     expire_le      TEXT    NOT NULL,
     agent          TEXT    NOT NULL DEFAULT ''
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_utilisateur ON sessions(utilisateur_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiration ON sessions(expire_le)`,

  // Historique des versions d'un plan : le filet du §8, transposé en base.
  `CREATE TABLE IF NOT EXISTS sauvegardes (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
     rev            INTEGER NOT NULL,
     contenu        TEXT    NOT NULL,
     cree_le        TEXT    NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sauvegardes_utilisateur ON sauvegardes(utilisateur_id, id DESC)`,
];

const MAX_SAUVEGARDES = 20;

const maintenant = () => new Date().toISOString();

export class Base {
  #db;

  constructor(cheminFichier) {
    if (cheminFichier !== ':memory:') mkdirSync(path.dirname(cheminFichier), { recursive: true });
    this.#db = new DatabaseSync(cheminFichier);

    // WAL : lectures et écritures cessent de se bloquer mutuellement.
    this.#db.prepare('PRAGMA journal_mode = WAL').get();
    this.#lancer('PRAGMA foreign_keys = ON');
    this.#lancer('PRAGMA busy_timeout = 5000');
    for (const instruction of SCHEMA) this.#lancer(instruction);
    this.#migrer();
  }

  /**
   * Ajoute les colonnes apparues après coup. `CREATE TABLE IF NOT EXISTS` ne
   * touche pas une table déjà créée : sans ça, une base existante resterait
   * bloquée sur l'ancien schéma.
   */
  #migrer() {
    const colonnes = this.#db.prepare('PRAGMA table_info(utilisateurs)').all().map((c) => c.name);
    if (!colonnes.includes('role')) {
      this.#lancer("ALTER TABLE utilisateurs ADD COLUMN role TEXT NOT NULL DEFAULT 'membre'");
    }
    if (!colonnes.includes('suspendu')) {
      this.#lancer('ALTER TABLE utilisateurs ADD COLUMN suspendu INTEGER NOT NULL DEFAULT 0');
    }
  }

  /** Exécute une instruction sans paramètre ni résultat attendu. */
  #lancer(sql) {
    this.#db.prepare(sql).run();
  }

  #transaction(travail) {
    this.#lancer('BEGIN');
    try {
      const resultat = travail();
      this.#lancer('COMMIT');
      return resultat;
    } catch (erreur) {
      this.#lancer('ROLLBACK');
      throw erreur;
    }
  }

  fermer() {
    this.#db.close();
  }

  /* ---------------------------------------------------------------- *
   * Utilisateurs
   * ---------------------------------------------------------------- */

  creerUtilisateur({ email, nom, motDePasse, role = 'membre' }) {
    const resultat = this.#db
      .prepare('INSERT INTO utilisateurs (email, nom, mot_de_passe, role, cree_le) VALUES (?, ?, ?, ?, ?)')
      .run(email, nom ?? '', motDePasse, role === 'admin' ? 'admin' : 'membre', maintenant());
    return this.utilisateurParId(Number(resultat.lastInsertRowid));
  }

  utilisateurParEmail(email) {
    return this.#db.prepare('SELECT * FROM utilisateurs WHERE email = ?').get(email) ?? null;
  }

  utilisateurParId(id) {
    return this.#db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(id) ?? null;
  }

  compterUtilisateurs() {
    return this.#db.prepare('SELECT COUNT(*) AS n FROM utilisateurs').get().n;
  }

  marquerVu(utilisateurId) {
    this.#db.prepare('UPDATE utilisateurs SET vu_le = ? WHERE id = ?').run(maintenant(), utilisateurId);
  }

  changerMotDePasse(utilisateurId, motDePasse) {
    this.#db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(motDePasse, utilisateurId);
  }

  supprimerUtilisateur(utilisateurId) {
    // ON DELETE CASCADE emporte plan, sessions et sauvegardes.
    this.#db.prepare('DELETE FROM utilisateurs WHERE id = ?').run(utilisateurId);
  }

  /* ---------------------------------------------------------------- *
   * Administration
   *
   * Aucune de ces méthodes ne lit le contenu d'un plan : l'administration
   * porte sur les comptes, jamais sur les finances de qui que ce soit.
   * ---------------------------------------------------------------- */

  listerUtilisateurs() {
    return this.#db
      .prepare(`SELECT u.id, u.email, u.nom, u.role, u.suspendu, u.cree_le, u.vu_le,
                       (SELECT COUNT(*) FROM sessions s
                         WHERE s.utilisateur_id = u.id AND s.expire_le > ?) AS sessions_actives,
                       (SELECT COUNT(*) FROM plans p WHERE p.utilisateur_id = u.id) AS a_un_plan
                  FROM utilisateurs u
                 ORDER BY u.cree_le ASC`)
      .all(maintenant());
  }

  compterAdmins() {
    return this.#db.prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin' AND suspendu = 0").get().n;
  }

  definirRole(utilisateurId, role) {
    this.#db
      .prepare('UPDATE utilisateurs SET role = ? WHERE id = ?')
      .run(role === 'admin' ? 'admin' : 'membre', utilisateurId);
  }

  definirSuspension(utilisateurId, suspendu) {
    this.#db.prepare('UPDATE utilisateurs SET suspendu = ? WHERE id = ?').run(suspendu ? 1 : 0, utilisateurId);
    // Un compte suspendu ne doit pas rester connecté sur ses appareils.
    if (suspendu) this.supprimerSessionsDe(utilisateurId);
  }

  /* ---------------------------------------------------------------- *
   * Plans — un par utilisateur, isolé des autres
   * ---------------------------------------------------------------- */

  lirePlan(utilisateurId) {
    const ligne = this.#db
      .prepare('SELECT contenu, rev FROM plans WHERE utilisateur_id = ?')
      .get(utilisateurId);
    return ligne ? { state: JSON.parse(ligne.contenu), rev: ligne.rev } : null;
  }

  creerPlan(utilisateurId, state) {
    this.#db
      .prepare('INSERT INTO plans (utilisateur_id, rev, contenu, maj_le) VALUES (?, 1, ?, ?)')
      .run(utilisateurId, JSON.stringify(state), maintenant());
    return { state, rev: 1 };
  }

  /**
   * Écriture optimiste : si `revAttendue` ne correspond plus, c'est qu'une
   * autre fenêtre a écrit entre-temps — on refuse plutôt que d'écraser.
   */
  ecrirePlan(utilisateurId, state, revAttendue = null) {
    const actuel = this.lirePlan(utilisateurId);
    if (!actuel) return { conflit: false, ...this.creerPlan(utilisateurId, state) };

    if (revAttendue !== null && revAttendue !== actuel.rev) {
      return { conflit: true, state: actuel.state, rev: actuel.rev };
    }

    const nouvelleRev = actuel.rev + 1;

    this.#transaction(() => {
      this.#db
        .prepare('UPDATE plans SET contenu = ?, rev = ?, maj_le = ? WHERE utilisateur_id = ? AND rev = ?')
        .run(JSON.stringify(state), nouvelleRev, maintenant(), utilisateurId, actuel.rev);
      this.#archiver(utilisateurId, actuel.rev, JSON.stringify(actuel.state));
    });

    return { conflit: false, state, rev: nouvelleRev };
  }

  #archiver(utilisateurId, rev, contenu) {
    this.#db
      .prepare('INSERT INTO sauvegardes (utilisateur_id, rev, contenu, cree_le) VALUES (?, ?, ?, ?)')
      .run(utilisateurId, rev, contenu, maintenant());
    this.#db
      .prepare(`DELETE FROM sauvegardes WHERE utilisateur_id = ? AND id NOT IN (
                  SELECT id FROM sauvegardes WHERE utilisateur_id = ? ORDER BY id DESC LIMIT ?
                )`)
      .run(utilisateurId, utilisateurId, MAX_SAUVEGARDES);
  }

  listerSauvegardes(utilisateurId) {
    return this.#db
      .prepare('SELECT id, rev, cree_le FROM sauvegardes WHERE utilisateur_id = ? ORDER BY id DESC')
      .all(utilisateurId);
  }

  lireSauvegarde(utilisateurId, id) {
    const ligne = this.#db
      .prepare('SELECT contenu, rev FROM sauvegardes WHERE utilisateur_id = ? AND id = ?')
      .get(utilisateurId, id);
    return ligne ? { state: JSON.parse(ligne.contenu), rev: ligne.rev } : null;
  }

  /* ---------------------------------------------------------------- *
   * Sessions — le jeton n'est jamais stocké en clair
   * ---------------------------------------------------------------- */

  creerSession({ jeton, utilisateurId, expireLe, agent }) {
    this.#db
      .prepare('INSERT INTO sessions (jeton, utilisateur_id, cree_le, expire_le, agent) VALUES (?, ?, ?, ?, ?)')
      .run(jeton, utilisateurId, maintenant(), expireLe, (agent ?? '').slice(0, 200));
  }

  /** Renvoie l'utilisateur si la session existe et n'est pas expirée. */
  utilisateurParSession(jeton) {
    const ligne = this.#db
      .prepare(`SELECT u.*, s.expire_le FROM sessions s
                JOIN utilisateurs u ON u.id = s.utilisateur_id
                WHERE s.jeton = ?`)
      .get(jeton);
    if (!ligne) return null;
    if (new Date(ligne.expire_le).getTime() < Date.now()) {
      this.supprimerSession(jeton);
      return null;
    }
    return ligne;
  }

  prolongerSession(jeton, expireLe) {
    this.#db.prepare('UPDATE sessions SET expire_le = ? WHERE jeton = ?').run(expireLe, jeton);
  }

  supprimerSession(jeton) {
    this.#db.prepare('DELETE FROM sessions WHERE jeton = ?').run(jeton);
  }

  supprimerSessionsDe(utilisateurId) {
    this.#db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(utilisateurId);
  }

  purgerSessionsExpirees() {
    return this.#db.prepare('DELETE FROM sessions WHERE expire_le < ?').run(maintenant()).changes;
  }
}
