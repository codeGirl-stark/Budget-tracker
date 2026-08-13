/**
 * Réglages — les décisions de valeurs (§2, §10.2) et la sauvegarde (§8).
 */

import { el, remplacer } from '../lib/dom.js';
import { montant, nombre, pourcent } from '../lib/format.js';
import {
  bloc, champMontant, champSelect, champTexte, bouton, indice, alerte, message, confirmer,
} from '../lib/composants.js';
import { REGLE_SURPLUS_DEFAUT, repartitionSurplus, stateInitial } from '/shared/model.js';
import { CATEGORIES } from '/shared/categories.js';
import { changerMotDePasse, supprimerCompte, utilisateurCourant } from '../session.js';

const DEVISES = [
  { valeur: 'XOF', label: 'FCFA — Franc CFA (XOF)' },
  { valeur: 'EUR', label: '€ — Euro' },
  { valeur: 'USD', label: '$ — Dollar américain' },
  { valeur: 'MAD', label: 'DH — Dirham marocain' },
  { valeur: 'CAD', label: 'CA$ — Dollar canadien' },
];

export function vueReglages(ctx) {
  const { state } = ctx;

  return el('div.vue.vue--reglages', [
    el('header.vue__tete', [
      el('div.vue__titre-zone', [
        el('p.vue__sur-titre', 'Réglages'),
        el('h1.vue__titre', 'Tes règles'),
      ]),
      el('p.vue__intro', 'Ces choix engagent des valeurs, pas seulement des chiffres. Rien n’est décidé à ta place.'),
    ]),

    blocCompte(ctx),
    blocGeneral(ctx),
    blocDime(ctx),
    blocAideFamiliale(ctx),
    blocSurplus(ctx),
    blocDonnees(ctx),
  ]);
}

/* ------------------------------------------------------------------ *
 * Compte
 * ------------------------------------------------------------------ */

