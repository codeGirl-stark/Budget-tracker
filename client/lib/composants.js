/**
 * Briques d'interface communes aux quatre vues.
 */

import { el, svg, vider, $ } from './dom.js';
import { nombre, montant, montantSigne, pourcent, lireMontant, symboleDevise } from './format.js';
import { STATUTS } from '/shared/categories.js';

/* ------------------------------------------------------------------ *
 * Saisie
 * ------------------------------------------------------------------ */

/**
 * Cellule de montant éditable, façon registre : le chiffre reste en place,
 * on écrit dessus. `onsaisie` est appelé à chaque frappe (sans re-rendu),
 * `onfin` à la validation (re-rendu autorisé).
 */
export function champMontant({
  valeur = 0,
  editable = true,
  onsaisie = null,
  onfin = null,
  aria = 'Montant',
  classe = '',
  placeholder = '0',
} = {}) {
  if (!editable) {
    return el(`span.chiffre.chiffre--fige${classe ? `.${classe}` : ''}`, {
      title: 'Calculé automatiquement — non modifiable',
    }, nombre(valeur));
  }

  return el(`input.chiffre.saisie${classe ? `.${classe}` : ''}`, {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder,
    value: valeur ? nombre(valeur) : '',
    'aria-label': aria,
    onfocus: (evenement) => evenement.target.select(),
    oninput: (evenement) => onsaisie?.(lireMontant(evenement.target.value)),
    onblur: (evenement) => {
      const valide = lireMontant(evenement.target.value);
      evenement.target.value = valide ? nombre(valide) : '';
      onfin?.(valide);
    },
    onkeydown: (evenement) => {
      if (evenement.key === 'Enter') { evenement.preventDefault(); evenement.target.blur(); }
      if (evenement.key === 'Escape') { evenement.target.value = valeur ? nombre(valeur) : ''; evenement.target.blur(); }
    },
  });
}

export function champTexte({
  valeur = '',
  onsaisie = null,
  onfin = null,
  aria = 'Libellé',
  placeholder = '',
  classe = '',
} = {}) {
  return el(`input.saisie.saisie--texte${classe ? `.${classe}` : ''}`, {
    type: 'text',
    autocomplete: 'off',
    value: valeur,
    placeholder,
    'aria-label': aria,
    oninput: (evenement) => onsaisie?.(evenement.target.value),
    onblur: (evenement) => onfin?.(evenement.target.value.trim()),
    onkeydown: (evenement) => { if (evenement.key === 'Enter') { evenement.preventDefault(); evenement.target.blur(); } },
  });
}

export function champSelect({ valeur, options, onchange, aria = 'Choix', classe = '' } = {}) {
  return el(`select.saisie.saisie--select${classe ? `.${classe}` : ''}`, {
    'aria-label': aria,
    onchange: (evenement) => onchange?.(evenement.target.value),
  }, options.map(({ valeur: v, label }) => el('option', { value: v, selected: String(v) === String(valeur) }, label)));
}

export function bouton(label, { onclick, variante = '', type = 'button', titre = null, desactive = false, icone = null } = {}) {
  const classes = ['bouton', ...variante.split(' ').filter(Boolean).map((v) => `bouton--${v}`)].join('.');
  return el(`button.${classes}`, {
    type,
    onclick,
    title: titre,
    disabled: desactive,
  }, [icone ? el('span.bouton__icone', { 'aria-hidden': 'true' }, icone) : null, el('span', label)]);
}

/** Petit bouton de suppression — discret jusqu'au survol de la ligne. */
export function boutonSupprimer(label, onclick) {
  return el('button.bouton-suppr', {
    type: 'button',
    onclick,
    title: label,
    'aria-label': label,
  }, el('span', { 'aria-hidden': 'true' }, '×'));
}

/* ------------------------------------------------------------------ *
 * Affichage
 * ------------------------------------------------------------------ */

export function pastilleStatut(code) {
  const statut = STATUTS[code] ?? STATUTS.neutre;
  return el(`span.statut.statut--${code}`, { title: statut.aria }, [
    el('span.statut__glyphe', { 'aria-hidden': 'true' }, statut.glyphe),
    el('span.statut__label', statut.label),
    el('span.hors-ecran', ` — ${statut.aria}`),
  ]);
}

