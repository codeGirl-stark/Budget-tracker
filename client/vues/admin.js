/**
 * Volet d'administration — gestion des comptes uniquement.
 *
 * Ce que cette vue permet : voir qui a un compte, suspendre, réactiver,
 * déconnecter, promouvoir, supprimer.
 * Ce qu'elle ne permet pas, volontairement : consulter ou modifier le plan
 * financier de quelqu'un d'autre. L'API n'expose même pas la route.
 */

import { el, remplacer, echelonner } from '../lib/dom.js';
import { bloc, bouton, message, confirmer, alerte, messageVide, indice } from '../lib/composants.js';
import { utilisateurCourant } from '../session.js';

async function appelerAdmin(chemin, { methode = 'GET', corps = null } = {}) {
  const options = {
    method: methode,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (corps) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(corps);
  }
  const reponse = await fetch(chemin, options);
  const charge = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(charge.erreur ?? `Erreur ${reponse.status}`);
  return charge;
}

const dateCourte = (iso) => (iso
  ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—');

const depuis = (iso) => {
  if (!iso) return 'jamais connectée';
  const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (jours <= 0) return 'aujourd’hui';
  if (jours === 1) return 'hier';
  if (jours < 30) return `il y a ${jours} jours`;
  if (jours < 365) return `il y a ${Math.floor(jours / 30)} mois`;
  return `il y a ${Math.floor(jours / 365)} an(s)`;
};

export function vueAdmin(ctx) {
  const conteneur = el('div.admin');
  const moi = utilisateurCourant();

  const charger = async () => {
    remplacer(conteneur, el('p.note', 'Chargement des comptes…'));
    try {
      const { comptes, admins } = await appelerAdmin('/api/admin/comptes');
      dessiner(comptes, admins);
    } catch (erreur) {
      remplacer(conteneur, alerte(erreur.message, { ton: 'attention', titre: 'Chargement impossible' }));
    }
  };

  const agir = async (action, libelleSucces) => {
    try {
      await action();
      message(libelleSucces, { ton: 'succes' });
      await charger();
    } catch (erreur) {
      message(erreur.message, { ton: 'erreur', duree: 7000 });
    }
  };

  const dessiner = (comptes, admins) => {
    if (comptes.length === 0) {
      remplacer(conteneur, messageVide('Aucun compte enregistré.'));
      return;
    }

    const lignes = comptes.map((compte) => ligneCompte(compte, agir, admins));
    echelonner(lignes, 26);

    remplacer(conteneur, [
      el('div.admin__resume', [
        vignette('Comptes', String(comptes.length)),
        vignette('Actifs', String(comptes.filter((c) => !c.suspendu).length)),
        vignette('Suspendus', String(comptes.filter((c) => c.suspendu).length)),
        vignette('Administrateurs', String(admins)),
      ]),
      el('div.admin__liste', lignes),
    ]);
  };

  charger();

  return el('div.vue.vue--admin', [
    el('header.vue__tete', [
      el('div.vue__titre-zone', [
        el('p.vue__sur-titre', 'Administration'),
        el('h1.vue__titre', 'Les comptes'),
      ]),
      el('div.vue__outils', bouton('Rafraîchir', { variante: 'discret', onclick: charger })),
      el('p.vue__intro', [
        'Tu gères ici les accès : qui peut entrer, qui est suspendu, qui administre. ',
        el('strong', 'Les plans financiers restent privés'),
        ' — même toi ne peux pas les consulter depuis cette page.',
      ]),
    ]),

    bloc({
      titre: 'Comptes enregistrés',
      description: 'Suspendre coupe l’accès immédiatement, sur tous les appareils, sans rien supprimer.',
      classe: 'bloc--admin',
      corps: conteneur,
    }),
  ]);
}

function vignette(label, valeur) {
  return el('div.admin__vignette', [
    el('span.admin__vignette-valeur.chiffre', valeur),
    el('span.admin__vignette-label', label),
  ]);
}

function ligneCompte(compte, agir, admins) {
  const estDernierAdmin = compte.role === 'admin' && !compte.suspendu && admins <= 1;

  const actions = [];

  if (!compte.moi) {
    actions.push(compte.suspendu
      ? bouton('Réactiver', {
        variante: 'discret',
        onclick: () => agir(
          () => appelerAdmin(`/api/admin/comptes/${compte.id}/reactiver`, { methode: 'POST' }),
          `Le compte de ${compte.email} est réactivé.`,
        ),
      })
      : bouton('Suspendre', {
        variante: 'discret',
        desactive: estDernierAdmin,
        titre: estDernierAdmin ? 'Impossible : dernier administrateur actif' : 'Couper l’accès sans supprimer les données',
        onclick: async () => {
          const ok = await confirmer({
            titre: `Suspendre ${compte.email} ?`,
            texte: 'La personne sera déconnectée de tous ses appareils et ne pourra plus se connecter. Son plan financier est conservé intact et lui sera rendu à la réactivation.',
            valider: 'Suspendre',
          });
          if (!ok) return;
          agir(
            () => appelerAdmin(`/api/admin/comptes/${compte.id}/suspendre`, { methode: 'POST' }),
            `Le compte de ${compte.email} est suspendu.`,
          );
        },
      }));
  }

  if (compte.sessionsActives > 0 && !compte.moi) {
    actions.push(bouton('Déconnecter', {
      variante: 'discret',
      titre: 'Fermer toutes ses sessions ouvertes',
      onclick: () => agir(
        () => appelerAdmin(`/api/admin/comptes/${compte.id}/sessions`, { methode: 'POST' }),
        `Sessions de ${compte.email} fermées.`,
      ),
    }));
  }

  actions.push(bouton(compte.role === 'admin' ? 'Retirer l’admin' : 'Nommer admin', {
    variante: 'discret',
    desactive: estDernierAdmin,
    titre: estDernierAdmin ? 'Impossible : dernier administrateur actif' : null,
    onclick: async () => {
      const versAdmin = compte.role !== 'admin';
      const ok = await confirmer({
        titre: versAdmin ? `Nommer ${compte.email} administrateur ?` : `Retirer les droits de ${compte.email} ?`,
        texte: versAdmin
          ? 'Cette personne pourra gérer tous les comptes, y compris suspendre le tien. Elle n’aura toujours aucun accès aux plans financiers des autres.'
          : 'Cette personne redeviendra un membre ordinaire.',
        valider: versAdmin ? 'Nommer' : 'Retirer',
      });
      if (!ok) return;
      agir(
        () => appelerAdmin(`/api/admin/comptes/${compte.id}/role`, {
          methode: 'POST',
          corps: { role: versAdmin ? 'admin' : 'membre' },
        }),
        versAdmin ? `${compte.email} est administrateur.` : `${compte.email} redevient membre.`,
      );
    },
  }));

  if (!compte.moi) {
    actions.push(bouton('Supprimer', {
      variante: 'danger',
      desactive: estDernierAdmin,
      onclick: async () => {
        const ok = await confirmer({
          titre: `Supprimer définitivement ${compte.email} ?`,
          texte: 'Le compte, son plan financier et tout son historique seront effacés. Cette action est irréversible. Si tu veux seulement couper l’accès, utilise plutôt « Suspendre ».',
          valider: 'Supprimer définitivement',
          danger: true,
        });
        if (!ok) return;
        agir(
          () => appelerAdmin(`/api/admin/comptes/${compte.id}`, { methode: 'DELETE' }),
          `Compte de ${compte.email} supprimé.`,
        );
      },
    }));
  }

  return el(`article.compte-ligne${compte.suspendu ? '.compte-ligne--suspendu' : ''}`, [
    el('div.compte-ligne__identite', [
      el('div.compte-ligne__tete', [
        el('span.compte-ligne__nom', compte.nom || compte.email.split('@')[0]),
        compte.role === 'admin' ? el('span.badge.badge--admin', 'admin') : null,
        compte.moi ? el('span.badge.badge--moi', 'toi') : null,
        compte.suspendu ? el('span.badge.badge--suspendu', 'suspendu') : null,
      ]),
      el('span.compte-ligne__email', compte.email),
      el('span.compte-ligne__meta', [
        `Inscrite le ${dateCourte(compte.creeLe)}`,
        ' · ',
        `vue ${depuis(compte.vuLe)}`,
        compte.sessionsActives > 0
          ? ` · ${compte.sessionsActives} session${compte.sessionsActives > 1 ? 's' : ''} ouverte${compte.sessionsActives > 1 ? 's' : ''}`
          : '',
      ]),
    ]),
    el('div.compte-ligne__actions', actions),
  ]);
}
