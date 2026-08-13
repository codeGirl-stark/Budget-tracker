/**
 * Fonds & Projets (§6.3) — les cumuls qui ne se lisent pas sur un seul mois.
 */

import { el, remplacer, echelonner } from '../lib/dom.js';
import { montant, nombre, pourcent } from '../lib/format.js';
import {
  bloc, barreProgression, champMontant, champTexte, champSelect, bouton, boutonSupprimer,
  messageVide, message, confirmer, indice, alerte,
} from '../lib/composants.js';
import { MOIS } from '/shared/categories.js';
import { etatFonds, cumulSinkingFunds, cibleUrgence, kpisAnnee, slug, nouvelId } from '/shared/model.js';

export function vueFonds(ctx) {
  const { state, annee } = ctx;
  const devise = state.currency;
  const lignes = kpisAnnee(state, annee).lignes;
  const moisReference = derniereActivite(lignes);
  const fonds = etatFonds(state, annee, moisReference);

  const cartes = [
    carteUrgence(ctx, fonds.urgence, moisReference, devise),
    carteEtudes(ctx, fonds.etudes, devise),
    carteBusiness(ctx, fonds.business, devise),
    carteInvestissement(fonds.investissement, devise),
  ];
  echelonner(cartes, 55);

  return el('div.vue.vue--fonds', [
    el('header.vue__tete', [
      el('div.vue__titre-zone', [
        el('p.vue__sur-titre', 'Fonds & projets'),
        el('h1.vue__titre', 'Ce qui s’accumule'),
      ]),
      el('p.vue__intro', 'Ces montants additionnent tous les réels enregistrés, sur toutes les années. Ils se construisent sur la durée, pas sur douze mois.'),
    ]),

    el('div.grille.grille--fonds', cartes),

    blocSinkingFunds(ctx, devise),
  ]);
}

function derniereActivite(lignes) {
  for (let i = 11; i >= 0; i -= 1) if (lignes[i].actif) return i;
  return 0;
}

/* ------------------------------------------------------------------ *
 * Fonds d'urgence — cible = X mois de (essentielles + aide familiale)
 * ------------------------------------------------------------------ */

function carteUrgence(ctx, fonds, moisReference, devise) {
  const detail = fonds.detail;

  return el('article.carte-fonds', [
    el('header.carte-fonds__tete', [
      el('h2.carte-fonds__titre', fonds.nom),
      el('p.carte-fonds__source', 'Alimenté par le cumul de la catégorie Épargne'),
    ]),
    barreProgression({ cumul: fonds.cumul, cible: fonds.cible, ton: 'sauge', devise }),
    el('div.carte-fonds__reglage', [
      el('label.champ', [
        el('span.champ__label', ['Couverture visée', indice('Nombre de mois de dépenses essentielles + aide familiale que le fonds doit pouvoir absorber.')]),
        champSelect({
          valeur: String(detail.multiplicateur),
          aria: 'Nombre de mois de couverture',
          options: [3, 6, 9, 12].map((n) => ({ valeur: String(n), label: `${n} mois` })),
          onchange: (valeur) => ctx.muter((state) => { state.fondsCibles.urgenceMois = Number(valeur); }),
        }),
      ]),
      el('p.carte-fonds__calcul', detail.base > 0
        ? [
          'Base de calcul : ', el('span.chiffre', montant(detail.base, devise)),
          ` par mois (essentielles + aide familiale de ${MOIS[moisReference].toLowerCase()}), × ${detail.multiplicateur}.`,
        ]
        : 'Renseigne un budget essentielles et aide familiale pour que la cible se calcule.'),
    ]),
  ]);
}

/* ------------------------------------------------------------------ *
 * Fonds études des frères — objectif annuel éditable
 * ------------------------------------------------------------------ */