function blocCompte(ctx) {
  const profil = utilisateurCourant();
  if (!profil) return null;

  const zone = el('div.compte__mdp');
  let ouvert = false;

  const formulaireMotDePasse = () => {
    const actuel = el('input.acces__saisie', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Mot de passe actuel', placeholder: 'Mot de passe actuel' });
    const nouveau = el('input.acces__saisie', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Nouveau mot de passe', placeholder: 'Nouveau mot de passe (10 caractères min.)' });
    const erreur = el('p.acces__erreur', { role: 'alert' });

    return el('form.compte__formulaire', {
      onsubmit: async (evenement) => {
        evenement.preventDefault();
        erreur.textContent = '';
        try {
          await changerMotDePasse({ actuel: actuel.value, nouveau: nouveau.value });
          ouvert = false;
          remplacer(zone, null);
          message('Mot de passe changé. Tes autres appareils devront se reconnecter.', { ton: 'succes', duree: 8000 });
        } catch (e) {
          erreur.textContent = e.message;
        }
      },
    }, [
      actuel,
      nouveau,
      erreur,
      el('div.compte__actions', [
        el('button.bouton.bouton--primaire', { type: 'submit' }, 'Changer le mot de passe'),
        bouton('Annuler', { variante: 'discret', onclick: () => { ouvert = false; remplacer(zone, null); } }),
      ]),
    ]);
  };

  return bloc({
    titre: 'Compte',
    description: 'Ton plan est privé. Personne d’autre ne peut le lire, pas même les autres comptes.',
    classe: 'bloc--reglage',
    corps: el('div.compte', [
      el('div.champ.champ--ligne', [
        el('span.champ__label', 'Connectée en tant que'),
        el('span.compte__email', profil.email),
      ]),

      el('div.champ.champ--ligne', [
        el('span.champ__label', 'Mot de passe'),
        bouton('Changer', {
          variante: 'discret',
          onclick: () => {
            ouvert = !ouvert;
            remplacer(zone, ouvert ? formulaireMotDePasse() : null);
          },
        }),
      ]),
      zone,

      el('div.champ.champ--ligne', [
        el('span.champ__label', 'Session'),
        bouton('Se déconnecter', { variante: 'discret', onclick: () => ctx.deconnecter() }),
      ]),

      el('hr.separateur'),

      zoneSuppression(),
    ]),
  });
}

/** Suppression de compte : confirmation, puis mot de passe saisi en clair dans la page. */
function zoneSuppression() {
  const zone = el('div.compte__suppression');

  const formulaire = () => {
    const motDePasse = el('input.acces__saisie', {
      type: 'password',
      autocomplete: 'current-password',
      'aria-label': 'Mot de passe pour confirmer la suppression',
      placeholder: 'Ton mot de passe',
    });
    const erreur = el('p.acces__erreur', { role: 'alert' });

    const form = el('form.compte__formulaire', {
      onsubmit: async (evenement) => {
        evenement.preventDefault();
        erreur.textContent = '';
        try {
          await supprimerCompte({ motDePasse: motDePasse.value });
          location.reload();
        } catch (e) {
          erreur.textContent = e.message;
        }
      },
    }, [
      el('p.note', 'Saisis ton mot de passe pour confirmer la suppression définitive.'),
      motDePasse,
      erreur,
      el('div.compte__actions', [
        el('button.bouton.bouton--danger', { type: 'submit' }, 'Supprimer définitivement'),
        bouton('Annuler', { variante: 'discret', onclick: () => remplacer(zone, declencheur()) }),
      ]),
    ]);
    requestAnimationFrame(() => motDePasse.focus());
    return form;
  };

  const declencheur = () => el('div.donnees__danger', [
    el('div', [
      el('strong', 'Supprimer mon compte'),
      el('p.note', 'Efface le compte, le plan et toutes les sauvegardes. Exporte d’abord si tu veux garder une trace.'),
    ]),
    bouton('Supprimer', {
      variante: 'danger',
      onclick: async () => {
        const ok = await confirmer({
          titre: 'Supprimer définitivement ton compte ?',
          texte: 'Ton plan financier et tout son historique seront effacés du serveur. Cette action est irréversible.',
          valider: 'Continuer',
          danger: true,
        });
        if (ok) remplacer(zone, formulaire());
      },
    }),
  ]);

  remplacer(zone, declencheur());
  return zone;
}

/* ------------------------------------------------------------------ */

function blocGeneral(ctx) {
  const { state } = ctx;
  const devise = state.currency;

  return bloc({
    titre: 'Général',
    classe: 'bloc--reglage',
    corps: el('div.reglages', [
      el('label.champ.champ--ligne', [
        el('span.champ__label', 'Devise'),
        champSelect({
          valeur: devise,
          aria: 'Devise',
          options: DEVISES,
          onchange: (valeur) => ctx.muter((state) => { state.currency = valeur; }),
        }),
      ]),
      el('label.champ.champ--ligne', [
        el('span.champ__label', ['Revenu mensuel par défaut', indice('Proposé quand un mois n’a encore aucune source de revenu. Ne modifie aucun mois déjà rempli.')]),
        el('span.champ__saisie', [
          champMontant({
            valeur: state.revenuMensuelDefaut,
            aria: 'Revenu mensuel par défaut',
            onfin: (valeur) => ctx.muter((state) => { state.revenuMensuelDefaut = valeur; }),
          }),
          el('span.champ__unite', devise === 'XOF' ? 'FCFA' : devise),
        ]),
      ]),
      el('label.champ.champ--ligne', [
        el('span.champ__label', 'Année de travail'),
        champSelect({
          valeur: state.currentYear,
          aria: 'Année de travail',
          options: Object.keys(state.years).map(Number).sort((a, b) => a - b).map((a) => ({ valeur: a, label: String(a) })),
          onchange: (valeur) => ctx.muter((state) => { state.currentYear = Number(valeur); }),
        }),
      ]),
    ]),
  });
}

/* ------------------------------------------------------------------ *
 * Base de calcul de la dîme (§2) — une décision de valeurs
 * ------------------------------------------------------------------ */

function blocDime(ctx) {
  const { state } = ctx;

  const options = [
    {
      valeur: 'total',
      titre: 'Sur le revenu total',
      texte: 'La dîme porte sur tout ce qui rentre : salaire, missions, dividendes, primes.',
    },
    {
      valeur: 'salaire_seul',
      titre: 'Sur le salaire seul',
      texte: 'Seules les sources marquées « stable » entrent dans la base de calcul.',
    },
  ];

  return bloc({
    titre: 'Base de calcul de la dîme',
    description: 'Le montant reste fixé à 10 %, calculé automatiquement et non modifiable à la main. Seule la base change.',
    classe: 'bloc--reglage',
    corps: el('div.choix-cartes', { role: 'radiogroup', 'aria-label': 'Base de calcul de la dîme' },
      options.map((option) => el('button.choix-carte', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(state.regleDime === option.valeur),
        onclick: () => ctx.muter((state) => { state.regleDime = option.valeur; }),
      }, [
        el('span.choix-carte__marque', { 'aria-hidden': 'true' }),
        el('span.choix-carte__corps', [
          el('strong.choix-carte__titre', option.titre),
          el('span.choix-carte__texte', option.texte),
        ]),
      ]))),
  });
}

/* ------------------------------------------------------------------ *
 * Aide familiale (§10.2 point 3)
 * ------------------------------------------------------------------ */

function blocAideFamiliale(ctx) {
  const { state } = ctx;
  const aide = state.aideFamiliale;
  const devise = state.currency;

  const options = [
    { valeur: 'plancher', titre: 'Plancher fixe', texte: 'Un montant minimum que tu t’engages à envoyer, indépendant de ce que tu gagnes.' },
    { valeur: 'pourcentage', titre: 'Pourcentage du revenu', texte: 'L’aide suit ce que tu gagnes — elle monte les bons mois, descend les mois creux.' },
  ];

  return bloc({
    titre: 'Aide familiale',
    description: 'Ce choix t’appartient. L’application ne l’applique pas automatiquement : elle sert de repère quand tu ajustes le prévu.',
    classe: 'bloc--reglage',
    corps: el('div.reglages', [
      el('div.choix-cartes', { role: 'radiogroup', 'aria-label': 'Mode de calcul de l’aide familiale' },
        options.map((option) => el('button.choix-carte', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(aide.mode === option.valeur),
          onclick: () => ctx.muter((state) => { state.aideFamiliale.mode = option.valeur; }),
        }, [
          el('span.choix-carte__marque', { 'aria-hidden': 'true' }),
          el('span.choix-carte__corps', [
            el('strong.choix-carte__titre', option.titre),
            el('span.choix-carte__texte', option.texte),
          ]),
        ]))),

      aide.mode === 'plancher'
        ? el('label.champ.champ--ligne', [
          el('span.champ__label', 'Montant plancher'),
          el('span.champ__saisie', [
            champMontant({
              valeur: aide.plancher,
              aria: 'Montant plancher de l’aide familiale',
              onfin: (valeur) => ctx.muter((state) => { state.aideFamiliale.plancher = valeur; }),
            }),
            el('span.champ__unite', devise === 'XOF' ? 'FCFA' : devise),
          ]),
        ])
        : el('label.champ.champ--ligne', [
          el('span.champ__label', 'Part du revenu'),
          el('span.champ__saisie', [
            el('input.chiffre.saisie.saisie--pct', {
              type: 'number', min: '0', max: '100', step: '1',
              value: String(aide.pourcentage),
              'aria-label': 'Pourcentage du revenu consacré à l’aide familiale',
              onchange: (evenement) => {
                const valeur = Math.min(100, Math.max(0, Number(evenement.target.value) || 0));
                ctx.muter((state) => { state.aideFamiliale.pourcentage = valeur; });
              },
            }),
            el('span.champ__unite', '%'),
          ]),
        ]),
    ]),
  });
}

