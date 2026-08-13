/**
 * Tableau de bord (§6.1) — la vue qui répond à « où j'en suis cette année ? »
 */

import { el, remplacer, echelonner } from '../lib/dom.js';
import { montant, montantSigne, pourcent, nombre } from '../lib/format.js';
import { kpi, bloc, barreProgression, champSelect, indice, messageVide, bouton } from '../lib/composants.js';
import { grapheAnnuel, grapheRepartition, sparkline } from '../lib/graphiques.js';
import { MOIS } from '/shared/categories.js';
import { kpisAnnee, repartitionDepenses, etatFonds, cumulSinkingFunds } from '/shared/model.js';

/** Période retenue pour le camembert — conservée d'une visite à l'autre. */
let periodeRepartition = 'annee';

export function vueTableauBord(ctx) {
  const { state, annee } = ctx;
  const devise = state.currency;
  const kpis = kpisAnnee(state, annee);
  const moisReference = derniereActivite(kpis.lignes);

  return el('div.vue.vue--bord', [
    el('header.vue__tete', [
      el('div.vue__titre-zone', [
        el('p.vue__sur-titre', 'Tableau de bord'),
        el('h1.vue__titre', ['Année ', el('span.vue__annee', String(annee))]),
      ]),
      el('div.vue__outils', selecteurAnnee(ctx)),
    ]),

    blocKpis(ctx, kpis, devise),

    bloc({
      titre: 'Revenus et dépenses, mois par mois',
      description: 'Les barres comparent ce qui rentre et ce qui sort ; la ligne suit le solde accumulé depuis janvier.',
      classe: 'bloc--graphe',
      corps: kpis.lignes.some((l) => l.actif)
        ? grapheAnnuel(kpis.lignes, { devise, onmois: (index) => ctx.naviguer(`/budget/${annee}/${index}`) })
        : messageVide(
          'Aucun mouvement enregistré sur cette année.',
          bouton('Ouvrir janvier', { variante: 'primaire', onclick: () => ctx.naviguer(`/budget/${annee}/0`) }),
        ),
    }),

    el('div.colonnes.colonnes--bord', [
      blocRepartition(ctx, devise),
      blocFonds(ctx, moisReference, devise),
    ]),

    blocDependance(ctx, kpis, devise),
  ]);
}

/* ------------------------------------------------------------------ */

function selecteurAnnee(ctx) {
  const annees = Object.keys(ctx.state.years).map(Number).sort((a, b) => a - b);
  // Une seule année : le titre l'affiche déjà, inutile de la répéter.
  if (annees.length <= 1) return null;
  return champSelect({
    valeur: ctx.annee,
    aria: 'Année affichée',
    options: annees.map((a) => ({ valeur: a, label: String(a) })),
    onchange: (valeur) => ctx.naviguer(`/tableau-bord/${valeur}`),
  });
}

/** Dernier mois où quelque chose s'est passé — sert de référence aux fonds. */
function derniereActivite(lignes) {
  for (let i = 11; i >= 0; i -= 1) if (lignes[i].actif) return i;
  return 0;
}

/* ------------------------------------------------------------------ *
 * KPIs (§6.1, §10.4)
 * ------------------------------------------------------------------ */

function blocKpis(ctx, kpis, devise) {
  const cartes = [
    kpi({
      label: 'Revenus',
      valeur: montant(kpis.revenus, devise),
      detail: 'Toutes sources confondues',
      ton: 'laiton',
    }),
    kpi({
      label: 'Dépenses réelles',
      valeur: montant(kpis.depenses, devise),
      detail: 'Somme des écritures des 11 catégories',
      ton: 'brique',
    }),
    kpi({
      label: 'Solde net',
      valeur: montantSigne(kpis.solde, devise),
      detail: kpis.solde >= 0 ? 'Non encore affecté' : 'Sorties supérieures aux entrées',
      ton: kpis.solde < 0 ? 'brique' : 'sauge',
    }),
    kpi({
      label: 'Taux d’épargne effectif',
      valeur: pourcent(kpis.tauxEpargne, { decimale: true }),
      detail: 'Épargne + investissement + business',
      ton: 'sauge',
      aide: 'Part du revenu qui construit du capital. La dîme n’entre volontairement pas dans ce calcul.',
    }),
    kpi({
      label: 'Dépendance au salaire',
      valeur: pourcent(kpis.dependanceSalaire, { decimale: true }),
      detail: 'Part des revenus de type stable',
      ton: 'ardoise',
      aide: 'Un indicateur qu’on veut voir baisser : plus il descend, plus tes revenus sont diversifiés.',
    }),
  ];

  echelonner(cartes, 60);
  return el('div.grille.grille--kpi', cartes);
}

