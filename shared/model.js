/**
 * Logique métier du plan financier — fonctions pures, sans DOM ni I/O.
 * Partagé entre le serveur (validation, seed) et le client (affichage).
 */

import {
  CATEGORIES,
  CATEGORIE_IDS,
  CATEGORIES_SOCLE,
  CATEGORIES_EPARGNE_EFFECTIVE,
  SCENARIOS_PAR_ID,
  SCENARIO_BASE,
  SINKING_FUNDS_DEFAUT,
} from './categories.js';

export const TAUX_DIME = 0.1;

export const REGLE_SURPLUS_DEFAUT = {
  investissement: 50,
  epargne: 20,
  devperso_loisirs: 15,
  projets: 15,
};

/* ------------------------------------------------------------------ *
 * Utilitaires
 * ------------------------------------------------------------------ */

/** Convertit n'importe quelle saisie en entier >= 0 (les FCFA n'ont pas de centimes). */
export function montantValide(valeur) {
  const n = typeof valeur === 'number' ? valeur : Number.parseFloat(String(valeur ?? '').replace(/[\s ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

export function nouvelId(prefixe = 'x') {
  const rnd = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefixe}_${rnd}`;
}

export function slug(texte) {
  return String(texte)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'fonds';
}

const somme = (liste, lire) => liste.reduce((total, item) => total + lire(item), 0);

/* ------------------------------------------------------------------ *
 * Accès aux données
 * ------------------------------------------------------------------ */

export function moisVide() {
  const categories = {};
  for (const id of CATEGORIE_IDS) {
    categories[id] = id === 'dime' ? { entries: [] } : { prevu: 0, entries: [] };
  }
  return { revenus: [], categories };
}

export function anneeVide() {
  const months = {};
  for (let i = 0; i < 12; i += 1) months[String(i)] = moisVide();
  return { months };
}

/** Renvoie le mois demandé, ou un mois vide si l'année/le mois n'existe pas encore. */
export function getMois(state, annee, indexMois) {
  return state?.years?.[String(annee)]?.months?.[String(indexMois)] ?? moisVide();
}

export function anneesDisponibles(state) {
  return Object.keys(state?.years ?? {})
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Revenus (§10)
 * ------------------------------------------------------------------ */

export function revenuTotal(mois) {
  return somme(mois.revenus ?? [], (r) => montantValide(r.montant));
}

export function revenuStable(mois) {
  return somme((mois.revenus ?? []).filter((r) => r.type === 'stable'), (r) => montantValide(r.montant));
}

export function revenuVariable(mois) {
  return revenuTotal(mois) - revenuStable(mois);
}

/** Base de calcul de la dîme selon le réglage de valeurs choisi (§2). */
export function baseDime(mois, regleDime = 'total') {
  return regleDime === 'salaire_seul' ? revenuStable(mois) : revenuTotal(mois);
}

/** Prévu de la dîme : toujours dérivé, jamais stocké (§2, §7). */
export function prevuDime(mois, regleDime = 'total') {
  return Math.round(baseDime(mois, regleDime) * TAUX_DIME);
}

/**
 * Part des revenus qui vient d'une source stable, sur 0..1.
 * `null` si aucun revenu (le ratio n'a alors pas de sens).
 */
export function tauxDependanceSalaire(mois) {
  const total = revenuTotal(mois);
  if (total === 0) return null;
  return revenuStable(mois) / total;
}

/* ------------------------------------------------------------------ *
 * Catégories (§3)
 * ------------------------------------------------------------------ */

export function reelCategorie(mois, categorieId) {
  const entries = mois.categories?.[categorieId]?.entries ?? [];
  return somme(entries, (e) => montantValide(e.montant));
}

export function prevuCategorie(mois, categorieId, regleDime = 'total') {
  if (categorieId === 'dime') return prevuDime(mois, regleDime);
  return montantValide(mois.categories?.[categorieId]?.prevu ?? 0);
}

/** Statut d'une catégorie — règles littérales du cahier des charges (§3). */
export function statutCategorie(prevu, reel) {
  if (prevu === 0 && reel === 0) return 'neutre';
  if (prevu === 0 && reel > 0) return 'depasse';
  const ratio = reel / prevu;
  if (ratio > 1) return 'depasse';
  if (ratio >= 0.9) return 'attention';
  return 'ok';
}

/** Ligne complète Prévu / Réel / Écart / % / Statut pour une catégorie. */
export function ligneCategorie(mois, categorieId, regleDime = 'total') {
  const prevu = prevuCategorie(mois, categorieId, regleDime);
  const reel = reelCategorie(mois, categorieId);
  return {
    id: categorieId,
    prevu,
    reel,
    ecart: prevu - reel,
    pct: prevu > 0 ? reel / prevu : null,
    statut: statutCategorie(prevu, reel),
  };
}

export function lignesMois(mois, regleDime = 'total') {
  return CATEGORIES.map((c) => ({ ...ligneCategorie(mois, c.id, regleDime), categorie: c }));
}

export function totauxMois(mois, regleDime = 'total') {
  const lignes = lignesMois(mois, regleDime);
  const prevu = somme(lignes, (l) => l.prevu);
  const reel = somme(lignes, (l) => l.reel);
  const revenu = revenuTotal(mois);
  return {
    revenu,
    revenuStable: revenuStable(mois),
    revenuVariable: revenuVariable(mois),
    prevu,
    reel,
    ecart: prevu - reel,
    resteAAffecter: revenu - prevu,
    solde: revenu - reel,
    lignes,
  };
}

/**
 * Alerte §10.3 : le socle (dîme, essentielles, famille) ne doit jamais
 * reposer sur un revenu variable.
 */
export function controleSocle(mois, regleDime = 'total') {
  const socle = somme(CATEGORIES_SOCLE, (id) => prevuCategorie(mois, id, regleDime));
  const stable = revenuStable(mois);
  return {
    socle,
    stable,
    couvert: socle <= stable,
    manque: Math.max(0, socle - stable),
  };
}

/* ------------------------------------------------------------------ *
 * Scénarios (§4)
 * ------------------------------------------------------------------ */

/**
 * Prévus à appliquer pour un scénario. La dîme est exclue : elle est dérivée.
 * `proportionnel` ré-échelonne les montants sur le revenu réel du mois.
 */
export function prevusScenario(scenarioId, { revenu = SCENARIO_BASE, proportionnel = false } = {}) {
  const scenario = SCENARIOS_PAR_ID[scenarioId];
  if (!scenario) return null;
  const facteur = proportionnel && revenu > 0 ? revenu / SCENARIO_BASE : 1;
  const prevus = {};
  for (const [id, montant] of Object.entries(scenario.prevus)) {
    if (id === 'dime') continue;
    prevus[id] = Math.round(montant * facteur);
  }
  return prevus;
}

/** Écart entre le total d'un scénario appliqué et le revenu du mois (§4). */
export function controleScenario(prevus, mois, regleDime = 'total') {
  const total = somme(Object.values(prevus), (v) => v) + prevuDime(mois, regleDime);
  const revenu = revenuTotal(mois);
  return { total, revenu, ecart: revenu - total };
}

/* ------------------------------------------------------------------ *
 * Règle du surplus (§10.2)
 * ------------------------------------------------------------------ */

/**
 * Répartit un delta de revenu stable selon `regleSurplus`.
 * Les enveloppes qui couvrent deux catégories sont partagées à parts égales,
 * et le reliquat d'arrondi tombe sur l'investissement.
 */
export function repartitionSurplus(delta, regleSurplus = REGLE_SURPLUS_DEFAUT) {
  const montant = Math.max(0, Math.round(delta));
  const pct = { ...REGLE_SURPLUS_DEFAUT, ...regleSurplus };
  const part = (p) => Math.round((montant * p) / 100);

  const capital = part(pct.investissement);
  const vie = part(pct.devperso_loisirs);
  const repartition = {
    investissement: Math.round(capital / 2),
    business: capital - Math.round(capital / 2),
    epargne: part(pct.epargne),
    devperso: Math.round(vie / 2),
    loisirs: vie - Math.round(vie / 2),
    projets: part(pct.projets),
  };
  const attribue = somme(Object.values(repartition), (v) => v);
  repartition.investissement += montant - attribue;
  return repartition;
}

/* ------------------------------------------------------------------ *
 * Fonds cumulés (§5)
 * ------------------------------------------------------------------ */

/** Somme de tous les Réel d'une catégorie, toutes années et tous mois confondus. */
export function cumulCategorie(state, categorieId, { annee = null } = {}) {
  let total = 0;
  for (const [cle, annuel] of Object.entries(state?.years ?? {})) {
    if (annee !== null && String(annee) !== cle) continue;
    for (const mois of Object.values(annuel?.months ?? {})) {
      total += reelCategorie(mois, categorieId);
    }
  }
  return total;
}

/** Cumul de la catégorie `projets` ventilé par sous-fonds. */
export function cumulSinkingFunds(state) {
  const parFonds = new Map();
  let nonAffecte = 0;
  for (const annuel of Object.values(state?.years ?? {})) {
    for (const mois of Object.values(annuel?.months ?? {})) {
      for (const entry of mois.categories?.projets?.entries ?? []) {
        const montant = montantValide(entry.montant);
        const id = entry.sinkingFundId;
        if (!id) { nonAffecte += montant; continue; }
        parFonds.set(id, (parFonds.get(id) ?? 0) + montant);
      }
    }
  }
  const fonds = (state?.sinkingFunds ?? []).map((f) => {
    const cumul = parFonds.get(f.id) ?? 0;
    return {
      ...f,
      cumul,
      reste: Math.max(0, montantValide(f.cible) - cumul),
      progression: f.cible > 0 ? cumul / f.cible : null,
    };
  });
  // Un sous-fonds supprimé peut laisser des écritures orphelines : on ne les perd pas.
  const connus = new Set(fonds.map((f) => f.id));
  for (const [id, cumul] of parFonds) {
    if (!connus.has(id)) nonAffecte += cumul;
  }
  return { fonds, nonAffecte };
}

/**
 * Cible du fonds d'urgence : X mois de (essentielles + aide familiale).
 * On se base sur le budget prévu du mois de référence, et à défaut sur le réel.
 */
export function cibleUrgence(state, annee, indexMois) {
  const mois = getMois(state, annee, indexMois);
  const base = ['essentielles', 'famille_aide'].reduce((total, id) => {
    const prevu = prevuCategorie(mois, id, state.regleDime);
    return total + (prevu > 0 ? prevu : reelCategorie(mois, id));
  }, 0);
  const multiplicateur = state?.fondsCibles?.urgenceMois ?? 3;
  return { base, multiplicateur, cible: base * multiplicateur };
}

/** Tous les fonds du §5, prêts à afficher. */
export function etatFonds(state, annee, indexMois) {
  const urgence = cibleUrgence(state, annee, indexMois);
  const cumulEpargne = cumulCategorie(state, 'epargne');
  const cumulEtudes = cumulCategorie(state, 'famille_etudes');
  const cumulEtudesAnnee = cumulCategorie(state, 'famille_etudes', { annee });
  const cumulBusiness = cumulCategorie(state, 'business');
  const cumulInvest = cumulCategorie(state, 'investissement');
  const cibleBusiness = montantValide(state?.fondsCibles?.businessCible ?? 0);
  const cibleEtudes = montantValide(state?.fondsCibles?.etudesAnnuel ?? 0);

  return {
    urgence: {
      id: 'urgence',
      nom: 'Fonds d’urgence & épargne rémunérée',
      cumul: cumulEpargne,
      cible: urgence.cible,
      progression: urgence.cible > 0 ? cumulEpargne / urgence.cible : null,
      detail: urgence,
    },
    etudes: {
      id: 'etudes',
      nom: 'Fonds études des frères',
      cumul: cumulEtudesAnnee,
      cumulTotal: cumulEtudes,
      cible: cibleEtudes,
      progression: cibleEtudes > 0 ? cumulEtudesAnnee / cibleEtudes : null,
    },
    business: {
      id: 'business',
      nom: 'Business Fund',
      cumul: cumulBusiness,
      cible: cibleBusiness || null,
      progression: cibleBusiness > 0 ? cumulBusiness / cibleBusiness : null,
    },
    investissement: {
      id: 'investissement',
      nom: 'Portefeuille investissement',
      cumul: cumulInvest,
      cible: null,
      progression: null,
    },
    projets: cumulSinkingFunds(state),
  };
}

/* ------------------------------------------------------------------ *
 * Vue annuelle & KPIs (§6)
 * ------------------------------------------------------------------ */

export function lignesAnnee(state, annee) {
  const regleDime = state?.regleDime ?? 'total';
  let cumul = 0;
  return Array.from({ length: 12 }, (_, i) => {
    const mois = getMois(state, annee, i);
    const revenu = revenuTotal(mois);
    const reel = somme(CATEGORIE_IDS, (id) => reelCategorie(mois, id));
    const epargneEffective = somme(CATEGORIES_EPARGNE_EFFECTIVE, (id) => reelCategorie(mois, id));
    const solde = revenu - reel;
    cumul += solde;
    return {
      index: i,
      revenu,
      revenuStable: revenuStable(mois),
      prevu: somme(CATEGORIE_IDS, (id) => prevuCategorie(mois, id, regleDime)),
      reel,
      solde,
      soldeCumule: cumul,
      epargneEffective,
      tauxEpargne: revenu > 0 ? epargneEffective / revenu : null,
      dependanceSalaire: tauxDependanceSalaire(mois),
      actif: revenu > 0 || reel > 0,
    };
  });
}

export function kpisAnnee(state, annee) {
  const lignes = lignesAnnee(state, annee);
  const revenus = somme(lignes, (l) => l.revenu);
  const revenusStables = somme(lignes, (l) => l.revenuStable);
  const depenses = somme(lignes, (l) => l.reel);
  const epargneEffective = somme(lignes, (l) => l.epargneEffective);
  return {
    revenus,
    depenses,
    solde: revenus - depenses,
    tauxEpargne: revenus > 0 ? epargneEffective / revenus : null,
    dependanceSalaire: revenus > 0 ? revenusStables / revenus : null,
    lignes,
  };
}

/** Répartition des dépenses réelles par catégorie sur une période. */
export function repartitionDepenses(state, annee, indexMois = null) {
  const total = [];
  for (const categorie of CATEGORIES) {
    let montant = 0;
    if (indexMois === null) {
      for (let i = 0; i < 12; i += 1) montant += reelCategorie(getMois(state, annee, i), categorie.id);
    } else {
      montant = reelCategorie(getMois(state, annee, indexMois), categorie.id);
    }
    total.push({ categorie, montant });
  }
  const cumul = somme(total, (t) => t.montant);
  return total
    .map((t) => ({ ...t, part: cumul > 0 ? t.montant / cumul : 0 }))
    .sort((a, b) => b.montant - a.montant);
}

/* ------------------------------------------------------------------ *
 * Normalisation / migration
 * ------------------------------------------------------------------ */

function normaliserRevenus(revenus) {
  if (!Array.isArray(revenus)) return [];
  return revenus.map((r) => ({
    id: typeof r?.id === 'string' && r.id ? r.id : nouvelId('r'),
    source: String(r?.source ?? 'Source').slice(0, 80),
    montant: montantValide(r?.montant),
    type: r?.type === 'variable' ? 'variable' : 'stable',
  }));
}

function normaliserEntries(entries, { avecSousFonds = false } = {}) {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    const entry = {
      id: typeof e?.id === 'string' && e.id ? e.id : nouvelId('e'),
      label: String(e?.label ?? '').slice(0, 120),
      montant: montantValide(e?.montant),
    };
    if (avecSousFonds && typeof e?.sinkingFundId === 'string' && e.sinkingFundId) {
      entry.sinkingFundId = e.sinkingFundId;
    }
    return entry;
  });
}

function normaliserMois(brut) {
  const mois = { revenus: normaliserRevenus(brut?.revenus), categories: {} };
  for (const id of CATEGORIE_IDS) {
    const source = brut?.categories?.[id] ?? {};
    const categorie = { entries: normaliserEntries(source.entries, { avecSousFonds: id === 'projets' }) };
    if (id !== 'dime') categorie.prevu = montantValide(source.prevu);
    mois.categories[id] = categorie;
  }
  if (typeof brut?.note === 'string' && brut.note.trim()) mois.note = brut.note.slice(0, 2000);
  return mois;
}

function normaliserSinkingFunds(brut) {
  const liste = Array.isArray(brut) ? brut : [];
  const vus = new Set();
  const fonds = [];
  for (const f of liste) {
    let id = typeof f?.id === 'string' && f.id ? f.id : slug(f?.nom ?? '');
    while (vus.has(id)) id = `${id}-2`;
    vus.add(id);
    fonds.push({
      id,
      nom: String(f?.nom ?? 'Sous-fonds').slice(0, 80),
      cible: montantValide(f?.cible),
      priorite: Number.isFinite(Number(f?.priorite)) ? Number(f.priorite) : fonds.length + 1,
    });
  }
  return fonds.sort((a, b) => a.priorite - b.priorite);
}

/**
 * Rend n'importe quelle entrée (fichier ancien, import utilisateur, données
 * partielles) conforme au modèle attendu, sans jamais jeter de données valides.
 */
export function normaliserState(brut) {
  const annees = {};
  for (const [cle, annuel] of Object.entries(brut?.years ?? {})) {
    if (!/^\d{4}$/.test(cle)) continue;
    const months = {};
    for (let i = 0; i < 12; i += 1) months[String(i)] = normaliserMois(annuel?.months?.[String(i)]);
    annees[cle] = { months };
  }

  const anneeCourante = Number.isInteger(Number(brut?.currentYear))
    ? Number(brut.currentYear)
    : new Date().getFullYear();
  if (!annees[String(anneeCourante)]) annees[String(anneeCourante)] = anneeVide();

  const surplus = { ...REGLE_SURPLUS_DEFAUT, ...(brut?.regleSurplus ?? {}) };
  for (const cle of Object.keys(REGLE_SURPLUS_DEFAUT)) {
    const n = Number(surplus[cle]);
    surplus[cle] = Number.isFinite(n) && n >= 0 ? n : REGLE_SURPLUS_DEFAUT[cle];
  }

  const aide = brut?.aideFamiliale ?? {};

  return {
    version: 1,
    currency: typeof brut?.currency === 'string' && brut.currency ? brut.currency.slice(0, 8) : 'XOF',
    currentYear: anneeCourante,
    revenuMensuelDefaut: montantValide(brut?.revenuMensuelDefaut ?? 400000),
    scenarioActif: SCENARIOS_PAR_ID[brut?.scenarioActif] ? brut.scenarioActif : 'A',
    regleDime: brut?.regleDime === 'salaire_seul' ? 'salaire_seul' : 'total',
    regleSurplus: surplus,
    aideFamiliale: {
      mode: aide?.mode === 'pourcentage' ? 'pourcentage' : 'plancher',
      plancher: montantValide(aide?.plancher ?? 100000),
      pourcentage: Math.min(100, Math.max(0, Number(aide?.pourcentage) || 15)),
    },
    fondsCibles: {
      urgenceMois: [3, 6, 9, 12].includes(Number(brut?.fondsCibles?.urgenceMois))
        ? Number(brut.fondsCibles.urgenceMois)
        : 3,
      etudesAnnuel: montantValide(brut?.fondsCibles?.etudesAnnuel ?? 480000),
      businessCible: montantValide(brut?.fondsCibles?.businessCible ?? 0),
    },
    sinkingFunds: normaliserSinkingFunds(brut?.sinkingFunds ?? SINKING_FUNDS_DEFAUT),
    years: annees,
  };
}

/**
 * État initial : douze mois prêts à l'emploi, revenu par défaut en source
 * stable et scénario A appliqué — l'utilisatrice arrive sur un plan, pas
 * sur une page blanche.
 */
export function stateInitial({ annee = new Date().getFullYear(), revenu = 400000 } = {}) {
  const state = normaliserState({ currentYear: annee, revenuMensuelDefaut: revenu });
  const prevus = prevusScenario('A');
  for (let i = 0; i < 12; i += 1) {
    const mois = state.years[String(annee)].months[String(i)];
    mois.revenus = [{ id: nouvelId('r'), source: 'Salaire', montant: revenu, type: 'stable' }];
    for (const [id, montant] of Object.entries(prevus)) mois.categories[id].prevu = montant;
  }
  return state;
}
