/**
 * Budget mensuel (§6.2) — le cœur de l'application.
 *
 * Particularité de rendu : la saisie ne déclenche jamais de reconstruction du
 * DOM. Chaque cellule calculée (réel, écart, %, statut, totaux) s'enregistre
 * comme « rafraîchisseur » et se met à jour sur place. Sans ça, taper un
 * montant ferait perdre le focus à chaque frappe.
 */

import { el, frag, remplacer, echelonner } from '../lib/dom.js';
import { nombre, montant, montantSigne, pourcent, lireMontant } from '../lib/format.js';
import {
  champMontant, champTexte, champSelect, bouton, boutonSupprimer, pastilleStatut,
  chiffre, chiffreEcart, bloc, alerte, messageVide, message, confirmer, indice, separateurGroupe,
} from '../lib/composants.js';
import { jaugeRepartitionPrevu } from '../lib/graphiques.js';
import {
  CATEGORIES, GROUPES, MOIS, MOIS_COURT, SCENARIOS, REPERES_DAKAR,
} from '/shared/categories.js';
import {
  getMois, totauxMois, controleSocle, revenuTotal, revenuStable, revenuVariable,
  prevuDime, prevusScenario, controleScenario, repartitionSurplus, nouvelId, montantValide,
} from '/shared/model.js';

/** Catégories dépliées — conservé d'un rendu à l'autre, pas dans les données. */
const depliees = new Set();
/** Suggestions écartées pour la session (clé « annee-mois »). */
const suggestionsIgnorees = new Set();

export function vueBudget(ctx) {
  const { state, annee, mois: indexMois } = ctx;
  // Référence vivante : les rafraîchisseurs relisent cet objet après chaque
  // saisie, il doit donc être celui qui vit dans l'état, pas une copie vide.
  const mois = assurerMois(state, annee, indexMois);
  const rafraichisseurs = [];

  const surMutation = () => { for (const fn of rafraichisseurs) fn(); };
  /** Modifie l'état sans reconstruire la vue, puis met à jour les cellules calculées. */
  const modifier = (fn) => { ctx.muter(fn, { rendu: false }); surMutation(); };

  const racine = el('div.vue.vue--budget', [
    enteteMois(ctx),
    el('div.colonnes.colonnes--budget', [
      el('div.colonnes__principale', [
        blocRevenus(ctx, mois, rafraichisseurs, modifier),
        blocSuggestionSurplus(ctx, mois),
        blocSocle(ctx, mois, rafraichisseurs),
        blocCategories(ctx, mois, rafraichisseurs, modifier),
      ]),
      el('aside.colonnes__laterale', [
        blocScenario(ctx, mois, rafraichisseurs),
        blocSynthese(ctx, mois, rafraichisseurs),
      ]),
    ]),
  ]);

  surMutation();
  return racine;
}

/* ================================================================== *
 * En-tête : année + douze onglets de mois
 * ================================================================== */

