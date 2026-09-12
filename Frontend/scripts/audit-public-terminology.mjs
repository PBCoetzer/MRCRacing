import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptsDirectory, "..");
const workspaceDirectory = path.resolve(frontendDirectory, "..");

const publicTargets = [
  path.join(frontendDirectory, "src", "app", "page.tsx"),
  path.join(frontendDirectory, "src", "app", "about", "page.tsx"),
  path.join(frontendDirectory, "src", "app", "contact", "page.tsx"),
  path.join(frontendDirectory, "src", "app", "faq"),
  path.join(frontendDirectory, "src", "app", "terms", "page.tsx"),
  path.join(frontendDirectory, "src", "app", "pricing"),
  path.join(frontendDirectory, "src", "components", "pricing"),
  path.join(frontendDirectory, "src", "app", "horse-racing"),
  path.join(frontendDirectory, "src", "components", "racing"),
  path.join(frontendDirectory, "src", "components", "site-footer.tsx"),
  path.join(frontendDirectory, "src", "app", "layout.tsx"),
  path.join(frontendDirectory, "src", "lib", "metadata.ts"),
  path.join(frontendDirectory, "src", "lib", "public-content.ts"),
  path.join(frontendDirectory, "scripts", "generate-og-image.ps1"),
  path.join(workspaceDirectory, "Deployment", "Supabase Email Templates"),
  path.join(
    workspaceDirectory,
    "supabase",
    "functions",
    "process-tip-notifications",
    "index.ts",
  ),
];

const registrationTargets = [
  path.join(frontendDirectory, "src", "app", "register", "page.tsx"),
  path.join(frontendDirectory, "src", "components", "auth", "register-form.tsx"),
];

const ignoredDirectoryNames = new Set([".git", ".next", "node_modules", "out"]);

const restrictedLanguageRule = {
  label: "restricted public wording",
  pattern:
    /\b(?:gambl(?:e|es|ed|ing|er|ers)?|bookmakers?|bets?|betted|betting|odds|winnings|dividends?)\b/i,
};

const responsibleMessagingRule = {
  label: "responsible-gambling messaging",
  pattern: /responsible\s+(?:gambling|gaming)|gamble\s+responsibly/i,
};

const publicRules = [
  restrictedLanguageRule,
  responsibleMessagingRule,
  { label: "public 18+ wording", pattern: /18\+|18\s+and\s+over/i },
];

const registrationRules = [restrictedLanguageRule, responsibleMessagingRule];

const approvedPublicExceptions = new Map([
  [
    path.join(frontendDirectory, "src", "app", "about", "page.tsx"),
    ["MRC Racing Tips is not a gambling website."],
  ],
]);

const standardEmailFooter =
  "MRC Racing Tips provides South African horse-racing analysis, factual race information, and independent digital tipster content.";
