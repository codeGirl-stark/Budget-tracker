/**
 * Écran de connexion / inscription.
 * Première page vue par une nouvelle personne : elle doit expliquer ce qu'est
 * l'application avant de demander une adresse e-mail.
 */

import { el, remplacer, echelonner } from '../lib/dom.js';
import { bouton, message } from '../lib/composants.js';
import { inscrire, connecter } from '../session.js';

const LONGUEUR_MIN = 10;

export function vueConnexion({ onConnecte }) {
  let mode = 'connexion'; // ou 'inscription'
  let enCours = false;

  const formulaire = el('form.acces__formulaire', { novalidate: true });
  const zoneErreur = el('div.acces__erreur', { role: 'alert' });

  const champ = (nom, { type, label, aide = null, autocomplete }) => {
    const saisie = el('input.acces__saisie', {
      type,
      name: nom,
      id: `acces-${nom}`,
      autocomplete,
      required: true,
      spellcheck: 'false',
      oninput: () => { zoneErreur.textContent = ''; saisie.removeAttribute('aria-invalid'); },
    });
    return {
      saisie,
      noeud: el('div.acces__champ', [
        el('label.acces__label', { for: `acces-${nom}` }, label),
        saisie,
        aide ? el('p.acces__aide', aide) : null,
      ]),
    };
  };

  const construire = () => {
    const inscription = mode === 'inscription';

    const email = champ('email', {
      type: 'email',
      label: 'Adresse e-mail',
      autocomplete: 'email',
    });
    const motDePasse = champ('motDePasse', {
      type: 'password',
      label: 'Mot de passe',
      autocomplete: inscription ? 'new-password' : 'current-password',
      aide: inscription ? `${LONGUEUR_MIN} caractères minimum. Choisis-en un que tu n’utilises nulle part ailleurs.` : null,
    });
    const nom = inscription
      ? champ('nom', { type: 'text', label: 'Prénom (facultatif)', autocomplete: 'given-name' })
      : null;
    if (nom) nom.saisie.required = false;

    const valider = el('button.bouton.bouton--primaire.bouton--bloc.acces__valider', { type: 'submit' },
      inscription ? 'Créer mon compte' : 'Se connecter');

    const champs = [nom?.noeud, email.noeud, motDePasse.noeud].filter(Boolean);

    formulaire.onsubmit = async (evenement) => {
      evenement.preventDefault();
      if (enCours) return;

      zoneErreur.textContent = '';
      const valeurs = {
        email: email.saisie.value.trim(),
        motDePasse: motDePasse.saisie.value,
        nom: nom?.saisie.value.trim() ?? '',
      };

      if (!valeurs.email) return echouer('Renseigne ton adresse e-mail.', email.saisie);
      if (!valeurs.motDePasse) return echouer('Renseigne ton mot de passe.', motDePasse.saisie);
      if (inscription && valeurs.motDePasse.length < LONGUEUR_MIN) {
        return echouer(`Le mot de passe doit faire au moins ${LONGUEUR_MIN} caractères.`, motDePasse.saisie);
      }

      enCours = true;
      valider.disabled = true;
      valider.textContent = inscription ? 'Création…' : 'Connexion…';

      try {
        const profil = inscription ? await inscrire(valeurs) : await connecter(valeurs);
        onConnecte(profil, { nouveau: inscription });
      } catch (erreur) {
        const cible = erreur.champ === 'email' ? email.saisie
          : erreur.champ === 'motDePasse' ? motDePasse.saisie
            : motDePasse.saisie;
        echouer(erreur.message, cible);
      } finally {
        enCours = false;
        valider.disabled = false;
        valider.textContent = inscription ? 'Créer mon compte' : 'Se connecter';
      }
    };

    const echouer = (texte, cible) => {
      zoneErreur.textContent = texte;
      cible?.setAttribute('aria-invalid', 'true');
      cible?.focus();
    };

    remplacer(formulaire, [
      el('h2.acces__titre', inscription ? 'Créer un compte' : 'Content de te revoir'),
      el('p.acces__sous-titre', inscription
        ? 'Ton plan financier est privé : personne d’autre n’y a accès.'
        : 'Reprends ton plan là où tu l’as laissé.'),
      ...champs,
      zoneErreur,
      valider,
      el('p.acces__bascule', [
        inscription ? 'Tu as déjà un compte ? ' : 'Pas encore de compte ? ',
        el('button.acces__lien', {
          type: 'button',
          onclick: () => { mode = inscription ? 'connexion' : 'inscription'; construire(); },
        }, inscription ? 'Se connecter' : 'En créer un'),
      ]),
    ]);

    echelonner([...formulaire.children], 40);
    requestAnimationFrame(() => (nom ?? email).saisie.focus());
  };

  construire();

  return el('div.acces', [
    el('aside.acces__marque', [
      el('div.acces__marque-tete', [
        el('span.rail__filet'),
        el('h1.acces__marque-titre', 'Plan\nfinancier'),
      ]),
      el('div.acces__arguments', [
        argument('Prévu contre réel', 'Onze catégories suivies mois par mois, avec l’écart affiché en clair.'),
        argument('La dîme, d’abord', 'Calculée automatiquement à 10 % du revenu, jamais saisie à la main.'),
        argument('Des fonds qui durent', 'Urgence, études, business, projets : des cumuls sur plusieurs années.'),
      ]),
      el('p.acces__pied', 'Tes données restent les tiennes. Export possible à tout moment.'),
    ]),
    el('main.acces__panneau', formulaire),
  ]);
}

function argument(titre, texte) {
  return el('div.acces__argument', [
    el('span.acces__puce', { 'aria-hidden': 'true' }),
    el('div', [
      el('strong.acces__argument-titre', titre),
      el('p.acces__argument-texte', texte),
    ]),
  ]);
}