function enteteMois(ctx) {
  const { state, annee, mois: indexMois } = ctx;
  const anneesConnues = Object.keys(state.years).map(Number).sort((a, b) => a - b);

  let ongletActif = null;

  const onglets = MOIS.map((nom, i) => {
    const donnees = getMois(state, annee, i);
    const actif = revenuTotal(donnees) > 0 || totauxMois(donnees, state.regleDime).reel > 0;
    const bouton = el(`button.onglet${i === indexMois ? '.onglet--actif' : ''}${actif ? '.onglet--rempli' : ''}`, {
      type: 'button',
      onclick: () => ctx.naviguer(`/budget/${annee}/${i}`),
      'aria-current': i === indexMois ? 'page' : null,
      title: nom,
    }, [
      el('span.onglet__court', MOIS_COURT[i]),
      el('span.onglet__long', nom),
    ]);
    if (i === indexMois) ongletActif = bouton;
    return bouton;
  });

  // Sur écran étroit la barre des mois déborde : on centre le mois courant.
  // On agit sur le seul conteneur horizontal — scrollIntoView ferait défiler
  // toute la page au passage.
  if (ongletActif) {
    requestAnimationFrame(() => {
      const barre = ongletActif.parentElement;
      if (!barre || barre.scrollWidth <= barre.clientWidth) return;
      barre.scrollLeft = ongletActif.offsetLeft - (barre.clientWidth - ongletActif.offsetWidth) / 2;
    });
  }

  return el('header.vue__tete', [
    el('div.vue__titre-zone', [
      el('p.vue__sur-titre', 'Budget mensuel'),
      el('h1.vue__titre', [MOIS[indexMois], el('span.vue__annee', String(annee))]),
    ]),
    el('div.vue__outils', [
      el('div.annee-nav', [
        bouton('←', {
          variante: 'discret icone',
          titre: `Aller à ${annee - 1}`,
          onclick: () => changerAnnee(ctx, annee - 1),
        }),
        el('span.annee-nav__valeur.chiffre', String(annee)),
        bouton('→', {
          variante: 'discret icone',
          titre: `Aller à ${annee + 1}`,
          onclick: () => changerAnnee(ctx, annee + 1),
        }),
      ]),
      anneesConnues.length > 1
        ? champSelect({
          valeur: annee,
          aria: 'Année',
          options: anneesConnues.map((a) => ({ valeur: a, label: String(a) })),
          onchange: (valeur) => ctx.naviguer(`/budget/${valeur}/${indexMois}`),
        })
        : null,
    ]),
    el('nav.onglets', { 'aria-label': 'Mois de l’année' }, onglets),
  ]);
}

function changerAnnee(ctx, cible) {
  if (!ctx.state.years[String(cible)]) {
    ctx.muter((state) => {
      const modele = {};
      for (let i = 0; i < 12; i += 1) modele[String(i)] = { revenus: [], categories: {} };
      state.years[String(cible)] = { months: modele };
    }, { rendu: false });
    message(`Année ${cible} créée.`, { ton: 'info' });
  }
  ctx.naviguer(`/budget/${cible}/${ctx.mois}`);
}

/* ================================================================== *
 * Revenus du mois (§6.2, §10.1)
 * ================================================================== */

function blocRevenus(ctx, mois, rafraichisseurs, modifier) {
  const devise = ctx.state.currency;
  const corps = el('div.revenus');

  const construire = () => {
    const sources = mois.revenus ?? [];
    const lignes = sources.map((source) => ligneRevenu(ctx, mois, source, modifier));

    return frag(
      sources.length === 0
        ? messageVide('Aucune source de revenu pour ce mois.')
        : el('ul.revenus__liste', lignes.map((ligne) => el('li.revenus__item', ligne))),

      el('div.revenus__ajout', [
        bouton('Ajouter une source', {
          variante: 'discret',
          icone: '+',
          onclick: () => {
            ctx.muter((state) => {
              const cible = assurerMois(state, ctx.annee, ctx.mois);
              cible.revenus.push({
                id: nouvelId('r'),
                source: '',
                montant: 0,
                type: cible.revenus.some((r) => r.type === 'stable') ? 'variable' : 'stable',
              });
            });
          },
        }),
        (mois.revenus ?? []).length === 0 && ctx.state.revenuMensuelDefaut > 0
          ? bouton(`Reprendre le salaire par défaut (${montant(ctx.state.revenuMensuelDefaut, devise)})`, {
            variante: 'discret',
            onclick: () => {
              ctx.muter((state) => {
                assurerMois(state, ctx.annee, ctx.mois).revenus.push({
                  id: nouvelId('r'), source: 'Salaire', montant: state.revenuMensuelDefaut, type: 'stable',
                });
              });
            },
          })
          : null,
      ]),
    );
  };

  remplacer(corps, construire());

  const totalStable = el('span.chiffre');
  const totalVariable = el('span.chiffre');
  const totalGeneral = el('strong.chiffre.chiffre--grand');
  const noteVariable = el('div.revenus__note');

  rafraichisseurs.push(() => {
    const total = revenuTotal(mois);
    const stable = revenuStable(mois);
    const variable = revenuVariable(mois);
    totalGeneral.textContent = montant(total, devise);
    totalStable.textContent = montant(stable, devise);
    totalVariable.textContent = montant(variable, devise);

    // §10.3 : un revenu variable n'a pas vocation à financer le quotidien.
    remplacer(noteVariable, variable > 0
      ? alerte(
        'Ces revenus ponctuels sont mieux employés en investissement, business ou fonds projets qu’à couvrir des dépenses courantes.',
        { ton: 'info', titre: `${montant(variable, devise)} de revenus variables ce mois` },
      )
      : null);
  });

  return bloc({
    titre: 'Revenus du mois',
    description: 'Une ligne par source. Le total sert de base à la dîme et aux scénarios.',
    classe: 'bloc--revenus',
    actions: el('div.revenus__total', [
      el('span.revenus__total-label', 'Total'),
      totalGeneral,
      el('span.revenus__total-detail', [
        el('span', ['stable ', totalStable]),
        el('span', ['variable ', totalVariable]),
      ]),
    ]),
    corps: [corps, noteVariable],
  });
}

