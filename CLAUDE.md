# IziPilot — CLAUDE.md
> Fichier de configuration pour Claude Code · Lire en premier avant toute action

---

## 🎯 Contexte du projet

**IziPilot** est le SaaS de pilotage OKR d'IziChange S.A. (Bénin / Afrique de l'Ouest).
Il remplace les fichiers Excel de revue OKR hebdomadaire par une application web complète.

- **Tagline** : L'exécution au rythme de vos ambitions
- **URL cible** : pilot.izichange.com (domaine à définir)
- **Utilisateurs** : 20–30 personnes (POs, Management, CEO, Viewers)
- **Rythme clé** : chaque lundi matin, chaque PO saisit sa revue avant 9h00

---

## 🏗 Stack technique

```
Next.js 15       App Router + Server Actions + Server Components
PostgreSQL 16    Base de données principale
Prisma ORM       Schéma typé + migrations
NextAuth.js v5   Authentification + gestion des sessions
Tailwind v4      Styling
Recharts         Graphiques (courbes de progression OKR)
Resend           Emails transactionnels (rappels, alertes, digest)
React Email      Templates email
Vitest           Tests unitaires
Playwright       Tests E2E
Vercel           Déploiement + Cron Jobs
Neon / Railway   PostgreSQL managé
```

---

## 🎨 Design System IziPilot

### Palette de couleurs (extraite de izichange.com)
```css
--teal:      #008081   /* Couleur principale — bouton, logo, CTA */
--teal-dk:   #005f60   /* Teal foncé — hover */
--teal-lt:   #e6f7f7   /* Teal clair — fonds de cartes */
--teal-md:   #b3e0e0   /* Teal moyen — bordures */
--dark:      #1c3a4a   /* Fond sombre — nav, sidebar */
--dark-md:   #2e3e4b   /* Texte sombre */
--red:       #e23c4a   /* Alertes — KR rouge — JAMAIS décoratif */
--red-lt:    #fceaea   /* Fond rouge clair */
--gold:      #f4a900   /* KR orange — attention */
--gold-lt:   #fffbe6   /* Fond gold clair */
--green:     #1d9e75   /* KR vert — succès */
--green-lt:  #e1f5ee   /* Fond vert clair */
--gray:      #5f6e7a   /* Texte secondaire */
--gray-lt:   #f2f6f7   /* Background général */
```

### Typographie
```
DM Serif Display  → Titres, taglines, scores clés (font-style: italic pour tagline)
DM Sans           → Corps, labels, navigation (weights: 300, 400, 500, 600)
DM Mono           → Scores OKR, métriques, données chiffrées, semaines
```

### Statuts OKR (immuables)
```
🟢 En bonne voie  → score ≥ 70%  → vert  #1d9e75
🟡 Attention       → score 40–69% → gold  #f4a900
🔴 Bloqué         → score < 40%  → rouge #e23c4a  → escalade 48h obligatoire
⚪ Non démarré    → pas encore lancé → gris
```

---

## 🗂 Structure des dossiers

> Convention : root `app/` (Next.js 16 default, pas de dossier `src/`)