/* ------------------------------------------------------------------ *
 * Règle du surplus (§10.2)
 * ------------------------------------------------------------------ */

function blocSurplus(ctx) {
  const { state } = ctx;
  const devise = state.currency;
  const apercu = el('div.surplus__apercu');

  const libelles = {
    investissement: 'Investissement + Business Fund',
    epargne: 'Épargne',
    devperso_loisirs: 'Développement personnel + Loisirs',
    projets: 'Fonds projets',
  };

  const majApercu = () => {
    const total = Object.keys(REGLE_SURPLUS_DEFAUT).reduce((somme, cle) => somme + Number(state.regleSurplus[cle] ?? 0), 0);
    const exemple = repartitionSurplus(50000, state.regleSurplus);
    remplacer(apercu, [
      total === 100
        ? null
        : alerte(
          `Tes parts totalisent ${total} %. Elles seront appliquées telles quelles : ${total < 100 ? 'une partie du surplus ne sera affectée nulle part' : 'la répartition dépassera le surplus disponible'}.`,
          { ton: 'attention' },
        ),
      el('div.surplus__exemple', [
        el('p.surplus__exemple-titre', ['Sur un surplus de ', el('span.chiffre', montant(50000, devise)), ', cela donnerait :']),
        el('ul.surplus__exemple-liste', Object.entries(exemple)
          .filter(([, valeur]) => valeur > 0)
          .map(([id, valeur]) => el('li', [
            el('span.surplus__exemple-nom', CATEGORIES.find((c) => c.id === id)?.nom ?? id),
            el('span.chiffre', montant(valeur, devise)),
          ]))),
      ]),
    ]);
  };

  const champs = Object.keys(REGLE_SURPLUS_DEFAUT).map((cle) => el('label.champ.champ--ligne', [
    el('span.champ__label', libelles[cle]),
    el('span.champ__saisie', [
      el('input.chiffre.saisie.saisie--pct', {
        type: 'number', min: '0', max: '100', step: '5',
        value: String(state.regleSurplus[cle]),
        'aria-label': `Part du surplus vers ${libelles[cle]}`,
        oninput: (evenement) => {
          const valeur = Math.max(0, Number(evenement.target.value) || 0);
          ctx.muter((state) => { state.regleSurplus[cle] = valeur; }, { rendu: false });
          majApercu();
        },
      }),
      el('span.champ__unite', '%'),
    ]),
  ]));

  majApercu();

  return bloc({
    titre: 'Règle du surplus',
    description: 'Quand ton salaire augmente, le socle ne bouge pas — c’est le delta qui se répartit selon ces parts.',
    classe: 'bloc--reglage',
    actions: bouton('Rétablir les valeurs par défaut', {
      variante: 'discret',
      onclick: () => ctx.muter((state) => { state.regleSurplus = { ...REGLE_SURPLUS_DEFAUT }; }),
    }),
    corps: [el('div.reglages', champs), apercu],
  });
}