function ligneRevenu(ctx, mois, source, modifier) {
  const devise = ctx.state.currency;
  const trouver = (state) => assurerMois(state, ctx.annee, ctx.mois).revenus.find((r) => r.id === source.id);

  return frag(
    champTexte({
      valeur: source.source,
      placeholder: 'Libellé (Salaire, Mission freelance…)',
      aria: 'Libellé de la source de revenu',
      classe: 'saisie--extensible',
      onsaisie: (valeur) => modifier((state) => { const r = trouver(state); if (r) r.source = valeur; }),
    }),
    champSelect({
      valeur: source.type,
      aria: 'Type de revenu',
      classe: 'saisie--type',
      options: [
        { valeur: 'stable', label: 'Stable' },
        { valeur: 'variable', label: 'Variable' },
      ],
      onchange: (valeur) => {
        ctx.muter((state) => { const r = trouver(state); if (r) r.type = valeur; });
        if (valeur === 'variable') {
          message('Revenu variable : pense à l’orienter vers investissement, business ou fonds projets.', { ton: 'info', duree: 7000 });
        }
      },
    }),
    champMontant({
      valeur: source.montant,
      aria: `Montant de ${source.source || 'la source'}`,
      classe: 'saisie--montant',
      onsaisie: (valeur) => modifier((state) => { const r = trouver(state); if (r) r.montant = valeur; }),
    }),
    el('span.revenus__devise', ctx.state.currency === 'XOF' ? 'FCFA' : ctx.state.currency),
    boutonSupprimer(`Supprimer la source ${source.source || 'sans nom'}`, async () => {
      if (source.montant > 0 || source.source) {
        const ok = await confirmer({
          titre: 'Supprimer cette source ?',
          texte: `« ${source.source || 'Source sans nom'} » — ${montant(source.montant, devise)} sera retiré du revenu du mois.`,
          valider: 'Supprimer',
          danger: true,
        });
        if (!ok) return;
      }
      ctx.muter((state) => {
        const cible = assurerMois(state, ctx.annee, ctx.mois);
        cible.revenus = cible.revenus.filter((r) => r.id !== source.id);
      });
    }),
  );
}

/* ================================================================== *
 * Suggestion §10.2 — le salaire a augmenté par rapport au mois précédent
 * ================================================================== */

function blocSuggestionSurplus(ctx, mois) {
  const { state, annee, mois: indexMois } = ctx;
  const cle = `${annee}-${indexMois}`;
  if (suggestionsIgnorees.has(cle)) return null;
  if (indexMois === 0) return null;

  const precedent = getMois(state, annee, indexMois - 1);
  const avant = revenuStable(precedent);
  const apres = revenuStable(mois);
  const delta = apres - avant;
  if (avant <= 0 || delta <= 0) return null;

  const repartition = repartitionSurplus(delta, state.regleSurplus);
  const devise = state.currency;
  const detail = Object.entries(repartition)
    .filter(([, valeur]) => valeur > 0)
    .map(([id, valeur]) => `${CATEGORIES.find((c) => c.id === id)?.nom ?? id} +${nombre(valeur)}`)
    .join(' · ');

  return el('div.suggestion', [
    el('div.suggestion__corps', [
      el('h3.suggestion__titre', `Ton revenu stable a augmenté de ${montant(delta, devise)}`),
      el('p.suggestion__texte', [
        'Le socle (dîme, essentielles, famille) reste volontairement inchangé. Ta règle du surplus propose de répartir ce delta ainsi : ',
        el('span.suggestion__detail', detail),
        '.',
      ]),
    ]),
    el('div.suggestion__actions', [
      bouton('Appliquer au prévu', {
        variante: 'primaire',
        onclick: () => {
          ctx.muter((state) => {
            const cible = assurerMois(state, annee, indexMois);
            for (const [id, valeur] of Object.entries(repartition)) {
              if (!valeur) continue;
              cible.categories[id].prevu = montantValide(cible.categories[id].prevu) + valeur;
            }
          });
          suggestionsIgnorees.add(cle);
          message(`Surplus de ${montant(delta, devise)} réparti sur le prévu.`, { ton: 'succes' });
        },
      }),
      bouton('Ignorer', {
        variante: 'discret',
        onclick: () => { suggestionsIgnorees.add(cle); ctx.rafraichir(); },
      }),
    ]),
  ]);
}

