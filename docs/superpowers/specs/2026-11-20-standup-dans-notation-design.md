# Le point du jour dans la notation mensuelle — design

Date : 2026-11-20 · Taille : petit changement

## Intention

Le remplissage du point du jour (standup) pèse dans la note mensuelle des
collaborateurs, de façon automatique et visible, au lieu de dépendre de la
seule appréciation de l'évaluateur.

## Ce qui existe

- Note mensuelle /5 = 60 % livraison (auto) + 40 % moyenne de 3 critères
  manuels (`lib/evaluation.ts`, figée dans `Evaluation` par
  `app/api/evaluations/route.ts`).
- `StandupEntry` : une ligne par personne, par sprint, par jour. On ne peut
  remplir que le jour même (web et MCP) : un jour manqué l'est définitivement.
- Aucune donnée d'absence (congé, maladie, férié) dans l'application.
- Le bilan trimestriel reprend `overall` des évaluations mensuelles : il hérite
  du changement sans modification.

## Approches

Poids dans la note :
1. **Troisième composante automatique — retenue.** 50 % livraison, 15 %
   standup, 35 % manuels. Lisible : une ligne dédiée dans la fiche.
2. Malus par jour manqué. Écartée : punitif, peu lisible.
3. Fondu dans la livraison. Écartée : on ne voit plus pourquoi la note bouge.

Absences justifiées :
1. **Saisie par l'évaluateur — retenue.** Un nombre de jours retirés du calcul.
2. Tolérance fixe. Écartée : injuste pour un congé long.
3. Module d'absences. Écartée : hors de proportion avec la demande.

## Design

**Jours attendus** d'une personne pour un mois : jours ouvrés (lundi–vendredi)
du mois couverts par un sprint ACTIVE ou COMPLETED auquel elle participe (au
moins une tâche assignée non annulée ou une capacité déclarée — même périmètre
que le blocage de `member-compliance-server.ts`). Pour le mois en cours, on
s'arrête à la veille ; aujourd'hui compte seulement s'il est déjà rempli.

**Taux** = jours remplis ÷ (jours attendus − jours d'absence justifiée).
Dénominateur ≤ 0 → pas de composante standup.

**Note standup /5** : même barème que la livraison
(`deliveryScoreFromRatio`, réutilisé tel quel).

**Note globale** : moyenne pondérée des composantes disponibles, poids
50 / 15 / 35, renormalisés quand une composante auto manque :
- sans standup : ≈ 59 / 41 (quasi identique au 60 / 40 actuel) ;
- sans livraison : standup 30 / manuels 70 ;
- sans les deux : manuels seuls (comportement actuel).

**Données** (migration additive, sans reprise) sur `Evaluation` :
- `standupScore Decimal?(3,1)` — figée comme `deliveryScore` ;
- `excusedDays Int @default(0)` — saisi par l'évaluateur, borné 0..jours attendus ;
- `statsSnapshot` reçoit `standupFiled`, `standupExpected`.

**Écrans** :
- Fiche de notation (`EvaluationsView`) : ligne « Point du jour (auto) :
  17/20 → 4,0/5 », champ « Jours d'absence justifiée », aperçu de la note
  recalculé en direct ; le texte des pondérations passe à 50/15/35.
- Mes évaluations (`MyEvaluationsView`) : une métrique « Point du jour (auto) ».

**Notes déjà enregistrées** : inchangées. La nouvelle formule s'applique à
toute évaluation saisie ou modifiée après la mise en ligne.

## Non-objectifs

- Pas de suivi des absences ni des jours fériés (l'évaluateur les retire).
- Pas de prise en compte de l'heure de remplissage ni du contenu.
- Pas de recalcul des évaluations passées.
- Pas de changement du bilan trimestriel ni de l'app mobile.

## Mes choix (non discutés, à corriger si besoin)

- Barème identique à celui de la livraison.
- Renormalisation des poids quand une composante manque.
- `excusedDays` est porté par chaque évaluation (si deux évaluateurs notent la
  même personne, chacun saisit le sien).

## Laissé au réalisateur

Découpage des fonctions, requêtes, libellés exacts. Tests unitaires obligatoires
sur le calcul (jours attendus, taux, note globale avec composantes manquantes).
