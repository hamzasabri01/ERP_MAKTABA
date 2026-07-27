const fs = require("fs");
const path = require("path");
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");

const ROOT = __dirname;
const DOCS = path.join(ROOT, "docs");
const ASSETS = path.join(DOCS, "assets", "pfe");
const OUTPUT = path.join(DOCS, "PFE_RAPPORT_PROERP_PROFESSIONNEL_60P.docx");

const COLORS = {
  navy: "17365D",
  blue: "1F4E79",
  mediumBlue: "2E75B6",
  lightBlue: "D9EAF7",
  paleBlue: "EEF5FC",
  green: "15803D",
  gray: "F3F6FA",
  dark: "111827",
  white: "FFFFFF",
  red: "991B1B",
};

const pageMargin = {
  top: 850,
  bottom: 850,
  left: 850,
  right: 850,
};

function polishFrench(text, opts = {}) {
  if (opts.font === "Consolas") return text;
  const replacements = [
    [/\bSecurisation\b/g, "Sécurisation"],
    [/\bsecurisation\b/g, "sécurisation"],
    [/\bSecurite\b/g, "Sécurité"],
    [/\bsecurite\b/g, "sécurité"],
    [/\bCybersecurite\b/g, "Cybersécurité"],
    [/\bcybersecurite\b/g, "cybersécurité"],
    [/\bmatieres\b/g, "matières"],
    [/\bResume\b/g, "Résumé"],
    [/\bexecutif\b/g, "exécutif"],
    [/\bgenerale\b/g, "générale"],
    [/\bpresentation\b/g, "présentation"],
    [/\bpresents\b/g, "présents"],
    [/\bpresente\b/g, "présente"],
    [/\brealisee\b/g, "réalisée"],
    [/\breel\b/g, "réel"],
    [/\brealisation\b/g, "réalisation"],
    [/\brealiser\b/g, "réaliser"],
    [/\bdecision\b/g, "décision"],
    [/\beviter\b/g, "éviter"],
    [/\bgerer\b/g, "gérer"],
    [/\bidentites\b/g, "identités"],
    [/\bidentite\b/g, "identité"],
    [/\bAcces\b/g, "Accès"],
    [/\betat\b/g, "état"],
    [/\bacces\b/g, "accès"],
    [/\bassocie\b/g, "associé"],
    [/\bassocié a\b/g, "associé à"],
    [/\ba citer\b/g, "à citer"],
    [/\ba reproduire\b/g, "à reproduire"],
    [/\ba conserver\b/g, "à conserver"],
    [/\ba empêcher\b/g, "à empêcher"],
    [/\bmeme\b/g, "même"],
    [/\bverifiable\b/g, "vérifiable"],
    [/\bcoherent\b/g, "cohérent"],
    [/\bexpose\b/g, "exposé"],
    [/\bIntegrite\b/g, "Intégrité"],
    [/\bAmelioration\b/g, "Amélioration"],
    [/\bapplique\b/g, "appliqué"],
    [/\bLe projet appliqué\b/g, "Le projet applique"],
    [/\bprotege\b/g, "protège"],
    [/\bseparation\b/g, "séparation"],
    [/\bcontrole\b/g, "contrôle"],
    [/\bcontroler\b/g, "contrôler"],
    [/\bcontrolee\b/g, "contrôlée"],
    [/\bcontroles\b/g, "contrôles"],
    [/\bControle\b/g, "Contrôle"],
    [/\bautorise\b/g, "autorisé"],
    [/\bautorisee\b/g, "autorisée"],
    [/\bnon autorisé/g, "non autorisé"],
    [/\blegitime\b/g, "légitime"],
    [/\blimite\b/g, "limité"],
    [/\breservee\b/g, "réservée"],
    [/\bprivilege\b/g, "privilège"],
    [/\breponse\b/g, "réponse"],
    [/\bReponse\b/g, "Réponse"],
    [/\belements\b/g, "éléments"],
    [/\bcritere\b/g, "critère"],
    [/\betre\b/g, "être"],
    [/\bcompletees\b/g, "complétées"],
    [/\bseparer\b/g, "séparer"],
    [/\bdeveloppement\b/g, "développement"],
    [/\bpreproduction\b/g, "préproduction"],
    [/\bmelangent\b/g, "mélangent"],
    [/\bempecher\b/g, "empêcher"],
    [/\bcroises\b/g, "croisés"],
    [/\bentree\b/g, "entrée"],
    [/\bresultat\b/g, "résultat"],
    [/\bcoherents\b/g, "cohérents"],
    [/\bsucces\b/g, "succès"],
    [/\bdetaillee\b/g, "détaillée"],
    [/\bperiodique\b/g, "périodique"],
    [/\bbasee\b/g, "basée"],
    [/\bbase sur\b/g, "basé sur"],
    [/\bbases sur\b/g, "basés sur"],
    [/\bcomposee\b/g, "composée"],
    [/\bdonnees\b/g, "données"],
    [/\becran\b/g, "écran"],
    [/\bpartages\b/g, "partagés"],
    [/\bexposee\b/g, "exposée"],
    [/\bliee\b/g, "liée"],
    [/\bautomatisees\b/g, "automatisées"],
    [/\btraite\b/g, "traité"],
    [/\bImplementation\b/g, "Implémentation"],
    [/\bModele\b/g, "Modèle"],
    [/\bauthentifiee\b/g, "authentifiée"],
    [/\bCreation\b/g, "Création"],
    [/\ba une\b/g, "à une"],
    [/\ba un\b/g, "à un"],
    [/\ba la\b/g, "à la"],
    [/\ba l'/g, "à l'"],
    [/\ba chaque\b/g, "à chaque"],
    [/\ba partir\b/g, "à partir"],
    [/\ba attribuer\b/g, "à attribuer"],
    [/\bMots-cles\b/g, "Mots-clés"],
    [/\bDefinition\b/g, "Définition"],
    [/\boperationnelles\b/g, "opérationnelles"],
    [/\boperations\b/g, "opérations"],
    [/\bsystemes\b/g, "systèmes"],
    [/\bevenements\b/g, "événements"],
    [/\bevenement\b/g, "événement"],
    [/\bdeploiement\b/g, "déploiement"],
    [/\bsecurise\b/g, "sécurisé"],
    [/\bsecurisee\b/g, "sécurisée"],
    [/\bsecuriser\b/g, "sécuriser"],
    [/\breseau\b/g, "réseau"],
    [/\breseaux\b/g, "réseaux"],
    [/\bregles\b/g, "règles"],
    [/\brequetes\b/g, "requêtes"],
    [/\brequete\b/g, "requête"],
    [/\brole\b/g, "rôle"],
    [/\broles\b/g, "rôles"],
    [/\bherite\b/g, "hérite"],
    [/\breduit\b/g, "réduit"],
    [/\breduire\b/g, "réduire"],
    [/\brisque\b/g, "risque"],
    [/\brisques\b/g, "risques"],
    [/\bmetier\b/g, "métier"],
    [/\bparametres\b/g, "paramètres"],
    [/\bdepenses\b/g, "dépenses"],
    [/\bpriorite\b/g, "priorité"],
    [/\bproblematique\b/g, "problématique"],
    [/\btraceabilite\b/g, "traçabilité"],
    [/\btracabilite\b/g, "traçabilité"],
    [/\bprocedures\b/g, "procédures"],
    [/\bprocedure\b/g, "procédure"],
    [/\bscenario\b/g, "scénario"],
    [/\bscenarios\b/g, "scénarios"],
    [/\bmultifacteur\b/g, "multifacteur"],
    [/\bsigne\b/g, "signé"],
    [/\butilise\b/g, "utilisé"],
    [/\butilisee\b/g, "utilisée"],
    [/\bintermediaire\b/g, "intermédiaire"],
    [/\bintegrite\b/g, "intégrité"],
    [/\bconfidentialite\b/g, "confidentialité"],
    [/\bdisponibilite\b/g, "disponibilité"],
    [/\bexploitation\b/g, "exploitation"],
    [/\bplanifiees\b/g, "planifiées"],
    [/\bverifiees\b/g, "vérifiées"],
    [/\bverifie\b/g, "vérifié"],
    [/\bverification\b/g, "vérification"],
    [/\bimplemente\b/g, "implémenté"],
    [/\bimplementation\b/g, "implémentation"],
  ];
  return replacements
    .reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text)
    .replace(/Le projet appliqué/g, "Le projet applique");
}