/* ================================================================== *
 * Contrôle du socle (§10.3)
 * ================================================================== */

function blocSocle(ctx, mois, rafraichisseurs) {
  const conteneur = el('div.socle');
  const devise = ctx.state.currency;

  rafraichisseurs.push(() => {
    const controle = controleSocle(mois, ctx.state.regleDime);
    if (controle.stable === 0 && controle.socle === 0) return remplacer(conteneur, null);
    remplacer(conteneur, controle.couvert
      ? alerte(
        `Le socle prévu (${montant(controle.socle, devise)}) tient sur le seul revenu stable (${montant(controle.stable, devise)}).`,
        { ton: 'ok', titre: 'Socle sécurisé' },
      )
      : alerte(
        `Le socle prévu atteint ${montant(controle.socle, devise)} alors que le revenu stable n’est que de ${montant(controle.stable, devise)}. Il manque ${montant(controle.manque, devise)} qui reposeraient sur des revenus variables.`,
        { ton: 'attention', titre: 'Le socle dépasse le revenu stable' },
      ));
  });

  return conteneur;
}

/* ================================================================== *
 * Scénarios (§4)
 * ================================================================== */

function blocScenario(ctx, mois, rafraichisseurs) {
  const { state } = ctx;
  const devise = state.currency;
  let choisi = state.scenarioActif ?? 'A';
  let proportionnel = false;

  const apercu = el('p.scenario__apercu');
  const resume = el('p.scenario__resume');

  const majApercu = () => {
    const scenario = SCENARIOS.find((s) => s.id === choisi);
    resume.textContent = scenario?.resume ?? '';
    const prevus = prevusScenario(choisi, { revenu: revenuTotal(mois), proportionnel });
    if (!prevus) return;
    const controle = controleScenario(prevus, mois, state.regleDime);
    if (controle.revenu === 0) {
      apercu.textContent = 'Renseigne d’abord un revenu pour ce mois.';
      apercu.className = 'scenario__apercu scenario__apercu--neutre';
      return;
    }
    if (controle.ecart === 0) {
      apercu.textContent = `Le total prévu tombe juste sur le revenu du mois (${montant(controle.revenu, devise)}).`;
      apercu.className = 'scenario__apercu scenario__apercu--ok';
    } else if (controle.ecart > 0) {
      apercu.textContent = `Il resterait ${montant(controle.ecart, devise)} non affectés sur le revenu du mois.`;
      apercu.className = 'scenario__apercu scenario__apercu--laiton';
    } else {
      apercu.textContent = `Ce scénario dépasserait le revenu du mois de ${montant(-controle.ecart, devise)}.`;
      apercu.className = 'scenario__apercu scenario__apercu--brique';
    }
  };

  rafraichisseurs.push(majApercu);

  const appliquer = async (surAnnee) => {
    const revenuRef = revenuTotal(mois);
    if (proportionnel && revenuRef === 0) {
      message('Impossible de proportionner sans revenu renseigné.', { ton: 'erreur' });
      return;
    }
    const ok = await confirmer({
      titre: surAnnee ? `Appliquer le scénario ${choisi} à toute l’année ${ctx.annee} ?` : `Appliquer le scénario ${choisi} à ${MOIS[ctx.mois]} ?`,
      texte: 'Le champ Prévu de chaque catégorie sera écrasé. Les montants réels déjà saisis ne sont pas touchés.',
      valider: 'Appliquer',
    });
    if (!ok) return;

    ctx.muter((state) => {
      state.scenarioActif = choisi;
      const cibles = surAnnee ? Array.from({ length: 12 }, (_, i) => i) : [ctx.mois];
      for (const index of cibles) {
        const cible = assurerMois(state, ctx.annee, index);
        const revenu = surAnnee && proportionnel ? revenuTotal(cible) : revenuRef;
        const prevus = prevusScenario(choisi, { revenu, proportionnel });
        if (!prevus) continue;
        for (const [id, valeur] of Object.entries(prevus)) cible.categories[id].prevu = valeur;
      }
    });
    message(
      surAnnee ? `Scénario ${choisi} appliqué aux 12 mois de ${ctx.annee}.` : `Scénario ${choisi} appliqué à ${MOIS[ctx.mois]}.`,
      { ton: 'succes' },
    );
  };

  const choix = el('div.scenario__choix', { role: 'radiogroup', 'aria-label': 'Scénario budgétaire' },
    SCENARIOS.map((scenario) => {
      const boiteChoix = el('button.scenario__option', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(scenario.id === choisi),
        onclick: () => {
          choisi = scenario.id;
          for (const autre of choix.children) autre.setAttribute('aria-checked', String(autre.dataset.id === choisi));
          majApercu();
        },
        dataset: { id: scenario.id },
      }, [
        el('span.scenario__lettre', scenario.id),
        el('span.scenario__nom', scenario.nom),
      ]);
      return boiteChoix;
    }));

  majApercu();

  return bloc({
    titre: 'Scénario',
    description: 'Écrase le Prévu de chaque catégorie. Le Réel n’est jamais touché.',
    classe: 'bloc--scenario',
    corps: [
      choix,
      resume,
      el('label.case', [
        el('input', {
          type: 'checkbox',
          onchange: (evenement) => { proportionnel = evenement.target.checked; majApercu(); },
        }),
        el('span', 'Proportionner au revenu du mois'),
        indice('Les scénarios sont calibrés sur 400 000 FCFA. Coché, chaque montant est ré-échelonné pour que le total corresponde au revenu réel.'),
      ]),
      apercu,
      el('div.scenario__actions', [
        bouton('Appliquer à ce mois', { variante: 'primaire', onclick: () => appliquer(false) }),
        bouton('À toute l’année', { variante: 'discret', onclick: () => appliquer(true) }),
      ]),
    ],
  });
}