/* ------------------------------------------------------------------ *
 * Répartition des dépenses, avec sélecteur de période
 * ------------------------------------------------------------------ */

function blocRepartition(ctx, devise) {
  const corps = el('div.repartition-conteneur');

  const dessiner = () => {
    const index = periodeRepartition === 'annee' ? null : Number(periodeRepartition);
    remplacer(corps, grapheRepartition(repartitionDepenses(ctx.state, ctx.annee, index), { devise }));
  };

  const selecteur = champSelect({
    valeur: periodeRepartition,
    aria: 'Période de la répartition',
    options: [
      { valeur: 'annee', label: 'Année entière' },
      ...MOIS.map((nom, i) => ({ valeur: String(i), label: nom })),
    ],
    onchange: (valeur) => { periodeRepartition = valeur; dessiner(); },
  });

  dessiner();

  return bloc({
    titre: 'Où part l’argent',
    description: 'Répartition des dépenses réellement enregistrées.',
    classe: 'bloc--repartition',
    actions: selecteur,
    corps,
  });
}

/* ------------------------------------------------------------------ *
 * Progression des fonds (§5, résumé compact)
 * ------------------------------------------------------------------ */

function blocFonds(ctx, moisReference, devise) {
  const fonds = etatFonds(ctx.state, ctx.annee, moisReference);
  const { fonds: sousFonds } = cumulSinkingFunds(ctx.state);
  const prioritaires = [...sousFonds].sort((a, b) => a.priorite - b.priorite).slice(0, 2);

  const barres = [
    barreProgression({ libelle: fonds.urgence.nom, cumul: fonds.urgence.cumul, cible: fonds.urgence.cible, ton: 'sauge', devise }),
    barreProgression({ libelle: `${fonds.etudes.nom} (${ctx.annee})`, cumul: fonds.etudes.cumul, cible: fonds.etudes.cible, ton: 'ocre', devise }),
    barreProgression({ libelle: fonds.business.nom, cumul: fonds.business.cumul, cible: fonds.business.cible, ton: 'teal', devise }),
    barreProgression({ libelle: fonds.investissement.nom, cumul: fonds.investissement.cumul, cible: null, ton: 'ardoise', devise }),
    ...prioritaires.map((sf) => barreProgression({ libelle: sf.nom, cumul: sf.cumul, cible: sf.cible, ton: 'encre', devise })),
  ];

  echelonner(barres, 50);

  return bloc({
    titre: 'Progression des fonds',
    description: 'Cumuls sur toutes les années enregistrées.',
    classe: 'bloc--fonds-resume',
    actions: bouton('Tout voir', { variante: 'discret', onclick: () => ctx.naviguer('/fonds') }),
    corps: [
      el('div.fonds-resume', barres),
      el('p.note', [
        'Le portefeuille investissement affiche le ',
        el('strong', 'capital versé'),
        ', pas sa valeur de marché.',
      ]),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Dépendance au salaire mois par mois (§10.4)
 * ------------------------------------------------------------------ */

function blocDependance(ctx, kpis, devise) {
  const valeurs = kpis.lignes.map((ligne) => ligne.dependanceSalaire);
  const renseignes = valeurs.filter((v) => v !== null);
  const dernier = renseignes.at(-1) ?? null;
  const premier = renseignes[0] ?? null;
  const evolution = premier !== null && dernier !== null ? dernier - premier : null;

  return bloc({
    titre: 'Dépendance au salaire',
    description: 'Part des revenus stables dans le total, mois après mois. L’objectif est de la voir descendre.',
    classe: 'bloc--dependance',
    corps: el('div.dependance', [
      sparkline(valeurs, { ton: 'ardoise', libelle: 'Dépendance au salaire' }),
      el('div.dependance__lecture', [
        el('p.dependance__valeur', [
          el('span.chiffre.chiffre--grand', pourcent(dernier, { decimale: true })),
          el('span.dependance__legende', 'sur le dernier mois renseigné'),
        ]),
        evolution === null || renseignes.length < 2
          ? el('p.note', 'Il faut au moins deux mois renseignés pour lire une tendance.')
          : el('p.note', evolution < 0
            ? `En baisse de ${pourcent(Math.abs(evolution), { decimale: true })} depuis le premier mois renseigné — la diversification progresse.`
            : evolution > 0
              ? `En hausse de ${pourcent(evolution, { decimale: true })} depuis le premier mois renseigné.`
              : 'Stable depuis le premier mois renseigné.'),
        el('p.note', [
          '100 % signifie que tout vient du salaire. ',
          'Chaque revenu variable encaissé fait mécaniquement baisser cet indicateur.',
        ]),
      ]),
    ]),
  });
}
