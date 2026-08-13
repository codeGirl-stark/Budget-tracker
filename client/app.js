/**
 * Point d'entrée : routage, navigation, thème, indicateur de sauvegarde.
 */

import { el, $, remplacer, vider } from './lib/dom.js';
import { message, montrerBulle, cacherBulle } from './lib/composants.js';
import * as etat from './etat.js';
import * as session from './session.js';
import { vueConnexion } from './vues/connexion.js';
import { vueTableauBord } from './vues/tableau-bord.js';
import { vueBudget } from './vues/budget.js';
import { vueFonds } from './vues/fonds.js';
import { vueGrandLivre } from './vues/grand-livre.js';
import { vueReglages } from './vues/reglages.js';
import { vueAdmin } from './vues/admin.js';

const SECTIONS = [
  { cle: 'tableau-bord', label: 'Tableau de bord', glyphe: '◱', avecAnnee: true },
  { cle: 'budget', label: 'Budget mensuel', glyphe: '▤', avecAnnee: true },
  { cle: 'fonds', label: 'Fonds & projets', glyphe: '◈', avecAnnee: false },
  { cle: 'grand-livre', label: 'Grand livre', glyphe: '☰', avecAnnee: true },
  { cle: 'reglages', label: 'Réglages', glyphe: '⚙', avecAnnee: false },
  { cle: 'admin', label: 'Comptes', glyphe: '◎', avecAnnee: false, adminSeulement: true },
];

const estAdmin = () => session.utilisateurCourant()?.role === 'admin';

/** Sections réellement accessibles au compte connecté. */
const sectionsVisibles = () => SECTIONS.filter((s) => !s.adminSeulement || estAdmin());

let routeCourante = null;

/* ================================================================== *
 * Routage
 * ================================================================== */