function carteEtudes(ctx, fonds, devise) {
  return el('article.carte-fonds', [
    el('header.carte-fonds__tete', [
      el('h2.carte-fonds__titre', fonds.nom),
      el('p.carte-fonds__source', 'Épargne dédiée, tenue à part de l’épargne personnelle'),
    ]),
    barreProgression({ cumul: fonds.cumul, cible: fonds.cible, ton: 'ocre', devise }),
    el('div.carte-fonds__reglage', [
      el('label.champ', [
        el('span.champ__label', 'Objectif annuel'),
        el('span.champ__saisie', [
          champMontant({
            valeur: fonds.cible,
            aria: 'Objectif annuel du fonds études',
            onfin: (valeur) => ctx.muter((state) => { state.fondsCibles.etudesAnnuel = valeur; }),
          }),
          el('span.champ__unite', devise === 'XOF' ? 'FCFA' : devise),
        ]),
      ]),
      el('p.carte-fonds__calcul', [
        'Cumul toutes années : ', el('span.chiffre', montant(fonds.cumulTotal, devise)), '.',
      ]),
    ]),
  ]);
}

/* ------------------------------------------------------------------ *
 * Business Fund — cible facultative
 * ------------------------------------------------------------------ */

function carteBusiness(ctx, fonds, devise) {
  return el('article.carte-fonds', [
    el('header.carte-fonds__tete', [
      el('h2.carte-fonds__titre', fonds.nom),
      el('p.carte-fonds__source', 'Capital dédié aux futurs projets entrepreneuriaux'),
    ]),
    barreProgression({ cumul: fonds.cumul, cible: fonds.cible, ton: 'teal', devise }),
    el('div.carte-fonds__reglage', [
      el('label.champ', [
        el('span.champ__label', ['Objectif (facultatif)', indice('Laisse à 0 pour suivre seulement le capital accumulé, sans cible.')]),
        el('span.champ__saisie', [
          champMontant({
            valeur: fonds.cible ?? 0,
            aria: 'Objectif du Business Fund',
            onfin: (valeur) => ctx.muter((state) => { state.fondsCibles.businessCible = valeur; }),
          }),
          el('span.champ__unite', devise === 'XOF' ? 'FCFA' : devise),
        ]),
      ]),
    ]),
  ]);
}

/* ------------------------------------------------------------------ *
 * Portefeuille investissement — pas de cible, une mise en garde
 * ------------------------------------------------------------------ */

function carteInvestissement(fonds, devise) {
  return el('article.carte-fonds', [
    el('header.carte-fonds__tete', [
      el('h2.carte-fonds__titre', fonds.nom),
      el('p.carte-fonds__source', 'BRVM et autres placements'),
    ]),
    barreProgression({ cumul: fonds.cumul, cible: null, ton: 'ardoise', devise }),
    el('div.carte-fonds__reglage',
      alerte(
        'Ce chiffre est le capital que tu as versé. L’application ne suit pas la performance de tes placements : la valeur de marché réelle est à consulter chez ta SGI.',
        { ton: 'info', titre: 'Capital versé, pas valeur de marché' },
      )),
  ]);
}

/* ------------------------------------------------------------------ *
 * Sinking funds (§5) — liste entièrement éditable
 * ------------------------------------------------------------------ */

function blocSinkingFunds(ctx, devise) {
  const corps = el('div.sinking');

  const dessiner = () => {
    const { fonds, nonAffecte } = cumulSinkingFunds(ctx.state);
    const cartes = fonds.map((sf, index) => carteSousFonds(ctx, sf, index, fonds.length, devise));
    echelonner(cartes, 45);

    remplacer(corps, [
      fonds.length === 0
        ? messageVide('Aucun sous-fonds. Ajoute un projet pour commencer à mettre de côté.')
        : el('div.sinking__liste', cartes),

      nonAffecte > 0
        ? alerte(
          `${montant(nonAffecte, devise)} ont été versés dans la catégorie Fonds projets sans être rattachés à un sous-fonds (ou à un sous-fonds supprimé depuis). Ce montant n’est perdu nulle part, mais il n’avance aucun objectif.`,
          { ton: 'attention', titre: 'Versements non affectés' },
        )
        : null,
    ]);
  };

  dessiner();

  return bloc({
    titre: 'Fonds projets',
    description: 'Un sous-fonds par achat visé. Chaque écriture de la catégorie « Fonds projets » se range dans l’un d’eux.',
    classe: 'bloc--sinking',
    actions: bouton('Ajouter un projet', {
      variante: 'primaire',
      icone: '+',
      onclick: () => ctx.muter((state) => {
        const priorite = Math.max(0, ...state.sinkingFunds.map((f) => f.priorite)) + 1;
        state.sinkingFunds.push({ id: nouvelId('sf'), nom: '', cible: 0, priorite });
      }),
    }),
    corps,
  });
}

