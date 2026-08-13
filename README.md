# Plan financier personnel

Application de pilotage budgétaire multi-utilisateur : prévu contre réel par
catégorie, fonds suivis en cumulé sur plusieurs années, tableau de bord et grand
livre annuel. Chaque personne a son compte et son plan, invisible des autres.

Implémentation du [cahier des charges](./cahier-des-charges-plan-financier.md).

## Démarrer

```bash
npm start        # http://127.0.0.1:4173
npm run dev      # idem, avec redémarrage au moindre changement
npm test         # 87 tests, sans dépendance
```

Node 22.5+ requis (pour `node:sqlite`). **Aucune dépendance à installer.**

Au premier lancement, crée ton compte depuis l'écran d'accueil. Si un fichier
`data/plan-financier.json` de l'ancienne version mono-utilisateur est présent, le
**premier compte créé** en hérite automatiquement.

## Technologies

Zéro dépendance, zéro build, zéro bundler — le code écrit est le code exécuté.

| Couche | Choix |
|---|---|
| Serveur | Node.js ≥ 22.5, module `node:http` |
| Base | SQLite via `node:sqlite` |
| Mots de passe | `scrypt` (`node:crypto`), sel unique par compte |
| Sessions | Jeton aléatoire, stocké haché, cookie `HttpOnly` |
| Front | JavaScript vanilla, modules ES natifs |
| Style | CSS manuscrit, variables natives |
| Graphiques | SVG généré à la main |
| Tests | `node:test` |

## Sécurité

- Les mots de passe ne sont **jamais** stockés en clair ni réversibles.
- Le jeton de session est stocké **haché** : une fuite de la base ne permet pas
  de rejouer les sessions.
- Le cookie est `HttpOnly` (invisible au JavaScript, donc invulnérable au vol par
  XSS) et `SameSite=Lax` (ne part pas depuis un autre site).
- Les requêtes modifiantes vérifient l'en-tête `Origin`.
- Huit tentatives de connexion par quart d'heure, par IP **et** par adresse.
- Une adresse inconnue coûte le même temps de calcul qu'une adresse connue : le
  délai de réponse ne révèle pas quels comptes existent.
- Le service worker ne met **jamais** en cache les réponses de `/api/`.

En production, l'application **doit** être servie en HTTPS derrière un reverse
proxy, avec `TRUST_PROXY=1` pour que les cookies `Secure` et la détection d'IP
fonctionnent.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4173` | Port d'écoute |
| `HOST` | `127.0.0.1` | Mettre `0.0.0.0` derrière un proxy ou en conteneur |
| `DATA_DIR` | `./data` | Emplacement de la base — **doit être un disque persistant** |
| `TRUST_PROXY` | — | `1` derrière un reverse proxy HTTPS |
| `ADMIN_EMAIL` | — | Désigne l'administrateur, quel que soit l'ordre d'inscription |

## Ce qu'il faut savoir

**Rien ne se perd.** Chaque modification est enregistrée seule, une demi-seconde
après la dernière frappe. Les vingt dernières versions de chaque plan sont
conservées en base. Si deux fenêtres modifient le même plan, la plus ancienne est
refusée et rechargée plutôt que d'écraser la plus récente.

**La dîme n'est jamais saisie.** Son *Prévu* vaut 10 % du revenu du mois, recalculé
à chaque changement. Il n'existe aucun champ pour l'écrire à la main — c'est
volontaire. Seul le *Réel* s'édite. Le réglage `regleDime` choisit la base :
revenu total ou salaire seul.

**Le socle ne doit pas reposer sur du revenu variable.** Dîme, essentielles et
famille sont comparés en permanence au seul revenu *stable*. Si le socle le
dépasse, l'application le signale — elle ne corrige rien toute seule.

**Une augmentation de salaire ne gonfle pas le train de vie.** Quand une source
stable augmente d'un mois sur l'autre, l'application propose de répartir *le delta*
selon la règle du surplus. Elle propose ; elle n'applique jamais d'office.

## Sur téléphone

L'application est installable depuis le navigateur (« Ajouter à l'écran
d'accueil ») : icône, plein écran, consultation hors-ligne du dernier état chargé.
Aucun store, aucun compte développeur. Une application native pourra plus tard
consommer la même API en envoyant `Authorization: Bearer <jeton>` — le jeton est
renvoyé par `/api/connexion` et `/api/inscription`.

## Structure

```
shared/      Logique métier pure — chargée telle quelle par Node et le navigateur
  categories.js    Les 11 catégories, les 3 scénarios, les repères Dakar
  model.js         Calculs : dîme, statuts, cumuls, KPIs, normalisation