/* ------------------------------------------------------------------ *
 * Données : export, import, remise à zéro (§8)
 * ------------------------------------------------------------------ */

function blocDonnees(ctx) {
  const entree = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async (evenement) => {
      const fichier = evenement.target.files?.[0];
      evenement.target.value = '';
      if (!fichier) return;
      try {
        const brut = JSON.parse(await fichier.text());
        const ok = await confirmer({
          titre: 'Remplacer les données actuelles ?',
          texte: `« ${fichier.name} » va écraser l’intégralité de ton plan actuel. Pense à exporter une sauvegarde avant si tu as un doute.`,
          valider: 'Importer',
          danger: true,
        });
        if (!ok) return;
        ctx.importer(brut);
        message('Données importées.', { ton: 'succes' });
      } catch (erreur) {
        message(`Import impossible : ${erreur.message}`, { ton: 'erreur', duree: 8000 });
      }
    },
  });

  const nombreMois = Object.values(ctx.state.years)
    .reduce((total, annuel) => total + Object.values(annuel.months).filter((m) => (m.revenus?.length ?? 0) > 0).length, 0);

  return bloc({
    titre: 'Données',
    description: 'Tout est enregistré automatiquement sur ce poste. Une sauvegarde datée est conservée à chaque écriture.',
    classe: 'bloc--reglage bloc--danger',
    corps: el('div.donnees', [
      el('p.note', [
        `${Object.keys(ctx.state.years).length} année(s) enregistrée(s), ${nombreMois} mois avec des revenus renseignés.`,
      ]),
      el('div.donnees__actions', [
        bouton('Exporter une sauvegarde', { variante: 'primaire', onclick: () => ctx.exporter() }),
        bouton('Importer un fichier', { variante: 'discret', onclick: () => entree.click() }),
        entree,
      ]),
      el('hr.separateur'),
      el('div.donnees__danger', [
        el('div', [
          el('strong', 'Repartir de zéro'),
          el('p.note', 'Efface toutes les années saisies et réapplique le scénario A sur douze mois. Irréversible depuis l’application.'),
        ]),
        bouton('Réinitialiser', {
          variante: 'danger',
          onclick: async () => {
            const ok = await confirmer({
              titre: 'Effacer tout le plan ?',
              texte: 'Toutes tes saisies seront perdues. Le fichier de sauvegarde précédent reste sur le disque, mais l’application ne pourra pas le restaurer toute seule.',
              valider: 'Tout effacer',
              danger: true,
            });
            if (!ok) return;
            const neuf = stateInitial({ annee: ctx.state.currentYear, revenu: ctx.state.revenuMensuelDefaut });
            ctx.importer(neuf);
            message('Plan réinitialisé.', { ton: 'info' });
          },
        }),
      ]),
    ]),
  });
}
