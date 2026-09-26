import { appendFile, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptsDirectory, "..");
const productionProjectRef = "cjgfvqgiqrphmakruqnk";

function requireUrl(name, expectedHost) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a development build.`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost) {
    throw new Error(`${name} must be https://${expectedHost}.`);
  }
  return parsed;
}

if (process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== "development") {
  throw new Error("NEXT_PUBLIC_DEPLOYMENT_ENV must be development.");
}

requireUrl("NEXT_PUBLIC_SITE_URL", "dev.mrcracing.co.za");
requireUrl("NEXT_PUBLIC_SUPABASE_URL", "api-dev.mrcracing.co.za");

const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
if (!publishableKey || publishableKey.includes("PASTE_") || publishableKey.includes("<")) {
  throw new Error("A real self-hosted development publishable key is required.");
}
if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(productionProjectRef)) {
  throw new Error("Development builds may not use the production Supabase project.");
}
if (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED !== "false") {
  throw new Error("Payments must remain disabled in the development environment.");
}

process.env.MRC_DEPLOY_TARGET = "development";

await new Promise((resolve, reject) => {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "build:static"], {
    cwd: frontendDirectory,
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Development build failed with exit code ${code}.`)));
});

const htaccessPath = path.join(frontendDirectory, "out", ".htaccess");
let htaccess = await readFile(htaccessPath, "utf8");
htaccess = htaccess
  .replace("!^www\\.mrcracing\\.co\\.za$", "!^dev\\.mrcracing\\.co\\.za$")
  .replace("https://www.mrcracing.co.za%{REQUEST_URI}", "https://dev.mrcracing.co.za%{REQUEST_URI}")
  .replaceAll("https://*.supabase.co", "https://api-dev.mrcracing.co.za")
  .replaceAll("wss://*.supabase.co", "wss://api-dev.mrcracing.co.za");
await writeFile(htaccessPath, htaccess, "utf8");
await appendFile(
  htaccessPath,
  "\n<IfModule mod_headers.c>\n  Header always set X-Robots-Tag \"noindex, nofollow, noarchive\"\n</IfModule>\n",
  "utf8",
);

await import("./verify-static-export.mjs");