```
izipilot/
├── CLAUDE.md                    ← CE FICHIER
├── Dockerfile                   ← Multi-stage build (standalone)
├── docker-compose.yml           ← App + PostgreSQL 16
├── .dockerignore
├── .env.example                 ← Template variables d'environnement
├── prisma/
│   ├── schema.prisma            ← Schéma complet (13 modèles)
│   └── seed.ts                  ← Données IziChange 2026
├── app/                         ← Next.js App Router (root-level)
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/
│   │   ├── dashboard/page.tsx
│   │   ├── weekly/page.tsx      ← Saisie hebdo PO
│   │   ├── synthesis/page.tsx   ← Vue Management
│   │   ├── history/page.tsx     ← Courbes 13 semaines
│   │   └── alerts/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── objectives/route.ts
│   │   ├── key-results/route.ts
│   │   ├── weekly-entries/route.ts
│   │   ├── alerts/route.ts
│   │   └── cron/
│   │       ├── monday-reminder/route.ts   ← Lundi 8h30
│   │       └── check-alerts/route.ts      ← Vérif 48h quotidien
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                      ← Composants de base
│   │   ├── StatusBadge.tsx
│   │   ├── ScoreDonut.tsx
│   │   ├── KrProgressBar.tsx
│   │   ├── AlertCard.tsx
│   │   ├── WeekSelector.tsx
│   │   └── Skeleton.tsx         ← Loading states
│   ├── layout/
│   │   ├── Nav.tsx
│   │   ├── Sidebar.tsx
│   │   └── PageHeader.tsx
│   ├── dashboard/
│   │   ├── KpiRow.tsx
│   │   ├── OkrScoreCard.tsx
│   │   ├── AlertsPanel.tsx
│   │   └── ProgressChart.tsx
│   ├── weekly/
│   │   ├── WeeklyEntryForm.tsx  ← Formulaire saisie PO (single-column mobile)
│   │   ├── KrEntryBlock.tsx
│   │   └── EscaladeForm.tsx
│   └── synthesis/
│       ├── ManagementGrid.tsx
│       └── ProductRow.tsx
├── lib/
│   ├── prisma.ts                ← Client Prisma singleton
│   ├── auth.ts                  ← Config NextAuth + MFA
│   ├── auth-guard.ts            ← Object-level access control (orgId + ownership)
│   ├── score.ts                 ← Calcul scores OKR (logique critique)
│   ├── alerts.ts                ← Détection alertes
│   └── email.ts                 ← Templates Resend
├── types/
│   ├── index.ts                 ← Types TypeScript partagés
│   └── api.ts                   ← Contrats API (request/response schemas)
├── constants/
│   └── izichange.ts             ← Données IziChange (produits, couleurs)
├── emails/
│   ├── WeeklyReminder.tsx       ← Template rappel lundi
│   ├── AlertBlocked.tsx         ← Template KR rouge
│   ├── Escalation48h.tsx        ← Template escalade
│   └── WeeklyDigest.tsx         ← Template digest Management
├── tests/
│   ├── unit/
│   │   ├── score.test.ts        ← Tests calcul scores (coverage ≥ 80%)
│   │   └── alerts.test.ts
│   └── e2e/
│       └── weekly-entry.spec.ts ← Flow PO complet lundi matin
└── vercel.json                  ← Config crons
```

---

## 🗄 Schéma de base de données (résumé)

### 13 modèles Prisma
```
Organization    → Racine multi-tenant (orgId sur tout)
User            → CEO | MANAGEMENT | PO | VIEWER
Session         → NextAuth.js
VerificationToken → NextAuth.js
Department      → D1–D8 (code, name, color, ownerId)
Product         → P1–P7 (code, name, color, status, ownerId)
Objective       → OKR lié à Dept OU Product (entityType)
KeyResult       → KR avec target, currentValue, score (Decimal), status, orgId
WeeklyEntry     → Saisie PO par KR par semaine (unique: krId+week+year), orgId
WeeklySession   → Session globale par semaine (deadline lundi 09h00)
Alert           → KR_BLOCKED | ENTRY_MISSING | ESCALATION_48H
Decision        → Décision actée en CODIR
Notification    → EMAIL | IN_APP
```

### Règle de calcul score (CRITIQUE — ne pas modifier sans tests)
```typescript
// lib/score.ts
score = currentValue / target          // 0.0 à 1.0
scorePercent = Math.round(score * 100) // Affiché en %

// Statut automatique
if (scorePercent >= 70) status = 'ON_TRACK'   // 🟢
if (scorePercent >= 40) status = 'AT_RISK'    // 🟡
if (scorePercent < 40)  status = 'BLOCKED'    // 🔴
// Exception : krType === 'BINARY' → 0% ou 100%
// Exception : krType === 'DATE'   → % avancement manuel PO
```

---

## 👥 Rôles et permissions

```
CEO          → Accès total : lecture + écriture + admin + tous les OKRs
MANAGEMENT   → Synthèse + alertes + décisions + lecture tous OKRs
PO           → Saisie hebdo de SON périmètre (produit ou dept assigné)
              → Lecture de TOUS les OKRs (visibilité globale)
VIEWER       → Lecture seule de tout
```