/* ================================================================== *
 * Le grand livre des catégories (§3, §6.2)
 * ================================================================== */

function blocCategories(ctx, mois, rafraichisseurs, modifier) {
  const devise = ctx.state.currency;
  const corpsTable = el('tbody.livre__corps');
  let groupePrecedent = null;

  for (const categorie of CATEGORIES) {
    if (categorie.groupe !== groupePrecedent) {
      groupePrecedent = categorie.groupe;
      const groupe = GROUPES[categorie.groupe];
      corpsTable.append(separateurGroupe(groupe.nom, groupe.desc, 6));
    }
    const { ligne, detail } = ligneCategorieDOM(ctx, mois, categorie, rafraichisseurs, modifier);
    corpsTable.append(ligne, detail);
  }

  const pied = piedTotaux(ctx, mois, rafraichisseurs);

  echelonner([...corpsTable.querySelectorAll('tr.livre__ligne')], 22);

  return bloc({
    titre: 'Catégories',
    description: 'Déplie une ligne pour saisir les écritures qui composent le réel.',
    classe: 'bloc--livre',
    corps: el('div.livre__cadre', el('table.livre', [
      el('caption.hors-ecran', `Budget prévu et réel par catégorie pour ${MOIS[ctx.mois]} ${ctx.annee}`),
      el('thead', el('tr', [
        el('th.livre__th.livre__th--nom', { scope: 'col' }, 'Catégorie'),
        el('th.livre__th.livre__th--num', { scope: 'col' }, 'Prévu'),
        el('th.livre__th.livre__th--num', { scope: 'col' }, 'Réel'),
        el('th.livre__th.livre__th--num', { scope: 'col' }, 'Écart'),
        el('th.livre__th.livre__th--num', { scope: 'col' }, '%'),
        el('th.livre__th.livre__th--statut', { scope: 'col' }, 'Statut'),
      ])),
      corpsTable,
      pied,
    ])),
  });
}