function lireRoute() {
  const brut = location.hash.replace(/^#\/?/, '');
  const morceaux = brut.split('/').filter(Boolean);
  const state = etat.lire();
  const anneeDefaut = state?.currentYear ?? new Date().getFullYear();

  // Une section réservée reste inaccessible par simple saisie d'URL.
  const demandee = SECTIONS.find((s) => s.cle === morceaux[0]);
  const section = demandee && (!demandee.adminSeulement || estAdmin())
    ? demandee.cle
    : 'tableau-bord';
  const annee = Number.isInteger(Number(morceaux[1])) && morceaux[1] ? Number(morceaux[1]) : anneeDefaut;
  const mois = Number.isInteger(Number(morceaux[2])) ? Math.min(11, Math.max(0, Number(morceaux[2]))) : moisParDefaut(annee);

  return { section, annee, mois };
}

/** À l'ouverture du budget, on tombe sur le mois courant si l'année est celle en cours. */
function moisParDefaut(annee) {
  const maintenant = new Date();
  return annee === maintenant.getFullYear() ? maintenant.getMonth() : 0;
}

function naviguer(chemin) {
  const cible = chemin.startsWith('#') ? chemin : `#${chemin}`;
  if (location.hash === cible) rendre();
  else location.hash = cible;
}

/* ================================================================== *
 * Contexte transmis aux vues
 * ================================================================== */

function contexte(route) {
  return {
    state: etat.lire(),
    annee: route.annee,
    mois: route.mois,
    section: route.section,
    naviguer,
    muter: etat.muter,
    rafraichir: rendre,
    exporter: () => {
      etat.telechargerExport();
      message('Sauvegarde téléchargée.', { ton: 'succes' });
    },
    importer: (brut) => etat.importer(brut),
    utilisateur: session.utilisateurCourant(),
    deconnecter: deconnecter,
  };
}

async function deconnecter() {
  await etat.vider().catch(() => {});
  await session.deconnecter();
  etat.reinitialiser();
  afficherConnexion();
}

/* ================================================================== *
 * Rendu
 * ================================================================== */

const VUES = {
  'tableau-bord': vueTableauBord,
  budget: vueBudget,
  fonds: vueFonds,
  'grand-livre': vueGrandLivre,
  reglages: vueReglages,
  admin: vueAdmin,
};

function rendre() {
  const route = lireRoute();
  const contenu = $('#contenu');
  const ctx = contexte(route);

  const memeSection = routeCourante?.section === route.section;
  routeCourante = route;

  try {
    const vue = VUES[route.section](ctx);
    remplacer(contenu, vue);
  } catch (erreur) {
    console.error('[rendu]', erreur);
    remplacer(contenu, el('div.vue', [
      el('h1.vue__titre', 'Quelque chose a cassé'),
      el('p.note', erreur.message),
      el('pre.trace', String(erreur.stack ?? '')),
    ]));
  }

  majNav(route);
  majRailAnnee(route);
  cacherBulle();
  if (!memeSection) contenu.scrollTo?.({ top: 0 });
}

/* ================================================================== *
 * Rail de navigation
 * ================================================================== */

function construireNav() {
  const nav = $('#nav');
  vider(nav);
  for (const section of sectionsVisibles()) {
    nav.append(el('a.nav__lien', {
      href: `#/${section.cle}`,
      dataset: { section: section.cle },
    }, [
      el('span.nav__glyphe', { 'aria-hidden': 'true' }, section.glyphe),
      el('span.nav__label', section.label),
    ]));
  }
}

function majNav(route) {
  for (const lien of document.querySelectorAll('.nav__lien')) {
    const actif = lien.dataset.section === route.section;
    lien.classList.toggle('nav__lien--actif', actif);
    if (actif) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');

    // On garde l'année (et le mois) dans les liens qui en dépendent.
    const section = SECTIONS.find((s) => s.cle === lien.dataset.section);
    if (!section?.avecAnnee) { lien.href = `#/${section.cle}`; continue; }
    lien.href = section.cle === 'budget'
      ? `#/budget/${route.annee}/${route.mois}`
      : `#/${section.cle}/${route.annee}`;
  }
}

function majRailAnnee(route) {
  const cible = $('#rail-annee');
  if (cible) cible.textContent = String(route.annee);
}

/* ================================================================== *
 * Thème
 * ================================================================== */

const THEMES = ['auto', 'clair', 'sombre'];
const LIBELLES_THEME = { auto: 'Auto', clair: 'Papier', sombre: 'Encre' };

function appliquerTheme(theme) {
  document.documentElement.dataset.theme = theme === 'auto' ? '' : theme;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  const bouton = $('#bouton-theme');
  if (bouton) {
    remplacer(bouton, [
      el('span', { 'aria-hidden': 'true' }, theme === 'sombre' ? '◑' : theme === 'clair' ? '◐' : '◒'),
      el('span', ` ${LIBELLES_THEME[theme]}`),
    ]);
    bouton.setAttribute('aria-label', `Thème : ${LIBELLES_THEME[theme]}. Changer.`);
  }
}

function initTheme() {
  let theme = localStorage.getItem('plan-financier:theme') ?? 'auto';
  if (!THEMES.includes(theme)) theme = 'auto';
  appliquerTheme(theme);

  $('#bouton-theme')?.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    localStorage.setItem('plan-financier:theme', theme);
    appliquerTheme(theme);
  });
}

/* ================================================================== *
 * Indicateur de sauvegarde
 * ================================================================== */

function initStatut() {
  const conteneur = $('#etat-sauvegarde');
  const texte = conteneur?.querySelector('.etat-sauvegarde__texte');
  if (!conteneur || !texte) return;

  etat.abonnerStatut((statut) => {
    conteneur.dataset.code = statut.code;
    texte.textContent = statut.texte;
  });
}

/* ================================================================== *
 * Infobulles déclaratives (`data-infobulle`)
 * ================================================================== */

function initInfobulles() {
  const montrer = (evenement) => {
    const cible = evenement.target.closest?.('[data-infobulle]');
    if (!cible) return;
    const cadre = cible.getBoundingClientRect();
    montrerBulle(cible.dataset.infobulle, cadre.left + cadre.width / 2, cadre.top);
  };
  const cacher = (evenement) => {
    if (evenement.target.closest?.('[data-infobulle]')) cacherBulle();
  };

  document.addEventListener('mouseover', montrer);
  document.addEventListener('mouseout', cacher);
  document.addEventListener('focusin', montrer);
  document.addEventListener('focusout', cacher);
  document.addEventListener('keydown', (evenement) => { if (evenement.key === 'Escape') cacherBulle(); });
  addEventListener('scroll', cacherBulle, { passive: true, capture: true });
}

/* ================================================================== *
 * Raccourcis clavier
 * ================================================================== */