function textRun(text, opts = {}) {
  return new TextRun({
    text: polishFrench(text, opts),
    font: opts.font || "Arial",
    size: opts.size || 22,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || COLORS.dark,
    underline: opts.underline,
    language: { value: "fr-FR" },
    noProof: opts.noProof ?? true,
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { before: opts.before ?? 70, after: opts.after ?? 70, line: opts.line ?? 276 },
    children: [textRun(text, opts.run || {})],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { before: 160, after: 180 },
    shading: { fill: COLORS.navy, type: ShadingType.CLEAR },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.mediumBlue } },
    children: [textRun(text, { bold: true, color: COLORS.white, size: 30 })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 110 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: COLORS.mediumBlue, space: 2 } },
    children: [textRun(text, { bold: true, color: COLORS.blue, size: 26 })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 150, after: 70 },
    children: [textRun(text, { bold: true, color: COLORS.mediumBlue, size: 23 })],
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 35, after: 35, line: 260 },
    children: [textRun(text)],
  });
}

function codeLine(text) {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 230 },
    shading: { fill: "F1F5F9", type: ShadingType.CLEAR },
    children: [textRun(text, { font: "Consolas", size: 18, color: "0F172A" })],
  });
}

function table(headers, rows, widths = []) {
  const colWidths = widths.length ? widths : headers.map(() => Math.floor(9000 / headers.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: "B8C6D9" };
  const borders = { top: border, bottom: border, left: border, right: border, insideH: border, insideV: border };

  const makeCell = (content, width, header = false, shade = false) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: { top: 90, bottom: 90, left: 120, right: 120 },
      borders,
      shading: { fill: header ? COLORS.mediumBlue : shade ? COLORS.gray : COLORS.white, type: ShadingType.CLEAR },
      children: [
        new Paragraph({
          alignment: header ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [textRun(String(content), { bold: header, color: header ? COLORS.white : COLORS.dark, size: header ? 20 : 19 })],
        }),
      ],
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((header, i) => makeCell(header, colWidths[i], true)) }),
      ...rows.map((row, ri) => new TableRow({ children: row.map((cell, i) => makeCell(cell, colWidths[i], false, ri % 2 === 1)) })),
    ],
  });
}

function image(pathName, caption, width = 590, height = 410) {
  const requestedPath = path.join(ASSETS, pathName);
  const pngFallback = pathName.toLowerCase().endsWith(".svg")
    ? path.join(ASSETS, pathName.replace(/\.svg$/i, ".png"))
    : null;
  const imagePath = pngFallback && fs.existsSync(pngFallback) ? pngFallback : requestedPath;
  if (!fs.existsSync(imagePath)) {
    return [p(`Figure manquante: ${pathName}`, { run: { italics: true, color: COLORS.red } })];
  }
  const extension = path.extname(imagePath).toLowerCase().replace(".", "");
  const type = extension === "jpg" ? "jpg" : extension === "jpeg" ? "jpg" : extension === "png" ? "png" : undefined;
  if (!type) {
    return [p(`Format image non supporte dans le DOCX: ${path.basename(imagePath)}`, { run: { italics: true, color: COLORS.red } })];
  }
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 80 },
      children: [
        new ImageRun({
          type,
          data: fs.readFileSync(imagePath),
          transformation: { width, height },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 130 },
      children: [textRun(caption, { italics: true, color: "475569", size: 19 })],
    }),
  ];
}

function codeBlock(title, lines) {
  const content = [h3(title)];
  for (const line of lines) content.push(codeLine(line));
  return content;
}

function topicProfile(topic) {
  const t = topic.toLowerCase();
  if (t.includes("mot de passe") || t.includes("brute force") || t.includes("authentification") || t.includes("mfa") || t.includes("totp") || t.includes("jwt") || t.includes("erreurs d'authentification")) {
    return "identity";
  }
  if (t.includes("privileges") || t.includes("permissions") || t.includes("rbac") || t.includes("routes") || t.includes("settings") || t.includes("acces non autorise") || t.includes("cashier")) {
    return "access";
  }
  if (t.includes("audit") || t.includes("journal") || t.includes("logs") || t.includes("siem") || t.includes("monitoring") || t.includes("supervision") || t.includes("ips") || t.includes("user agents") || t.includes("hash-chain")) {
    return "monitoring";
  }
  if (t.includes("cors") || t.includes("backend") || t.includes("headers") || t.includes("clickjacking") || t.includes("mime") || t.includes("referrer") || t.includes("permissions-policy") || t.includes("owasp")) {
    return "appsec";
  }
  if (t.includes("cloud") || t.includes("proxy") || t.includes("tls") || t.includes("docker") || t.includes("volumes") || t.includes("postgre") || t.includes("waf") || t.includes("certificats") || t.includes("migration")) {
    return "cloud";
  }
  if (t.includes("sauvegarde") || t.includes("backup") || t.includes("restauration") || t.includes("incident") || t.includes("secrets") || t.includes("production")) {
    return "resilience";
  }
  if (t.includes("documentation") || t.includes("soutenance") || t.includes("jury") || t.includes("roadmap") || t.includes("checklist") || t.includes("demo")) {
    return "governance";
  }
  return "general";
}