function ligneCategorieDOM(ctx, mois, categorie, rafraichisseurs, modifier) {
  const devise = ctx.state.currency;
  const donnees = mois.categories[categorie.id];
  const estDime = categorie.id === 'dime';
  const ouverte = depliees.has(categorie.id);

  const detail = el('tr.livre__detail', { hidden: !ouverte });
  const celluleDetail = el('td.livre__detail-cellule', { colspan: '6' });
  detail.append(celluleDetail);

  const basculer = () => {
    const estOuverte = depliees.has(categorie.id);
    if (estOuverte) {
      depliees.delete(categorie.id);
      detail.hidden = true;
      remplacer(celluleDetail, null);
    } else {
      depliees.add(categorie.id);
      detail.hidden = false;
      remplacer(celluleDetail, editeurEcritures(ctx, mois, categorie, modifier));
    }
    chevron.classList.toggle('chevron--ouvert', !estOuverte);
    boutonNom.setAttribute('aria-expanded', String(!estOuverte));
  };

  if (ouverte) remplacer(celluleDetail, editeurEcritures(ctx, mois, categorie, modifier));

  const chevron = el(`span.chevron${ouverte ? '.chevron--ouvert' : ''}`, { 'aria-hidden': 'true' }, '›');
  const compteur = el('span.livre__compteur');

  const boutonNom = el('button.livre__nom', {
    type: 'button',
    onclick: basculer,
    'aria-expanded': String(ouverte),
  }, [
    chevron,
    el('span.livre__nom-texte', [
      el('span.livre__nom-principal', categorie.nom),
      el('span.livre__nom-contenu', categorie.contenu),
    ]),
    categorie.nonNegociable ? el('span.badge.badge--non-negociable', 'non négociable') : null,
    compteur,
  ]);

  const cellulePrevu = el('td.livre__td.livre__td--num');
  const celluleReel = el('td.livre__td.livre__td--num');
  const celluleEcart = el('td.livre__td.livre__td--num');
  const cellulePct = el('td.livre__td.livre__td--num');
  const celluleStatut = el('td.livre__td.livre__td--statut');

  // Le prévu de la dîme est dérivé : pas d'input, jamais (§2).
  if (estDime) {
    const valeurDime = el('span.chiffre.chiffre--fige');
    cellulePrevu.append(valeurDime, el('span.livre__mention', '10 % du revenu'));
    rafraichisseurs.push(() => { valeurDime.textContent = nombre(prevuDime(mois, ctx.state.regleDime)); });
  } else {
    cellulePrevu.append(champMontant({
      valeur: montantValide(donnees.prevu),
      aria: `Prévu — ${categorie.nom}`,
      onsaisie: (valeur) => modifier((state) => {
        assurerMois(state, ctx.annee, ctx.mois).categories[categorie.id].prevu = valeur;
      }),
    }));
  }

  const ligne = el(`tr.livre__ligne${estDime ? '.livre__ligne--dime' : ''}`, { dataset: { categorie: categorie.id } }, [
    el('th.livre__td.livre__td--nom', { scope: 'row' }, boutonNom),
    cellulePrevu, celluleReel, celluleEcart, cellulePct, celluleStatut,
  ]);

  rafraichisseurs.push(() => {
    const prevu = estDime ? prevuDime(mois, ctx.state.regleDime) : montantValide(mois.categories[categorie.id].prevu);
    const entrees = mois.categories[categorie.id].entries ?? [];
    const reel = entrees.reduce((somme, e) => somme + montantValide(e.montant), 0);
    const ecart = prevu - reel;
    const pct = prevu > 0 ? reel / prevu : null;
    const statut = prevu === 0 && reel === 0 ? 'neutre'
      : prevu === 0 ? 'depasse'
        : reel / prevu > 1 ? 'depasse'
          : reel / prevu >= 0.9 ? 'attention' : 'ok';

    remplacer(celluleReel, chiffre(reel));
    remplacer(celluleEcart, chiffreEcart(ecart));
    remplacer(cellulePct, el(`span.chiffre${pct !== null && pct > 1 ? '.chiffre--brique' : ''}`, pourcent(pct)));
    remplacer(celluleStatut, pastilleStatut(statut));
    compteur.textContent = entrees.length ? `${entrees.length}` : '';
    compteur.title = entrees.length ? `${entrees.length} écriture${entrees.length > 1 ? 's' : ''}` : '';
    ligne.classList.toggle('livre__ligne--depasse', statut === 'depasse');
  });

  return { ligne, detail };
}