function initRaccourcis() {
  addEventListener('keydown', (evenement) => {
    if (!evenement.altKey || evenement.ctrlKey || evenement.metaKey) return;
    if (routeCourante?.section !== 'budget') return;
    if (evenement.key !== 'ArrowLeft' && evenement.key !== 'ArrowRight') return;

    evenement.preventDefault();
    const pas = evenement.key === 'ArrowLeft' ? -1 : 1;
    const brut = routeCourante.mois + pas;
    const annee = routeCourante.annee + (brut < 0 ? -1 : brut > 11 ? 1 : 0);
    const mois = (brut + 12) % 12;
    naviguer(`/budget/${annee}/${mois}`);
  });
}

/* ================================================================== *
 * Démarrage
 * ================================================================== */

/* ================================================================== *
 * Aiguillage connexion / application
 * ================================================================== */

let applicationInitialisee = false;

function afficherConnexion() {
  const coque = $('#coque');
  const acces = $('#acces') ?? el('div#acces.acces-ecran');
  if (!acces.isConnected) document.body.append(acces);

  if (coque) coque.hidden = true;
  acces.hidden = false;
  document.documentElement.classList.add('mode-acces');

  remplacer(acces, vueConnexion({
    onConnecte: async (profil, { nouveau }) => {
      await demarrerApplication();
      message(
        nouveau ? `Bienvenue${profil.nom ? ` ${profil.nom}` : ''} — ton plan est prêt.` : 'Te revoilà.',
        { ton: 'succes' },
      );
    },
  }));
}

async function demarrerApplication() {
  await etat.charger();

  const acces = $('#acces');
  if (acces) { acces.hidden = true; vider(acces); }
  document.documentElement.classList.remove('mode-acces');

  // Reconstruite à chaque connexion : les sections dépendent du rôle, et un
  // autre compte peut se connecter sans recharger la page.
  construireNav();

  if (!applicationInitialisee) {
    initStatut();
    initInfobulles();
    initRaccourcis();
    etat.abonner(() => rendre());
    etat.auSessionPerdue(() => {
      message('Ta session a expiré. Reconnecte-toi pour enregistrer.', { ton: 'erreur', duree: 0 });
      afficherConnexion();
    });
    addEventListener('hashchange', rendre);
    applicationInitialisee = true;
  }

  if (!location.hash) location.replace(`#/tableau-bord/${etat.lire().currentYear}`);
  rendre();
  majIdentite();

  const coque = $('#coque');
  if (coque) {
    coque.hidden = false;
    requestAnimationFrame(() => coque.classList.add('coque--prete'));
  }
}

/** Affiche le compte connecté en pied de rail. */
function majIdentite() {
  const profil = session.utilisateurCourant();
  const pied = $('.rail__pied');
  if (!pied || !profil) return;

  let bloc = $('#identite');
  if (!bloc) {
    bloc = el('div#identite.identite');
    pied.prepend(bloc);
  }
  remplacer(bloc, [
    el('span.identite__nom', { title: profil.email }, profil.nom || profil.email.split('@')[0]),
    el('button.identite__sortie', {
      type: 'button',
      title: 'Se déconnecter',
      'aria-label': `Se déconnecter de ${profil.email}`,
      onclick: () => deconnecter(),
    }, 'Sortir'),
  ]);
}

/**
 * Le service worker n'est enregistré qu'en contexte sécurisé (HTTPS ou
 * localhost) — ailleurs le navigateur le refuse de toute façon.
 */
function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((erreur) => {
      console.warn('[sw] enregistrement impossible :', erreur.message);
    });
  });
}

async function demarrer() {
  initTheme();
  initServiceWorker();

  try {
    const profil = await session.recupererSession();
    if (profil) await demarrerApplication();
    else afficherConnexion();
  } catch (erreur) {
    if (erreur instanceof session.ErreurAuthentification) {
      afficherConnexion();
    } else {
      console.error('[démarrage]', erreur);
      remplacer($('#chargement'), el('div.chargement__erreur', [
        el('p', 'Impossible de joindre le serveur.'),
        el('p.note', erreur.message),
        el('button.bouton.bouton--primaire', { type: 'button', onclick: () => location.reload() }, 'Réessayer'),
      ]));
      return;
    }
  }

  $('#chargement')?.remove();
}

demarrer();
