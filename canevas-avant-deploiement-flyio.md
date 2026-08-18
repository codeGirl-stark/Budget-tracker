# Canevas — Évolutions avant déploiement Fly.io

## Contexte et portée

L'application actuelle fonctionne pour un usage personnel (compte unique testé),
avec un modèle de catégories figé dans `shared/categories.js`. Trois objectifs
futurs changent la donne :

1. Les catégories doivent devenir **personnalisables par compte**, avec un
   système de **templates** (dont les catégories créées par un utilisateur
   peuvent elles-mêmes devenir des templates pour d'autres).
2. La base de données doit migrer de **SQLite vers Postgres**.
3. L'application actuelle deviendra la base d'une **appli d'éducation
   financière mobile**, où le web servira surtout de page de renvoi vers
   l'appli mobile.

Ce document liste ce qu'il faut changer, dans quel ordre, et ce qui peut
attendre.

---

## 0. Le fil conducteur : les catégories cessent d'être une constante partagée

Aujourd'hui, `shared/categories.js` définit 11 catégories fixes, dont une
(`dime`) avec un comportement spécial codé en dur (10 % du revenu, champ
*Prévu* non éditable). Plusieurs autres parties du système supposent que ces
identifiants (`dime`, `epargne`, `investissement`, `business`, `projets`…)
existent et sont les mêmes pour tout le monde :

- Le calcul de la dîme (`revenu × 10 %`, non modifiable) est écrit pour *une*
  catégorie précise.
- Le cumul des fonds (fonds d'urgence, études des frères, business,
  investissement) est calculé en additionnant les *Réel* d'une catégorie
  identifiée par son id.
- Les sinking funds (appareils) s'accrochent spécifiquement à la catégorie
  `projets` via `sinkingFundId`.
- La règle du surplus (répartition d'une augmentation de salaire) répartit
  vers des catégories nommées en dur (`investissement`, `epargne`,
  `devperso_loisirs`, `projets`).

Rendre les catégories libres casse tout ça si on ne généralise que les
labels. Il faut généraliser les **comportements**, pas juste les noms.

---

## 1. Catégories personnalisables + système de templates

### 1.1 Où on est

Une seule liste de catégories, partagée par tous les comptes, définie dans le
code (`shared/categories.js`).

### 1.2 Où on va

- Chaque compte a **ses propres catégories**, stockées en base, modifiables
  librement (ajout, suppression, renommage, couleur, ordre, archivage).
- À la création d'un compte, l'utilisateur choisit un **template** de départ
  (le tien — "Plan Sénégal / Dakar" — devient le premier, pas une règle
  universelle). Le template **copie** ses catégories dans le nouveau compte —
  jamais de référence live : modifier son propre plan ne doit jamais changer
  le template ni celui d'un autre compte qui l'a adopté.
- Un utilisateur peut **publier son jeu de catégories comme template** pour
  que d'autres comptes le découvrent et démarrent avec.

### 1.3 Le mécanisme « verrouillée » doit devenir générique

Au lieu d'un cas spécial pour la dîme, prévoir un **type de catégorie**
réutilisable par n'importe qui :

```json
{
  "type": "verrouillee",
  "calcul": { "base": "revenu_total", "pourcentage": 10 }
}
```

`base` vaut `"revenu_total"` ou `"revenu_stable"` (cf. §10 du cahier des
charges initial). N'importe quel utilisateur peut créer une catégorie de ce
type avec le pourcentage de son choix — la dîme à 10 % devient *un exemple de
configuration dans ton template*, pas une règle imposée par le système.

### 1.4 Conséquences en cascade à traiter explicitement

| Mécanisme actuel | Dépendait de | Doit devenir |
|---|---|---|
| Dîme non modifiable | id `dime` en dur | Type `verrouillee` générique (§1.3), utilisable sur n'importe quelle catégorie |
| Cumul des fonds (urgence, études, business, investissement) | ids fixes (`epargne`, `investissement`…) | Un flag `type: "fonds"` sur la catégorie ; le cumul additionne le *Réel* de toute catégorie ainsi marquée, quel que soit son id |
| Sinking funds (appareils) | catégorie `projets` en dur | Le flag `type: "fonds"` avec un sous-champ `sousFonds: true` autorise n'importe quelle catégorie à porter des sous-fonds nommés, pas seulement une catégorie appelée "projets" |
| Règle du surplus | catégories nommées en dur dans `regleSurplus` | `regleSurplus` référence des **id de catégories du compte** (choisies par l'utilisateur dans sa propre liste), pas des clés fixes |
| Taux d'épargne effectif (dashboard) | somme de `epargne + investissement + business` | Somme de toutes les catégories marquées `type: "fonds"` du compte |

### 1.5 Modèle de données (esquisse)

```json
// catégorie (une ligne par compte)
{
  "id": "uuid",
  "compteId": "uuid",
  "label": "Épargne",
  "description": "...",
  "couleur": "#3F6B4A",
  "type": "normale | fonds | verrouillee",
  "calcul": { "base": "revenu_total", "pourcentage": 10 },
  "sousFonds": false,
  "ordre": 4,
  "archivee": false
}

// template (catalogue, public ou privé)
{
  "id": "uuid",
  "nom": "Plan Sénégal / Dakar",
  "description": "...",
  "auteurId": "uuid | null",
  "visibilite": "prive | public | masque",
  "definition": { "categories": [...], "scenarios": [...] },
  "creeLe": "...",
  "majLe": "..."
}
```

`definition` est un **instantané figé** au moment de la publication — un
compte qui adopte un template en obtient une copie indépendante, comme
n'importe quelle catégorie créée à la main.

### 1.6 Cycle de vie d'un template

1. Un compte construit ses catégories (à la main, ou en partant d'un
   template existant qu'il modifie).
2. Il choisit « Publier comme template » → snapshot de ses catégories et
   scénarios, `visibilite: "prive"` par défaut (visible seulement par lui,
   utile pour dupliquer entre ses propres plans si l'app le permet un jour)
   ou `"public"` (visible dans un catalogue partagé).
3. Un autre compte parcourt le catalogue, adopte un template → copie dans
   son propre plan, indépendante dès l'instant de l'adoption.

### 1.7 Modération minimale des templates publics

Rendre des templates visibles par d'autres comptes appelle un minimum de
contrôle. Pas besoin d'un système complexe au lancement, mais prévoir le
point d'accroche dans le modèle plutôt que de le rajouter après coup :

- Étendre le rôle `admin` existant (déjà capable de suspendre un compte) pour
  qu'il puisse passer un template en `visibilite: "masque"`.
- Le champ `visibilite` à trois valeurs (§1.5) porte déjà cette logique.

### 1.8 Migrer tes données actuelles

Script de migration à écrire : tes 11 catégories et tes 3 scénarios actuels
deviennent (a) ton propre jeu de catégories personnelles dans le nouveau
modèle, et (b) ton premier template public — celui qui préserve ton travail
au lieu de le perdre dans la bascule.

---

## 2. Migration SQLite → Postgres

### 2.1 Pourquoi ce moment est le bon

Le README actuel est explicite : une seule machine, un seul volume — `fly
scale count 2` créerait une seconde base et répartirait les comptes au
hasard. Le schéma va de toute façon changer avec les catégories/templates
(§1) : autant écrire les nouvelles tables directement pour Postgres plutôt
que de migrer SQLite → SQLite-avec-templates, puis SQLite → Postgres dans un
second temps.

### 2.2 Ce qui change concrètement

- `server/db.js` reste le seul fichier à réécrire — c'est justement pour ça
  qu'il isole tout le SQL du projet.
- Le principe « zéro dépendance » ne survit pas tel quel : `node:sqlite` est
  natif à Node, Postgres non — il faudra un driver (`pg` ou équivalent). À
  trancher consciemment : ce principe reste-t-il pour le reste du code
  (serveur, client) même si la couche base de données y déroge ? (voir
  « Points à trancher » en fin de document)
- `DATA_DIR` (chemin du fichier SQLite) devient `DATABASE_URL` (chaîne de
  connexion Postgres).
- Les colonnes JSON stockées en texte peuvent devenir `jsonb` natif —
  interrogeable directement en SQL, utile pour un futur tableau
  d'administration des templates.
- Prévoir un système de migrations de schéma (fichiers SQL numérotés,
  exécutés au démarrage) — le schéma va bouger plusieurs fois (catégories,
  templates), autant s'équiper maintenant.
- Les 87 tests qui touchent la base devront tourner contre une vraie
  instance Postgres (locale ou éphémère en CI) plutôt que le fichier SQLite
  actuel.

### 2.3 Schéma — esquisse SQL

```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom TEXT NOT NULL,
  description TEXT,
  auteur_id UUID REFERENCES comptes(id),
  visibilite TEXT NOT NULL DEFAULT 'prive'
    CHECK (visibilite IN ('prive','public','masque')),
  definition JSONB NOT NULL,
  cree_le TIMESTAMPTZ DEFAULT now(),
  maj_le TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compte_id UUID NOT NULL REFERENCES comptes(id),
  label TEXT NOT NULL,
  description TEXT,
  couleur TEXT,
  type TEXT NOT NULL DEFAULT 'normale'
    CHECK (type IN ('normale','fonds','verrouillee')),
  calcul JSONB,
  sous_fonds BOOLEAN NOT NULL DEFAULT false,
  ordre INTEGER NOT NULL DEFAULT 0,
  archivee BOOLEAN NOT NULL DEFAULT false
);
```

### 2.4 Déploiement Fly.io avec Postgres

```bash
fly postgres create --name plan-financier-db
fly postgres attach plan-financier-db
```

Remplace la logique `fly volumes create` actuelle. Les sauvegardes suivent le
mécanisme propre à Fly Postgres (à documenter au moment de le faire) — la
commande `fly ssh console -C "cat ..."` du README actuel ne s'applique plus
telle quelle.

### 2.5 Ce que ça débloque

La limite « une seule machine » du README actuel disparaît : plusieurs
machines peuvent se connecter à la même base Postgres en même temps.
`fly scale count 2` redevient une option sûre le jour où le trafic le
justifie — pas urgent maintenant, mais ça retire un plafond.

---

## 3. Préparer (sans la construire) le terrain pour l'appli mobile

Rien à changer dans l'immédiat sur ce projet précis, mais trois principes à
préserver pour ne pas avoir à tout redéfaire plus tard :

- **L'API reste la seule porte d'entrée aux données.** Le jeton `Bearer`
  déjà prévu (`/api/connexion`, `/api/inscription`) doit rester la voie
  d'accès unique — aucune logique métier ne doit vivre uniquement côté
  client web, sinon la future appli mobile ne pourra pas la réutiliser telle
  quelle.
- **`shared/` reste la source de vérité des calculs**, indépendante de toute
  présentation. Une fois les catégories sorties du code en dur (§1), ce
  dossier redevient exactement ce qu'il doit être : la logique portable vers
  une future appli native, sans dupliquer les règles.
- **Ne pas sur-investir dans l'UI web actuelle.** Le jour où l'appli mobile
  existera, le site web bascule de « application complète » à « page de
  renvoi » (badges App Store/Play Store, lien profond vers l'app). Pas un
  chantier à ouvrir maintenant — juste une raison de garder l'interface web
  simple plutôt que d'y investir un temps qui sera en partie jeté.

---

## Ordre de chantier suggéré

1. Généraliser le mécanisme « verrouillée » (la dîme devient un cas
   particulier de configuration, pas une règle système) — §1.3
2. Sortir les catégories de `shared/categories.js` vers un modèle en base,
   par compte, avec les comportements génériques du §1.4
3. Concevoir le schéma catégories/templates **directement pour Postgres**
   (§2.3) plutôt que pour SQLite d'abord
4. Écrire le script de migration : tes données actuelles → tes catégories
   personnelles + ton premier template (§1.8)
5. Construire le système de templates (publication, catalogue, adoption) —
   §1.6
6. Basculer `server/db.js` vers Postgres, migrer les 87 tests
7. Déployer sur Fly.io avec Postgres attaché (§2.4)
8. *(Hors périmètre immédiat)* démarrer l'appli mobile / page de renvoi

---

## Points encore à trancher (pas de réponse toute faite ici)

- **Un template republié propose-t-il une mise à jour** à ceux qui l'ont
  déjà adopté, ou reste-t-il figé (simple snapshot, sans lien après coup) ?
  Les deux sont défendables — la deuxième option est plus simple à
  construire et plus prévisible pour l'utilisateur qui a adopté un template.
- **« Zéro dépendance »** : principe qu'on garde pour tout sauf la base de
  données, ou qu'on abandonne franchement une fois `pg` introduit ?
- **Modération des templates publics** : le rôle admin existant suffit-il
  (masquer après coup, sur signalement), ou faut-il un statut « en attente
  de review » avant toute publication publique ? Le premier est plus simple
  et cohérent avec le reste de l'app (l'admin agit déjà après coup, jamais en
  amont) — mais à confirmer selon le volume de comptes attendu.