const OPERATIONAL_CONTENT = {
  identity: {
    risk: "Le risque principal concerne l'usurpation d'identite: un attaquant qui obtient un mot de passe peut tenter d'ouvrir une session, d'utiliser l'API et d'acceder a des fonctions ERP sensibles.",
    implementation: "Dans ProERP Web, la reponse combine la politique de mots de passe, le hachage cote serveur, le rate limiting sur le login, le jeton JWT et le flux MFA/TOTP pour ajouter une preuve supplementaire de possession.",
    cloud: "En environnement Cloud, cette partie doit rester independante du poste utilisateur: les secrets sont places en variables d'environnement, les connexions passent par HTTPS et les journaux d'authentification sont conserves pour analyse.",
    validation: "Le test consiste a provoquer un echec de connexion, a verifier le blocage progressif, puis a confirmer que le compte avec MFA exige un code temporaire valide avant de recevoir le token d'acces.",
    rows: [
      ["Actif critique", "Identite utilisateur, session JWT, secret TOTP, compte administrateur"],
      ["Controle applique", "Politique mot de passe, hash, rate limiting, MFA, expiration token"],
      ["Preuve attendue", "Challenge MFA, code HTTP coherent, log d'echec ou de succes"],
      ["Amelioration", "MFA obligatoire pour les roles admin et rotation controlee des secrets"],
    ],
  },
  access: {
    risk: "Le risque principal est le contournement d'autorisation: un utilisateur legitime mais limite peut essayer d'appeler directement une route API reservee a l'administration.",
    implementation: "Le projet applique le principe du moindre privilege avec des roles distincts, des controles backend et une interface React qui adapte les actions visibles sans remplacer la decision serveur.",
    cloud: "Dans le Cloud, les restrictions applicatives doivent etre completees par des regles reseau: le backend n'est pas expose inutilement et seules les routes publiques passent par le reverse proxy.",
    validation: "La validation repose sur des essais croises: connexion avec un compte cashier, appel d'une route admin, verification d'un refus 403, puis controle que l'administrateur conserve le droit attendu.",
    rows: [
      ["Actif critique", "Routes API, profils utilisateurs, operations de gestion et de reporting"],
      ["Controle applique", "RBAC backend, separation admin/cashier, menus frontend coherents"],
      ["Preuve attendue", "Reponse 403 pour profil non autorise et succes pour profil admin"],
      ["Amelioration", "Matrice IAM detaillee et revue periodique des permissions"],
    ],
  },
  monitoring: {
    risk: "Le risque concerne le manque de visibilite: sans logs fiables, une tentative d'intrusion, une action anormale ou une modification sensible peut passer inapercue.",
    implementation: "ProERP Web centralise des evenements de securite dans le Security Center, affiche des indicateurs utiles et preserve la tracabilite des actions comme l'activation ou la desactivation MFA.",
    cloud: "Dans une exploitation Cloud, ces traces doivent etre exportables vers une solution SIEM ou un service de monitoring pour permettre la correlation, l'alerte et la conservation longue duree.",
    validation: "Le controle se teste en generant volontairement des actions: connexion, echec, changement MFA, acces refuse et consultation du Security Center afin de verifier la presence des evenements.",
    rows: [
      ["Actif critique", "Logs d'audit, evenements securite, preuves de conformite"],
      ["Controle applique", "Journalisation, Security Center, hash-chain, indicateurs MFA"],
      ["Preuve attendue", "Evenement horodate avec utilisateur, adresse IP et description"],
      ["Amelioration", "Export SIEM, alertes temps reel et conservation centralisee"],
    ],
  },
  appsec: {
    risk: "Le risque vient d'une mauvaise configuration applicative: origine CORS trop large, en-tetes absents, erreurs exposees ou route backend accessible hors du chemin prevu.",
    implementation: "Le durcissement ajoute des en-tetes de securite, limite les origines autorisees, documente les endpoints sensibles et garde les controles essentiels dans FastAPI.",
    cloud: "Lors du deploiement, le reverse proxy prend en charge HTTPS, la politique CORS reste explicite et les regles firewall reduisent la surface exposee a Internet.",
    validation: "Le test consiste a inspecter les reponses HTTP, verifier les en-tetes, tester une origine non autorisee et confirmer que les routes sensibles refusent l'acces non authentifie.",
    rows: [
      ["Actif critique", "API FastAPI, navigateur client, endpoints sensibles"],
      ["Controle applique", "Security headers, CORS strict, authentification obligatoire"],
      ["Preuve attendue", "Headers visibles et refus d'appel depuis une origine non prevue"],
      ["Amelioration", "WAF, scan OWASP ZAP et politique CSP plus stricte"],
    ],
  },
  cloud: {
    risk: "Le risque est une infrastructure fonctionnelle mais fragile: ports trop ouverts, conteneurs mal isoles, absence de TLS ou dependance a une base locale non adaptee a la production.",
    implementation: "Le rapport propose une architecture Cloud progressive avec frontend, backend, base de donnees, reverse proxy, variables d'environnement, volumes et supervision.",
    cloud: "Cette partie relie directement le projet a la Licence: elle montre comment passer d'une application locale vers une exploitation Cloud securisee et documentee.",
    validation: "La validation se fait par verification des ports exposes, controle de la communication frontend/backend, test HTTPS, lecture des logs et controle de persistance des donnees.",
    rows: [
      ["Actif critique", "Conteneurs, reseau, base de donnees, certificats, volumes"],
      ["Controle applique", "Reverse proxy, TLS, firewall, isolation Docker, variables env"],
      ["Preuve attendue", "Application accessible via HTTPS et backend non expose directement"],
      ["Amelioration", "PostgreSQL manage, sauvegardes chiffrees et haute disponibilite"],
    ],
  },
  resilience: {
    risk: "Le risque majeur est l'indisponibilite ou la perte de donnees apres erreur humaine, compromission, panne serveur ou mauvaise manipulation d'un secret.",
    implementation: "Le projet documente les sauvegardes, la rotation des secrets, les procedures de restauration et les controles permettant d'identifier une action sensible.",
    cloud: "Dans le Cloud, la resilience depend aussi des volumes persistants, de la separation des secrets, du stockage externe des backups et d'un plan de reprise teste regulierement.",
    validation: "Le test attendu consiste a simuler une restauration, verifier que les donnees critiques reviennent correctement et confirmer que l'incident laisse une trace exploitable.",
    rows: [
      ["Actif critique", "Base de donnees, secrets, fichiers de configuration, journaux"],
      ["Controle applique", "Backup, restauration, rotation secret, limitation des acces"],
      ["Preuve attendue", "Sauvegarde exploitable et procedure de reprise reproductible"],
      ["Amelioration", "Chiffrement backup, stockage hors site et tests PRA planifies"],
    ],
  },
  governance: {
    risk: "Le risque est de livrer une solution techniquement correcte mais difficile a maintenir, expliquer ou auditer par une autre personne apres la fin du PFE.",
    implementation: "La documentation relie les exigences, le code, les captures, les tests et les limites pour montrer une demarche professionnelle et transmissible.",
    cloud: "En contexte Cloud, la gouvernance impose des checklists: comptes, secrets, sauvegardes, monitoring, couts, certificats, ports, roles et responsabilites.",
    validation: "La validation se fait par revue documentaire: chaque mecanisme doit avoir une justification, un fichier source, une preuve visuelle et un test associe.",
    rows: [
      ["Actif critique", "Documentation, procedures, preuves, plan de soutenance"],
      ["Controle applique", "Checklist, matrice tests, architecture, glossaire, limites"],
      ["Preuve attendue", "Rapport coherent et demonstration reproductible devant le jury"],
      ["Amelioration", "Runbook d'exploitation et guide d'administration versionne"],
    ],
  },
  general: {
    risk: "Le risque est traite comme un scenario transversal qui touche a la fois les utilisateurs, l'API, les donnees ERP et l'environnement de deploiement.",
    implementation: "La solution s'appuie sur les briques deja implementees: authentification, roles, MFA, audit, Security Center, en-tetes HTTP et preparation Cloud.",
    cloud: "Le lien Cloud reste essentiel, car un controle efficace localement doit rester fiable une fois l'application exposee derriere un proxy et une configuration reseau.",
    validation: "La preuve combine un test fonctionnel, un resultat observable dans l'interface, un comportement API et une trace de securite.",
    rows: [
      ["Actif critique", "Application ERP, comptes, API, logs et infrastructure"],
      ["Controle applique", "Defense en profondeur et verification par scenario"],
      ["Preuve attendue", "Capture, code, log ou resultat HTTP associe"],
      ["Amelioration", "Industrialisation progressive selon les priorites de risque"],
    ],
  },
};

function cleanTopic(topic) {
  return topic.replace(/^\d+\.\s*/, "").trim();
}

function tocEntry(title, page) {
  return new Paragraph({
    spacing: { before: 35, after: 35, line: 240 },
    tabStops: [{ type: "right", position: 9020 }],
    children: [
      textRun(title, { size: 20 }),
      textRun("\t" + page, { size: 20, bold: true, color: COLORS.blue }),
    ],
  });
}

function manualTableOfContents() {
  const entries = [
    ["Résumé exécutif", 3],
    ["1. Introduction générale", 4],
    ["2. Présentation de ProERP Web", 6],
    ["3. Contexte cybersécurité et Cloud Computing", 8],
    ["4. Architecture de la solution", 10],
    ["5. IAM et gestion des identités", 12],
    ["6. RBAC et principe du moindre privilège", 14],
    ["7. Authentification multifacteur MFA/TOTP", 17],
    ["8. Sécurisation JWT et sessions", 20],
    ["9. Journalisation, audit logs et intégrité", 23],
    ["10. Security Center et monitoring", 26],
    ["11. Sécurité réseau, CORS et headers HTTP", 29],
    ["12. Déploiement Cloud sécurisé", 32],
    ["13. Plan de tests et validation", 36],
    ["14. Threat modeling STRIDE et OWASP", 40],
    ["15. Dossiers opérationnels", 44],
    ["16. Perspectives d'évolution", 58],
    ["Conclusion générale", 62],
    ["Glossaire", 64],
  ];
  return [
    h1("Table des matières"),
    p("Le sommaire ci-dessous présente la structure du rapport. Les pages sont indicatives et peuvent varier légèrement après modification dans Microsoft Word.", { run: { italics: true, color: "475569" } }),
    ...entries.map(([title, page]) => tocEntry(title, page)),
  ];
}

