# Budget Foyer

Application de budget partagé pour un couple — PWA installable sur Android,
synchronisée en temps réel via Supabase.

## 1. Ce qui est réellement construit dans cette première passe

| Élément | Statut |
|---|---|
| Schéma de base de données complet + Row Level Security | ✅ `supabase/schema.sql` |
| Moteur de calcul budgétaire (le cœur du produit, §6/§9/§24/§25) | ✅ `src/lib/budget-engine.js` + tests |
| Squelette PWA (Vite, Tailwind, manifest, service worker) | ✅ |
| **Authentification** (inscription avec prénom, connexion, déconnexion) | ✅ `src/pages/Auth.jsx`, `src/lib/auth.js` |
| **Création de foyer + invitation par code/lien** | ✅ `src/pages/HouseholdSetup.jsx`, `src/lib/household.js` |
| **Scan de ticket** (OCR + confirmation obligatoire avant sauvegarde) | ✅ `src/pages/ScanReceipt.jsx`, `src/lib/ocr.js` |
| Écran **Accueil** (reste à dépenser, objectifs, détail du budget) | ✅ `src/pages/Dashboard.jsx` |
| Écran **Ajouter une dépense** (scan ou saisie manuelle) | ✅ `src/pages/AddExpense.jsx` |
| Écran **Épargne** (poches, soldes, suppression avec confirmation) | ✅ `src/pages/Epargne.jsx` |
| **Préparer mon mois** (revenus, charges, épargne, marge, calcul immédiat) | ✅ `src/pages/PrepareMonth.jsx`, `src/lib/month-prep.js` |
| **Gestion des charges** (CRUD indépendant, portée ce mois/prochains mois) | ✅ `src/pages/Charges.jsx`, `src/lib/charges.js` |
| **Notre foyer** (vue combinée des deux membres) | ✅ `src/pages/Foyer.jsx` |
| **Bannière "Préparer [mois suivant]"** (derniers jours du mois) | ✅ `src/pages/Dashboard.jsx`, `src/lib/date-utils.js` |
| Écran **Mon espace** (envies d'achat privées + délai de réflexion) | ✅ `src/pages/MonEspace.jsx` |
| Notifications | ⬜ non commencé |

L'app n'a plus de "mode démonstration" : elle attend désormais une vraie
session (voir §5 pour connecter Supabase). C'était le bon compromis pour
que vous puissiez réellement tester à deux, comme demandé.

## 2. Pourquoi cette architecture

- **PWA (Vite + React + Tailwind), pas d'app native** : un seul code pour
  Android et navigateur, installation via le bouton "Ajouter à l'écran
  d'accueil", pas de compte développeur Google Play nécessaire pour
  commencer. `vite-plugin-pwa` génère le service worker et le manifest.
- **Supabase plutôt qu'un backend maison** : Auth + PostgreSQL + Row Level
  Security + Realtime + Storage couvrent exactement les besoins (§17, §19)
  avec un plan gratuit largement suffisant pour deux utilisateurs, et la
  RLS permet d'appliquer la confidentialité des envies d'achat **au niveau
  base de données**, comme exigé au §15 — pas seulement dans l'interface.
- **Moteur de calcul séparé de l'UI** (`budget-engine.js`) : ce sont des
  fonctions pures, sans réseau. Elles sont testées unitairement
  (`budget-engine.test.js`) pour garantir qu'aucune régression ne
  réintroduit un double comptage (§25) — le risque le plus critique d'une
  app d'argent en couple.

## 3. Modèle de données — logique clé

Le schéma (`supabase/schema.sql`) distingue systématiquement :

- **`planned_amount`** (l'objectif du mois, ce qui est *réservé* dès le
  1er du mois) et **`actual_paid_in`** (ce qui a *réellement* été versé) —
  table `savings_goals`. Le budget disponible se calcule toujours sur
  `planned_amount`, jamais sur `actual_paid_in` (règle §3).
- **`expenses.source_type`** (`perso` / `compte_joint` / `pocket`) : seule
  une dépense `perso` diminue le budget personnel de celui qui paie ; les
  deux autres diminuent le solde de la poche concernée (règle §9).
- **`pocket_transfers`**, table séparée de `expenses` : un virement réel
  vers une poche n'est PAS une dépense et ne doit jamais re-diminuer le
  budget disponible, qui l'a déjà réservé via `planned_amount` (règle §25,
  "éviter le double comptage").