---

## 📦 Données IziChange 2026 (seed)

### Produits (P1–P7)
```typescript
const PRODUCTS = [
  { code:'P1', name:'Plateforme Trading Crypto',  color:'#185FA5', status:'IN_DEVELOPMENT' },
  { code:'P2', name:'Wallet Électronique Crypto',  color:'#008081', status:'ACTIVE' },
  { code:'P3', name:'Africapart',                  color:'#D85A30', status:'ACTIVE' },
  { code:'P4', name:'API Collecte de Fonds',       color:'#534AB7', status:'IN_DEVELOPMENT' },
  { code:'P5', name:'IziChange PAY',               color:'#BA7517', status:'IN_DEVELOPMENT' },
  { code:'P6', name:'Carte Virtuelle IziChange',   color:'#C0392B', status:'ACTIVE' },
  { code:'P7', name:'IziLab',                      color:'#1D9E75', status:'PLANNED' },
]
```

### Départements (D1–D8)
```typescript
const DEPARTMENTS = [
  { code:'D1', name:'Communication & Marketing', color:'#D85A30' },
  { code:'D2', name:'IT',                        color:'#1C3A4A' },
  { code:'D3', name:'Finance',                   color:'#1D9E75' },
  { code:'D4', name:'Juridique & Compliance',    color:'#BA7517' },
  { code:'D5', name:'Support Client',            color:'#378ADD' },
  { code:'D6', name:'Stratégie & Innovation',    color:'#639922' },
  { code:'D7', name:'Management',                color:'#444441' },
  { code:'D8', name:'Ressources Humaines',       color:'#C0392B' },
]
```

### Nombre d'OKRs par entité (tous en base via seed)
```
7 produits × 3 objectifs × 3 KRs = 63 KRs produits
8 départements × 3 objectifs × 3 KRs = 72 KRs départements
Total : 135 KRs à seeder pour 2026 (Q1–Q4)
```

---

## 🤖 Architecture 5 agents Claude Code

### Agent 1 — Infrastructure & Auth
**Worktree** : `git worktree add agents/agent-1-infra`
**Mission** : Fondations du projet (démarrer EN PREMIER)
```
- Setup Next.js 15 + Prisma + PostgreSQL + Tailwind v4 + NextAuth.js v5
- Implémenter schema.prisma complet (13 modèles)
- Configurer NextAuth.js avec rôles (CEO/MANAGEMENT/PO/VIEWER)
- Créer middleware de protection des routes par rôle
- Écrire prisma/seed.ts avec toutes les données IziChange 2026
- Configurer .env.example avec toutes les variables nécessaires
```
**Livrable** : projet qui tourne en local avec auth + seed + DB

### Agent 2 — OKR Engine
**Worktree** : `git worktree add agents/agent-2-engine`
**Dépend de** : Agent 1 (schema.prisma doit exister)
**Mission** : API Routes et logique métier OKR
```
- API Routes : /api/objectives, /api/key-results, /api/weekly-entries
- src/lib/score.ts : calcul score, delta S-1, statut automatique
- src/lib/alerts.ts : détection KRs rouges, entrées manquantes
- Validation Zod sur toutes les entrées
- Contrainte unique (krId + weekNumber + year) sur WeeklyEntry
- Import Excel optionnel (xlsx → seed DB)
```
**Livrable** : API testable via curl/Postman

### Agent 3 — Dashboard & UI
**Worktree** : `git worktree add agents/agent-3-ui`
**Dépend de** : Agent 1 (auth). Peut travailler avec mocks pendant Agent 2
**Mission** : Interface utilisateur complète
```
- Layout : Nav (dark) + Sidebar (produits+depts avec scores) + Main
- Page Dashboard : KPIs, scores OKR, alertes, mini-chart progression
- Page Weekly : formulaire saisie PO (sliders, statuts, blocage, besoin)
- Page Synthesis : grille Management tous produits+depts
- Page History : courbes Recharts 13 semaines par KR
- Page Alerts : liste alertes + formulaire décision
- Mobile-first : POs doivent pouvoir saisir depuis téléphone
- RESPECTER le design system IziPilot (couleurs, typographie, composants)
```
**Référence design** : `izipilot_design_ui.html` (fourni)