function repeatAnalysis(rawTopic, index) {
  const topic = cleanTopic(rawTopic);
  const profileName = topicProfile(topic);
  const profile = OPERATIONAL_CONTENT[profileName];
  const controlMap = {
    identity: "backend/api/routes/auth.py, backend/core/security.py et frontend/src/pages/LoginPage.jsx",
    access: "backend/api/routes/users.py, backend/api/schemas.py et frontend/src/components/layout/Layout.jsx",
    monitoring: "backend/api/routes/security_center.py, journaux applicatifs et page Security Center",
    appsec: "backend/main.py, configuration CORS, middleware HTTP et routes FastAPI",
    cloud: "plan de deploiement, reverse proxy, variables d'environnement et volumes persistants",
    resilience: "procedures de sauvegarde, restauration, rotation des secrets et plan de reprise",
    governance: "docs/PFE_SECURITE_CLOUD.md, docs/PFE_PLAN_TESTS_SECURITE.md et rapport final",
    general: "backend, frontend, documentation et plan de tests",
  };
  const scenarioAngles = {
    identity: [
      `L'attaque consideree est une tentative d'ouverture de session a partir d'identifiants voles ou devines. Le controle attendu doit ralentir l'attaque, reduire l'impact du mot de passe compromis et produire une trace exploitable.`,
      `Le scenario prend en compte le comportement d'un utilisateur reel: erreur de saisie, oubli du code temporaire, changement de poste ou activation MFA depuis le profil.`,
      `L'analyse distingue l'identification, l'authentification et la session. Cette separation aide a expliquer pourquoi le mot de passe seul ne suffit pas dans une application ERP exposee.`,
    ],
    access: [
      `Le scenario verifie qu'un compte limite ne peut pas obtenir plus de droits en modifiant l'interface ou en appelant directement l'API avec un outil externe.`,
      `La logique retenue protege les fonctions d'administration, les rapports et les parametres car ces zones peuvent modifier le comportement global de l'ERP.`,
      `Le controle est pense pour une petite organisation: les roles restent simples, mais les decisions d'autorisation sont centralisees cote backend.`,
    ],
    monitoring: [
      `Le scenario cherche a transformer une action technique en evenement comprehensible: qui a fait quoi, quand, depuis quelle adresse et avec quel resultat.`,
      `La supervision n'est pas limitee a l'affichage d'une page. Elle sert a preparer une exploitation Cloud ou les logs deviennent une source de detection et d'audit.`,
      `Le Security Center joue le role de tableau de bord pedagogique: il rend visibles les controles qui seraient normalement disperses dans des fichiers de logs.`,
    ],
    appsec: [
      `Le scenario part d'une mauvaise configuration classique: navigateur non fiable, origine externe, en-tete absent ou route exposee sans verification suffisante.`,
      `La protection applicative complete l'IAM. Meme avec de bons roles, une API mal configuree peut exposer des informations ou accepter des appels inattendus.`,
      `Le durcissement reste volontairement lisible pour la soutenance: chaque en-tete ou restriction peut etre montre avec une requete HTTP simple.`,
    ],
    cloud: [
      `Le scenario represente le passage de la maquette locale vers un environnement Cloud plus proche de la production avec proxy, TLS, ports controles et base persistante.`,
      `La conception evite de melanger code et infrastructure. Les secrets, les ports, les certificats et les volumes sont traites comme des elements de configuration.`,
      `L'objectif n'est pas de surdimensionner l'architecture, mais de montrer une trajectoire realiste depuis le prototype vers une exploitation securisee.`,
    ],
    resilience: [
      `Le scenario suppose qu'un incident arrive: erreur humaine, compte compromis, suppression de donnees, secret expose ou indisponibilite temporaire du serveur.`,
      `La securite ne se limite pas a empecher l'attaque. Elle doit aussi permettre de comprendre l'incident, restaurer le service et reduire les pertes.`,
      `Les procedures proposees donnent une methode reproductible, ce qui est indispensable dans un contexte Cloud ou l'exploitation peut etre reprise par une autre personne.`,
    ],
    governance: [
      `Le scenario vise la transmission du projet: un administrateur ou un membre du jury doit pouvoir comprendre la logique sans relire tout le code ligne par ligne.`,
      `La gouvernance donne de la valeur au travail technique, car elle relie les choix, les preuves, les tests et les limites dans un document defendable.`,
      `La preparation de soutenance transforme le projet en demonstration: chaque partie importante doit avoir un message, une capture et une preuve de fonctionnement.`,
    ],
    general: [
      `Le scenario est transversal et permet de verifier que la securite n'est pas traitee comme une option isolee, mais comme une propriete globale du systeme.`,
      `L'analyse croise le besoin metier ERP, le risque cybersecurite et les contraintes Cloud pour garder une coherence de Licence Professionnelle.`,
      `Le controle est juge sur sa clarte, son integration au code existant et la facilite avec laquelle il peut etre teste.`,
    ],
  };
  const implementationAngles = {
    identity: [
      `Le code associe verifie les identifiants, genere un challenge MFA si le compte l'exige, puis ne livre le token d'acces complet qu'apres validation du code TOTP.`,
      `La politique de mot de passe et le rate limiting reduisent les attaques automatises, tandis que le secret MFA reste separe du mot de passe.`,
      `Le frontend accompagne l'utilisateur dans l'etape OTP, mais la decision de valider ou refuser reste dans FastAPI.`,
    ],
    access: [
      `Les routes sensibles appliquent les roles cote serveur, ce qui evite de faire confiance uniquement aux menus React.`,
      `La reponse 403 devient une preuve importante: elle montre que l'API refuse l'action meme si la requete est construite manuellement.`,
      `La matrice RBAC garde les droits comprehensibles: administrateur pour la gestion, cashier pour les operations limitees, lecture controlee pour les vues autorisees.`,
    ],
    monitoring: [
      `Les evenements sont presentes dans une logique d'audit: type d'action, utilisateur, adresse IP, date et resultat.`,
      `La hash-chain documentee renforce l'idee d'integrite des logs, car une alteration devrait etre detectable par rupture de coherence.`,
      `Les indicateurs de couverture MFA donnent une mesure de maturite et pas seulement une liste brute d'utilisateurs.`,
    ],
    appsec: [
      `Les middlewares FastAPI ajoutent des en-tetes tels que X-Frame-Options ou X-Content-Type-Options pour limiter des attaques navigateur connues.`,
      `La configuration CORS garde une liste d'origines attendues au lieu d'accepter aveuglement toutes les sources.`,
      `Les controles backend sont verifies par appel HTTP, ce qui donne une preuve plus solide qu'une simple observation de l'interface.`,
    ],
    cloud: [
      `Le reverse proxy devient le point d'entree, pendant que le backend reste derriere une couche interne et que la base conserve ses donnees dans un volume.`,
      `La separation configuration/code permet de changer l'environnement sans modifier l'application: URL, secret JWT, base de donnees et regles reseau.`,
      `Le schema propose laisse une evolution possible vers PostgreSQL, WAF, monitoring centralise et sauvegardes chiffrees.`,
    ],
    resilience: [
      `Les sauvegardes et la restauration sont traitees comme des controles a tester, pas comme une intention abstraite.`,
      `La rotation des secrets reduit l'impact d'une fuite et oblige a documenter ou se trouvent les valeurs sensibles.`,
      `Le plan de reprise relie les roles humains, les fichiers techniques et les etapes de verification apres incident.`,
    ],
    governance: [
      `La documentation organise les preuves: architecture, captures, fichiers modifies, tests realises et limites restantes.`,
      `Le rapport evite une presentation purement descriptive en reliant chaque fonctionnalite a une menace et a un resultat observable.`,
      `Les checklists rendent le projet exploitable apres la soutenance et facilitent la relecture par un encadrant.`,
    ],
    general: [
      `L'implementation s'appuie sur une defense en profondeur: identite, role, journalisation, durcissement HTTP et preparation Cloud.`,
      `Chaque controle est garde a un niveau comprehensible afin de pouvoir etre explique sans perdre le lien avec le code source.`,
      `Le prototype montre une base solide qui peut etre industrialisee sans changer completement l'application.`,
    ],
  };
  const validationAngles = [
    `La preuve minimale comprend le resultat attendu, le resultat obtenu et l'endroit ou il est visible: interface, reponse API, log ou fichier source.`,
    `Le test doit etre reproductible pendant la soutenance: un compte, une action, une verification, puis une conclusion courte.`,
    `La validation doit aussi mentionner la limite restante, car un projet professionnel distingue clairement ce qui est implemente de ce qui reste a industrialiser.`,
  ];
  const cloudAngles = [
    `Dans la partie Cloud, ce dossier doit etre relie aux ports exposes, aux variables d'environnement, au proxy HTTPS et a la supervision.`,
    `La version production devra separer developpement, preproduction et production afin d'eviter que les secrets ou donnees de test se melangent.`,
    `Le deploiement cible doit garder des preuves d'exploitation: logs conserves, sauvegardes planifiees et controles reseau verifies.`,
  ];
  const introVariants = [
    `Le dossier ${index} traite le scenario "${topic}" comme un point de controle precis et non comme une simple notion theorique.`,
    `Pour "${topic}", l'analyse part du contexte ProERP Web: utilisateurs internes, donnees de gestion, API FastAPI et exploitation future dans le Cloud.`,
    `Ce point est important pour le PFE parce qu'il relie une menace concrete a une realisation visible dans le code, l'interface ou la documentation d'exploitation.`,
  ];
  const cia = [
    `Confidentialite: le controle reduit l'exposition des donnees ERP aux profils non autorises et limite les informations disponibles apres compromission d'un compte.`,
    `Integrite: la mesure aide a empecher ou retracer les modifications sensibles, notamment les changements de roles, de configuration, de paiement ou de stock.`,
    `Disponibilite: la protection doit rester compatible avec l'usage quotidien; elle bloque les comportements dangereux sans interrompre inutilement les operations normales.`,
  ];
  const selectedCia = cia[index % cia.length];
  const scenario = scenarioAngles[profileName][index % scenarioAngles[profileName].length];
  const implementation = implementationAngles[profileName][index % implementationAngles[profileName].length];
  const cloudPoint = cloudAngles[index % cloudAngles.length];
  const validation = validationAngles[index % validationAngles.length];
  return [
    h3("Contexte du scenario"),
    p(`Ce dossier analyse le cas suivant: ${topic}. ${introVariants[index % introVariants.length].replace(`Pour "${topic}", `, "")} ${scenario}`),
    h3("Risque et controle applique"),
    p(`Le risque associe a "${topic}" est prioritaire pour ProERP Web. ${profile.risk} ${profile.implementation}`),
    h3("Implementation dans ProERP Web"),
    p(`Dans l'application, le controle retenu pour "${topic}" s'appuie sur une implementation verifiable. ${implementation} Les elements a citer dans le rapport sont: ${controlMap[profileName]}.`),
    h3("Lien Cloud et critere de securite"),
    p(`En exploitation Cloud, "${topic}" doit rester coherent avec la configuration reseau, les secrets et la supervision. ${profile.cloud} ${cloudPoint} ${selectedCia}`),
    h3("Validation attendue"),
    p(`La validation de "${topic}" doit etre simple a reproduire pendant la soutenance. ${profile.validation} ${validation} La preuve a conserver peut etre une capture d'ecran, un extrait de code, un resultat HTTP, une entree de log ou une ligne de configuration.`),
  ];
}

