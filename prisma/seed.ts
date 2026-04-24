import { PrismaClient, UserRole, EntityType, Quarter, KrType, KrStatus, ProductStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding IziPilot database...");

  // ── Hash default password ─────────────────────────────────────
  // All test accounts use "password123" — change in production!
  const defaultPassword = await bcrypt.hash("password123", 12);

  // ── Organization ──────────────────────────────────────────────
  const org = await prisma.organization.create({
    data: {
      name: "IziChange S.A.",
      slug: "izichange",
      primaryColor: "#008081",
    },
  });

  // ── Users ─────────────────────────────────────────────────────
  const users = await Promise.all([
    prisma.user.create({ data: { orgId: org.id, email: "direction@izichange.com", name: "Directeur Général", role: "CEO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "comitedirection@izichange.com", name: "Directeur Opérations", role: "MANAGEMENT", passwordHash: defaultPassword } }),
    // POs Produits (P1–P7)
    prisma.user.create({ data: { orgId: org.id, email: "geres@izichange.com", name: "PO Trading", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "abdoulouadoud.bouraima@izichange.com", name: "PO Wallet", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "romel@izichange.com", name: "PO Africapart", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "marius@izichange.com", name: "PO Collecte", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "pierremichel.agbla@izichange.com", name: "PO IziPay", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "serge.adounsi@izichange.com", name: "PO Carte", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "christian.ode@izichange.com", name: "PO IziLab", role: "PO", passwordHash: defaultPassword } }),
    // POs Départements (D1–D8)
    prisma.user.create({ data: { orgId: org.id, email: "johanes.quenum@izichange.com", name: "Resp. Marketing", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "aziz.sovimi@izichange.com", name: "Resp. IT", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "jerry.agossou@izichange.com", name: "Resp. Finance", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "jean-paul.doliveira@izichange.com", name: "Resp. Juridique", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "ulrich.atchade@izichange.com", name: "Resp. Support", role: "PO", passwordHash: defaultPassword } }),
    prisma.user.create({ data: { orgId: org.id, email: "joas.vigan@izichange.com", name: "Resp. Stratégie", role: "PO", passwordHash: defaultPassword } }),
    // Resp. Management (D7) — uses same person as Directeur Opérations (comitedirection), handled via mgmt1 reference
    prisma.user.create({ data: { orgId: org.id, email: "menes.whannou@izichange.com", name: "Resp. RH", role: "PO", passwordHash: defaultPassword } }),
  ]);

  const [
    ceo, mgmt1,
    poTrading, poWallet, poAfricapart, poCollecte, poPay, poCarte, poIzilab,
    poMarketing, poIT, poFinance, poLegal, poSupport, poStrategie, poRH,
  ] = users;

  // ── Products (P1–P7) ─────────────────────────────────────────
  const productsData = [
    { code: "P1", name: "Plateforme Trading Crypto", color: "#185FA5", status: "IN_DEVELOPMENT" as ProductStatus, owner: poTrading },
    { code: "P2", name: "Wallet Électronique Crypto", color: "#008081", status: "ACTIVE" as ProductStatus, owner: poWallet },
    { code: "P3", name: "Africapart", color: "#D85A30", status: "ACTIVE" as ProductStatus, owner: poAfricapart },
    { code: "P4", name: "API Collecte de Fonds", color: "#534AB7", status: "IN_DEVELOPMENT" as ProductStatus, owner: poCollecte },
    { code: "P5", name: "IziChange PAY", color: "#BA7517", status: "IN_DEVELOPMENT" as ProductStatus, owner: poPay },
    { code: "P6", name: "Carte Virtuelle IziChange", color: "#C0392B", status: "ACTIVE" as ProductStatus, owner: poCarte },
    { code: "P7", name: "IziLab", color: "#1D9E75", status: "PLANNED" as ProductStatus, owner: poIzilab },
  ];

  const products = await Promise.all(
    productsData.map((p, i) =>
      prisma.product.create({
        data: {
          orgId: org.id, code: p.code, name: p.name, color: p.color,
          status: p.status, ownerId: p.owner.id, sortOrder: i,
        },
      })
    )
  );

  // ── Departments (D1–D8) ──────────────────────────────────────
  const deptsData = [
    { code: "D1", name: "Communication & Marketing", color: "#D85A30", owner: poMarketing },
    { code: "D2", name: "IT", color: "#1C3A4A", owner: poIT },
    { code: "D3", name: "Finance", color: "#1D9E75", owner: poFinance },
    { code: "D4", name: "Juridique & Compliance", color: "#BA7517", owner: poLegal },
    { code: "D5", name: "Support Client", color: "#378ADD", owner: poSupport },
    { code: "D6", name: "Stratégie & Innovation", color: "#639922", owner: poStrategie },
    { code: "D7", name: "Management", color: "#444441", owner: mgmt1 },
    { code: "D8", name: "Ressources Humaines", color: "#C0392B", owner: poRH },
  ];

  const departments = await Promise.all(
    deptsData.map((d, i) =>
      prisma.department.create({
        data: {
          orgId: org.id, code: d.code, name: d.name, color: d.color,
          ownerId: d.owner.id, sortOrder: i,
        },
      })
    )
  );

  // ── OKRs: Products ───────────────────────────────────────────
  // 7 products × 3 objectives × 3 KRs = 63 KRs
  type KrDef = { title: string; type: KrType; target?: number; unit?: string; targetDate?: string; isInverse?: boolean };
  type ObjDef = { title: string; why: string; quarter: Quarter; krs: KrDef[] };
  const productOKRs: {
    productIdx: number;
    objectives: ObjDef[];
  }[] = [
    // P1 — Plateforme Trading Crypto
    {
      productIdx: 0,
      objectives: [
        {
          title: "Lancer la V1 de la plateforme trading",
          quarter: "Q1",
          why: "Capturer le marché crypto ouest-africain en croissance",
          krs: [
            { title: "Recruter 500 traders actifs", type: "NUMERIC", target: 500, unit: "traders" },
            { title: "Volume de trading mensuel > 1M$", type: "NUMERIC", target: 1000000, unit: "$" },
            { title: "Go-live plateforme", type: "DATE", targetDate: "Juin 2026" },
          ],
        },
        {
          title: "Assurer la fiabilité technique",
          quarter: "Q2",
          why: "Les traders quittent si la plateforme est instable",
          krs: [
            { title: "Uptime > 99.5%", type: "PERCENTAGE", target: 99.5, unit: "%" },
            { title: "Temps de réponse API < 200ms (P95)", type: "NUMERIC", target: 200, unit: "ms", isInverse: true },
            { title: "Aucun incident critique en production", type: "BINARY" },
          ],
        },
        {
          title: "Obtenir les agréments réglementaires",
          quarter: "Q1",
          why: "Obligatoire pour opérer légalement au Bénin",
          krs: [
            { title: "Licence BCEAO obtenue", type: "BINARY" },
            { title: "Audit de sécurité passé", type: "BINARY" },
            { title: "Documentation compliance soumise", type: "DATE", targetDate: "Mars 2026" },
          ],
        },
      ],
    },
    // P2 — Wallet Électronique Crypto
    {
      productIdx: 1,
      objectives: [
        {
          title: "Augmenter la base utilisateurs du wallet",
          quarter: "Q2",
          why: "Le wallet est le produit phare, il faut accélérer l'adoption",
          krs: [
            { title: "10 000 wallets créés", type: "NUMERIC", target: 10000, unit: "wallets" },
            { title: "Taux d'activation > 60%", type: "PERCENTAGE", target: 60, unit: "%" },
            { title: "NPS utilisateurs > 50", type: "NUMERIC", target: 50, unit: "points" },
          ],
        },
        {
          title: "Réduire les coûts de transaction",
          quarter: "Q3",
          why: "Les frais élevés freinent l'adoption en Afrique de l'Ouest",
          krs: [
            { title: "Coût moyen par transaction < 0.5$", type: "NUMERIC", target: 0.5, unit: "$", isInverse: true },
            { title: "3 nouveaux partenaires paiement intégrés", type: "NUMERIC", target: 3, unit: "partenaires" },
            { title: "Marge brute transactions > 15%", type: "PERCENTAGE", target: 15, unit: "%" },
          ],
        },
        {
          title: "Sécuriser les fonds utilisateurs",
          quarter: "Q2",
          why: "La confiance est le pilier du crypto en Afrique",
          krs: [
            { title: "Aucune perte de fonds client", type: "BINARY" },
            { title: "Audit sécurité trimestriel complété", type: "BINARY" },
            { title: "Temps de détection fraude < 5min", type: "NUMERIC", target: 5, unit: "min", isInverse: true },
          ],
        },
      ],
    },
    // P3 — Africapart
    {
      productIdx: 2,
      objectives: [
        {
          title: "Développer le marché locatif en ligne",
          quarter: "Q2",
          why: "Africapart doit devenir la référence locative au Bénin",
          krs: [
            { title: "2 000 annonces actives", type: "NUMERIC", target: 2000, unit: "annonces" },
            { title: "500 réservations mensuelles", type: "NUMERIC", target: 500, unit: "réservations" },
            { title: "Taux de conversion visiteur > 8%", type: "PERCENTAGE", target: 8, unit: "%" },
          ],
        },
        {
          title: "Améliorer l'expérience propriétaire",
          quarter: "Q3",
          why: "Les propriétaires sont le supply-side critique",
          krs: [
            { title: "Temps moyen de publication < 10min", type: "NUMERIC", target: 10, unit: "min", isInverse: true },
            { title: "Taux de satisfaction proprio > 80%", type: "PERCENTAGE", target: 80, unit: "%" },
            { title: "Délai de paiement proprio < 48h", type: "NUMERIC", target: 48, unit: "heures", isInverse: true },
          ],
        },
        {
          title: "Expansion géographique",
          quarter: "Q3",
          why: "Le marché béninois seul ne suffit pas à la rentabilité",
          krs: [
            { title: "Lancement Togo", type: "DATE", targetDate: "Sept 2026" },
            { title: "100 annonces au Togo", type: "NUMERIC", target: 100, unit: "annonces" },
            { title: "Partenariat 2 agences immobilières", type: "NUMERIC", target: 2, unit: "agences" },
          ],
        },
      ],
    },
    // P4 — API Collecte de Fonds
    {
      productIdx: 3,
      objectives: [
        {
          title: "Lancer l'API de collecte en production",
          quarter: "Q1",
          why: "Permettre aux entreprises de lever des fonds via notre plateforme",
          krs: [
            { title: "API v1 déployée", type: "DATE", targetDate: "Avr 2026" },
            { title: "5 clients intégrés", type: "NUMERIC", target: 5, unit: "clients" },
            { title: "Documentation API 100% complète", type: "BINARY" },
          ],
        },
        {
          title: "Garantir la conformité financière",
          quarter: "Q2",
          why: "La collecte de fonds est très réglementée en zone UEMOA",
          krs: [
            { title: "Validation juridique BCEAO", type: "BINARY" },
            { title: "KYC/AML intégré à 100%", type: "PERCENTAGE", target: 100, unit: "%" },
            { title: "Rapport conformité mensuel automatisé", type: "BINARY" },
          ],
        },
        {
          title: "Atteindre la rentabilité du service",
          quarter: "Q4",
          why: "L'API doit s'autofinancer d'ici Q4",
          krs: [
            { title: "Revenu mensuel API > 5 000$", type: "NUMERIC", target: 5000, unit: "$" },
            { title: "Coût d'infrastructure < 20% du CA", type: "PERCENTAGE", target: 20, unit: "%", isInverse: true },
            { title: "Taux de churn clients < 5%", type: "PERCENTAGE", target: 5, unit: "%", isInverse: true },
          ],
        },
      ],
    },
    // P5 — IziChange PAY
    {
      productIdx: 4,
      objectives: [
        {
          title: "Lancer IziChange PAY pour les marchands",
          quarter: "Q1",
          why: "Le paiement mobile est le prochain relais de croissance",
          krs: [
            { title: "200 marchands inscrits", type: "NUMERIC", target: 200, unit: "marchands" },
            { title: "Go-live paiement QR code", type: "DATE", targetDate: "Mai 2026" },
            { title: "Volume transactions > 500K$/mois", type: "NUMERIC", target: 500000, unit: "$/mois" },
          ],
        },
        {
          title: "Intégrer les opérateurs mobile money",
          quarter: "Q2",
          why: "Sans mobile money, PAY ne marchera pas en Afrique de l'Ouest",
          krs: [
            { title: "Intégration MTN Mobile Money", type: "BINARY" },
            { title: "Intégration Moov Money", type: "BINARY" },
            { title: "Taux de succès transactions > 95%", type: "PERCENTAGE", target: 95, unit: "%" },
          ],
        },
        {
          title: "Optimiser l'expérience paiement",
          quarter: "Q3",
          why: "Les marchands veulent un paiement rapide et fiable",
          krs: [
            { title: "Temps de paiement < 15 secondes", type: "NUMERIC", target: 15, unit: "secondes", isInverse: true },
            { title: "Taux d'abandon panier < 10%", type: "PERCENTAGE", target: 10, unit: "%", isInverse: true },
            { title: "Délai de réponse support marchand < 2h", type: "NUMERIC", target: 2, unit: "heures", isInverse: true },
          ],
        },
      ],
    },
    // P6 — Carte Virtuelle IziChange
    {
      productIdx: 5,
      objectives: [
        {
          title: "Augmenter l'émission de cartes virtuelles",
          quarter: "Q2",
          why: "Les cartes virtuelles sont très demandées pour les achats en ligne",
          krs: [
            { title: "5 000 cartes émises", type: "NUMERIC", target: 5000, unit: "cartes" },
            { title: "Volume mensuel achats > 200K$", type: "NUMERIC", target: 200000, unit: "$" },
            { title: "Taux d'activation cartes > 70%", type: "PERCENTAGE", target: 70, unit: "%" },
          ],
        },
        {
          title: "Réduire la fraude carte",
          quarter: "Q3",
          why: "La fraude érode la confiance et les marges",
          krs: [
            { title: "Taux de fraude < 0.1%", type: "PERCENTAGE", target: 0.1, unit: "%", isInverse: true },
            { title: "Détection fraude temps réel déployée", type: "BINARY" },
            { title: "Chargeback ratio < 0.5%", type: "PERCENTAGE", target: 0.5, unit: "%", isInverse: true },
          ],
        },
        {
          title: "Étendre les partenariats bancaires",
          quarter: "Q4",
          why: "Plus de partenaires = plus de devises supportées",
          krs: [
            { title: "2 nouveaux émetteurs intégrés", type: "NUMERIC", target: 2, unit: "émetteurs" },
            { title: "Support EUR et GBP en plus de USD", type: "BINARY" },
            { title: "Coût d'émission carte réduit de 20%", type: "PERCENTAGE", target: 20, unit: "%", isInverse: true },
          ],
        },
      ],
    },
    // P7 — IziLab
    {
      productIdx: 6,
      objectives: [
        {
          title: "Lancer le programme d'innovation IziLab",
          quarter: "Q2",
          why: "IziLab incube les futurs produits d'IziChange",
          krs: [
            { title: "3 POCs validés", type: "NUMERIC", target: 3, unit: "POCs" },
            { title: "Budget innovation alloué", type: "BINARY" },
            { title: "Équipe IziLab constituée (5 pers)", type: "NUMERIC", target: 5, unit: "personnes" },
          ],
        },
        {
          title: "Explorer le marché DeFi Afrique",
          quarter: "Q3",
          why: "La DeFi est le prochain grand mouvement crypto en Afrique",
          krs: [
            { title: "Étude de marché DeFi publiée", type: "BINARY" },
            { title: "1 partenariat protocole DeFi signé", type: "NUMERIC", target: 1, unit: "partenariats" },
            { title: "Prototype yield farming testé", type: "DATE", targetDate: "Nov 2026" },
          ],
        },
        {
          title: "Construire la communauté développeurs",
          quarter: "Q4",
          why: "Une communauté dev accélère l'écosystème IziChange",
          krs: [
            { title: "50 développeurs actifs dans la communauté", type: "NUMERIC", target: 50, unit: "développeurs" },
            { title: "Taux d'engagement communauté > 30%", type: "PERCENTAGE", target: 30, unit: "%" },
            { title: "SDK open-source publié", type: "BINARY" },
          ],
        },
      ],
    },
  ];

  // ── OKRs: Departments ────────────────────────────────────────
  // 8 departments × 3 objectives × 3 KRs = 72 KRs
  const deptOKRs: {
    deptIdx: number;
    objectives: ObjDef[];
  }[] = [
    // D1 — Communication & Marketing
    {
      deptIdx: 0,
      objectives: [
        {
          title: "Renforcer la notoriété de la marque IziChange",
          quarter: "Q2",
          why: "La notoriété est faible hors de Cotonou",
          krs: [
            { title: "Reach réseaux sociaux > 500K/mois", type: "NUMERIC", target: 500000, unit: "reach" },
            { title: "Trafic organique > 50K visites/mois", type: "NUMERIC", target: 50000, unit: "visites" },
            { title: "Notoriété assistée > 30% au Bénin", type: "PERCENTAGE", target: 30, unit: "%" },
          ],
        },
        {
          title: "Générer des leads qualifiés",
          quarter: "Q2",
          why: "Le marketing doit alimenter la croissance produit",
          krs: [
            { title: "2 000 leads qualifiés générés", type: "NUMERIC", target: 2000, unit: "leads" },
            { title: "Coût par lead < 3$", type: "NUMERIC", target: 3, unit: "$", isInverse: true },
            { title: "Taux de conversion lead > 12%", type: "PERCENTAGE", target: 12, unit: "%" },
          ],
        },
        {
          title: "Structurer le marketing digital",
          quarter: "Q1",
          why: "Les campagnes actuelles sont trop manuelles",
          krs: [
            { title: "CRM marketing déployé", type: "BINARY" },
            { title: "Automatisation emailing opérationnelle", type: "BINARY" },
            { title: "Dashboard analytics en place", type: "DATE", targetDate: "Avr 2026" },
          ],
        },
      ],
    },
    // D2 — IT
    {
      deptIdx: 1,
      objectives: [
        {
          title: "Moderniser l'infrastructure technique",
          quarter: "Q1",
          why: "L'infra actuelle ne tiendra pas la montée en charge",
          krs: [
            { title: "Migration cloud complète", type: "DATE", targetDate: "Juil 2026" },
            { title: "CI/CD sur tous les projets", type: "BINARY" },
            { title: "Coût infra optimisé de 25%", type: "PERCENTAGE", target: 25, unit: "%" },
          ],
        },
        {
          title: "Renforcer la cybersécurité",
          quarter: "Q2",
          why: "Fintech = cible prioritaire des cyberattaques",
          krs: [
            { title: "Pentest trimestriel passé", type: "BINARY" },
            { title: "Temps de réponse incident < 30min", type: "NUMERIC", target: 30, unit: "min", isInverse: true },
            { title: "Formation sécurité 100% équipe", type: "PERCENTAGE", target: 100, unit: "%" },
          ],
        },
        {
          title: "Améliorer la productivité développeurs",
          quarter: "Q3",
          why: "Le time-to-market est trop long actuellement",
          krs: [
            { title: "Temps de build réduit à < 5min", type: "NUMERIC", target: 5, unit: "min", isInverse: true },
            { title: "Couverture tests > 70%", type: "PERCENTAGE", target: 70, unit: "%" },
            { title: "Déploiements par semaine > 10", type: "NUMERIC", target: 10, unit: "déploiements" },
          ],
        },
      ],
    },
    // D3 — Finance
    {
      deptIdx: 2,
      objectives: [
        {
          title: "Optimiser la gestion de trésorerie",
          quarter: "Q1",
          why: "Le cash est le nerf de la guerre pour une fintech",
          krs: [
            { title: "Prévision trésorerie automatisée", type: "BINARY" },
            { title: "Écart prévision/réel < 5%", type: "PERCENTAGE", target: 5, unit: "%", isInverse: true },
            { title: "Reporting financier J+3", type: "NUMERIC", target: 3, unit: "jours", isInverse: true },
          ],
        },
        {
          title: "Lever un tour de financement",
          quarter: "Q2",
          why: "Financer la croissance 2026-2027",
          krs: [
            { title: "Pitch deck finalisé", type: "DATE", targetDate: "Mars 2026" },
            { title: "3 LOI (lettres d'intention) reçues", type: "NUMERIC", target: 3, unit: "LOI" },
            { title: "Term sheet signé", type: "BINARY" },
          ],
        },
        {
          title: "Automatiser la comptabilité",
          quarter: "Q3",
          why: "Le volume de transactions rend la compta manuelle impossible",
          krs: [
            { title: "Rapprochement bancaire automatisé", type: "BINARY" },
            { title: "Temps de clôture mensuelle < 5 jours", type: "NUMERIC", target: 5, unit: "jours", isInverse: true },
            { title: "Aucune erreur comptable en audit", type: "BINARY" },
          ],
        },
      ],
    },
    // D4 — Juridique & Compliance
    {
      deptIdx: 3,
      objectives: [
        {
          title: "Assurer la conformité réglementaire",
          quarter: "Q1",
          why: "La BCEAO renforce les contrôles sur les fintechs",
          krs: [
            { title: "100% des produits conformes BCEAO", type: "PERCENTAGE", target: 100, unit: "%" },
            { title: "Registre réglementaire à jour", type: "BINARY" },
            { title: "Aucune sanction réglementaire", type: "BINARY" },
          ],
        },
        {
          title: "Renforcer le cadre KYC/AML",
          quarter: "Q2",
          why: "Le blanchiment est le risque #1 pour les crypto en Afrique",
          krs: [
            { title: "Taux de vérification KYC > 95%", type: "PERCENTAGE", target: 95, unit: "%" },
            { title: "Délai moyen KYC < 24h", type: "NUMERIC", target: 24, unit: "heures", isInverse: true },
            { title: "Formation AML dispensée à 100% staff", type: "PERCENTAGE", target: 100, unit: "%" },
          ],
        },
        {
          title: "Structurer la propriété intellectuelle",
          quarter: "Q3",
          why: "Protéger les innovations d'IziChange",
          krs: [
            { title: "2 marques déposées", type: "NUMERIC", target: 2, unit: "marques" },
            { title: "Politique PI formalisée", type: "BINARY" },
            { title: "Audit PI réalisé", type: "DATE", targetDate: "Juin 2026" },
          ],
        },
      ],
    },
    // D5 — Support Client
    {
      deptIdx: 4,
      objectives: [
        {
          title: "Améliorer la satisfaction client",
          quarter: "Q2",
          why: "Le support est le visage d'IziChange auprès des utilisateurs",
          krs: [
            { title: "CSAT > 85%", type: "PERCENTAGE", target: 85, unit: "%" },
            { title: "Temps première réponse < 15min", type: "NUMERIC", target: 15, unit: "min", isInverse: true },
            { title: "Taux de résolution 1er contact > 70%", type: "PERCENTAGE", target: 70, unit: "%" },
          ],
        },
        {
          title: "Déployer le support multicanal",
          quarter: "Q3",
          why: "Les utilisateurs veulent choisir leur canal de contact",
          krs: [
            { title: "Chatbot WhatsApp opérationnel", type: "BINARY" },
            { title: "Base de connaissances > 100 articles", type: "NUMERIC", target: 100, unit: "articles" },
            { title: "Support téléphonique 12h/7", type: "DATE", targetDate: "Août 2026" },
          ],
        },
        {
          title: "Réduire le volume de tickets",
          quarter: "Q4",
          why: "Le self-service réduit les coûts et améliore l'expérience",
          krs: [
            { title: "Taux de self-service > 40%", type: "PERCENTAGE", target: 40, unit: "%" },
            { title: "Réduction tickets -20% vs Q1", type: "PERCENTAGE", target: 20, unit: "%" },
            { title: "FAQ dynamique en place", type: "BINARY" },
          ],
        },
      ],
    },
    // D6 — Stratégie & Innovation
    {
      deptIdx: 5,
      objectives: [
        {
          title: "Définir la feuille de route 2027",
          quarter: "Q3",
          why: "La stratégie doit être claire 6 mois à l'avance",
          krs: [
            { title: "Plan stratégique 2027 validé en CODIR", type: "DATE", targetDate: "Oct 2026" },
            { title: "5 marchés analysés pour expansion", type: "NUMERIC", target: 5, unit: "marchés" },
            { title: "Budget prévisionnel 2027 bouclé", type: "BINARY" },
          ],
        },
        {
          title: "Mettre en place la veille concurrentielle",
          quarter: "Q1",
          why: "Les concurrents arrivent vite sur le marché crypto africain",
          krs: [
            { title: "Rapport veille mensuel automatisé", type: "BINARY" },
            { title: "10 concurrents suivis activement", type: "NUMERIC", target: 10, unit: "concurrents" },
            { title: "Alerte concurrentielle < 48h", type: "NUMERIC", target: 48, unit: "heures", isInverse: true },
          ],
        },
        {
          title: "Piloter les partenariats stratégiques",
          quarter: "Q2",
          why: "Les partenariats accélèrent la croissance en Afrique",
          krs: [
            { title: "3 partenariats stratégiques signés", type: "NUMERIC", target: 3, unit: "partenariats" },
            { title: "Pipeline partenaires > 15 prospects", type: "NUMERIC", target: 15, unit: "prospects" },
            { title: "1 partenariat bancaire majeur", type: "NUMERIC", target: 1, unit: "partenariats" },
          ],
        },
      ],
    },
    // D7 — Management
    {
      deptIdx: 6,
      objectives: [
        {
          title: "Instaurer la culture OKR",
          quarter: "Q1",
          why: "Les OKRs ne marchent que si toute l'entreprise les adopte",
          krs: [
            { title: "100% des POs formés aux OKRs", type: "PERCENTAGE", target: 100, unit: "%" },
            { title: "Taux de saisie hebdo > 90%", type: "PERCENTAGE", target: 90, unit: "%" },
            { title: "CODIR OKR hebdomadaire tenu", type: "BINARY" },
          ],
        },
        {
          title: "Améliorer la prise de décision",
          quarter: "Q2",
          why: "Les décisions traînent et bloquent les équipes",
          krs: [
            { title: "Délai décision moyen < 48h", type: "NUMERIC", target: 48, unit: "heures", isInverse: true },
            { title: "100% des alertes traitées sous 72h", type: "PERCENTAGE", target: 100, unit: "%" },
            { title: "Dashboard IziPilot utilisé quotidiennement", type: "BINARY" },
          ],
        },
        {
          title: "Renforcer la communication interne",
          quarter: "Q3",
          why: "Les équipes travaillent en silo actuellement",
          krs: [
            { title: "Stand-up inter-équipes hebdomadaire", type: "BINARY" },
            { title: "Taux de lecture newsletter interne > 70%", type: "PERCENTAGE", target: 70, unit: "%" },
            { title: "Satisfaction communication interne > 75%", type: "PERCENTAGE", target: 75, unit: "%" },
          ],
        },
      ],
    },
    // D8 — Ressources Humaines
    {
      deptIdx: 7,
      objectives: [
        {
          title: "Recruter les talents clés 2026",
          quarter: "Q1",
          why: "La croissance nécessite des recrutements ciblés",
          krs: [
            { title: "15 recrutements réalisés", type: "NUMERIC", target: 15, unit: "recrutements" },
            { title: "Délai moyen recrutement < 30 jours", type: "NUMERIC", target: 30, unit: "jours", isInverse: true },
            { title: "Taux d'acceptation offres > 80%", type: "PERCENTAGE", target: 80, unit: "%" },
          ],
        },
        {
          title: "Développer les compétences",
          quarter: "Q2",
          why: "Le crypto/fintech évolue vite, les équipes doivent suivre",
          krs: [
            { title: "Plan de formation individuel pour 100% staff", type: "PERCENTAGE", target: 100, unit: "%" },
            { title: "Budget formation utilisé > 80%", type: "PERCENTAGE", target: 80, unit: "%" },
            { title: "2 certifications par développeur", type: "NUMERIC", target: 2, unit: "certifications" },
          ],
        },
        {
          title: "Améliorer la rétention",
          quarter: "Q3",
          why: "Le turnover coûte cher et déstabilise les équipes",
          krs: [
            { title: "Taux de turnover < 10%", type: "PERCENTAGE", target: 10, unit: "%", isInverse: true },
            { title: "eNPS > 40", type: "NUMERIC", target: 40, unit: "points" },
            { title: "Entretiens annuels 100% réalisés", type: "PERCENTAGE", target: 100, unit: "%" },
          ],
        },
      ],
    },
  ];

  // ── Create Product OKRs ──────────────────────────────────────
  let krCount = 0;
  const objectiveIds: string[] = []; // Track for company OKR parent links
  for (const pOkr of productOKRs) {
    const product = products[pOkr.productIdx];
    for (let oi = 0; oi < pOkr.objectives.length; oi++) {
      const obj = pOkr.objectives[oi];
      const objective = await prisma.objective.create({
        data: {
          orgId: org.id,
          entityType: "PRODUCT",
          productId: product.id,
          title: obj.title,
          why: obj.why,
          quarter: obj.quarter,
          year: 2026,
          sortOrder: oi,
        },
      });
      objectiveIds.push(objective.id);

      for (let ki = 0; ki < obj.krs.length; ki++) {
        const kr = obj.krs[ki];
        await prisma.keyResult.create({
          data: {
            orgId: org.id,
            objectiveId: objective.id,
            title: kr.title,
            krType: kr.type,
            target: kr.target ?? null,
            targetUnit: kr.unit ?? null,
            targetDate: kr.targetDate ?? null,
            isInverse: kr.isInverse ?? false,
            ownerId: productsData[pOkr.productIdx].owner.id,
            sortOrder: ki,
          },
        });
        krCount++;
      }
    }
  }

  // ── Create Department OKRs ───────────────────────────────────
  for (const dOkr of deptOKRs) {
    const dept = departments[dOkr.deptIdx];
    for (let oi = 0; oi < dOkr.objectives.length; oi++) {
      const obj = dOkr.objectives[oi];
      const objective = await prisma.objective.create({
        data: {
          orgId: org.id,
          entityType: "DEPARTMENT",
          departmentId: dept.id,
          title: obj.title,
          why: obj.why,
          quarter: obj.quarter,
          year: 2026,
          sortOrder: oi,
        },
      });
      objectiveIds.push(objective.id);

      for (let ki = 0; ki < obj.krs.length; ki++) {
        const kr = obj.krs[ki];
        await prisma.keyResult.create({
          data: {
            orgId: org.id,
            objectiveId: objective.id,
            title: kr.title,
            krType: kr.type,
            target: kr.target ?? null,
            targetUnit: kr.unit ?? null,
            targetDate: kr.targetDate ?? null,
            isInverse: kr.isInverse ?? false,
            ownerId: deptsData[dOkr.deptIdx].owner.id,
            sortOrder: ki,
          },
        });
        krCount++;
      }
    }
  }

  // ── Company-level Strategic OKRs ─────────────────────────────
  // 4 company objectives that cascade into dept/product objectives
  const companyOKRs: ObjDef[] = [
    {
      title: "Devenir le leader fintech en Afrique de l'Ouest",
      why: "Vision 2027 : IziChange doit dominer le march\u00e9 crypto UEMOA",
      quarter: "Q1",
      krs: [
        { title: "Part de march\u00e9 crypto UEMOA > 25%", type: "PERCENTAGE", target: 25, unit: "%" },
        { title: "Pr\u00e9sence dans 3 pays (B\u00e9nin, Togo, C\u00f4te d'Ivoire)", type: "NUMERIC", target: 3, unit: "pays" },
        { title: "Revenu annuel r\u00e9current > 500K$", type: "NUMERIC", target: 500000, unit: "$" },
      ],
    },
    {
      title: "Atteindre l'excellence op\u00e9rationnelle",
      why: "La croissance sans structure op\u00e9rationnelle cr\u00e9e du chaos",
      quarter: "Q2",
      krs: [
        { title: "Score satisfaction client global > 85%", type: "PERCENTAGE", target: 85, unit: "%" },
        { title: "Taux de saisie OKR hebdo > 95%", type: "PERCENTAGE", target: 95, unit: "%" },
        { title: "D\u00e9lai moyen de d\u00e9cision CODIR < 48h", type: "NUMERIC", target: 48, unit: "heures", isInverse: true },
      ],
    },
    {
      title: "S\u00e9curiser le financement de la croissance",
      why: "Sans financement, la roadmap 2027 est compromise",
      quarter: "Q2",
      krs: [
        { title: "Tour de table Series A cl\u00f4tur\u00e9", type: "BINARY" },
        { title: "Runway > 18 mois post-lev\u00e9e", type: "NUMERIC", target: 18, unit: "mois" },
        { title: "Unit economics positif sur 3 produits", type: "NUMERIC", target: 3, unit: "produits" },
      ],
    },
    {
      title: "B\u00e2tir une \u00e9quipe world-class",
      why: "Le talent est le facteur limitant #1 de la croissance",
      quarter: "Q3",
      krs: [
        { title: "Taux de r\u00e9tention > 90%", type: "PERCENTAGE", target: 90, unit: "%" },
        { title: "eNPS > 50", type: "NUMERIC", target: 50, unit: "points" },
        { title: "100% des postes cl\u00e9s pourvus", type: "PERCENTAGE", target: 100, unit: "%" },
      ],
    },
  ];

  let companyObjCount = 0;
  for (let ci = 0; ci < companyOKRs.length; ci++) {
    const obj = companyOKRs[ci];
    const companyObjective = await prisma.objective.create({
      data: {
        orgId: org.id,
        entityType: "COMPANY",
        title: obj.title,
        why: obj.why,
        quarter: obj.quarter,
        year: 2026,
        sortOrder: ci,
      },
    });

    for (let ki = 0; ki < obj.krs.length; ki++) {
      const kr = obj.krs[ki];
      await prisma.keyResult.create({
        data: {
          orgId: org.id,
          objectiveId: companyObjective.id,
          title: kr.title,
          krType: kr.type,
          target: kr.target ?? null,
          targetUnit: kr.unit ?? null,
          targetDate: kr.targetDate ?? null,
          isInverse: kr.isInverse ?? false,
          ownerId: ceo.id,
          sortOrder: ki,
        },
      });
      krCount++;
    }

    // Link some existing objectives as children of company objectives
    // Obj 0 "Leader fintech" → P1 obj 0, P2 obj 0, P3 obj 0
    // Obj 1 "Excellence ops" → D5 obj 0, D7 obj 0
    // Obj 2 "Financement" → D3 obj 1, P4 obj 2
    // Obj 3 "Equipe" → D8 obj 0, D8 obj 2
    const childLinks: Record<number, number[]> = {
      0: [0, 3, 6],     // P1-obj0, P2-obj0, P3-obj0
      1: [33, 39],       // D5-obj0, D7-obj0
      2: [28, 8],        // D3-obj1, P4-obj2
      3: [42, 44],       // D8-obj0, D8-obj2
    };
    const children = childLinks[ci] || [];
    for (const childIdx of children) {
      if (objectiveIds[childIdx]) {
        await prisma.objective.update({
          where: { id: objectiveIds[childIdx] },
          data: { parentId: companyObjective.id },
        });
      }
    }
    companyObjCount++;
  }

  // ── Actions (sample data) ──────────────────────────────────────
  // Fetch some KRs to attach actions to
  const sampleKrs = await prisma.keyResult.findMany({
    where: { orgId: org.id },
    take: 10,
    orderBy: { createdAt: "asc" },
    select: { id: true, ownerId: true },
  });

  const actionData: {
    krIdx: number;
    title: string;
    status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate?: Date;
  }[] = [
    // P1 KRs
    { krIdx: 0, title: "Intégrer API Binance spot", status: "DONE", priority: "HIGH", dueDate: new Date("2026-03-15") },
    { krIdx: 0, title: "Tester le matching engine en staging", status: "IN_PROGRESS", priority: "HIGH", dueDate: new Date("2026-04-25") },
    { krIdx: 0, title: "Campagne onboarding 100 premiers traders", status: "TODO", priority: "MEDIUM", dueDate: new Date("2026-05-10") },
    { krIdx: 1, title: "Optimiser les requêtes WebSocket", status: "IN_PROGRESS", priority: "MEDIUM" },
    { krIdx: 1, title: "Mettre en place le monitoring Datadog", status: "DONE", priority: "HIGH" },
    { krIdx: 2, title: "Préparer le dossier BCEAO", status: "BLOCKED", priority: "URGENT", dueDate: new Date("2026-04-20") },
    { krIdx: 2, title: "Réunion avec le cabinet juridique", status: "DONE", priority: "HIGH" },
    // P2 KRs
    { krIdx: 3, title: "Landing page referral program", status: "IN_PROGRESS", priority: "MEDIUM", dueDate: new Date("2026-04-30") },
    { krIdx: 3, title: "A/B test onboarding flow", status: "TODO", priority: "LOW" },
    { krIdx: 4, title: "Négocier frais avec Orange Money", status: "IN_PROGRESS", priority: "HIGH", dueDate: new Date("2026-05-01") },
    { krIdx: 4, title: "Benchmark frais concurrents", status: "DONE", priority: "MEDIUM" },
    // P3 KRs
    { krIdx: 5, title: "Partenariat agence Century21 Cotonou", status: "IN_PROGRESS", priority: "HIGH" },
    { krIdx: 6, title: "Optimiser SEO pages annonces", status: "TODO", priority: "MEDIUM" },
    { krIdx: 6, title: "Simplifier le formulaire publication", status: "DONE", priority: "HIGH" },
    // D1 KRs
    { krIdx: 7, title: "Campagne Instagram Q2", status: "IN_PROGRESS", priority: "MEDIUM", dueDate: new Date("2026-04-28") },
    { krIdx: 7, title: "Produire 10 vidéos témoignages", status: "TODO", priority: "LOW", dueDate: new Date("2026-05-30") },
    { krIdx: 8, title: "Configurer tracking UTM complet", status: "DONE", priority: "MEDIUM" },
    { krIdx: 8, title: "Lancer campagne Google Ads Bénin", status: "BLOCKED", priority: "URGENT", dueDate: new Date("2026-04-22") },
    { krIdx: 9, title: "Évaluer HubSpot vs Brevo", status: "CANCELLED", priority: "LOW" },
  ];

  let actionCount = 0;
  for (const a of actionData) {
    const kr = sampleKrs[a.krIdx];
    if (!kr) continue;
    const action = await prisma.action.create({
      data: {
        orgId: org.id,
        krId: kr.id,
        title: a.title,
        assigneeId: kr.ownerId,
        createdById: kr.ownerId,
        status: a.status,
        priority: a.priority,
        dueDate: a.dueDate ?? null,
        completedAt: a.status === "DONE" ? new Date() : null,
        weekCreated: 14,
        weekCompleted: a.status === "DONE" ? 16 : null,
      },
    });

    // Add a sample comment on some actions
    if (actionCount % 3 === 0) {
      await prisma.actionComment.create({
        data: {
          actionId: action.id,
          authorId: kr.ownerId,
          content: "Mise à jour : progression en cours, RAS.",
        },
      });
    }
    actionCount++;
  }

  // ── Department Members ────────────────────────────────────────
  // Assign users to departments (owner as LEAD + some cross-members)
  const memberAssignments: { deptIdx: number; userId: string; role: string }[] = [
    // Each dept owner is LEAD of their department
    { deptIdx: 0, userId: poMarketing.id, role: "LEAD" },
    { deptIdx: 1, userId: poIT.id, role: "LEAD" },
    { deptIdx: 2, userId: poFinance.id, role: "LEAD" },
    { deptIdx: 3, userId: poLegal.id, role: "LEAD" },
    { deptIdx: 4, userId: poSupport.id, role: "LEAD" },
    { deptIdx: 5, userId: poStrategie.id, role: "LEAD" },
    { deptIdx: 6, userId: mgmt1.id, role: "LEAD" },
    { deptIdx: 7, userId: poRH.id, role: "LEAD" },
    // Cross-functional members
    { deptIdx: 0, userId: poIT.id, role: "MEMBER" },          // IT supports Marketing
    { deptIdx: 0, userId: poStrategie.id, role: "MEMBER" },   // Stratégie in Marketing
    { deptIdx: 1, userId: poTrading.id, role: "MEMBER" },     // PO Trading in IT
    { deptIdx: 1, userId: poWallet.id, role: "MEMBER" },      // PO Wallet in IT
    { deptIdx: 1, userId: poPay.id, role: "MEMBER" },         // PO Pay in IT
    { deptIdx: 2, userId: poLegal.id, role: "MEMBER" },       // Legal in Finance
    { deptIdx: 2, userId: mgmt1.id, role: "MEMBER" },         // Dir Ops in Finance
    { deptIdx: 3, userId: poFinance.id, role: "MEMBER" },     // Finance in Legal
    { deptIdx: 4, userId: poMarketing.id, role: "MEMBER" },   // Marketing in Support
    { deptIdx: 5, userId: ceo.id, role: "MEMBER" },           // CEO in Stratégie
    { deptIdx: 5, userId: mgmt1.id, role: "MEMBER" },         // Dir Tech in Stratégie
    { deptIdx: 6, userId: ceo.id, role: "MEMBER" },           // CEO in Management
    { deptIdx: 6, userId: mgmt1.id, role: "MEMBER" },         // Dir Ops in Management
    { deptIdx: 6, userId: mgmt1.id, role: "MEMBER" },         // Dir Tech in Management
    { deptIdx: 7, userId: mgmt1.id, role: "MEMBER" },         // Dir Ops in RH
  ];

  let memberCount = 0;
  for (const ma of memberAssignments) {
    await prisma.departmentMember.create({
      data: {
        departmentId: departments[ma.deptIdx].id,
        userId: ma.userId,
        role: ma.role,
      },
    });
    memberCount++;
  }

  console.log(`✅ Seeded: 1 org, ${users.length} users, ${products.length} products, ${departments.length} departments, ${krCount} key results, ${actionCount} actions, ${memberCount} department members`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