const requiredSnippets = [
  {
    file: path.join(frontendDirectory, "src", "components", "auth", "register-form.tsx"),
    snippets: ['name="confirmedOver18"', "confirmed_over_18: confirmedOver18"],
    label: "registration age declaration",
  },
  {
    file: path.join(frontendDirectory, "src", "app", "about", "page.tsx"),
    snippets: [
      "MRC Racing Tips is not a gambling website.",
      "premium digital horse-racing analysis",
    ],
    label: "premium-content platform explanation",
  },
  {
    file: path.join(frontendDirectory, "src", "components", "tipster", "manage-tips-client.tsx"),
    snippets: [
      "p_multiples: multiples",
      "p_multiple_changes: multipleChanges",
      "Pick 6",
      "Bipot",
      "Jackpot",
    ],
    label: "retained tipster meeting options",
  },
  {
    file: path.join(frontendDirectory, "src", "components", "client", "client-dashboard-client.tsx"),
    snippets: ["Exotic&apos;s and Multiples", "tip_card_multiple_selections"],
    label: "retained client meeting options",
  },
  {
    file: path.join(
      frontendDirectory,
      "src",
      "components",
      "admin",
      "admin-operations-client.tsx",
    ),
    snippets: [
      "Client registration and email diagnostics",
      "Tracked Auth email support is installed",
      "admin_list_registration_diagnostics",
      "admin_list_auth_email_delivery_summary",
    ],
    label: "administrator registration diagnostics",
  },
  {
    file: path.join(
      frontendDirectory,
      "src",
      "components",
      "admin",
      "admin-user-detail-client.tsx",
    ),
    snippets: [
      "Registration and confirmation diagnostics",
      "Immutable registration timeline",
      "admin_get_user_registration_diagnostics",
    ],
    label: "administrator user Auth timeline",
  },
  ...[
    "change-email-address.html",
    "confirm-signup.html",
    "invite-user.html",
    "magic-link-or-otp.html",
    "reauthentication.html",
    "reset-password.html",
  ].map((fileName) => ({
    file: path.join(
      workspaceDirectory,
      "Deployment",
      "Supabase Email Templates",
      "html",
      fileName,
    ),
    snippets: [standardEmailFooter],
    label: "standard authentication-email footer",
  })),
  {
    file: path.join(
      workspaceDirectory,
      "supabase",
      "functions",
      "process-tip-notifications",
      "index.ts",
    ),
    snippets: [standardEmailFooter],
    label: "standard notification-email footer",
  },
];

const migrationPath = path.join(
  workspaceDirectory,
  "supabase",
  "migrations",
  "20260903164324_restrict_published_content_terminology.sql",
);
const forbiddenMigrationSnippets = [
  "create or replace function public.save_tip_card",
  "create or replace function public.revise_tip_card",
  "tipster_contract_versions",
  "meeting_bet_options",
  "meeting_bet_legs",
  "tip_card_multiple_selections",
];
const registrationDiagnosticsMigrationPath = path.join(
  workspaceDirectory,
  "supabase",
  "migrations",
  "20260903164335_admin_registration_diagnostics.sql",
);
const premiumTermsMigrationPath = path.join(
  workspaceDirectory,
  "supabase",
  "migrations",
  "20260908072620_persist_versioned_client_terms_acceptance.sql",
);
const requiredRegistrationDiagnosticsSnippets = [
  "create table if not exists public.auth_user_diagnostic_events",
  "alter table public.auth_user_diagnostic_events enable row level security",
  "create or replace function public.admin_list_registration_diagnostics",
  "create or replace function public.admin_get_user_registration_diagnostics",
  "users.confirmation_sent_at",
  "profiles.confirmed_over_18_at",
  "'providerDeliveryTracked', false",
];
const forbiddenRegistrationDiagnosticsSnippets = [
  "encrypted_password",
  "confirmation_token",
  "recovery_token",
  "email_change_token",
  "reauthentication_token",
];

async function collectFiles(target) {
  const targetStat = await stat(target);
  if (targetStat.isFile()) return [target];

  const files = [];
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

async function findViolations(targets, rules) {
  const files = (await Promise.all(targets.map(collectFiles))).flat();
  const violations = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      for (const rule of rules) {
        if (rule.pattern.test(line)) {
          const approvedExceptions = approvedPublicExceptions.get(file) ?? [];
          if (
            rule === restrictedLanguageRule &&
            approvedExceptions.some((exception) => line.includes(exception))
          ) {
            continue;
          }

          violations.push({
            file: path.relative(workspaceDirectory, file),
            line: lineIndex + 1,
            label: rule.label,
          });
        }
      }
    }
  }

  return { files, violations };
}

const publicAudit = await findViolations(publicTargets, publicRules);
const registrationAudit = await findViolations(registrationTargets, registrationRules);
const violations = [...publicAudit.violations, ...registrationAudit.violations];

for (const requirement of requiredSnippets) {
  const content = await readFile(requirement.file, "utf8");
  for (const snippet of requirement.snippets) {
    if (!content.includes(snippet)) {
      violations.push({
        file: path.relative(workspaceDirectory, requirement.file),
        line: 1,
        label: `missing ${requirement.label}`,
      });
    }
  }
}