- **`wishlist_items`** : la seule table dont la policy RLS ne référence
  jamais `household_id`, seulement `owner_id = auth.uid()`. C'est
  intentionnel — c'est la garantie technique, pas seulement visuelle, de
  la confidentialité exigée au §15.

## 4. Calcul du budget disponible (le cœur du produit)

```
Revenus du mois
– épargne prévue (planned_amount de chaque objectif)
– charges fixes prévues
– marge de sécurité
= Budget initial du mois

Budget initial
– dépenses réellement payées depuis un compte PERSO
= RESTE À DÉPENSER
```

Voir `computeMonthlyBudget()` dans `src/lib/budget-engine.js`, entièrement
testée contre l'exemple chiffré de votre cahier des charges (700 € puis
565 €).

## 5. Démarrer en local

```bash
npm install
cp .env.example .env          # renseigner l'URL et la clé anon de votre projet Supabase
# Dans le SQL editor de Supabase, exécuter supabase/schema.sql
npm run test                  # vérifie le moteur de calcul
npm run dev                   # lance l'app sur http://localhost:5173
```

Pour installer la PWA sur Android : ouvrir l'URL déployée dans Chrome,
menu → "Ajouter à l'écran d'accueil".

## 6. Comment fonctionne "Préparer mon mois"

