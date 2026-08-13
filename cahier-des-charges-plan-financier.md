# Cahier des charges — Application « Plan Financier Personnel »

## 1. Contexte

Utilisatrice basée à **Dakar, Sénégal**. Revenu actuel : **400 000 FCFA net/mois** (à traiter comme une valeur par défaut modifiable, pas une constante codée en dur — le revenu peut varier d'un mois à l'autre).

Objectif produit : remplacer un budget « je dépense puis je vois ce qu'il reste » par une architecture financière pilotée — prévu vs réel par catégorie, fonds séparés suivis dans la durée, tableau de bord, vue annuelle sur 12 mois.

Devise par défaut : **FCFA (XOF)**, mais le champ doit rester modifiable (EUR, USD… au cas où).

---

## 2. Règle non négociable : la dîme

La catégorie **Dîme** est prioritaire sur toute autre répartition :

- **Montant prévu = 10 % du revenu du mois, calculé automatiquement.**
- Ce champ ne doit **pas** être modifiable manuellement dans l'interface (pas d'input libre) — seule la case *Réel* (les versements effectivement faits) est éditable, exactement comme les autres catégories. Le *Prévu* se recalcule tout seul si le revenu du mois change.
- Base de calcul quand le revenu a plusieurs sources (voir §10) : par défaut, 10 % du **revenu total du mois** (toutes sources confondues). Prévoir un réglage `regleDime` (`"total"` ou `"salaire_seul"`) pour que l'utilisatrice puisse choisir si la dîme porte sur l'ensemble de ses revenus ou seulement sur le salaire — c'est une décision de valeurs, pas un choix technique.
- Visuellement, cette catégorie doit être distincte des autres (badge « non négociable » ou équivalent), et apparaître en premier dans toutes les listes/tableaux.

---

## 3. Catégories budgétaires

11 catégories, chacune suivie en **Prévu / Réel / Écart / % consommé / Statut** :

| id | Nom affiché | Contenu | Prévu éditable ? |
|---|---|---|---|
| `dime` | Dîme | Dîme, offrandes | Non (auto = 10% du revenu) |
| `essentielles` | Dépenses essentielles | Logement, charges, alimentation, transport, télécom, santé courante — l'utilisatrice ajoute ses propres lignes libres à l'intérieur (ex: « Loyer », « Alimentation », « Transport ») | Oui |
| `famille_aide` | Aide familiale | Argent envoyé aux parents | Oui |
| `famille_etudes` | Fonds études des frères | Épargne dédiée, **distincte** de l'épargne personnelle | Oui |
| `epargne` | Épargne (urgence + rémunérée) | Alimente le fonds d'urgence | Oui |
| `investissement` | Investissements | BRVM (actions/obligations), autres placements | Oui |
| `business` | Business Fund | Capital dédié aux futurs projets entrepreneuriaux, distinct de l'investissement financier | Oui |
| `devperso` | Développement personnel | Beauté/entretien, style, sport, apprentissage/formations | Oui |
| `loisirs` | Loisirs | Sorties, restaurants, découvertes, voyages | Oui |
| `projets` | Fonds projets / achats | Sinking funds pour achats importants (voir §5) | Oui |
| `imprevus` | Imprévus | Marge de sécurité du mois | Oui |

**Statut** calculé ainsi :
- `prevu === 0 && reel === 0` → neutre (« — »)
- `prevu === 0 && reel > 0` → dépassé
- `reel / prevu > 1` → dépassé
- `reel / prevu >= 0.9` → attention
- sinon → ok

---

## 4. Scénarios préconfigurés (appliquent le champ *Prévu* de chaque catégorie)

Tous les montants ci-dessous supposent un revenu de 400 000 FCFA (le Prévu de `dime` reste toujours 10 % du revenu réel du mois, indépendamment du scénario).

**Scénario A — Équilibré (recommandé pour démarrer)**
| Catégorie | Montant |
|---|---|
| Dîme | 40 000 |
| Essentielles | 200 000 |
| Famille — aide | 60 000 |
| Famille — études frères | 40 000 |
| Épargne | 15 000 |
| Investissement | 10 000 |
| Business Fund | 5 000 |
| Développement personnel | 10 000 |
| Loisirs | 10 000 |
| Fonds projets | 5 000 |
| Imprévus | 5 000 |