### Agent 4 — Alertes & Notifications
**Worktree** : `git worktree add agents/agent-4-alerts`
**Dépend de** : Agent 2 (scores doivent exister)
**Mission** : Système d'alertes et emails automatiques
```
- Resend + React Email : 4 templates (reminder, blocked, escalade, digest)
- Cron lundi 8h30 : rappel à chaque PO "Soumettez votre revue"
- Cron quotidien 10h : vérif KRs rouges non traités → escalade 48h
- Détection auto : KR passe rouge → email Management dans l'heure
- Digest hebdo : résumé tous statuts + décisions à prendre
- vercel.json : config des 2 crons
```

### Agent 5 — Tests & QA
**Worktree** : `git worktree add agents/agent-5-qa`
**Mission** : Tests et qualité (démarre dès S1, travaille en parallèle)
```
- Vitest : tests unitaires src/lib/score.ts (coverage ≥ 80%)
- Vitest : tests API Routes (saisie → score calculé)
- Playwright : E2E flow PO complet (login → saisie → soumission → score affiché)
- Playwright : flow Management (voir synthèse → alertes → décision)
- GitHub Actions : pipeline CI/CD → lint → tests → build → deploy preview
```

---

## 🔄 Règles de collaboration entre agents

### Ne jamais modifier sans coordination
- `prisma/schema.prisma` → Agent 1 propriétaire. Toute migration = PR + review
- `lib/score.ts` → Logique critique. Toute modification = tests obligatoires
- `constants/izichange.ts` → Données de référence. Ne pas dupliquer

### Convention de branches
```
main          → Production (protégé)
agent-1/*     → Travaux Agent 1
agent-2/*     → Travaux Agent 2
agent-3/*     → Travaux Agent 3
agent-4/*     → Travaux Agent 4
agent-5/*     → Travaux Agent 5
```

### Variables d'environnement requises
```env
DATABASE_URL=postgresql://...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...
RESEND_API_KEY=...
CRON_SECRET=...          # Pour sécuriser les endpoints cron
```

---

## 📋 Règles de développement

### Toujours
- TypeScript strict sur tout le code
- Zod pour valider toutes les entrées API
- Prisma transactions pour les opérations multi-tables
- `Math.round()` sur tous les scores affichés (jamais de float brut)
- Vérifier le rôle utilisateur dans chaque Server Action/API Route
- Mobile-first CSS (les POs saisissent depuis téléphone)

### Jamais
- Hardcoder les couleurs IziChange (utiliser les CSS variables)
- Modifier schema.prisma sans migration Prisma
- Afficher un score non arrondi (ex: 72.43% → 72%)
- Exposer des données d'une org à une autre (multi-tenant)
- Envoyer un email sans vérifier `process.env.NODE_ENV !== 'test'`

### Calcul score — règles métier immuables
```typescript
// NUMERIC : score = réel / cible
// PERCENTAGE : score = réel / cible (même formule)
// DATE : score = avancement manuel 0–100% saisi par le PO
// BINARY : score = 0 (non) ou 1 (oui) — jamais de valeur intermédiaire

// Delta S-1
delta = currentScore - previousWeekScore

// Règle Google OKR
// 70% = réussite, 100% = cibles trop faciles, <40% 3 semaines = recalibrer
```

---

## 🚀 Ordre de démarrage recommandé

```
Jour 1–3  : Agent 1 seul         → schéma DB + auth + seed
Jour 4    : Agents 2 + 3 + 5     → engine + UI (mocks) + premiers tests
Semaine 2 : Agent 4              → alertes après premiers scores
Semaine 3 : Intégration          → Agent 3 connecte l'API Agent 2
Semaine 4 : QA                   → Agent 5 full coverage
Semaine 5 : Beta IziChange       → 9 POs testent en conditions réelles
Semaine 6 : Go-live              → pilot.izichange.com
```

---

## 📎 Fichiers de référence à garder dans le repo