server/
  index.js         Routage HTTP, sessions, fichiers statiques
  db.js            Tout le SQL du projet, isolé derrière des méthodes métier
  auth.js          Hachage, jetons, validation, limitation des tentatives
client/
  app.js           Aiguillage connexion/application, routage, thème
  session.js       Appels d'authentification
  etat.js          État du plan, sauvegarde différée, export/import
  sw.js            Service worker (jamais de données en cache)
  lib/             DOM, formatage, composants, graphiques SVG
  vues/            Connexion, tableau de bord, budget, fonds, grand livre, réglages
test/        87 tests : modèle, formatage, authentification, base
data/        Créé au démarrage — la base SQLite
```

`shared/` est le même code des deux côtés : un calcul juste dans les tests est le
calcul qui s'affiche à l'écran. Changer de moteur de base revient à réécrire
`server/db.js` seul.

## API

| Route | Rôle |
|---|---|
| `POST /api/inscription` | Créer un compte → session |
| `POST /api/connexion` | Ouvrir une session |
| `POST /api/deconnexion` | Fermer la session courante |
| `GET /api/moi` | Profil connecté |
| `GET /api/state` | Lire son plan |
| `PUT /api/state` | Écrire son plan (`rev` pour détecter les conflits) |
| `GET /api/export` | Télécharger son plan en JSON |
| `POST /api/mot-de-passe` | Changer de mot de passe (coupe les autres sessions) |
| `POST /api/compte/supprimer` | Supprimer son compte et toutes ses données |

### Administration (réservée au rôle `admin`)

| Route | Rôle |
|---|---|
| `GET /api/admin/comptes` | Lister les comptes (jamais leur contenu) |
| `POST /api/admin/comptes/:id/suspendre` | Couper l'accès sans rien supprimer |
| `POST /api/admin/comptes/:id/reactiver` | Rendre l'accès |
| `POST /api/admin/comptes/:id/sessions` | Fermer toutes ses sessions |
| `POST /api/admin/comptes/:id/role` | Nommer ou retirer un administrateur |
| `DELETE /api/admin/comptes/:id` | Supprimer le compte et ses données |

Pour un compte non-administrateur, ces routes répondent `404` — inutile de
confirmer l'existence d'un volet d'administration.

## Administration

**Le premier compte créé est administrateur.** La variable `ADMIN_EMAIL` permet de
désigner explicitement l'administrateur si l'ordre d'inscription ne convient pas.

Le volet « Comptes » gère les **accès**, jamais les finances :

- **Aucune route, aucune méthode de base de données n'expose le plan d'un autre
  compte à l'administrateur.** Un test automatisé vérifie qu'aucune donnée
  budgétaire ne fuit dans la liste des comptes.
- **Suspendre** coupe l'accès immédiatement sur tous les appareils, sans rien
  effacer : le plan est rendu intact à la réactivation.
- **Supprimer** est irréversible et emporte le plan et l'historique.

Garde-fous contre l'auto-verrouillage : un administrateur ne peut ni se
suspendre, ni se supprimer lui-même, et le dernier administrateur actif ne peut
pas être rétrogradé, suspendu ou supprimé.

## Détails d'interface

- **Alt + ←/→** passe au mois précédent / suivant.
- Cliquer une ligne du grand livre ouvre ce mois dans le budget.
- Le bouton de thème alterne Auto / Papier / Encre.
- Suppression d'une écriture ou d'un projet : un message propose d'annuler.
