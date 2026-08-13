import test from 'node:test';
import assert from 'node:assert/strict';

import {
  baseDime,
  prevuDime,
  statutCategorie,
  ligneCategorie,
  totauxMois,
  controleSocle,
  prevusScenario,
  controleScenario,
  repartitionSurplus,
  cumulCategorie,
  cumulSinkingFunds,
  cibleUrgence,
  etatFonds,
  kpisAnnee,
  lignesAnnee,
  repartitionDepenses,
  normaliserState,
  stateInitial,
  montantValide,
  tauxDependanceSalaire,
  moisVide,
} from '../shared/model.js';

const moisAvec = ({ revenus = [], categories = {} } = {}) => {
  const mois = moisVide();
  mois.revenus = revenus;
  for (const [id, valeur] of Object.entries(categories)) {
    mois.categories[id] = { ...mois.categories[id], ...valeur };
  }
  return mois;
};

const salaire = (montant) => ({ id: 'r1', source: 'Salaire', montant, type: 'stable' });
const freelance = (montant) => ({ id: 'r2', source: 'Mission', montant, type: 'variable' });

/* ---------------------------------------------------------------- */
test('montantValide accepte les saisies humaines et refuse le négatif', () => {
  assert.equal(montantValide('40 000'), 40000);
  assert.equal(montantValide('40000,5'), 40001);
  assert.equal(montantValide('abc'), 0);
  assert.equal(montantValide(-500), 0);
  assert.equal(montantValide(undefined), 0);
});

/* ---------------------------------------------------------------- */
test('la dîme vaut 10 % du revenu total par défaut', () => {
  const mois = moisAvec({ revenus: [salaire(400000), freelance(150000)] });
  assert.equal(baseDime(mois, 'total'), 550000);
  assert.equal(prevuDime(mois, 'total'), 55000);
});

test('la dîme peut ne porter que sur le salaire', () => {
  const mois = moisAvec({ revenus: [salaire(400000), freelance(150000)] });
  assert.equal(baseDime(mois, 'salaire_seul'), 400000);
  assert.equal(prevuDime(mois, 'salaire_seul'), 40000);
});

test('le prévu de la dîme est dérivé, jamais lu dans les données', () => {
  const mois = moisAvec({
    revenus: [salaire(300000)],
    categories: { dime: { prevu: 999999, entries: [] } },
  });
  assert.equal(ligneCategorie(mois, 'dime', 'total').prevu, 30000);
});

/* ---------------------------------------------------------------- */
test('les statuts suivent exactement les seuils du cahier des charges', () => {
  assert.equal(statutCategorie(0, 0), 'neutre');
  assert.equal(statutCategorie(0, 1), 'depasse');
  assert.equal(statutCategorie(100, 101), 'depasse');
  assert.equal(statutCategorie(100, 100), 'attention');
  assert.equal(statutCategorie(100, 90), 'attention');
  assert.equal(statutCategorie(100, 89), 'ok');
  assert.equal(statutCategorie(100, 0), 'ok');
});

test('une ligne expose écart, pourcentage et statut', () => {
  const mois = moisAvec({
    categories: {
      loisirs: { prevu: 10000, entries: [{ id: 'e1', label: 'Resto', montant: 12000 }] },
    },
  });
  const ligne = ligneCategorie(mois, 'loisirs');
  assert.equal(ligne.reel, 12000);
  assert.equal(ligne.ecart, -2000);
  assert.equal(ligne.pct, 1.2);
  assert.equal(ligne.statut, 'depasse');
});

test('le pourcentage est nul quand rien n’est prévu', () => {
  assert.equal(ligneCategorie(moisVide(), 'loisirs').pct, null);
});

/* ---------------------------------------------------------------- */
test('les totaux du mois incluent la dîme dérivée et le reste à affecter', () => {
  const mois = moisAvec({
    revenus: [salaire(400000)],
    categories: {
      essentielles: { prevu: 200000, entries: [{ id: 'e1', label: 'Loyer', montant: 80000 }] },
      loisirs: { prevu: 10000, entries: [] },
    },
  });
  const t = totauxMois(mois);
  assert.equal(t.revenu, 400000);
  assert.equal(t.prevu, 40000 + 200000 + 10000);
  assert.equal(t.reel, 80000);
  assert.equal(t.resteAAffecter, 150000);
  assert.equal(t.solde, 320000);
  assert.equal(t.lignes[0].id, 'dime', 'la dîme passe en premier');
});