/* ------------------------------------------------------------------ *
 * Écritures d'une catégorie
 * ------------------------------------------------------------------ */

function editeurEcritures(ctx, mois, categorie, modifier) {
  const devise = ctx.state.currency;
  const entrees = mois.categories[categorie.id].entries ?? [];

  const trouverEntree = (state, id) => assurerMois(state, ctx.annee, ctx.mois)
    .categories[categorie.id].entries.find((e) => e.id === id);

  const optionsFonds = [
    { valeur: '', label: 'Non affecté' },
    ...ctx.state.sinkingFunds.map((fonds) => ({ valeur: fonds.id, label: fonds.nom })),
  ];

  const liste = entrees.length === 0
    ? messageVide('Aucune écriture. Le réel de cette catégorie vaut 0.')
    : el('ul.ecritures', entrees.map((entree) => el('li.ecritures__ligne', [
      champTexte({
        valeur: entree.label,
        placeholder: 'Libellé',
        aria: 'Libellé de l’écriture',
        classe: 'saisie--extensible',
        onsaisie: (valeur) => modifier((state) => { const e = trouverEntree(state, entree.id); if (e) e.label = valeur; }),
      }),
      categorie.sousFonds
        ? champSelect({
          valeur: entree.sinkingFundId ?? '',
          aria: 'Sous-fonds de destination',
          classe: 'saisie--fonds',
          options: optionsFonds,
          onchange: (valeur) => ctx.muter((state) => {
            const e = trouverEntree(state, entree.id);
            if (!e) return;
            if (valeur) e.sinkingFundId = valeur;
            else delete e.sinkingFundId;
          }, { rendu: false }),
        })
        : null,
      champMontant({
        valeur: entree.montant,
        aria: 'Montant de l’écriture',
        classe: 'saisie--montant',
        onsaisie: (valeur) => modifier((state) => { const e = trouverEntree(state, entree.id); if (e) e.montant = valeur; }),
      }),
      boutonSupprimer('Supprimer cette écriture', () => {
        const copie = { ...entree };
        ctx.muter((state) => {
          const cible = assurerMois(state, ctx.annee, ctx.mois).categories[categorie.id];
          cible.entries = cible.entries.filter((e) => e.id !== entree.id);
        });
        message(`Écriture « ${copie.label || 'sans libellé'} » supprimée.`, {
          ton: 'info',
          action: {
            label: 'Annuler',
            onclick: () => ctx.muter((state) => {
              assurerMois(state, ctx.annee, ctx.mois).categories[categorie.id].entries.push(copie);
            }),
          },
        });
      }),
    ])));

  const ajouter = (label = '', montantInitial = 0) => ctx.muter((state) => {
    const cible = assurerMois(state, ctx.annee, ctx.mois).categories[categorie.id];
    const entree = { id: nouvelId('e'), label, montant: montantInitial };
    if (categorie.sousFonds) {
      const prioritaire = [...state.sinkingFunds].sort((a, b) => a.priorite - b.priorite)[0];
      if (prioritaire) entree.sinkingFundId = prioritaire.id;
    }
    cible.entries.push(entree);
  });

  return el('div.detail-categorie', [
    liste,
    el('div.detail-categorie__actions', [
      bouton('Ajouter une écriture', { variante: 'discret', icone: '+', onclick: () => ajouter() }),
      categorie.id === 'essentielles' ? reperesDakar(ajouter, entrees, devise) : null,
    ]),
  ]);
}