```
docs/
├── izipilot_design_ui.html       ← Design system + maquette dashboard
├── erd_izichange_okr.html        ← ERD visuel des 11 tables
├── schema.prisma                 ← Schéma Prisma de référence
└── izichange_okr_2026.md         ← Liste complète des 135 KRs 2026
```

---

## 🔒 Sécurité

### Authentification
- NextAuth.js v5 avec email magic link (par défaut)
- MFA obligatoire pour CEO et MANAGEMENT (TOTP via authenticator app)
- MFA optionnel pour PO
- Session timeout : 4h max, refresh automatique
- Rate limiting sur les endpoints d'auth (10 req/min par IP)

### Autorisation (object-level)
Chaque API Route et Server Action doit vérifier :
1. **Rôle** : l'utilisateur a le rôle requis
2. **Organisation** : `orgId` correspond à l'org de l'utilisateur (multi-tenant)
3. **Ownership** : pour les mutations PO, vérifier `ownerId === userId`

```typescript
// lib/auth-guard.ts — helper utilisé partout
async function requireAccess(session, { orgId, ownerId?, roles? }) {
  // 1. Session valide
  // 2. user.orgId === orgId
  // 3. roles check (si spécifié)
  // 4. ownerId check (si spécifié, sauf CEO/MANAGEMENT)
}
```

### Headers de sécurité (middleware Next.js)
```
Content-Security-Policy, X-Frame-Options: DENY, X-Content-Type-Options: nosniff
Strict-Transport-Security (HSTS), Referrer-Policy: strict-origin-when-cross-origin
```

### Cron endpoints
- Sécurisés par header `Authorization: Bearer ${CRON_SECRET}`
- CRON_SECRET : 64 chars minimum, rotation trimestrielle
- Rate limited : 1 req/min par endpoint

### Audit logging
- Toute mutation (create/update/delete) loggée avec userId, timestamp, changement
- Décisions CODIR signées (userId + timestamp)
- Logs conservés 12 mois minimum

### CORS
- Production : whitelist `pilot.izichange.com` uniquement
- Dev : `localhost:3000`

---

## 📱 UX & Accessibilité

### Responsive breakpoints
```
mobile   : < 480px   → Single column, sidebar masquée
tablet   : < 768px   → Sidebar collapsible
desktop  : ≥ 768px   → Layout complet sidebar + main
```

### Mobile-first pour le formulaire PO (Weekly Entry)
- Layout single-column obligatoire sur mobile
- Sliders natifs pour la saisie de progression
- Bouton "Soumettre" sticky en bas d'écran
- Draft auto-save local (localStorage) en cas de perte de connexion

### Auto-redirect PO
- Si rôle PO + lundi matin (avant deadline) → redirect automatique vers `/weekly`
- Après soumission → écran de confirmation avec récap des scores

### États des composants (obligatoires)
Chaque composant UI doit gérer :
- **Loading** : skeleton placeholder (composant `Skeleton.tsx`)
- **Empty** : message "Aucune donnée" avec illustration
- **Error** : message d'erreur + bouton retry
- **Disabled** : pour VIEWER (lecture seule, interactions désactivées)

### Accessibilité WCAG AA
- Contraste minimum 4.5:1 pour tout texte
- ⚠️ Vérifier : gold (#f4a900) sur gold-lt (#fffbe6) → insuffisant, utiliser gold sur blanc
- ⚠️ Vérifier : red (#e23c4a) sur red-lt (#fceaea) → tester avant implémentation
- Labels `aria-label` sur tous les éléments interactifs
- Navigation clavier complète (tab, enter, escape)

### Échelle typographique
```
xs   : 11px / 0.6875rem  → Labels, métadonnées
sm   : 13px / 0.8125rem  → Texte secondaire, légendes
base : 15px / 0.9375rem  → Corps de texte, formulaires
lg   : 18px / 1.125rem   → Sous-titres, noms de produits
xl   : 24px / 1.5rem     → Titres de page
2xl  : 32px / 2rem       → Scores KPI, métriques clés
```

---

*IziPilot — by IziChange S.A. · Confidentiel · Usage interne*