function carteSousFonds(ctx, sf, index, total, devise) {
  const modifier = (fn) => ctx.muter((state) => {
    const cible = state.sinkingFunds.find((f) => f.id === sf.id);
    if (cible) fn(cible, state);
  }, { rendu: false });

  const deplacer = (direction) => ctx.muter((state) => {
    const trie = [...state.sinkingFunds].sort((a, b) => a.priorite - b.priorite);
    const position = trie.findIndex((f) => f.id === sf.id);
    const voisin = position + direction;
    if (voisin < 0 || voisin >= trie.length) return false;
    [trie[position], trie[voisin]] = [trie[voisin], trie[position]];
    trie.forEach((f, i) => { f.priorite = i + 1; });
    state.sinkingFunds = trie;
    return true;
  });

  return el('article.sous-fonds', [
    el('div.sous-fonds__rang', [
      el('span.sous-fonds__priorite', { title: `Priorité ${sf.priorite}` }, String(index + 1)),
      el('div.sous-fonds__ordre', [
        el('button.bouton-ordre', {
          type: 'button', title: 'Monter la priorité', 'aria-label': `Monter ${sf.nom || 'ce projet'}`,
          disabled: index === 0, onclick: () => deplacer(-1),
        }, '▲'),
        el('button.bouton-ordre', {
          type: 'button', title: 'Descendre la priorité', 'aria-label': `Descendre ${sf.nom || 'ce projet'}`,
          disabled: index === total - 1, onclick: () => deplacer(1),
        }, '▼'),
      ]),
    ]),

    el('div.sous-fonds__corps', [
      el('div.sous-fonds__entetes', [
        champTexte({
          valeur: sf.nom,
          placeholder: 'Nom du projet',
          aria: 'Nom du sous-fonds',
          classe: 'saisie--titre',
          onsaisie: (valeur) => modifier((fonds) => { fonds.nom = valeur; }),
        }),
        el('span.sous-fonds__cible-champ', [
          el('span.sous-fonds__cible-label', 'Cible'),
          champMontant({
            valeur: sf.cible,
            aria: `Cible du fonds ${sf.nom || 'sans nom'}`,
            onfin: (valeur) => ctx.muter((state) => {
              const cible = state.sinkingFunds.find((f) => f.id === sf.id);
              if (cible) cible.cible = valeur;
            }),
          }),
          el('span.champ__unite', devise === 'XOF' ? 'FCFA' : devise),
        ]),
      ]),
      barreProgression({ cumul: sf.cumul, cible: sf.cible, ton: 'encre', devise }),
    ]),

    boutonSupprimer(`Supprimer le projet ${sf.nom || 'sans nom'}`, async () => {
      const ok = await confirmer({
        titre: `Supprimer « ${sf.nom || 'ce projet'} » ?`,
        texte: sf.cumul > 0
          ? `${montant(sf.cumul, devise)} y ont déjà été versés. Les écritures ne seront pas supprimées, mais elles apparaîtront comme non affectées.`
          : 'Ce sous-fonds ne contient aucun versement.',
        valider: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
      const copie = { ...sf };
      ctx.muter((state) => { state.sinkingFunds = state.sinkingFunds.filter((f) => f.id !== sf.id); });
      message(`Projet « ${copie.nom || 'sans nom'} » supprimé.`, {
        ton: 'info',
        action: {
          label: 'Annuler',
          onclick: () => ctx.muter((state) => {
            state.sinkingFunds.push({ id: copie.id, nom: copie.nom, cible: copie.cible, priorite: copie.priorite });
            state.sinkingFunds.sort((a, b) => a.priorite - b.priorite);
          }),
        },
      });
    }),
  ]);
}