export function chiffre(valeur, { devise = null, signe = false, ton = null, sourdine = false } = {}) {
  const texte = signe ? montantSigne(valeur, devise) : (devise ? montant(valeur, devise) : nombre(valeur));
  const classes = ['chiffre'];
  if (ton) classes.push(`chiffre--${ton}`);
  if (sourdine) classes.push('chiffre--sourdine');
  return el(`span.${classes.join('.')}`, texte);
}

/** Écart : positif = il reste de la marge (sauge), négatif = dépassement (brique). */
export function chiffreEcart(valeur, devise = null) {
  const ton = valeur < 0 ? 'brique' : valeur > 0 ? 'sauge' : null;
  return chiffre(valeur, { devise, signe: true, ton, sourdine: valeur === 0 });
}

/**
 * Barre de progression d'un fonds. `cible` nulle → on affiche seulement le
 * capital cumulé (cas du Business Fund sans objectif, §5).
 */
export function barreProgression({ cumul, cible, ton = 'sauge', devise = 'XOF', libelle = null } = {}) {
  const aCible = Number.isFinite(cible) && cible > 0;
  const ratio = aCible ? cumul / cible : null;
  const largeur = aCible ? Math.min(100, Math.max(0, ratio * 100)) : 0;
  const atteint = aCible && cumul >= cible;

  return el('div.barre', [
    libelle ? el('div.barre__libelle', libelle) : null,
    el('div.barre__piste', {
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': aCible ? String(cible) : '0',
      'aria-valuenow': String(Math.round(cumul)),
      'aria-valuetext': aCible
        ? `${montant(cumul, devise)} sur ${montant(cible, devise)} — ${pourcent(ratio)}`
        : `${montant(cumul, devise)} cumulés, sans objectif défini`,
    }, aCible
      ? el(`div.barre__remplissage.barre__remplissage--${atteint ? 'atteint' : ton}`, { style: { '--largeur': `${largeur}%` } })
      : el('div.barre__remplissage.barre__remplissage--sans-cible')),
    el('div.barre__pied', [
      el('span.barre__cumul', montant(cumul, devise)),
      aCible
        ? el('span.barre__cible', [
          el('span.barre__part', pourcent(ratio)),
          el('span.barre__reste', atteint ? 'objectif atteint' : `reste ${montant(cible - cumul, devise)}`),
        ])
        : el('span.barre__cible', el('span.barre__reste', 'pas d’objectif défini')),
    ]),
  ]);
}

/** Bloc de contenu titré — l'unité de composition de toutes les vues. */
export function bloc({ titre, description = null, actions = null, corps, classe = '', id = null } = {}) {
  // `classe` peut en contenir plusieurs, séparées par des espaces.
  const classes = ['bloc', ...String(classe).split(/\s+/).filter(Boolean)].join('.');
  return el(`section.${classes}`, { id }, [
    titre
      ? el('header.bloc__tete', [
        el('div.bloc__intitule', [
          el('h2.bloc__titre', titre),
          description ? el('p.bloc__desc', description) : null,
        ]),
        actions ? el('div.bloc__actions', actions) : null,
      ])
      : null,
    el('div.bloc__corps', corps),
  ]);
}

export function kpi({ label, valeur, detail = null, ton = null, aide = null }) {
  return el(`article.kpi${ton ? `.kpi--${ton}` : ''}`, [
    el('h3.kpi__label', [label, aide ? indice(aide) : null]),
    el('p.kpi__valeur', valeur),
    detail ? el('p.kpi__detail', detail) : null,
  ]);
}

/** Petit « ? » qui explique un calcul sans encombrer l'écran. */
export function indice(texte) {
  return el('span.indice', { tabindex: '0', role: 'note', 'aria-label': texte, 'data-infobulle': texte }, '?');
}

export function messageVide(texte, action = null) {
  return el('div.vide', [el('p.vide__texte', texte), action]);
}

export function alerte(texte, { ton = 'attention', actions = null, titre = null } = {}) {
  return el(`div.alerte.alerte--${ton}`, { role: ton === 'attention' ? 'alert' : 'status' }, [
    el('div.alerte__corps', [
      titre ? el('strong.alerte__titre', titre) : null,
      el('p.alerte__texte', texte),
    ]),
    actions ? el('div.alerte__actions', actions) : null,
  ]);
}

