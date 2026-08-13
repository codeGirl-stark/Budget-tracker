/**
 * Micro-couche DOM : assez pour construire des vues lisibles, rien de plus.
 * Pas de framework — le rendu est direct, et c'est volontaire.
 */

const NS_SVG = 'http://www.w3.org/2000/svg';
const MOTIF_SELECTEUR = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/;
const CACHE = new Map();

/** "section.bloc.bloc--large#id" → { tag, id, classes } */
function analyser(selecteur) {
  const memo = CACHE.get(selecteur);
  if (memo) return memo;
  const correspondance = selecteur.match(MOTIF_SELECTEUR);
  if (!correspondance) throw new Error(`Sélecteur invalide : ${selecteur}`);
  const parse = {
    tag: correspondance[1] || 'div',
    id: correspondance[2] || null,
    classes: correspondance[3] ? correspondance[3].slice(1).split('.') : [],
  };
  CACHE.set(selecteur, parse);
  return parse;
}

const PROPRIETES_DIRECTES = new Set([
  'value', 'checked', 'disabled', 'selected', 'hidden', 'open', 'indeterminate', 'multiple', 'readOnly',
]);

function appliquer(noeud, proprietes) {
  for (const [cle, valeur] of Object.entries(proprietes)) {
    if (valeur === null || valeur === undefined || valeur === false) continue;

    if (cle === 'class') {
      noeud.setAttribute('class', [noeud.getAttribute('class'), valeur].filter(Boolean).join(' '));
    } else if (cle === 'text') {
      noeud.textContent = String(valeur);
    } else if (cle === 'style' && typeof valeur === 'object') {
      for (const [prop, v] of Object.entries(valeur)) {
        if (v === null || v === undefined) continue;
        if (prop.startsWith('--')) noeud.style.setProperty(prop, String(v));
        else noeud.style[prop] = v;
      }
    } else if (cle === 'dataset') {
      Object.assign(noeud.dataset, valeur);
    } else if (cle.startsWith('on') && typeof valeur === 'function') {
      noeud.addEventListener(cle.slice(2).toLowerCase(), valeur);
    } else if (PROPRIETES_DIRECTES.has(cle)) {
      noeud[cle] = valeur;
    } else if (valeur === true) {
      noeud.setAttribute(cle, '');
    } else {
      noeud.setAttribute(cle, String(valeur));
    }
  }
}

function ajouter(parent, enfants) {
  if (enfants === null || enfants === undefined || enfants === false || enfants === true) return;
  if (Array.isArray(enfants)) {
    for (const enfant of enfants) ajouter(parent, enfant);
    return;
  }
  parent.append(enfants instanceof Node ? enfants : document.createTextNode(String(enfants)));
}

/** Élément HTML. `el('button.bouton', { onclick }, 'Appliquer')` */
export function el(selecteur = 'div', proprietes = null, enfants = null) {
  const { tag, id, classes } = analyser(selecteur);
  const noeud = document.createElement(tag);
  if (id) noeud.id = id;
  if (classes.length) noeud.className = classes.join(' ');

  // Signature souple : el(sel, enfants) sans objet de propriétés.
  if (proprietes instanceof Node || Array.isArray(proprietes) || typeof proprietes === 'string' || typeof proprietes === 'number') {
    ajouter(noeud, proprietes);
  } else if (proprietes) {
    appliquer(noeud, proprietes);
  }
  ajouter(noeud, enfants);
  return noeud;
}

/** Élément SVG (namespace correct, sinon rien ne s'affiche). */
export function svg(tag, proprietes = null, enfants = null) {
  const noeud = document.createElementNS(NS_SVG, tag);
  if (proprietes) {
    for (const [cle, valeur] of Object.entries(proprietes)) {
      if (valeur === null || valeur === undefined || valeur === false) continue;
      if (cle.startsWith('on') && typeof valeur === 'function') noeud.addEventListener(cle.slice(2).toLowerCase(), valeur);
      else if (cle === 'dataset') Object.assign(noeud.dataset, valeur);
      else if (cle === 'text') noeud.textContent = String(valeur);
      else noeud.setAttribute(cle, String(valeur));
    }
  }
  ajouter(noeud, enfants);
  return noeud;
}

export function frag(...enfants) {
  const morceau = document.createDocumentFragment();
  ajouter(morceau, enfants);
  return morceau;
}

export function vider(noeud) {
  while (noeud.firstChild) noeud.removeChild(noeud.firstChild);
  return noeud;
}

export function remplacer(noeud, contenu) {
  vider(noeud);
  ajouter(noeud, contenu);
  return noeud;
}

export const $ = (selecteur, racine = document) => racine.querySelector(selecteur);
export const $$ = (selecteur, racine = document) => [...racine.querySelectorAll(selecteur)];

/**
 * Applique un délai d'animation croissant aux enfants : les lignes
 * s'inscrivent l'une après l'autre, comme sur un registre qu'on remplit.
 */
export function echelonner(noeuds, pas = 26, depart = 0) {
  const liste = Array.isArray(noeuds) ? noeuds : [...noeuds];
  liste.forEach((noeud, index) => {
    noeud.style.setProperty('--retard', `${depart + index * pas}ms`);
    noeud.classList.add('surgit');
  });
  return liste;
}
