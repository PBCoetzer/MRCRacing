import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(scriptsDirectory, "..", "out");
const expectedFiles = ["index.html", "404.html", "robots.txt", "sitemap.xml"];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".txt", ".xml"]);
const secretPatterns = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
  { label: "Stripe live secret", pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { label: "Resend API key", pattern: /\bre_[A-Za-z0-9_-]{24,}\b/ },
];

async function findFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

function routeOutputPath(url) {
  const routePath = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  return routePath ? path.join(outputDirectory, routePath, "index.html") : path.join(outputDirectory, "index.html");
}

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

await stat(outputDirectory);

for (const expectedFile of expectedFiles) {
  await stat(path.join(outputDirectory, expectedFile));
}

const htaccess = await readFile(path.join(outputDirectory, ".htaccess"), "utf8");
if (
  !htaccess.includes('<FilesMatch "^__next\\..*\\.txt$">')
  || !htaccess.includes('Header set Cache-Control "no-store, max-age=0, must-revalidate"')
) {
  throw new Error("Static export does not disable caching for mutable Next route payloads.");
}

const files = await findFiles(outputDirectory);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
if (htmlFiles.length < 60) {
  throw new Error(`Static export contains only ${htmlFiles.length} HTML files; expected at least 60.`);
}

for (const file of files) {
  if (!textExtensions.has(path.extname(file))) continue;
  const value = await readFile(file, "utf8");

  for (const secret of secretPatterns) {
    if (secret.pattern.test(value)) {
      throw new Error(`${secret.label} found in ${path.relative(outputDirectory, file)}.`);
    }
  }

  for (const match of value.matchAll(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
    if (decodeJwtPayload(match[0])?.role === "service_role") {
      throw new Error(`Supabase service-role JWT found in ${path.relative(outputDirectory, file)}.`);
    }
  }
}

const sitemap = await readFile(path.join(outputDirectory, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (!sitemapUrls.length) {
  throw new Error("Sitemap contains no URLs.");
}

for (const sitemapUrl of sitemapUrls) {
  const parsed = new URL(sitemapUrl);
  if (!new Set(["mrcracing.co.za", "www.mrcracing.co.za"]).has(parsed.hostname)) {
    throw new Error(`Unexpected sitemap host: ${parsed.hostname}.`);
  }
  if (!parsed.pathname.endsWith("/")) {
    throw new Error(`Sitemap URL must use a trailing slash: ${sitemapUrl}.`);
  }
  await stat(routeOutputPath(sitemapUrl));
}

const dynamicUrls = sitemapUrls.filter((url) =>
  /\/(?:blog|tipsters)\/[^/]+\/$/.test(new URL(url).pathname),
);
if (!dynamicUrls.length) {
  throw new Error("No dynamic public blog or tipster routes were exported.");
}

for (const dynamicUrl of dynamicUrls) {
  const html = await readFile(routeOutputPath(dynamicUrl), "utf8");
  if (!/<h1\b/i.test(html)) {
    throw new Error(`Dynamic route lacks a server-rendered H1: ${dynamicUrl}.`);
  }
  if (/\/blog\/[^/]+\/$/.test(new URL(dynamicUrl).pathname)
    && (!html.includes("Join the conversation") || !html.includes("Post comment"))) {
    throw new Error(`Blog route lacks the client comment interface: ${dynamicUrl}.`);
  }
}

let payloadAliases = 0;
for (const file of files) {
  const relativeParts = path.relative(outputDirectory, file).split(path.sep);
  const payloadIndex = relativeParts.findIndex((part) => part.startsWith("__next."));
  if (payloadIndex < 0 || payloadIndex === relativeParts.length - 1) continue;

  const routeDirectory = path.join(outputDirectory, ...relativeParts.slice(0, payloadIndex));
  const aliasPath = path.join(routeDirectory, relativeParts.slice(payloadIndex).join("."));
  await stat(aliasPath);
  payloadAliases += 1;
}

if (!payloadAliases) {
  throw new Error("No flattened Next payload aliases were verified.");
}

console.log(
  `Verified ${htmlFiles.length} HTML files, ${sitemapUrls.length} sitemap routes, ${dynamicUrls.length} dynamic pages, and ${payloadAliases} payload aliases.`,
);