/** Étiquette de section dans un tableau (les trois groupes de catégories). */
export function separateurGroupe(nom, description, colonnes) {
  return el('tr.livre__groupe', el('th.livre__groupe-cellule', { colspan: String(colonnes), scope: 'colgroup' }, [
    el('span.livre__groupe-nom', nom),
    el('span.livre__groupe-desc', description),
  ]));
}

/* ------------------------------------------------------------------ *
 * Messages éphémères & confirmations
 * ------------------------------------------------------------------ */

export function message(texte, { ton = 'info', duree = 5000, action = null } = {}) {
  const pile = $('#pile-messages');
  if (!pile) return () => {};

  const noeud = el(`div.message.message--${ton}`, { role: 'status' }, [
    el('span.message__texte', texte),
    action ? el('button.message__action', {
      type: 'button',
      onclick: () => { action.onclick(); fermer(); },
    }, action.label) : null,
    el('button.message__fermer', { type: 'button', 'aria-label': 'Fermer', onclick: () => fermer() }, '×'),
  ]);

  let minuterie = null;
  function fermer() {
    clearTimeout(minuterie);
    noeud.classList.add('message--sortant');
    noeud.addEventListener('animationend', () => noeud.remove(), { once: true });
    setTimeout(() => noeud.remove(), 400);
  }

  pile.append(noeud);
  if (duree > 0) minuterie = setTimeout(fermer, duree);
  return fermer;
}

/** Confirmation modale — utilisée pour tout ce qui détruit des données. */
export function confirmer({ titre, texte, valider = 'Confirmer', annuler = 'Annuler', danger = false } = {}) {
  return new Promise((resoudre) => {
    const boiteValider = el(`button.bouton.bouton--${danger ? 'danger' : 'primaire'}`, {
      type: 'button',
      onclick: () => { boite.close(); resoudre(true); },
    }, valider);

    const boite = el('dialog.modale', {
      onclose: () => { boite.remove(); resoudre(false); },
      oncancel: () => resoudre(false),
    }, el('form.modale__corps', { method: 'dialog' }, [
      el('h2.modale__titre', titre),
      el('p.modale__texte', texte),
      el('div.modale__actions', [
        el('button.bouton.bouton--discret', { type: 'button', onclick: () => { boite.close(); resoudre(false); } }, annuler),
        boiteValider,
      ]),
    ]));

    document.body.append(boite);
    boite.showModal();
    boiteValider.focus();
  });
}

/* ------------------------------------------------------------------ *
 * Infobulles (partagées avec les graphiques)
 * ------------------------------------------------------------------ */

let bulle = null;

export function montrerBulle(contenu, x, y) {
  bulle ??= $('#infobulle');
  if (!bulle) return;
  vider(bulle);
  bulle.append(typeof contenu === 'string' ? document.createTextNode(contenu) : contenu);
  bulle.hidden = false;
  const largeur = bulle.offsetWidth;
  const gauche = Math.min(Math.max(8, x - largeur / 2), innerWidth - largeur - 8);
  bulle.style.transform = `translate(${Math.round(gauche)}px, ${Math.round(y - bulle.offsetHeight - 12)}px)`;
}

export function cacherBulle() {
  bulle ??= $('#infobulle');
  if (bulle) bulle.hidden = true;
}

/** Contenu d'infobulle standard : un titre, puis des lignes libellé/valeur. */
export function contenuBulle(titre, lignes) {
  return el('div.bulle', [
    el('div.bulle__titre', titre),
    el('dl.bulle__liste', lignes.flatMap(({ label, valeur, ton }) => [
      el('dt.bulle__label', label),
      el(`dd.bulle__valeur${ton ? `.chiffre--${ton}` : ''}`, valeur),
    ])),
  ]);
}

/* ------------------------------------------------------------------ *
 * Divers
 * ------------------------------------------------------------------ */

export function iconeFleche(direction = 'bas') {
  const chemins = { bas: 'M4 6l4 4 4-4', haut: 'M4 10l4-4 4 4', droite: 'M6 4l4 4-4 4' };
  return svg('svg', { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true', class: 'fleche' },
    svg('path', { d: chemins[direction], fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

export { symboleDevise };