const migrationContent = await readFile(migrationPath, "utf8");
for (const snippet of forbiddenMigrationSnippets) {
  if (migrationContent.toLowerCase().includes(snippet)) {
    violations.push({
      file: path.relative(workspaceDirectory, migrationPath),
      line: 1,
      label: "publishing migration changes a preserved feature",
    });
  }
}

const registrationDiagnosticsMigrationContent = await readFile(
  registrationDiagnosticsMigrationPath,
  "utf8",
);
for (const snippet of requiredRegistrationDiagnosticsSnippets) {
  if (!registrationDiagnosticsMigrationContent.includes(snippet)) {
    violations.push({
      file: path.relative(workspaceDirectory, registrationDiagnosticsMigrationPath),
      line: 1,
      label: "incomplete administrator registration diagnostics",
    });
  }
}
for (const snippet of forbiddenRegistrationDiagnosticsSnippets) {
  if (registrationDiagnosticsMigrationContent.toLowerCase().includes(snippet)) {
    violations.push({
      file: path.relative(workspaceDirectory, registrationDiagnosticsMigrationPath),
      line: 1,
      label: "administrator diagnostics expose an Auth secret field",
    });
  }
}

const registerFormContent = await readFile(
  path.join(frontendDirectory, "src", "components", "auth", "register-form.tsx"),
  "utf8",
);
const clientDashboardContent = await readFile(
  path.join(frontendDirectory, "src", "components", "client", "client-dashboard-client.tsx"),
  "utf8",
);
const premiumTermsMigrationContent = await readFile(premiumTermsMigrationPath, "utf8");
const migrationTermsVersions = new Set(
  premiumTermsMigrationContent.match(/\d{4}-\d{2}-\d{2}-premium-content/g) ?? [],
);
if (
  !registerFormContent.includes('supabase.rpc(\n        "get_current_premium_terms_version"') ||
  !clientDashboardContent.includes('supabase.rpc("get_premium_terms_status")') ||
  !premiumTermsMigrationContent.includes(
    "create or replace function public.get_current_premium_terms_version()",
  ) ||
  !premiumTermsMigrationContent.includes(
    "create or replace function public.get_premium_terms_status()",
  ) ||
  migrationTermsVersions.size !== 1
) {
  violations.push({
    file: path.relative(workspaceDirectory, premiumTermsMigrationPath),
    line: 1,
    label: "premium terms versions are not synchronized",
  });
}

const authPayloadPath = path.join(
  workspaceDirectory,
  "Deployment",
  "Supabase Email Templates",
  "management-api-payload.json",
);
const authPayload = JSON.parse(await readFile(authPayloadPath, "utf8"));
const authTemplateKeys = [
  "mailer_templates_confirmation_content",
  "mailer_templates_invite_content",
  "mailer_templates_magic_link_content",
  "mailer_templates_email_change_content",
  "mailer_templates_recovery_content",
  "mailer_templates_reauthentication_content",
];
for (const templateKey of authTemplateKeys) {
  if (!String(authPayload[templateKey] ?? "").includes(standardEmailFooter)) {
    violations.push({
      file: path.relative(workspaceDirectory, authPayloadPath),
      line: 1,
      label: "stale authentication-email deployment payload",
    });
  }
}

const socialImagePath = path.join(
  frontendDirectory,
  "public",
  "images",
  "mrc-racing-og.png",
);
const socialImageStat = await stat(socialImagePath);
if (!socialImageStat.isFile() || socialImageStat.size < 10_000) {
  violations.push({
    file: path.relative(workspaceDirectory, socialImagePath),
    line: 1,
    label: "missing regenerated social preview image",
  });
}

if (violations.length) {
  console.error("Public terminology audit failed:");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} (${violation.label})`);
  }
  process.exitCode = 1;
} else {
  const fileCount = new Set([...publicAudit.files, ...registrationAudit.files]).size;
  console.log(`Public terminology audit passed across ${fileCount} files.`);
}