**Scénario B — Orienté investissement & patrimoine**
| Catégorie | Montant |
|---|---|
| Dîme | 40 000 |
| Essentielles | 200 000 |
| Famille — aide | 60 000 |
| Famille — études frères | 40 000 |
| Épargne | 10 000 |
| Investissement | 20 000 |
| Business Fund | 15 000 |
| Développement personnel | 5 000 |
| Loisirs | 5 000 |
| Fonds projets | 0 |
| Imprévus | 5 000 |

**Scénario C — Orienté développement personnel & carrière**
| Catégorie | Montant |
|---|---|
| Dîme | 40 000 |
| Essentielles | 200 000 |
| Famille — aide | 60 000 |
| Famille — études frères | 40 000 |
| Épargne | 10 000 |
| Investissement | 5 000 |
| Business Fund | 5 000 |
| Développement personnel | 25 000 |
| Loisirs | 10 000 |
| Fonds projets | 0 |
| Imprévus | 5 000 |

Chaque scénario doit sommer exactement au revenu du mois concerné (les montants ci-dessus sont calibrés pour 400 000 — si l'utilisatrice change son revenu, prévoir soit un recalcul proportionnel, soit un simple avertissement que le total ne correspond plus à 100 % du revenu).

**Comportement attendu** : un sélecteur de scénario (A/B/C) avec un bouton « Appliquer » qui écrase le champ *Prévu* de chaque catégorie pour le mois affiché (et idéalement une option « appliquer à toute l'année »). Le *Réel* n'est jamais touché par l'application d'un scénario.

---

## 5. Fonds à suivre en cumulé (au-delà du mois courant)

Ces montants ne se lisent pas sur un seul mois : ce sont des **cumuls glissants**, calculés en additionnant tous les *Réel* enregistrés dans la catégorie correspondante, sur tous les mois et toutes les années présents dans les données.

| Fonds | Alimenté par | Cible | Notes |
|---|---|---|---|
| Fonds d'urgence + épargne rémunérée | Cumul de `epargne` (tous mois confondus) | X mois de (Essentielles + Famille-aide) du mois courant, X réglable (3/6/9/12) | Objectif réaliste : construction sur plusieurs années, pas sur 12 mois |
| Fonds études des frères | Cumul de `famille_etudes` | Objectif annuel éditable (proposer 480 000 FCFA par défaut = 40 000 × 12) | À garder visuellement séparé de l'épargne perso |
| Business Fund | Cumul de `business` | Optionnelle, pas de valeur par défaut | Juste afficher le capital cumulé si aucune cible définie |
| Portefeuille investissement | Cumul de `investissement` | Pas de cible | Préciser dans l'UI que c'est le **capital versé**, pas la valeur de marché (l'app ne suit pas la performance boursière) |
| Fonds projets / achats (sinking funds) | Cumul de `projets`, **ventilé par sous-fonds** (voir ci-dessous) | Une cible par sous-fonds | Liste éditable par l'utilisatrice |

### Sinking funds — pré-remplissage suggéré

Chaque entrée de la catégorie `projets` doit pouvoir être rattachée à un sous-fonds nommé (liste éditable : ajout, suppression, renommage, changement de cible). Pré-remplir avec ces 4 projets et cibles (prix constatés à Dakar, à ajuster si les prix changent) :

| Sous-fonds | Cible suggérée (FCFA) | Priorité suggérée |
|---|---|---|
| iPhone (format compact) | 400 000 | 1 — le plus réaliste à court/moyen terme |
| iPad | 400 000 | 2 |
| MacBook Air | 650 000 | 3 — envisager plutôt via une rentrée d'argent ponctuelle (prime, mission) que via le budget mensuel seul |
| Samsung Galaxy Z Flip | 800 000 | 4 — le plus cher, à repousser le plus loin ; c'est un achat plaisir plus qu'un outil |

L'interface doit permettre d'ajouter d'autres sous-fonds librement (nom + cible), pas seulement ces 4.

---

## 6. Écrans / vues

**1. Tableau de bord**
- KPIs sur l'année en cours : Revenus, Dépenses réelles totales, Solde net, Taux d'épargne effectif (= (Réel épargne + Réel investissement + Réel business) / Revenus — la dîme n'entre pas dans ce calcul), **Taux de dépendance au salaire** (= revenus de type `stable` / revenus totaux — voir §10 ; un indicateur qu'on veut voir baisser dans le temps)
- Graphique : Revenus vs Dépenses par mois (12 barres) + solde cumulé en ligne
- Répartition des dépenses réelles par catégorie (camembert ou barres), avec sélecteur de période (année entière ou mois précis)
- Résumé compact de la progression des fonds (barres de progression : urgence, études frères, business, investissement, + 1-2 sinking funds prioritaires)

**2. Budget mensuel**
- Sélecteur de mois (12 onglets, année en cours)
- **Revenus du mois** : liste de sources (voir §10), pas un champ unique — ajout/suppression d'une source avec libellé, montant et type (stable/variable). Le total du mois est la somme, affiché en tête.
- Sélecteur + bouton d'application de scénario (§4) — s'applique sur la base du revenu total du mois
- Liste des 11 catégories, chacune avec Prévu / Réel / Écart / % / Statut, dépliable pour voir/ajouter/supprimer les écritures individuelles (libellé + montant ; pour `projets`, ajouter un sélecteur de sous-fonds)

**3. Fonds & Projets**
- Détail de chaque fonds du §5 avec barre de progression cumulé/cible
- Réglage de la cible du fonds d'urgence (multiplicateur de mois) et du fonds études des frères (montant annuel)
- Gestion des sinking funds : ajout, édition (nom/cible), suppression

**4. Grand livre annuel**
- Table récapitulative des 12 mois : Revenu, Dépenses réelles, Solde, Taux d'épargne effectif
- Clic sur une ligne → ouvre ce mois dans la vue Budget mensuel

---

## 7. Modèle de données (proposition)

```json
{
  "currency": "XOF",
  "currentYear": 2026,
  "revenuMensuelDefaut": 400000,
  "scenarioActif": "A",
  "regleDime": "total",
  "regleSurplus": {
    "investissement": 50,
    "epargne": 20,
    "devperso_loisirs": 15,
    "projets": 15
  },
  "fondsCibles": {
    "urgenceMois": 3,
    "etudesAnnuel": 480000
  },
  "sinkingFunds": [
    { "id": "iphone", "nom": "iPhone (format compact)", "cible": 400000, "priorite": 1 },
    { "id": "ipad", "nom": "iPad", "cible": 400000, "priorite": 2 },
    { "id": "macbook", "nom": "MacBook Air", "cible": 650000, "priorite": 3 },
    { "id": "zflip", "nom": "Samsung Galaxy Z Flip", "cible": 800000, "priorite": 4 }
  ],
  "years": {
    "2026": {
      "months": {
        "0": {
          "revenus": [
            { "id": "r1", "source": "Salaire", "montant": 400000, "type": "stable" },
            { "id": "r2", "source": "Mission freelance BI", "montant": 150000, "type": "variable" }
          ],
          "categories": {
            "dime": { "entries": [ { "id": "e1", "label": "Dîme janvier", "montant": 40000 } ] },
            "essentielles": { "prevu": 200000, "entries": [ { "id": "e2", "label": "Loyer", "montant": 80000 } ] },
            "famille_aide": { "prevu": 60000, "entries": [] },
            "famille_etudes": { "prevu": 40000, "entries": [] },
            "epargne": { "prevu": 15000, "entries": [] },
            "investissement": { "prevu": 10000, "entries": [] },
            "business": { "prevu": 5000, "entries": [] },
            "devperso": { "prevu": 10000, "entries": [] },
            "loisirs": { "prevu": 10000, "entries": [] },
            "projets": { "prevu": 5000, "entries": [ { "id": "e3", "label": "Versement", "montant": 5000, "sinkingFundId": "iphone" } ] },
            "imprevus": { "prevu": 5000, "entries": [] }
          }
        }
      }
    }
  }
}
```

Note : `dime` n'a pas de champ `prevu` stocké — il est **dérivé** à l'affichage (`revenu × 0.10`), jamais lu depuis les données.

---

## 8. Persistance

Recommandation : stockage local simple (fichier JSON local, ou `localStorage` si application web mono-utilisateur dans le navigateur, ou base SQLite si Claude Code part sur une petite appli avec backend). Le choix technique exact est laissé à l'implémentation — l'important est que **rien ne se perde entre deux sessions** et qu'un export/sauvegarde soit possible (au minimum un export JSON téléchargeable, idéal pour faire une sauvegarde manuelle).

---

## 9. Repères de coûts Dakar utilisés comme valeurs par défaut (2026)

- Logement (chambre/studio meublé, quartier accessible) : ~80 000 FCFA/mois
- Charges (eau/électricité) : ~15 000 FCFA/mois
- Alimentation : ~55 000 FCFA/mois
- Transport (abonnement bus/BRT + appoint VTC) : ~30 000 FCFA/mois
- Télécom (forfait + internet mobile) : ~12 000 FCFA/mois
- Santé courante : ~8 000 FCFA/mois
- Livret d'épargne bancaire réglementé : 3,5 % à 4,5 %/an
- BRVM : accès via une SGI agréée (pièce d'identité + justificatif de domicile + dépôt initial variable), rendement actions historique 8-10 %/an mais volatil

Ces chiffres sont des hypothèses de travail, pas des contraintes — l'application doit permettre de tout modifier facilement (l'utilisatrice connaît mieux que quiconque son loyer réel, son opérateur, etc.).

---

## 10. Revenus multiples & évolution du budget

L'utilisatrice ne veut pas dépendre uniquement de son salaire (objectif explicite : salaire → épargne → investissement → capital → business → plusieurs sources de revenus → patrimoine). L'application doit donc traiter le revenu comme **une liste de sources**, pas un montant unique, et appliquer des règles différentes selon deux situations : une augmentation du revenu stable, et l'apparition de revenus variables.

### 10.1 Modèle de revenu

Chaque mois contient un tableau `revenus` (voir §7), chaque entrée ayant :
- `source` (libellé libre : « Salaire », « Mission freelance X », « Dividendes »…)
- `montant`
- `type` : `"stable"` (récurrent, prévisible — salaire) ou `"variable"` (ponctuel, imprévisible — freelance, business, dividendes)

Le revenu total du mois = somme de toutes les entrées. C'est cette somme qui sert de base au calcul de la dîme (sauf si `regleDime = "salaire_seul"`, auquel cas seule la somme des entrées `type: "stable"` compte).

### 10.2 Règle à l'augmentation du salaire (revenu stable qui augmente)

Ne jamais faire évoluer le budget socle (essentielles, famille, dîme) proportionnellement au salaire — risque d'inflation du style de vie. À la place :

1. Le **socle** (essentielles + famille + dîme) reste stable, sauf changement réel de situation (déménagement, famille qui s'agrandit) décidé consciemment par l'utilisatrice, jamais automatiquement.
2. Le **delta** (nouveau salaire − ancien salaire) suit une règle d'affectation dédiée, stockée dans `regleSurplus` (§7), par défaut :
   - 50 % → Investissement + Business Fund
   - 20 % → Épargne
   - 15 % → Développement personnel + Loisirs
   - 15 % → Fonds projets
3. L'aide familiale (minimum 100 000 FCFA) est un choix distinct : l'app doit permettre de la marquer comme « plancher fixe » ou « pourcentage du revenu », au choix de l'utilisatrice — ne pas décider à sa place.

**Fonctionnalité suggérée** : quand l'utilisatrice modifie le montant d'une source `stable` d'un mois sur l'autre, proposer (pas forcer) d'appliquer automatiquement `regleSurplus` sur la différence pour pré-remplir les nouveaux `prevu`.

### 10.3 Règle à la diversification des revenus (apparition de sources variables)

Principe : le socle ne repose **jamais** sur un revenu `variable`. Concrètement :

- Le *Prévu* des catégories `essentielles`, `famille_aide`, `famille_etudes` et `dime` (base salaire seul si `regleDime = "salaire_seul"`) doit rester calculable à partir des seules entrées `type: "stable"` du mois — l'app ne doit pas laisser l'utilisatrice se reposer sur un revenu freelance pour couvrir son loyer.
- Un revenu `variable` encaissé dans le mois est, par défaut, entièrement dirigé vers `investissement`, `business` et `projets` (pas de règle de répartition figée ici — laisser l'utilisatrice décider au cas par cas via ses écritures, mais l'UI peut suggérer ce comportement lors de l'ajout d'une entrée de revenu variable).

### 10.4 KPI à ajouter au tableau de bord

**Taux de dépendance au salaire** = (somme des revenus `type: "stable"`) / (revenu total), sur le mois ou sur l'année. C'est la mesure directe de la progression vers l'objectif « ne pas dépendre uniquement du salaire ». Afficher son évolution mois par mois (ex : petit graphique en ligne) est plus parlant qu'un chiffre isolé.

---

## 11. Direction visuelle (suggestion, non contraignante)

Univers du **grand livre comptable / carnet de comptes** : papier ligné, colonnes alignées, chiffres en police à chasse fixe (type IBM Plex Mono) pour un rendu tabulaire propre, une police display avec du caractère pour les titres (type Fraunces), palette sobre dérivée du papier comptable (vert pâle, encre, laiton pour les revenus, brique pour les dépenses, sauge pour l'épargne). Libre à Claude Code de proposer sa propre direction si une autre approche sert mieux le produit.
