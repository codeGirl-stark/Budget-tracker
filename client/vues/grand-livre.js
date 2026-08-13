/**
 * Grand livre annuel (§6.4) — les douze mois d'un coup d'œil.
 */

import { el, echelonner } from '../lib/dom.js';
import { montant, montantSigne, pourcent, nombre } from '../lib/format.js';
import { bloc, bouton, champSelect, chiffre, chiffreEcart, indice, messageVide } from '../lib/composants.js';
import { MOIS } from '/shared/categories.js';
import { kpisAnnee } from '/shared/model.js';

export function vueGrandLivre(ctx) {
  const { state, annee } = ctx;
  const devise = state.currency;
  const kpis = kpisAnnee(state, annee);
  const annees = Object.keys(state.years).map(Number).sort((a, b) => a - b);

  const lignes = kpis.lignes.map((ligne) => {
    const rang = el(`tr.livre__ligne${ligne.actif ? '' : '.livre__ligne--vide'}`, {
      tabindex: '0',
      role: 'link',
      'aria-label': `${MOIS[ligne.index]} ${annee} — revenu ${montant(ligne.revenu, devise)}, dépenses ${montant(ligne.reel, devise)}, solde ${montantSigne(ligne.solde, devise)}. Ouvrir ce mois.`,
      onclick: () => ctx.naviguer(`/budget/${annee}/${ligne.index}`),
      onkeydown: (evenement) => {
        if (evenement.key === 'Enter' || evenement.key === ' ') {
          evenement.preventDefault();
          ctx.naviguer(`/budget/${annee}/${ligne.index}`);
        }
      },
    }, [
      el('th.livre__td.livre__td--nom', { scope: 'row' }, [
        el('span.grand-livre__mois', MOIS[ligne.index]),
        ligne.actif ? null : el('span.grand-livre__vide', 'vide'),
      ]),
      el('td.livre__td.livre__td--num', chiffre(ligne.revenu)),
      el('td.livre__td.livre__td--num', chiffre(ligne.reel)),
      el('td.livre__td.livre__td--num', chiffreEcart(ligne.solde)),
      el('td.livre__td.livre__td--num', el('span.chiffre', montantSigne(ligne.soldeCumule))),
      el('td.livre__td.livre__td--num', el('span.chiffre', pourcent(ligne.tauxEpargne, { decimale: true }))),
      el('td.livre__td.livre__td--num', el('span.chiffre.chiffre--sourdine', pourcent(ligne.dependanceSalaire))),
      el('td.livre__td.livre__td--action', el('span.grand-livre__fleche', { 'aria-hidden': 'true' }, '›')),
    ]);
    return rang;
  });

  echelonner(lignes, 24);

  const table = el('table.livre.livre--annuel', [
    el('caption.hors-ecran', `Récapitulatif des douze mois de ${annee}`),
    el('thead', el('tr', [
      el('th.livre__th.livre__th--nom', { scope: 'col' }, 'Mois'),
      el('th.livre__th.livre__th--num', { scope: 'col' }, 'Revenu'),
      el('th.livre__th.livre__th--num', { scope: 'col' }, 'Dépenses'),
      el('th.livre__th.livre__th--num', { scope: 'col' }, 'Solde'),
      el('th.livre__th.livre__th--num', { scope: 'col' }, 'Cumulé'),
      el('th.livre__th.livre__th--num', { scope: 'col' }, ['Épargne', indice('Épargne + investissement + business, rapportés au revenu du mois. La dîme n’est pas comptée.')]),
      el('th.livre__th.livre__th--num', { scope: 'col' }, ['Dép. salaire', indice('Part du revenu du mois provenant de sources stables.')]),
      el('th.livre__th.livre__th--action', { scope: 'col' }, el('span.hors-ecran', 'Ouvrir')),
    ])),
    el('tbody.livre__corps', lignes),
    el('tfoot.livre__pied', el('tr', [
      el('th.livre__td.livre__td--nom', { scope: 'row' }, `Total ${annee}`),
      el('td.livre__td.livre__td--num', chiffre(kpis.revenus)),
      el('td.livre__td.livre__td--num', chiffre(kpis.depenses)),
      el('td.livre__td.livre__td--num', chiffreEcart(kpis.solde)),
      el('td.livre__td.livre__td--num', el('span.chiffre.chiffre--sourdine', '—')),
      el('td.livre__td.livre__td--num', el('span.chiffre', pourcent(kpis.tauxEpargne, { decimale: true }))),
      el('td.livre__td.livre__td--num', el('span.chiffre.chiffre--sourdine', pourcent(kpis.dependanceSalaire))),
      el('td.livre__td.livre__td--action'),
    ])),
  ]);

  return el('div.vue.vue--grand-livre', [
    el('header.vue__tete', [
      el('div.vue__titre-zone', [
        el('p.vue__sur-titre', 'Grand livre'),
        el('h1.vue__titre', ['Exercice ', el('span.vue__annee', String(annee))]),
      ]),
      el('div.vue__outils', [
        annees.length > 1
          ? champSelect({
            valeur: annee,
            aria: 'Année du grand livre',
            options: annees.map((a) => ({ valeur: a, label: String(a) })),
            onchange: (valeur) => ctx.naviguer(`/grand-livre/${valeur}`),
          })
          : null,
        bouton('Exporter en JSON', { variante: 'discret', onclick: () => ctx.exporter() }),
      ]),
      el('p.vue__intro', 'Clique sur une ligne pour ouvrir le mois correspondant dans le budget.'),
    ]),

    bloc({
      classe: 'bloc--livre',
      corps: kpis.lignes.some((l) => l.actif)
        ? el('div.livre__cadre', table)
        : messageVide(
          `Rien n’est encore enregistré pour ${annee}.`,
          bouton('Ouvrir janvier', { variante: 'primaire', onclick: () => ctx.naviguer(`/budget/${annee}/0`) }),
        ),
    }),

    resumeAnnuel(kpis, devise),
  ]);
}

function resumeAnnuel(kpis, devise) {
  const actifs = kpis.lignes.filter((l) => l.actif);
  if (actifs.length === 0) return null;

  const meilleur = [...actifs].sort((a, b) => b.solde - a.solde)[0];
  const pire = [...actifs].sort((a, b) => a.solde - b.solde)[0];
  const moyenneRevenu = Math.round(actifs.reduce((s, l) => s + l.revenu, 0) / actifs.length);
  const moyenneDepense = Math.round(actifs.reduce((s, l) => s + l.reel, 0) / actifs.length);

  return bloc({
    titre: 'Lecture de l’exercice',
    classe: 'bloc--resume-annuel',
    corps: el('dl.resume-annuel', [
      el('dt', `Mois renseignés`), el('dd.chiffre', `${actifs.length} / 12`),
      el('dt', 'Revenu moyen'), el('dd.chiffre', montant(moyenneRevenu, devise)),
      el('dt', 'Dépense moyenne'), el('dd.chiffre', montant(moyenneDepense, devise)),
      // La couleur suit le signe, pas le rang : un « pire mois » resté positif
      // ne doit pas s'afficher en rouge.
      el('dt', 'Meilleur mois'),
      el('dd', [MOIS[meilleur.index], ' — ', chiffre(meilleur.solde, { devise, signe: true, ton: meilleur.solde < 0 ? 'brique' : 'sauge' })]),
      el('dt', 'Mois le plus tendu'),
      el('dd', [MOIS[pire.index], ' — ', chiffre(pire.solde, { devise, signe: true, ton: pire.solde < 0 ? 'brique' : 'sauge' })]),
    ]),
  });
}