function operationalTable(topic) {
  return table(
    ["Point", "Description"],
    OPERATIONAL_CONTENT[topicProfile(topic)].rows,
    [2600, 6600]
  );
}

function section(title, paragraphs) {
  const children = [h2(title)];
  paragraphs.forEach((txt) => children.push(p(txt)));
  return children;
}

function addMainChapter(children, title, intro, subsections) {
  children.push(h1(title));
  intro.forEach((txt) => children.push(p(txt)));
  subsections.forEach((sub) => {
    children.push(h2(sub.title));
    sub.paragraphs.forEach((txt) => children.push(p(txt)));
    if (sub.bullets) sub.bullets.forEach((txt) => children.push(bullet(txt)));
    if (sub.table) children.push(table(sub.table.headers, sub.table.rows, sub.table.widths));
  });
}

function coreChapterContent(title) {
  const topic = cleanTopic(title);
  const key = title.toLowerCase();
  const common = {
    proof: `Pour le chapitre "${topic}", la preuve attendue combine un extrait de code, une capture d'ecran, un test fonctionnel et un resultat observable dans l'application.`,
    limit: `La limite de "${topic}" concerne surtout le passage en production: la maquette locale valide le comportement, tandis qu'un environnement Cloud reel exige durcissement, supervision et sauvegardes automatisees.`,
  };
  const chapters = [
    {
      match: "iam",
      paragraphs: [
        "L'IAM constitue la base de la securite du projet. Il permet de relier chaque action sensible a une identite connue au lieu de laisser l'application fonctionner avec des acces anonymes ou partages.",
        "Dans ProERP Web, cette partie s'appuie sur la gestion des comptes utilisateurs, les roles, l'etat actif du compte et les informations d'authentification. Le backend reste responsable de la decision finale afin d'eviter les contournements par l'interface.",
        "Le lien avec le Cloud est direct: une application exposee doit savoir qui se connecte, depuis quel profil et avec quelles limites. Sans IAM propre, le reste des controles perd sa valeur.",
      ],
      rows: [
        ["Risque traite", "Compte partage, utilisateur inconnu, action impossible a attribuer"],
        ["Implementation", "Modele utilisateur, roles, session authentifiee, controles backend"],
        ["Preuve", "Creation d'utilisateur, connexion, role visible, acces verifie par profil"],
        ["Amelioration", "Politique de cycle de vie des comptes et revue periodique des acces"],
      ],
    },
    {
      match: "rbac",
      paragraphs: [
        "Le RBAC applique le principe du moindre privilege: chaque utilisateur recoit uniquement les droits necessaires a sa mission. Cette approche reduit les erreurs d'administration et limite l'impact d'un compte compromis.",
        "Dans l'application, les droits ne sont pas seulement caches dans le frontend. Les routes sensibles doivent aussi verifier le role cote API, car un utilisateur peut appeler directement une route avec un outil externe.",
        "Le test important consiste a connecter un compte limite, essayer une action admin et verifier le refus. Cette preuve montre que la securite n'est pas uniquement visuelle.",
      ],
      rows: [
        ["Risque traite", "Elevation de privileges, acces non autorise aux rapports ou parametres"],
        ["Implementation", "Roles applicatifs, permissions backend, menus React adaptes"],
        ["Preuve", "Reponse 403 avec un compte non autorise et succes avec un administrateur"],
        ["Amelioration", "Matrice RBAC documentee par module ERP"],
      ],
    },
    {
      match: "jwt",
      paragraphs: [
        "JWT sert a transporter l'identite de l'utilisateur apres authentification. Le jeton signe evite de renvoyer le mot de passe et permet au backend de verifier chaque requete protegee.",
        "La securite du JWT depend fortement de la cle secrete, de la duree de validite et du stockage cote client. Le projet separe ces points dans la logique backend et la documentation de deploiement.",
        "Dans un contexte Cloud, la cle de signature ne doit pas etre presente dans le code source. Elle doit etre injectee par variable d'environnement et remplacee en cas d'incident.",
      ],
      rows: [
        ["Risque traite", "Session falsifiee, token trop long, secret expose"],
        ["Implementation", "Creation et verification de token signe dans backend/core/security.py"],
        ["Preuve", "Connexion reussie, appel API authentifie, expiration documentee"],
        ["Amelioration", "Rotation de secret et refresh token plus controle"],
      ],
    },
    {
      match: "mfa",
      paragraphs: [
        "Le MFA ajoute une deuxieme preuve apres le mot de passe. Dans ce projet, le choix TOTP est adapte car il fonctionne avec des applications standards comme Google Authenticator ou Microsoft Authenticator.",
        "Le flux implemente separe la connexion classique et la verification du code temporaire. Si le compte exige MFA, le backend ne livre pas directement le jeton final.",
        "Ce controle est particulierement important pour les comptes administrateurs, car un mot de passe vole ne suffit plus pour ouvrir une session complete.",
      ],
      rows: [
        ["Risque traite", "Vol de mot de passe et connexion frauduleuse"],
        ["Implementation", "Secret TOTP, setup MFA, activation, verification OTP"],
        ["Preuve", "Challenge MFA au login et evenement d'activation dans les logs"],
        ["Amelioration", "MFA obligatoire pour les roles critiques"],
      ],
    },
    {
      match: "audit",
      paragraphs: [
        "Les audit logs donnent de la visibilite sur les actions sensibles. Ils permettent de comprendre ce qui s'est passe apres un incident ou une operation inhabituelle.",
        "Le projet documente la journalisation des evenements de securite et l'utilisation d'une logique de hash-chain pour renforcer l'integrite des traces.",
        "La valeur de cette partie est pratique: pendant la soutenance, une action peut etre realisee puis retrouvee dans les journaux ou dans le Security Center.",
      ],
      rows: [
        ["Risque traite", "Action sensible non tracee ou modification discrete des logs"],
        ["Implementation", "Evenements horodates, utilisateur, adresse IP, hash d'integrite"],
        ["Preuve", "Log mfa_enabled, mfa_disabled, login failed ou acces refuse"],
        ["Amelioration", "Export vers SIEM et conservation centralisee"],
      ],
    },
    {
      match: "security center",
      paragraphs: [
        "Le Security Center transforme des donnees techniques en indicateurs lisibles. Il aide l'administrateur a suivre la posture de securite sans ouvrir directement les fichiers de logs.",
        "Les indicateurs importants concernent les evenements recents, les alertes, les IPs, l'integrite et la couverture MFA. Cette page donne une preuve visuelle forte pour le PFE.",
        "Dans une exploitation Cloud, ce tableau de bord peut devenir une premiere couche avant une integration SIEM plus avancee.",
      ],
      rows: [
        ["Risque traite", "Absence de monitoring et detection tardive"],
        ["Implementation", "Route Security Center, metriques, alertes, couverture MFA"],
        ["Preuve", "Capture de la page Security Center et donnees actualisees"],
        ["Amelioration", "Alertes temps reel et correlation SIEM"],
      ],
    },
    {
      match: "rate limiting",
      paragraphs: [
        "Le rate limiting reduit les attaques de brute force sur le formulaire de connexion. Il limite le nombre d'essais possibles depuis une meme source sur une periode donnee.",
        "Ce controle complete la politique de mot de passe et MFA. Il ne remplace pas l'authentification forte, mais ralentit les tentatives automatisees.",
        "Le test consiste a provoquer plusieurs echecs de connexion et a verifier que l'application repond de maniere controlee.",
      ],
      rows: [
        ["Risque traite", "Essais massifs de mots de passe"],
        ["Implementation", "Limitation sur endpoint login et journalisation des echecs"],
        ["Preuve", "Reponse de blocage ou ralentissement apres plusieurs tentatives"],
        ["Amelioration", "Blocage adaptatif par IP et par compte"],
      ],
    },
    {
      match: "headers",
      paragraphs: [
        "Les headers HTTP de securite protegent le navigateur contre plusieurs mauvaises pratiques: clickjacking, interpretation MIME incorrecte ou fuite d'information par le referrer.",
        "Ils sont ajoutes cote backend pour etre appliques a toutes les reponses. Cette approche est simple a verifier avec les outils developpeur ou une requete HTTP.",
        "Dans le Cloud, ces headers doivent rester presents derriere le reverse proxy afin de conserver la meme posture de securite en production.",
      ],
      rows: [
        ["Risque traite", "Clickjacking, MIME sniffing, fuite de contexte navigateur"],
        ["Implementation", "Middleware FastAPI ajoutant les headers de securite"],
        ["Preuve", "Inspection des reponses HTTP"],
        ["Amelioration", "Politique CSP plus stricte et tests OWASP ZAP"],
      ],
    },
    {
      match: "cors",
      paragraphs: [
        "CORS controle quelles origines navigateur peuvent appeler l'API. Une configuration trop large expose inutilement le backend a des scenarios d'abus depuis des sites non prevus.",
        "Dans ProERP Web, la configuration doit rester explicite: le frontend connu est autorise, les origines inconnues sont refusees.",
        "Ce controle est lie au Cloud car les URL changent entre local, preproduction et production. La documentation doit donc preciser les origines autorisees.",
      ],
      rows: [
        ["Risque traite", "Appels navigateur depuis une origine non controlee"],
        ["Implementation", "Configuration CORS dans FastAPI"],
        ["Preuve", "Test avec origine autorisee et origine refusee"],
        ["Amelioration", "Profils CORS separes par environnement"],
      ],
    },
    {
      match: "docker",
      paragraphs: [
        "Docker facilite le deploiement reproductible de l'application. Il isole les composants, simplifie le packaging et clarifie les dependances.",
        "Pour ProERP Web, l'objectif est de preparer une architecture ou frontend, backend et donnees persistantes sont separes. Les volumes protegent les donnees contre la perte lors du redemarrage des conteneurs.",
        "Cette partie montre le lien avec le Cloud Computing: une application conteneurisee est plus facile a deployer sur un VPS, une VM Cloud ou une plateforme orchestrable.",
      ],
      rows: [
        ["Risque traite", "Installation manuelle fragile et configuration non reproductible"],
        ["Implementation", "Conteneurs, variables d'environnement, volumes"],
        ["Preuve", "Plan de deploiement et architecture Cloud"],
        ["Amelioration", "Compose production et monitoring conteneurs"],
      ],
    },
    {
      match: "reverse proxy",
      paragraphs: [
        "Le reverse proxy devient le point d'entree de l'application. Il peut terminer HTTPS, router les requetes et masquer le backend interne.",
        "Le firewall complete ce dispositif en limitant les ports exposes. L'utilisateur accede a l'application par HTTPS, tandis que les services internes restent proteges.",
        "Cette architecture reduit la surface d'attaque et rapproche le projet d'une exploitation professionnelle.",
      ],
      rows: [
        ["Risque traite", "Backend expose directement et trafic non chiffre"],
        ["Implementation", "Reverse proxy HTTPS, firewall, ports limites"],
        ["Preuve", "Schema de deploiement et regles reseau documentees"],
        ["Amelioration", "WAF et certificats automatises"],
      ],
    },
    {
      match: "sauvegardes",
      paragraphs: [
        "Les sauvegardes assurent la continuite apres incident. Elles protegent contre une suppression accidentelle, une panne, une mauvaise manipulation ou une compromission partielle.",
        "Le rapport doit distinguer les donnees applicatives, les fichiers uploades, les configurations et les secrets. Chaque element n'a pas le meme rythme de sauvegarde ni le meme niveau de sensibilite.",
        "La restauration est aussi importante que la sauvegarde: une sauvegarde non testee reste une hypothese, pas une preuve.",
      ],
      rows: [
        ["Risque traite", "Perte de donnees ou indisponibilite apres incident"],
        ["Implementation", "Plan backup, volumes persistants, procedure de restauration"],
        ["Preuve", "Checklist et test de restauration"],
        ["Amelioration", "Backups chiffres hors site et PRA planifie"],
      ],
    },
  ];
  const item = chapters.find((chapter) => key.includes(chapter.match)) || {
    paragraphs: [
      "Ce chapitre presente un controle de securite applique a ProERP Web et relie a l'exploitation Cloud.",
      common.proof,
      common.limit,
    ],
    rows: [
      ["Risque traite", "Risque applicatif ou infrastructurel"],
      ["Implementation", "Controle integre dans le projet"],
      ["Preuve", "Capture, code, log ou test"],
      ["Amelioration", "Industrialisation Cloud"],
    ],
  };
  return [
    h2("Analyse et mise en oeuvre"),
    ...item.paragraphs.map((txt) => p(txt)),
    h2("Preuves et limites"),
    p(common.proof),
    p(common.limit),
    table(["Axe", "Description"], item.rows, [2600, 6600]),
  ];
}