/** Repères de coûts Dakar (§9) — proposés en un clic, jamais imposés. */
function reperesDakar(ajouter, entrees, devise) {
  const dejaPresents = new Set(entrees.map((e) => e.label.trim().toLowerCase()));
  const restants = REPERES_DAKAR.filter((repere) => !dejaPresents.has(repere.label.toLowerCase()));
  if (restants.length === 0) return null;

  return el('details.reperes', [
    el('summary.reperes__titre', 'Repères Dakar 2026'),
    el('p.reperes__note', 'Ordres de grandeur constatés — à ajuster à ta situation réelle.'),
    el('div.reperes__liste', restants.map((repere) => el('button.reperes__item', {
      type: 'button',
      onclick: () => ajouter(repere.label, repere.montant),
    }, [
      el('span.reperes__nom', repere.label),
      el('span.reperes__montant.chiffre', montant(repere.montant, devise)),
    ]))),
  ]);
}

/* ------------------------------------------------------------------ *
 * Pied de tableau : totaux
 * ------------------------------------------------------------------ */

function piedTotaux(ctx, mois, rafraichisseurs) {
  const devise = ctx.state.currency;
  const cellules = {
    prevu: el('td.livre__td.livre__td--num'),
    reel: el('td.livre__td.livre__td--num'),
    ecart: el('td.livre__td.livre__td--num'),
    reste: el('td.livre__td.livre__td--num', { colspan: '2' }),
  };

  rafraichisseurs.push(() => {
    const totaux = totauxMois(mois, ctx.state.regleDime);
    remplacer(cellules.prevu, chiffre(totaux.prevu));
    remplacer(cellules.reel, chiffre(totaux.reel));
    remplacer(cellules.ecart, chiffreEcart(totaux.ecart));
    remplacer(cellules.reste, el('span.livre__reste', [
      el('span.livre__reste-label', totaux.resteAAffecter < 0 ? 'Sur-affecté' : 'Non affecté'),
      chiffre(Math.abs(totaux.resteAAffecter), {
        ton: totaux.resteAAffecter < 0 ? 'brique' : totaux.resteAAffecter > 0 ? 'laiton' : null,
      }),
    ]));
  });

  return el('tfoot.livre__pied', el('tr', [
    el('th.livre__td.livre__td--nom', { scope: 'row' }, 'Total'),
    cellules.prevu, cellules.reel, cellules.ecart, cellules.reste,
  ]));
}

/* ================================================================== *
 * Synthèse latérale
 * ================================================================== */

function blocSynthese(ctx, mois, rafraichisseurs) {
  const devise = ctx.state.currency;
  const conteneur = el('div.synthese');

  rafraichisseurs.push(() => {
    const totaux = totauxMois(mois, ctx.state.regleDime);
    remplacer(conteneur, [
      jaugeRepartitionPrevu(totaux.lignes, totaux.revenu, { devise }),
      el('dl.synthese__liste', [
        el('dt', 'Revenu du mois'), el('dd.chiffre', montant(totaux.revenu, devise)),
        el('dt', 'Total prévu'), el('dd.chiffre', montant(totaux.prevu, devise)),
        el('dt', 'Total réel'), el('dd.chiffre', montant(totaux.reel, devise)),
        el('dt', 'Solde du mois'),
        el('dd', chiffre(totaux.solde, { devise, signe: true, ton: totaux.solde < 0 ? 'brique' : 'sauge' })),
      ]),
    ]);
  });

  return bloc({ titre: 'Synthèse du mois', classe: 'bloc--synthese', corps: conteneur });
}

/* ================================================================== *
 * Utilitaire — garantit que le mois existe avant d'écrire dedans
 * ================================================================== */

export function assurerMois(state, annee, indexMois) {
  const cleAnnee = String(annee);
  state.years[cleAnnee] ??= { months: {} };
  const months = state.years[cleAnnee].months;
  months[String(indexMois)] ??= { revenus: [], categories: {} };
  const mois = months[String(indexMois)];
  mois.revenus ??= [];
  mois.categories ??= {};
  for (const categorie of CATEGORIES) {
    mois.categories[categorie.id] ??= categorie.id === 'dime' ? { entries: [] } : { prevu: 0, entries: [] };
    mois.categories[categorie.id].entries ??= [];
  }
  return mois;
}
