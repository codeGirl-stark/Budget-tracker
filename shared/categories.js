/**
 * Référentiel du plan financier : catégories, scénarios, libellés.
 * Module ESM pur — chargé tel quel par le serveur Node et par le navigateur.
 */

export const CATEGORIE_DIME = 'dime';

/** Les 11 catégories, dans l'ordre d'affichage. La dîme est toujours en tête. */
export const CATEGORIES = [
  {
    id: 'dime',
    nom: 'Dîme',
    contenu: 'Dîme, offrandes',
    groupe: 'socle',
    prevuEditable: false,
    nonNegociable: true,
  },
  {
    id: 'essentielles',
    nom: 'Dépenses essentielles',
    contenu: 'Logement, charges, alimentation, transport, télécom, santé courante',
    groupe: 'socle',
    prevuEditable: true,
  },
  {
    id: 'famille_aide',
    nom: 'Aide familiale',
    contenu: 'Argent envoyé aux parents',
    groupe: 'socle',
    prevuEditable: true,
  },
  {
    id: 'famille_etudes',
    nom: 'Fonds études des frères',
    contenu: 'Épargne dédiée, distincte de l’épargne personnelle',
    groupe: 'socle',
    prevuEditable: true,
  },
  {
    id: 'epargne',
    nom: 'Épargne',
    contenu: 'Fonds d’urgence + épargne rémunérée',
    groupe: 'capital',
    prevuEditable: true,
  },
  {
    id: 'investissement',
    nom: 'Investissements',
    contenu: 'BRVM (actions/obligations), autres placements',
    groupe: 'capital',
    prevuEditable: true,
  },
  {
    id: 'business',
    nom: 'Business Fund',
    contenu: 'Capital dédié aux futurs projets entrepreneuriaux',
    groupe: 'capital',
    prevuEditable: true,
  },
  {
    id: 'devperso',
    nom: 'Développement personnel',
    contenu: 'Beauté/entretien, style, sport, apprentissage',
    groupe: 'vie',
    prevuEditable: true,
  },
  {
    id: 'loisirs',
    nom: 'Loisirs',
    contenu: 'Sorties, restaurants, découvertes, voyages',
    groupe: 'vie',
    prevuEditable: true,
  },
  {
    id: 'projets',
    nom: 'Fonds projets / achats',
    contenu: 'Sinking funds pour achats importants',
    groupe: 'vie',
    prevuEditable: true,
    sousFonds: true,
  },
  {
    id: 'imprevus',
    nom: 'Imprévus',
    contenu: 'Marge de sécurité du mois',
    groupe: 'vie',
    prevuEditable: true,
  },
];

export const CATEGORIE_IDS = CATEGORIES.map((c) => c.id);

export const CATEGORIES_PAR_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const GROUPES = {
  socle: { nom: 'Socle', desc: 'Ce qui doit tenir sur le revenu stable' },
  capital: { nom: 'Capital', desc: 'Ce qui construit le patrimoine' },
  vie: { nom: 'Vie & projets', desc: 'Ce qui fait avancer et respirer' },
};

/** Catégories dont le prévu ne doit jamais reposer sur un revenu variable (§10.3). */
export const CATEGORIES_SOCLE = ['dime', 'essentielles', 'famille_aide', 'famille_etudes'];

/** Catégories comptées dans le taux d'épargne effectif (§6). */
export const CATEGORIES_EPARGNE_EFFECTIVE = ['epargne', 'investissement', 'business'];

/** Revenu de référence sur lequel les scénarios ont été calibrés. */
export const SCENARIO_BASE = 400000;

export const SCENARIOS = [
  {
    id: 'A',
    nom: 'Équilibré',
    resume: 'Recommandé pour démarrer — chaque poste reçoit sa part.',
    prevus: {
      dime: 40000,
      essentielles: 200000,
      famille_aide: 60000,
      famille_etudes: 40000,
      epargne: 15000,
      investissement: 10000,
      business: 5000,
      devperso: 10000,
      loisirs: 10000,
      projets: 5000,
      imprevus: 5000,
    },
  },
  {
    id: 'B',
    nom: 'Investissement & patrimoine',
    resume: 'Le surplus part vers la BRVM et le capital business.',
    prevus: {
      dime: 40000,
      essentielles: 200000,
      famille_aide: 60000,
      famille_etudes: 40000,
      epargne: 10000,
      investissement: 20000,
      business: 15000,
      devperso: 5000,
      loisirs: 5000,
      projets: 0,
      imprevus: 5000,
    },
  },
  {
    id: 'C',
    nom: 'Développement personnel & carrière',
    resume: 'La priorité va aux compétences et à l’image.',
    prevus: {
      dime: 40000,
      essentielles: 200000,
      famille_aide: 60000,
      famille_etudes: 40000,
      epargne: 10000,
      investissement: 5000,
      business: 5000,
      devperso: 25000,
      loisirs: 10000,
      projets: 0,
      imprevus: 5000,
    },
  },
];

export const SCENARIOS_PAR_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

export const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const MOIS_COURT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

/** Repères de coûts Dakar 2026 (§9) — suggestions de saisie, jamais imposées. */
export const REPERES_DAKAR = [
  { label: 'Logement (chambre/studio meublé)', montant: 80000 },
  { label: 'Charges (eau/électricité)', montant: 15000 },
  { label: 'Alimentation', montant: 55000 },
  { label: 'Transport (BRT/bus + appoint VTC)', montant: 30000 },
  { label: 'Télécom (forfait + internet)', montant: 12000 },
  { label: 'Santé courante', montant: 8000 },
];

export const SINKING_FUNDS_DEFAUT = [
  { id: 'iphone', nom: 'iPhone (format compact)', cible: 400000, priorite: 1 },
  { id: 'ipad', nom: 'iPad', cible: 400000, priorite: 2 },
  { id: 'macbook', nom: 'MacBook Air', cible: 650000, priorite: 3 },
  { id: 'zflip', nom: 'Samsung Galaxy Z Flip', cible: 800000, priorite: 4 },
];

export const STATUTS = {
  neutre: { label: '—', aria: 'Rien de prévu ni dépensé', glyphe: '·' },
  ok: { label: 'ok', aria: 'Dans le budget', glyphe: '●' },
  attention: { label: 'attention', aria: 'Proche de la limite', glyphe: '▲' },
  depasse: { label: 'dépassé', aria: 'Budget dépassé', glyphe: '✕' },
};
