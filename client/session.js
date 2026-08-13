/**
 * Session côté client.
 *
 * Le navigateur s'authentifie par cookie httpOnly : le jeton n'est jamais
 * exposé au JavaScript, donc une faille XSS ne peut pas le voler. Le jeton
 * renvoyé par l'API n'est utile qu'à un futur client mobile, qui l'enverra
 * lui-même en en-tête `Authorization`.
 */

let utilisateur = null;

export const utilisateurCourant = () => utilisateur;

/** Levée quand l'API répond 401 : l'appelant doit afficher l'écran de connexion. */
export class ErreurAuthentification extends Error {
  constructor(message = 'Connexion requise.') {
    super(message);
    this.name = 'ErreurAuthentification';
  }
}

async function appeler(chemin, { methode = 'GET', corps = null } = {}) {
  const options = {
    method: methode,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (corps !== null) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(corps);
  }

  const reponse = await fetch(chemin, options);
  const charge = await reponse.json().catch(() => ({}));

  if (reponse.status === 401) throw new ErreurAuthentification(charge.erreur);
  if (!reponse.ok) {
    const erreur = new Error(charge.erreur ?? `Erreur ${reponse.status}`);
    erreur.champ = charge.champ ?? null;
    erreur.statut = reponse.status;
    throw erreur;
  }
  return charge;
}

/* ------------------------------------------------------------------ */

/** Qui est connecté ? `null` si personne — sans lever d'erreur. */
export async function recupererSession() {
  try {
    const { utilisateur: profil } = await appeler('/api/moi');
    utilisateur = profil;
    return profil;
  } catch (erreur) {
    if (erreur instanceof ErreurAuthentification) {
      utilisateur = null;
      return null;
    }
    throw erreur;
  }
}

export async function inscrire({ email, nom, motDePasse }) {
  const reponse = await appeler('/api/inscription', {
    methode: 'POST',
    corps: { email, nom, motDePasse },
  });
  utilisateur = reponse.utilisateur;
  return utilisateur;
}

export async function connecter({ email, motDePasse }) {
  const reponse = await appeler('/api/connexion', {
    methode: 'POST',
    corps: { email, motDePasse },
  });
  utilisateur = reponse.utilisateur;
  return utilisateur;
}

export async function deconnecter() {
  await appeler('/api/deconnexion', { methode: 'POST' }).catch(() => {});
  utilisateur = null;
}

export async function changerMotDePasse({ actuel, nouveau }) {
  await appeler('/api/mot-de-passe', { methode: 'POST', corps: { actuel, nouveau } });
}

export async function supprimerCompte({ motDePasse }) {
  await appeler('/api/compte/supprimer', { methode: 'POST', corps: { motDePasse } });
  utilisateur = null;
}