/* ---------------------------------------------------------------- */
test('le socle doit tenir sur le revenu stable seul', () => {
  const mois = moisAvec({
    revenus: [salaire(250000), freelance(200000)],
    categories: {
      essentielles: { prevu: 200000, entries: [] },
      famille_aide: { prevu: 60000, entries: [] },
      famille_etudes: { prevu: 40000, entries: [] },
    },
  });
  const c = controleSocle(mois, 'total');
  assert.equal(c.socle, 45000 + 200000 + 60000 + 40000);
  assert.equal(c.stable, 250000);
  assert.equal(c.couvert, false);
  assert.equal(c.manque, 95000);
});

/* ---------------------------------------------------------------- */
test('un scénario applique les prévus sans toucher à la dîme', () => {
  const prevus = prevusScenario('A');
  assert.equal(prevus.essentielles, 200000);
  assert.equal(prevus.epargne, 15000);
  assert.equal('dime' in prevus, false);
});

test('le mode proportionnel ré-échelonne le scénario sur le revenu du mois', () => {
  const prevus = prevusScenario('B', { revenu: 600000, proportionnel: true });
  assert.equal(prevus.essentielles, 300000);
  assert.equal(prevus.investissement, 30000);
});

test('un scénario non ré-échelonné signale l’écart avec le revenu', () => {
  const mois = moisAvec({ revenus: [salaire(500000)] });
  const controle = controleScenario(prevusScenario('A'), mois);
  assert.equal(controle.revenu, 500000);
  assert.equal(controle.total, 360000 + 50000);
  assert.equal(controle.ecart, 90000);
});

test('un scénario proportionnel tombe juste sur le revenu du mois', () => {
  const mois = moisAvec({ revenus: [salaire(520000)] });
  const prevus = prevusScenario('A', { revenu: 520000, proportionnel: true });
  assert.equal(controleScenario(prevus, mois).ecart, 0);
});

test('scénario inconnu → null', () => {
  assert.equal(prevusScenario('Z'), null);
});

/* ---------------------------------------------------------------- */
test('la règle du surplus répartit exactement le delta', () => {
  const r = repartitionSurplus(100000);
  assert.equal(r.investissement + r.business, 50000);
  assert.equal(r.epargne, 20000);
  assert.equal(r.devperso + r.loisirs, 15000);
  assert.equal(r.projets, 15000);
  assert.equal(Object.values(r).reduce((a, b) => a + b, 0), 100000);
});

test('la règle du surplus ne perd pas les francs d’arrondi', () => {
  for (const delta of [1, 7, 33333, 99999]) {
    const total = Object.values(repartitionSurplus(delta)).reduce((a, b) => a + b, 0);
    assert.equal(total, delta, `delta ${delta}`);
  }
});

test('un delta négatif ne distribue rien', () => {
  assert.equal(Object.values(repartitionSurplus(-5000)).reduce((a, b) => a + b, 0), 0);
});

/* ---------------------------------------------------------------- */
const stateCumuls = () => normaliserState({
  currentYear: 2026,
  sinkingFunds: [
    { id: 'iphone', nom: 'iPhone', cible: 400000, priorite: 1 },
    { id: 'ipad', nom: 'iPad', cible: 400000, priorite: 2 },
  ],
  years: {
    2025: {
      months: {
        11: {
          revenus: [salaire(400000)],
          categories: {
            epargne: { prevu: 15000, entries: [{ id: 'a', label: 'Versement', montant: 15000 }] },
            projets: { prevu: 5000, entries: [{ id: 'b', label: 'Versement', montant: 5000, sinkingFundId: 'iphone' }] },
          },
        },
      },
    },
    2026: {
      months: {
        0: {
          revenus: [salaire(400000), freelance(100000)],
          categories: {
            epargne: { prevu: 15000, entries: [{ id: 'c', label: 'Versement', montant: 20000 }] },
            famille_etudes: { prevu: 40000, entries: [{ id: 'd', label: 'Frères', montant: 40000 }] },
            essentielles: { prevu: 200000, entries: [{ id: 'e', label: 'Loyer', montant: 80000 }] },
            famille_aide: { prevu: 60000, entries: [] },
            projets: {
              prevu: 5000,
              entries: [
                { id: 'f', label: 'Versement', montant: 10000, sinkingFundId: 'iphone' },
                { id: 'g', label: 'Versement', montant: 7000, sinkingFundId: 'fonds-supprime' },
                { id: 'h', label: 'Versement', montant: 3000 },
              ],
            },
          },
        },
      },
    },
  },
});

test('les cumuls traversent toutes les années', () => {
  const state = stateCumuls();
  assert.equal(cumulCategorie(state, 'epargne'), 35000);
  assert.equal(cumulCategorie(state, 'epargne', { annee: 2026 }), 20000);
});

test('les sinking funds sont ventilés, orphelins compris', () => {
  const { fonds, nonAffecte } = cumulSinkingFunds(stateCumuls());
  const iphone = fonds.find((f) => f.id === 'iphone');
  assert.equal(iphone.cumul, 15000);
  assert.equal(iphone.reste, 385000);
  assert.equal(fonds.find((f) => f.id === 'ipad').cumul, 0);
  assert.equal(nonAffecte, 10000, 'écriture sans fonds + écriture d’un fonds supprimé');
});