- **Un seul écran, deux usages** : au tout premier lancement, il prépare
  le mois en cours (aucun mois n'existe encore) ; plus tard, il peut aussi
  préparer un mois futur via `?month=2026-10-01` dans l'URL — c'est cette
  même route que branchera la bannière automatique "Préparer octobre" à
  l'approche du changement de mois (non encore construite, voir §7).
- **Pré-remplissage intelligent** : revenus et objectifs d'épargne
  reprennent les valeurs du mois précédent de CET utilisateur ; les
  charges reprennent uniquement celles marquées *récurrentes* (une charge
  ponctuelle du mois dernier n'est jamais resuggérée). Tout reste
  modifiable avant de valider.
- **Calcul immédiat** : le bandeau du haut recalcule le budget disponible
  à chaque frappe, avant même d'enregistrer quoi que ce soit, via
  `computeMonthlyBudget()` — exactement la même fonction que le Dashboard.
- **Ré-édition sans risque pour les dépenses** : "Enregistrer les
  modifications" remplace entièrement les revenus/charges/objectifs de CE
  mois, mais ne touche jamais à la table `expenses`, qui n'a aucune
  référence vers eux — techniquement garanti, pas seulement par
  convention (voir le commentaire en tête de `src/lib/month-prep.js`).
- **Poches créées à la volée** : si le foyer n'a encore aucune poche
  d'épargne (premier lancement), un petit formulaire permet d'en créer
  directement depuis cet écran plutôt que d'obliger un détour par Épargne.

## 7. Comment fonctionne la gestion des charges

- La charge (`fixed_charges`) est désormais un objet autonome : on la
  crée, modifie, désactive ou supprime depuis l'écran **Charges**, sans
  jamais passer par "Préparer mon mois" — cet écran continue seulement à
  la suggérer comme gabarit les mois où elle n'a pas encore d'entrée.
- **Modifier une charge récurrente existante** déclenche systématiquement
  le choix "Modifier uniquement ce mois" / "Modifier également les
  prochains mois" :
  - *Ce mois uniquement* ne touche que l'entrée du mois en cours
    (`fixed_charge_entries`) — le gabarit, et donc les mois futurs déjà
    programmés, restent inchangés.
  - *Aussi les prochains mois* modifie le gabarit lui-même ET l'entrée du
    mois en cours, pour que le changement soit immédiatement visible.
  - Dans les deux cas, les mois **passés** ne sont jamais réécrits : leurs
    entrées gardent leurs montants d'origine (contrainte `ON DELETE SET
    NULL` sur `fixed_charge_entries.fixed_charge_id`, même si le gabarit
    est supprimé plus tard).
- **Activer/désactiver** une charge l'ajoute ou la retire immédiatement du
  mois en cours, sans jamais supprimer une dépense déjà enregistrée (la
  table `expenses` n'est jamais touchée par cet écran).
- **Charge commune** : les deux membres peuvent la créer, modifier,
  désactiver ou supprimer à égalité. Une modification du gabarit est
  journalisée automatiquement (déclencheur SQL déjà en place) ; une
  modification "ce mois uniquement" — qui ne touche pas le gabarit — est
  journalisée explicitement par le code (`logSharedChargeAction()`) pour
  que l'historique du foyer reste complet dans les deux cas.
- **Charge personnelle** : modifiable/supprimable uniquement par son
  propriétaire (RLS), jamais journalisée dans l'historique commun.

## 8. Règle validée sur l'édition des éléments communs

- Poches et charges **communes** : modifiables/supprimables par les deux
  membres à égalité, sans validation croisée.
- Éléments **personnels** (poche `is_private`, charge `is_shared = false`) :
  modifiables uniquement par leur propriétaire — appliqué en RLS, pas
  seulement dans l'UI.
- Chaque création/modification/suppression d'un élément **commun** est
  journalisée automatiquement en base (déclencheur SQL, table
  `household_activity_log`, visible sur l'écran Foyer) avec l'auteur et
  l'horodatage.
- Une suppression demande uniquement la confirmation de la personne qui
  agit (`window.confirm` dans `Epargne.jsx`), jamais l'accord du conjoint.
- Les envies d'achat restent intégralement hors de cet historique, quel
  que soit le membre (règle §15, inchangée).

## 9. Audit de sécurité et corrections avant test réel

Passage de contrôle RLS effectué avant votre premier test à deux. Deux
failles réelles trouvées et corrigées (voir le détail en commentaire dans
`schema.sql`, section "MIGRATION SÉCURITÉ") :

- **Codes d'invitation listables par n'importe qui** : la policy de
  lecture de `household_invites` laissait passer, sans le vouloir, tous
  les codes non utilisés de tous les foyers, pas seulement du vôtre.
  Corrigé : seule la fonction `accept_household_invite()` (qui contourne
  les policies) peut désormais lire un code pour rejoindre un foyer ; la
  lecture directe de la table est limitée à son propre foyer.
- **`household_id` modifiable directement** : un utilisateur aurait pu, en
  théorie, changer son propre `household_id` par un simple appel réseau
  vers n'importe quel foyer existant, sans jamais passer par un code
  d'invitation. Corrigé par un déclencheur qui bloque toute modification
  de ce champ hors des fonctions `create_household()` et
  `accept_household_invite()`.

Vérifié et confirmé sain, sans modification nécessaire :
- Les **envies d'achat** (`wishlist_items`) sont filtrées uniquement par
  `owner_id = auth.uid()`, sans aucune branche "foyer" dans la policy —
  invisibles pour le conjoint par construction, quelle que soit la requête
  envoyée.
- Toutes les autres tables (dépenses, charges, poches, revenus, mois
  budgétaires...) sont systématiquement filtrées par
  `household_id = my_household_id()` : aucune donnée d'un autre foyer
  n'est accessible.

**Limitation connue, mineure** : au sein d'un même foyer, les policies
d'écriture sur les revenus et les mois budgétaires ne vérifient pas
encore que seul le propriétaire du mois peut le modifier (un conjoint
pourrait techniquement modifier les revenus saisis par l'autre). Comme il
s'agit d'un couple de confiance et non d'un risque inter-foyer, ce n'est
pas bloquant pour votre test — dites-moi si vous voulez que je verrouille
aussi ce point.

## 10. Trois bugs corrigés pendant la relecture du parcours de test

- **Prénom perdu si Supabase demande une confirmation par e-mail** :
  entre l'inscription et le clic sur le lien reçu par mail, le prénom
  saisi n'était nulle part conservé. Il est maintenant mis de côté
  temporairement et repris automatiquement dès que la session apparaît.
  Pour éviter cette étape supplémentaire pendant votre test, le guide
  ci-dessous vous fait désactiver la confirmation par e-mail (§11).
- **Bouton "+ Ajouter une poche" sans effet dans Épargne** : il n'avait
  pas de gestionnaire de clic. Corrigé — l'écran Épargne permet
  maintenant réellement de créer une poche commune ou personnelle.
- **Aucune façon d'enregistrer un versement réel** : le champ "réellement
  versé" existait en base et dans les calculs, mais rien dans
  l'interface ne permettait de l'alimenter. Ajouté : un bouton "+ Verser"
  sur chaque poche dans l'écran Épargne (`src/lib/transfers.js`), qui met
  à jour le solde de la poche et la barre de progression, sans jamais
  toucher au budget disponible du mois (déjà réservé via l'objectif
  prévu — voir §4).

## 11. Comment fonctionne l'achat en plusieurs fois

- Depuis **Ajouter une dépense → 🔁 Plusieurs fois** : montant total OU
  mensuel (l'autre est calculé automatiquement), nombre de mensualités,
  date de la première échéance (modifiable pour un premier prélèvement
  différé), catégorie, personnel ou commun (compte joint).
- Chaque mensualité est créée d'avance comme une vraie dépense, datée dans
  le bon mois futur — le budget de ce mois-là la prendra en compte
  automatiquement dès qu'il sera préparé, sans que vous ayez à y repenser.
- Une mensualité dont le mois est **déjà passé ou en cours** est considérée
  "verrouillée" et n'est plus jamais modifiée automatiquement — seules les
  mensualités **futures** peuvent être révisées, soldées en une fois
  (`settleRemainingNow`), ou annulées (`cancelRemainingInstallments`),
  exactement comme demandé.
- Le dernier versement absorbe l'écart d'arrondi (ex. 100 € / 3 mois =
  33,33 + 33,33 + 33,34), pour ne jamais perdre un centime.

## 12. Objectifs d'épargne chiffrés (comptes)

- À la création d'une poche (Épargne ou Préparer mon mois), vous pouvez
  désormais renseigner un **objectif chiffré** et une **date cible**
  optionnels (ex. "Croisière", 2000 €, février). Le champ existait déjà
  en base (`target_amount`, `target_date`) mais aucun formulaire ne le
  proposait — corrigé.
- La progression s'affiche à deux endroits : sur **Épargne** (par poche)
  et sur l'**Accueil**, dans une nouvelle carte "Objectifs d'épargne"
  distincte de "Objectifs du mois" — celle-ci suit le solde réel de la
  poche par rapport à l'objectif total, pas le versement prévu du mois en
  cours.
- Verser de l'argent dans la poche (bouton "+ Verser") fait avancer cette
  progression automatiquement, sans jamais toucher au budget disponible
  (même règle qu'ailleurs : l'argent est déjà réservé dès qu'il est
  prévu, pas quand il est physiquement versé).

## 13. Comptes : dépense vs épargne (refonte du concept "poche")

Suite à un vrai besoin identifié en testant ("je veux voir combien il me
reste sur mon compte BRED, sur mon Livret A...") : ce qui s'appelait
"poche" est renommé **compte** partout dans l'interface, et chaque compte
a désormais un **usage** choisi à la création :

- **Dépense** (ex. carte BRED, La Poste, espèces) : aucune réservation
  préalable — le dépenser réduit **directement** le reste à dépenser du
  mois, exactement comme "Mon compte perso". Une enveloppe mensuelle
  optionnelle sert uniquement de repère visuel propre à ce compte, sans
  rien réserver en plus.
- **Épargne** (dont le compte joint, désormais unifié dans ce même
  système plutôt qu'un cas à part) : de l'argent mis de côté via un
  objectif/versement prévu chaque mois — le dépenser ne re-diminue
  **jamais** le reste à dépenser, déjà réservé en amont. C'est exactement
  le comportement historique du compte joint, conservé à l'identique.

Ce qui en découle concrètement :
- **`AddExpense.jsx` et `ScanReceipt.jsx` proposent enfin un vrai
  sélecteur de compte** — ce menu n'existait pas avant (trou identifié en
  testant : choisir "poche" ne demandait jamais laquelle), donc dépenser
  depuis un compte particulier ne faisait déjà baisser aucun solde.
  Corrigé : chaque dépense peut être imputée à n'importe quel compte, quel
  que soit son usage — y compris piocher dans un compte épargne, qui
  réduit alors son solde sans toucher au reste à dépenser (cohérent avec
  la règle ci-dessus).
- **`computeMonthlyBudget()`** distingue maintenant les dépenses par le
  type du compte source (`pocketUsageType`), pas seulement par
  `sourceType` — voir les nouveaux tests dans `budget-engine.test.js`.
- **`PrepareMonth.jsx`** n'affiche les comptes de type "épargne" dans "Ce
  que je prévois de mettre de côté" — un compte "dépense" n'a pas de
  réservation mensuelle à définir.
- **Épargne.jsx** est divisé en deux sections : "Comptes de dépense" et
  "Notre épargne". **Dashboard.jsx** affiche désormais une carte "Nos
  comptes" avec le solde de chaque compte de dépense.
- Les noms de compte restent **toujours saisis librement** par chaque
  utilisateur — rien n'est suggéré ni codé en dur.

## 14. Compte de prélèvement sur les charges fixes

- Chaque charge peut désormais avoir un **compte de prélèvement**
  optionnel (`Charges.jsx`). Comme pour l'épargne, on distingue **prévu**
  (la charge, déjà réservée dans le budget dès sa création — inchangé) et
  **réellement payé** (case "Payée ce mois-ci") : cocher cette case
  décompte alors le solde réel du compte associé, sans jamais retoucher
  au budget disponible (déjà réservé en amont — pas de double-comptage).
  Décocher annule exactement le même montant en sens inverse.
- Le compte choisi sur le gabarit se propage automatiquement aux mois
  suivants quand la charge y est suggérée ; il reste modifiable
  indépendamment "pour ce mois uniquement", comme le montant.

## 15. Écran Revenus (même principe que Charges)

Un revenu peut être **fixe** (persiste jusqu'à suppression, exactement
comme une charge récurrente : actif/inactif, modification "ce mois
uniquement" ou "aussi les prochains mois", suggéré automatiquement chaque
mois tant qu'il est actif) ou **ponctuel** (une seule ligne ajoutée au
mois en cours, sans gabarit, sans jamais réapparaître ensuite). Toujours
personnel — pas de notion de "commun" pour un revenu, contrairement aux
charges. `src/pages/Revenus.jsx`, `src/lib/income.js`.

## 16. Transparence entre les deux membres du foyer

Changement de principe important, à la demande explicite de l'utilisatrice :
l'app était par défaut trop cloisonnée entre les deux membres (chacun ne
voyait que ses propres charges/revenus). Le nouveau principe : **tout est
visible par les deux, sauf ce qui est explicitement privé.**

- **Charges et Revenus** : chacun voit désormais ceux de l'autre, dans une
  section séparée, en lecture seule (modifier/supprimer reste réservé au
  propriétaire — RLS mise à jour sur `recurring_incomes`, cf. migration
  dans `schema.sql`, sécurité déjà correcte sur `fixed_charges`).
- **Accueil** : "Reste à dépenser" affiche désormais le total du foyer
  (les deux personnes cumulées), avec le détail par personne juste
  en dessous. La carte "Mes projets" (ex-"Objectifs d'épargne") reste
  déjà correctement soumise à la case "privé" existante sur les comptes.
- **Foyer** : corrige au passage une fuite trouvée pendant le test — un
  compte marqué privé apparaissait quand même dans la vue "Notre foyer"
  (totaux et liste). Filtré désormais, y compris pour son propre
  propriétaire, puisque "Foyer" est justement la vue commune.
- **Reste strictement privé, sans exception** : les envies d'achat,
  et tout compte/projet explicitement coché "privé".
- Nouveau fichier `src/lib/memberBudget.js` : calcul du budget d'un
  membre du foyer, partagé entre `Dashboard.jsx` et `Foyer.jsx` pour
  éviter la duplication.

## 17. "Mes projets" — vraiment indépendant des comptes

Corrige une confusion de ma part : la première version de "Mes projets"
réutilisait le champ `target_amount` des comptes d'épargne, ce qui le
faisait afficher exactement les mêmes lignes qu'"Objectifs du mois".
Nouvelle table `projects`, totalement séparée de `savings_pockets` :

- Démarre **vide**. Un crayon ✏️ à côté du titre ouvre le formulaire de
  création (nom, somme visée, date limite optionnelle, privé ou non).
- On y verse manuellement (bouton "+ Verser") — ex. de l'argent physique
  mis de côté dans une boîte à la maison, qu'on vient ensuite déclarer
  dans l'app. Ça ne touche **jamais** le budget disponible ni le solde
  d'aucun compte : c'est un simple suivi, complètement hors du calcul.
- Même règle de confidentialité que les comptes : privé = visible du
  seul créateur ; commun = les deux peuvent voir et verser.

Au passage, correction d'un problème d'affichage : le détail par personne
sur l'Accueil (nom + budget initial/dépensé/reste) passait sur deux
lignes qui se chevauchaient sur mobile — recalé en petite grille à trois
colonnes sous le nom, comme le reste de l'app.

## 18. Trois derniers ajustements

- **Clavier qui s'ouvrait tout seul sur "Dépenses"** : le focus
  automatique sur le champ montant retiré (`AddExpense.jsx`) — le clavier
  ne s'ouvre plus qu'au clic dans le champ.
- **"Budget" sur l'Accueil** (ex-"Mon budget") : devient un vrai tableau
  à une colonne par membre du foyer (Revenus, Charges fixes, Épargne
  prévue, Marge, Dépenses), plus seulement les chiffres de la personne
  connectée.
- **Écran Charges réorganisé** : au lieu de sections toujours dépliées,
  deux tuiles pliables par personne (nom + total), qu'on ouvre pour voir
  le détail — modifiable pour la sienne, lecture seule pour celle de
  l'autre membre. "Charges communes" reste une section à part, modifiable
  par les deux.

## 19. Revenu "fixe" directement depuis Préparer mon mois

Corrige un vrai manque signalé : ajouter un revenu depuis "Préparer mon
mois" ne le faisait apparaître que pour ce mois-ci, jamais dans l'écran
**Revenus**. Chaque revenu a désormais une case **"Fixe / récurrent"** —
si cochée, un gabarit `recurring_incomes` est créé automatiquement (même
mécanisme que pour les charges), et le revenu devient immédiatement
consultable/modifiable dans **Revenus**, proposé chaque mois suivant sans
ressaisie. Non cochée, il reste ponctuel : ajouté une seule fois à ce
mois, sans suite.

## 20. Objectifs du mois combinés + ordre des comptes

- **"Objectifs du mois" sur l'Accueil** : pour un compte **commun**
  (compte joint, tirelire...), l'objectif et le "versé" combinent
  désormais les deux membres (500 € + 500 € = 1000 €), avec le détail
  "X € versés par Maïté / Y € versés par Stephane" et le **solde réel du
  compte** affiché juste en dessous, sans changer d'onglet. Pour un
  compte privé, inchangé — seulement votre propre objectif.
- **Ordre des comptes personnalisable** : flèches ▲▼ sur chaque compte,
  dans Épargne (comptes de dépense et épargne séparément). Nouvelle
  colonne `sort_order` sur `savings_pockets`. Limite à connaître : cet
  ordre est stocké sur le compte lui-même, donc partagé — le réorganiser
  change l'ordre pour les deux membres, pas seulement le vôtre.

## 21. Verser depuis l'Accueil, quitter le foyer, et gabarit d'épargne

- **"+ Verser" directement sur "Objectifs du mois"** (Accueil) — plus
  besoin d'aller sur Épargne pour enregistrer un versement.
- **Foyer** : le code d'invitation reste accessible en permanence dans
  une section repliable "Gérer mon foyer" (plus besoin d'avoir un
  foyer incomplet pour le voir — utile pour réinviter quelqu'un
  d'autre). Un lien "Quitter ce foyer" y a été ajouté, avec
  confirmation (nouvelle fonction RPC `leave_household()`, même
  principe sécurisé que `create_household`/`accept_household_invite`).
- **Gabarit de versement d'épargne habituel** (nouvelle table
  `recurring_savings_goals`, une par personne et par compte — même
  principe que les charges/revenus fixes) : le montant qu'on verse
  d'habitude est désormais mémorisé séparément du mois en cours. Chaque
  ligne d'"Ce que je prévois de mettre de côté" (Préparer mon mois) a
  une case **"Actif ce mois-ci"** — décochée, le montant ne compte plus
  dans le budget disponible de ce mois précis, mais reste enregistré
  pour être proposé de nouveau le mois où le versement redevient
  possible. Résout le cas "pas de salaire ce mois-ci, donc pas
  d'épargne, mais je ne veux pas perdre mon montant habituel".

## 22. Préparer mon mois en cartes repliables + montant mensuel dès la création du compte

- **Préparer mon mois** ne s'ouvre plus tout déroulé — les quatre
  sections (Revenus, Charges, Ce que je prévois de mettre de côté,
  Marge) sont désormais des cartes repliées par défaut, avec leur total
  affiché dans l'en-tête ; on clique pour déplier uniquement celle
  qu'on veut modifier. Beaucoup moins de défilement.
- **Créer/modifier un compte d'épargne** (Épargne, ou directement depuis
  Préparer mon mois) propose maintenant un champ **"Montant que je
  compte mettre chaque mois"** dès la création — plus besoin d'aller
  ensuite sur Préparer mon mois pour le renseigner une première fois ;
  ça crée directement le gabarit (`recurring_savings_goals`).
- Rappel sur les charges déjà payées avant d'être ajoutées à l'app
  (ex. assurances prélevées avant leur saisie) : les laisser **inactives**
  tant qu'on ne veut pas qu'elles comptent sur le mois affiché — cocher
  "Active" sur l'écran Charges au moment voulu (ex. le mois suivant)
  pour qu'elles recommencent à se réserver, sans rien resaisir.

## 23. Report automatique (et modifiable) du mois précédent

À la demande explicite de l'utilisatrice, après une longue discussion sur
le fait que chaque mois était calculé de façon totalement indépendante
(aucun lien entre le reste à dépenser de septembre et le budget
d'octobre) : nouvelle colonne `carryover_amount` sur `budget_months`.

- À la **première** préparation d'un nouveau mois (jamais fait avant),
  l'app calcule automatiquement le vrai reste à dépenser final du mois
  précédent (positif ou négatif) et le propose déjà rempli dans une
  nouvelle carte repliable "Report du mois précédent" — juste au-dessus
  de "Marge de sécurité" dans `PrepareMonth.jsx`.
- **Toujours modifiable** ensuite, y compris pour le remettre à 0 si
  l'utilisateur ne veut pas de report ce mois-là.
- Une fois le mois déjà préparé, sa valeur enregistrée est respectée
  telle quelle (jamais recalculée automatiquement à chaque réouverture),
  pour ne pas écraser une correction manuelle.
- `computeMonthlyBudget()` (`budget-engine.js`) prend maintenant un
  paramètre `carryoverAmount`, ajouté à `initialBudget`. Répercuté
  partout où le budget d'un mois est calculé : `memberBudget.js` (donc
  Accueil et Foyer automatiquement), et affiché comme ligne à part dans
  le tableau "Budget" de l'Accueil et dans le résumé en haut de
  Préparer mon mois.
- **Limite assumée, expliquée à l'utilisatrice** : l'app découpe
  toujours le mois du 1ᵉʳ au dernier jour du calendrier, pas selon un
  cycle de paie décalé (ex. salaire versé le 28). Le report absorbe
  l'essentiel de cet écart d'un mois sur l'autre ; un vrai mois
  "personnalisé" (ex. du 28 au 27, propre à chaque personne) a été
  proposé mais refusé comme trop complexe — non construit.

## 24. Prochaines étapes (par ordre de priorité proposé)

1. **Notifications** (§16) : Web Push via le service worker déjà généré
   par `vite-plugin-pwa`, déclenchées par des fonctions Supabase Edge sur
   les seuils (50 % du budget, délai de réflexion terminé, etc.).
2. **Export CSV/PDF** (§20).

## 25. Pour tester à deux dès maintenant

1. Créer un projet Supabase, exécuter `supabase/schema.sql` dans son
   éditeur SQL, renseigner `.env` (voir §5).
2. `npm run dev` en local, ou déployer sur Vercel/Netlify (gratuit,
   quelques clics, build command `npm run build`, dossier `dist`) pour
   avoir une URL accessible depuis les deux téléphones.
3. Personne 1 : s'inscrire, "Créer mon foyer", copier le code affiché.
4. Personne 2 : s'inscrire sur son propre téléphone, "J'ai un code
   d'invitation", saisir le code — les deux comptes sont alors reliés et
   la synchronisation des données communes est immédiate au prochain
   chargement d'écran (le temps réel Supabase pourra être ajouté à cet
   endroit précis si vous voulez un rafraîchissement instantané sans
   recharger).
5. Pour le scan de ticket, la clé de démo OCR.space fonctionne pour
   quelques essais ; pour un usage quotidien à deux, prenez une clé
   gratuite sur https://ocr.space/ocrapi/freekey et mettez-la dans
   `VITE_OCR_API_KEY`.