function createDoc() {
  const children = [];

  children.push(
    new Paragraph({ spacing: { before: 700, after: 0 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [textRun("Licence Professionnelle en Cybersecurite et Cloud Computing", { bold: true, size: 28, color: COLORS.blue })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [textRun("Projet de Fin d'Etudes", { bold: true, size: 26, color: COLORS.mediumBlue })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 250, after: 250 },
      shading: { fill: COLORS.navy, type: ShadingType.CLEAR },
      children: [textRun("Securisation d'une application ERP Web dans un environnement Cloud", { bold: true, size: 34, color: COLORS.white })],
    }),
    p("Application support: ProERP Web", { align: AlignmentType.CENTER, run: { bold: true, size: 24, color: COLORS.blue } }),
    p("Technologies: FastAPI, React, JWT, RBAC, MFA/TOTP, Audit Logs, Security Center, Docker, CORS, HTTPS, Firewall", { align: AlignmentType.CENTER }),
    ...image("architecture-globale.svg", "Figure 1 - Architecture globale securisee du projet ProERP Web.", 600, 365),
  );

  children.push(...manualTableOfContents());

  addMainChapter(children, "Resume executif", [
    "Ce rapport presente la securisation de ProERP Web, une application ERP Web composee d'un frontend React/Vite, d'un backend FastAPI et d'une base SQLite pour la maquette. Le projet s'inscrit dans le cadre d'une Licence Professionnelle en Cybersecurite et Cloud Computing.",
    "La solution realisee met en place une gestion des identites, un controle d'acces base sur les roles, une authentification multifacteur TOTP, des tokens JWT, un journal d'audit avec hash-chain, un Security Center, des headers HTTP de securite, un rate limiting sur la connexion et une documentation de deploiement Cloud securise.",
    "Le rapport insiste sur les preuves: captures d'ecran, extraits de code, tableaux de tests, architecture, scenarios de menace et procedures de validation. L'objectif est de produire un document soutenable, technique et professionnel.",
  ], [
    {
      title: "Mots-cles",
      paragraphs: [],
      table: {
        headers: ["Terme", "Definition"],
        rows: [
          ["IAM", "Gestion des identites et des acces"],
          ["RBAC", "Controle d'acces base sur les roles"],
          ["MFA/TOTP", "Authentification multifacteur basee sur un code temporaire"],
          ["JWT", "Jeton signe utilise pour authentifier les requetes API"],
          ["Audit logs", "Journalisation des actions sensibles"],
          ["Cloud hardening", "Durcissement de l'environnement de deploiement"],
        ],
        widths: [2300, 7000],
      },
    },
  ]);

  addMainChapter(children, "1. Introduction generale", [
    "Les applications ERP Web centralisent des donnees sensibles et operationnelles. Elles manipulent les comptes utilisateurs, les clients, les ventes, les paiements, le stock et les rapports. Lorsqu'elles sont exposees dans un environnement Cloud, leur securisation devient une priorite.",
    "Le projet ProERP Web sert de support pratique pour appliquer les notions de cybersecurite et de Cloud Computing: authentification, autorisation, tracabilite, supervision, configuration reseau et deploiement conteneurise.",
    "La problematique principale est la suivante: comment securiser l'acces a une application ERP Web hebergee dans un environnement Cloud tout en assurant la tracabilite des actions utilisateurs et la supervision des evenements sensibles ?",
  ], [
    {
      title: "Objectifs du projet",
      paragraphs: [
        "Les objectifs sont organises autour de trois axes: securiser l'identite, controler les autorisations et superviser les evenements de securite. A cela s'ajoute la preparation au deploiement Cloud.",
      ],
      bullets: [
        "Mettre en place un mecanisme IAM coherent.",
        "Appliquer un controle d'acces base sur les roles.",
        "Ajouter MFA/TOTP au processus de connexion.",
        "Tracer les actions sensibles dans des audit logs.",
        "Afficher les indicateurs dans un Security Center.",
        "Documenter Docker, CORS, HTTPS, reverse proxy et firewall.",
      ],
    },
  ]);

  addMainChapter(children, "2. Presentation de ProERP Web", [
    "ProERP Web est une application de gestion qui contient plusieurs modules: Dashboard, POS, ventes, achats, clients, fournisseurs, produits, stock, depenses, caisse, rapports, utilisateurs, parametres et Security Center.",
    "L'architecture est classique et claire: le frontend React fournit l'interface, le backend FastAPI expose les endpoints REST et la base SQLite stocke les donnees de la maquette. Cette structure permet d'ajouter des controles de securite sans casser la logique metier.",
  ], [
    {
      title: "Vue fonctionnelle",
      paragraphs: [
        "Les modules ERP montrent que l'application n'est pas un simple prototype vide. Elle manipule des operations metier, ce qui justifie la presence d'une securite applicative: un mauvais acces pourrait modifier un stock, consulter des rapports ou administrer les utilisateurs.",
      ],
      table: {
        headers: ["Module", "Risque principal", "Controle associe"],
        rows: [
          ["Utilisateurs", "Creation ou modification non autorisee", "RBAC + audit logs"],
          ["Stock", "Ajustement frauduleux", "Permission stock + audit"],
          ["Ventes", "Modification de documents", "Permission sales + logs"],
          ["Rapports", "Fuite d'informations", "Permission reports"],
          ["Parametres", "Mauvaise configuration", "Permission settings"],
        ],
        widths: [2300, 3800, 3300],
      },
    },
  ]);

  addMainChapter(children, "3. Contexte Cybersecurite et Cloud Computing", [
    "La cybersecurite regroupe les mecanismes permettant de proteger les systemes, les donnees et les utilisateurs contre les acces non autorises, les abus et les pertes de tracabilite.",
    "Le Cloud Computing impose des contraintes supplementaires: exposition reseau, gestion des secrets, configuration CORS, reverse proxy HTTPS, firewall, sauvegardes et supervision.",
  ], [
    {
      title: "Lien avec la filiere",
      paragraphs: [
        "Le sujet est adapte a une Licence Professionnelle car il combine des actions concretes de securisation applicative avec une preparation a l'exploitation Cloud. Il ne se limite pas a une idee theorique: les controles sont integres dans le code et testes.",
      ],
    },
  ]);

  children.push(h1("4. Architecture de la solution"));
  children.push(...image("architecture-globale.svg", "Figure 2 - Architecture applicative globale.", 610, 370));
  children.push(...image("flux-authentification-mfa.svg", "Figure 3 - Flux d'authentification avec MFA/TOTP.", 610, 370));
  children.push(...image("modele-rbac.svg", "Figure 4 - Modele IAM/RBAC applique a ProERP Web.", 610, 370));
  children.push(...image("deploiement-cloud.svg", "Figure 5 - Deploiement Cloud securise recommande.", 610, 370));

  const coreChapters = [
    ["5. IAM et gestion des identites", "IAM permet d'identifier les utilisateurs, de gerer leurs comptes, d'associer des roles et de controler les acces. Dans ProERP Web, cette logique repose sur les tables users et roles."],
    ["6. RBAC et principe du moindre privilege", "RBAC attribue les permissions aux roles. L'utilisateur herite des permissions de son role, ce qui rend la gestion plus claire et reduit les risques d'erreur."],
    ["7. Authentification JWT", "JWT permet de transmettre l'identite de l'utilisateur apres login. Le backend signe le token et verifie sa validite a chaque requete protegee."],
    ["8. MFA/TOTP", "MFA ajoute une deuxieme preuve d'identite. Le code TOTP limite le risque en cas de vol du mot de passe."],
    ["9. Audit logs et hash-chain", "Les journaux d'audit enregistrent les evenements sensibles. La hash-chain permet de detecter une modification non autorisee des logs."],
    ["10. Security Center", "Le Security Center transforme les logs en indicateurs exploitables: connexions, echecs, actions sensibles, IPs, couverture MFA et integrite."],
    ["11. Rate limiting et protection brute force", "Le rate limiting limite les tentatives repetitives sur la connexion et reduit le risque d'attaque par force brute."],
    ["12. Headers HTTP de securite", "Les headers de securite reduisent certains risques Web: clickjacking, MIME sniffing, fuite de referrer et acces aux capteurs."],
    ["13. CORS et exposition API", "CORS controle les origines autorisees a appeler l'API depuis un navigateur. Une configuration stricte reduit l'exposition inutile."],
    ["14. Docker et deploiement Cloud", "Docker facilite le packaging, la portabilite et la separation entre application, configuration et donnees persistantes."],
    ["15. Reverse proxy, HTTPS et firewall", "Le reverse proxy termine TLS et le firewall limite les ports exposes. Le backend ne doit pas etre expose directement a Internet."],
    ["16. Sauvegardes et continuite", "La sauvegarde de la base, des uploads et des configurations garantit la recuperation apres incident."],
  ];

  coreChapters.forEach(([title, intro], idx) => {
    children.push(h1(title));
    children.push(p(intro));
    coreChapterContent(title).forEach((item) => children.push(item));
  });

  children.push(h1("17. Extraits de code expliques"));
  children.push(...image("code-auth-mfa.svg", "Figure 6 - Extrait backend lie au login MFA.", 620, 360));
  children.push(...image("code-security-totp.svg", "Figure 7 - Extrait backend lie a la verification TOTP.", 620, 360));
  children.push(...image("code-security-center.svg", "Figure 8 - Extrait backend lie au Security Center.", 620, 360));
  children.push(...codeBlock("Fichiers principaux modifies", [
    "backend/core/security.py          -> JWT, TOTP, MFA token, password policy",
    "backend/api/routes/auth.py        -> login, login/mfa, mfa/setup, mfa/enable, mfa/disable",
    "backend/api/routes/security_center.py -> metrics, risk score, integrity check",
    "backend/main.py                   -> permissions routers, CORS, security headers",
    "frontend/src/lib/AuthContext.jsx  -> session, permissions, MFA actions",
    "frontend/src/pages/LoginPage.jsx  -> login en deux etapes avec code MFA",
    "frontend/src/components/layout/Layout.jsx -> profil utilisateur et activation MFA",
  ]));

  children.push(h1("18. Captures d'ecran et preuves visuelles"));
  [
    ["01-login.png", "Figure 9 - Page de connexion."],
    ["02-dashboard.png", "Figure 10 - Tableau de bord apres authentification."],
    ["03-security-center.png", "Figure 11 - Security Center."],
    ["04-users-rbac.png", "Figure 12 - Gestion utilisateurs et roles."],
    ["05-settings-audit.png", "Figure 13 - Parametres et audit."],
  ].forEach(([file, caption]) => children.push(...image(file, caption, 620, 430)));

  children.push(h1("19. Tests et validation"));
  children.push(table(
    ["ID", "Scenario", "Resultat attendu", "Resultat obtenu"],
    [
      ["IAM-01", "Admin accede a la gestion utilisateurs", "Acces autorise", "OK"],
      ["IAM-02", "Cashier appelle /api/users", "403 Forbidden", "OK"],
      ["MFA-01", "Generation secret", "Secret TOTP", "OK"],
      ["MFA-02", "Login avec challenge MFA", "mfa_required=true", "OK"],
      ["AUD-01", "Login reussi", "login_success", "OK"],
      ["CLD-01", "Headers securite", "Headers presents", "OK"],
      ["CLD-02", "Frontend build", "Build sans erreur", "OK"],
    ],
    [1400, 3300, 2600, 1900]
  ));
  repeatAnalysis("la phase de tests et validation", 19).forEach((item) => children.push(item));

  children.push(h1("20. Threat modeling STRIDE et OWASP"));
  children.push(table(
    ["Categorie", "Risque dans ProERP Web", "Controle implemente"],
    [
      ["Spoofing", "Usurpation d'identite", "JWT + MFA/TOTP"],
      ["Tampering", "Modification de logs", "Hash-chain"],
      ["Repudiation", "Utilisateur nie une action", "Audit logs"],
      ["Information Disclosure", "Acces aux rapports", "RBAC"],
      ["Denial of Service", "Brute force login", "Rate limiting"],
      ["Elevation of Privilege", "Role limite accede admin", "require_permission"],
    ],
    [2200, 3600, 3400]
  ));
  repeatAnalysis("la modelisation des menaces STRIDE et OWASP", 20).forEach((item) => children.push(item));

  children.push(h1("21. Perspectives d'evolution"));
  [
    "Migration de SQLite vers PostgreSQL pour un environnement Cloud plus robuste.",
    "Export des logs vers un SIEM pour correlation et alertes centralisees.",
    "Ajout d'un WAF devant le reverse proxy pour filtrer les attaques HTTP.",
    "Monitoring avance avec Prometheus et Grafana.",
    "Sauvegardes chiffrees vers un stockage Cloud.",
    "MFA obligatoire pour les roles administrateurs.",
    "Rotation automatique des secrets et durcissement des variables d'environnement.",
  ].forEach((item) => children.push(bullet(item)));
  repeatAnalysis("les perspectives d'industrialisation Cloud", 21).forEach((item) => children.push(item));

  const operationalTopics = [
    "Vol de mot de passe", "Brute force sur login", "Elevation de privileges", "Alteration d'audit logs",
    "Mauvaise configuration CORS", "Exposition directe du backend", "Fuite de SECRET_KEY", "Absence de sauvegarde",
    "Compte cashier compromis", "Acces non autorise aux rapports", "Durcissement avant production", "Plan de reponse a incident",
    "Supervision quotidienne", "Supervision hebdomadaire", "Validation de la couverture MFA", "Migration PostgreSQL",
    "Integration SIEM", "Ajout WAF", "Monitoring Prometheus/Grafana", "Rotation des secrets",
    "Documentation administrateur", "Documentation utilisateur", "Preparation soutenance", "Checklist Cloud finale",
    "Gestion du cycle de vie des comptes", "Desactivation des comptes inactifs", "Controle des permissions critiques",
    "Journalisation des paiements", "Journalisation des ajustements stock", "Protection des endpoints settings",
    "Protection des backups", "Controle des uploads", "Analyse des IPs uniques", "Analyse des user agents",
    "Verification de l'integrite hash-chain", "Gestion des erreurs d'authentification", "Protection contre clickjacking",
    "Protection contre MIME sniffing", "Gestion du referrer", "Restrictions Permissions-Policy",
    "Exploitation derriere reverse proxy", "Gestion des certificats TLS", "Isolation par conteneur Docker",
    "Persistances des volumes", "Plan de restauration apres incident", "Mise en place d'une politique MFA",
    "Controle des routes frontend", "Controle des routes backend", "Validation par appels API directs",
    "Analyse OWASP Broken Access Control", "Analyse OWASP Authentication Failures", "Analyse OWASP Security Misconfiguration",
    "Analyse OWASP Logging and Monitoring Failures", "Roadmap production", "Roadmap Cloud hybride",
    "Preparation demo jury", "Questions probables du jury", "Reponses techniques a preparer",
  ];

  children.push(h1("22. Dossiers operationnels"));
  operationalTopics.forEach((topic, i) => {
    children.push(h2(`22.${i + 1} ${topic}`));
    repeatAnalysis(topic, i + 1).forEach((item) => children.push(item));
    children.push(operationalTable(topic));
  });

  children.push(h1("23. Conclusion generale"));
  children.push(
    p("Le projet a permis de securiser ProERP Web de maniere concrete et progressive. Les mecanismes ajoutes couvrent l'authentification, l'autorisation, la tracabilite, la supervision et la preparation Cloud."),
    p("Le travail est coherent avec une Licence Professionnelle en Cybersecurite et Cloud Computing, car il combine des concepts fondamentaux avec une implementation observable dans une application reelle."),
    p("Les limites identifiees ouvrent la voie a des ameliorations professionnelles: PostgreSQL, SIEM, WAF, monitoring centralise, sauvegardes chiffrees et MFA obligatoire pour les comptes sensibles.")
  );

  children.push(h1("24. Glossaire"));
  children.push(table(
    ["Terme", "Definition"],
    [
      ["IAM", "Gestion des identites et des acces."],
      ["RBAC", "Modele d'autorisation base sur les roles."],
      ["MFA", "Authentification multifacteur."],
      ["TOTP", "Code temporaire base sur le temps."],
      ["JWT", "Jeton JSON signe."],
      ["Audit log", "Journal des actions importantes."],
      ["Hash-chain", "Chaine de hashes pour integrite."],
      ["CORS", "Controle des origines navigateur."],
      ["Reverse proxy", "Serveur intermediaire pour HTTPS et routage."],
      ["WAF", "Pare-feu applicatif Web."],
      ["SIEM", "Plateforme de supervision et correlation securite."],
    ],
    [2400, 6800]
  ));

  return new Document({
    creator: "H.SABRI",
    title: "PFE ProERP Web - Cybersecurite et Cloud Computing",
    description: "Rapport PFE professionnel genere depuis generate_rapport.js",
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 420, hanging: 220 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 22, language: { value: "fr-FR" }, noProof: true },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: pageMargin,
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [textRun("PFE - ProERP Web | Cybersecurite et Cloud Computing", { size: 18, color: "64748B" })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              textRun("Page ", { size: 18, color: "64748B" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "64748B" }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

async function main() {
  fs.mkdirSync(DOCS, { recursive: true });
  const doc = createDoc();
  const buffer = await Packer.toBuffer(doc);
  let outputPath = OUTPUT;
  try {
    fs.writeFileSync(outputPath, buffer);
  } catch (error) {
    if (error.code !== "EBUSY") throw error;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    outputPath = path.join(DOCS, `PFE_RAPPORT_PROERP_PROFESSIONNEL_60P_${stamp}.docx`);
    fs.writeFileSync(outputPath, buffer);
    console.log("Le fichier principal est ouvert ou verrouille, une nouvelle copie a ete creee.");
  }
  console.log("Document genere avec succes:");
  console.log(outputPath);
}

main().catch((error) => {
  console.error("Erreur lors de la generation:", error);
  process.exit(1);
});