test('la cible du fonds d’urgence suit essentielles + aide familiale', () => {
  const state = stateCumuls();
  state.fondsCibles.urgenceMois = 6;
  const { base, cible } = cibleUrgence(state, 2026, 0);
  assert.equal(base, 260000);
  assert.equal(cible, 1560000);
});

test('etatFonds expose progression et capital versé', () => {
  const fonds = etatFonds(stateCumuls(), 2026, 0);
  assert.equal(fonds.urgence.cumul, 35000);
  assert.equal(fonds.etudes.cumul, 40000);
  assert.equal(fonds.investissement.cible, null);
  assert.equal(fonds.business.cible, null);
});

/* ---------------------------------------------------------------- */
test('les KPIs annuels excluent la dîme du taux d’épargne', () => {
  const state = stateCumuls();
  const kpis = kpisAnnee(state, 2026);
  assert.equal(kpis.revenus, 500000);
  assert.equal(kpis.depenses, 20000 + 40000 + 80000 + 20000);
  assert.equal(kpis.solde, 500000 - 160000);
  assert.equal(kpis.tauxEpargne, 20000 / 500000);
  assert.equal(kpis.dependanceSalaire, 400000 / 500000);
});

test('le solde cumulé s’enchaîne de mois en mois', () => {
  const lignes = lignesAnnee(stateCumuls(), 2026);
  assert.equal(lignes[0].solde, 340000);
  assert.equal(lignes[1].soldeCumule, 340000);
  assert.equal(lignes[11].soldeCumule, 340000);
});

test('la répartition des dépenses est triée et sommée à 100 %', () => {
  const rep = repartitionDepenses(stateCumuls(), 2026);
  assert.equal(rep[0].categorie.id, 'essentielles');
  const total = rep.reduce((a, r) => a + r.part, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test('la répartition sur un mois vide ne divise pas par zéro', () => {
  const rep = repartitionDepenses(stateCumuls(), 2026, 5);
  assert.equal(rep.every((r) => r.part === 0), true);
});

/* ---------------------------------------------------------------- */
test('le taux de dépendance au salaire vaut null sans revenu', () => {
  assert.equal(tauxDependanceSalaire(moisVide()), null);
  assert.equal(tauxDependanceSalaire(moisAvec({ revenus: [salaire(100), freelance(300)] })), 0.25);
});

/* ---------------------------------------------------------------- */
test('la normalisation répare des données incomplètes sans rien perdre', () => {
  const state = normaliserState({
    currentYear: '2026',
    currency: 'EUR',
    regleDime: 'nimporte quoi',
    fondsCibles: { urgenceMois: 7 },
    years: {
      2026: { months: { 3: { revenus: [{ source: 'Salaire', montant: '350 000' }], categories: { loisirs: { prevu: '8000', entries: [{ label: 'Ciné', montant: 3000 }] } } } } },
      pasuneannee: { months: {} },
    },
  });
  assert.equal(state.currency, 'EUR');
  assert.equal(state.regleDime, 'total');
  assert.equal(state.fondsCibles.urgenceMois, 3, 'valeur hors liste → défaut');
  assert.equal(Object.keys(state.years).length, 1);
  assert.equal(Object.keys(state.years['2026'].months).length, 12);
  const mois = state.years['2026'].months['3'];
  assert.equal(mois.revenus[0].montant, 350000);
  assert.equal(mois.revenus[0].type, 'stable');
  assert.ok(mois.revenus[0].id, 'un id est généré');
  assert.equal(mois.categories.loisirs.prevu, 8000);
  assert.equal(mois.categories.loisirs.entries[0].montant, 3000);
  assert.equal('prevu' in mois.categories.dime, false, 'la dîme n’a pas de prévu stocké');
  assert.equal(state.sinkingFunds.length, 4, 'les sous-fonds par défaut sont posés');
});

test('la normalisation est idempotente', () => {
  const une = normaliserState(stateInitial({ annee: 2026 }));
  const deux = normaliserState(une);
  assert.deepEqual(deux, une);
});

test('l’état initial arrive avec douze mois et le scénario A', () => {
  const state = stateInitial({ annee: 2026, revenu: 400000 });
  const mois = state.years['2026'].months['0'];
  assert.equal(mois.revenus[0].montant, 400000);
  assert.equal(mois.categories.essentielles.prevu, 200000);
  assert.equal(totauxMois(mois).resteAAffecter, 0, 'le scénario A boucle sur 400 000');
  assert.equal(kpisAnnee(state, 2026).revenus, 4800000);
});
