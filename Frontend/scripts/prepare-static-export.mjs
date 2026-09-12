import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(scriptsDirectory, "..", "out");

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

const exportedFiles = await findFiles(outputDirectory);
let copiedPayloads = 0;
let cleanedHtmlFiles = 0;

for (const sourcePath of exportedFiles) {
  if (sourcePath.endsWith(".html")) {
    const html = await readFile(sourcePath, "utf8");
    const cleanedHtml = html.replace(
      /<link rel="icon" href="\/favicon\.ico(?:\?[^"}]*)?"[^>]*\/>/g,
      "",
    );

    if (cleanedHtml !== html) {
      await writeFile(sourcePath, cleanedHtml, "utf8");
      cleanedHtmlFiles += 1;
    }
  }

  const relativeParts = path.relative(outputDirectory, sourcePath).split(path.sep);
  const nextPayloadIndex = relativeParts.findIndex((part) =>
    part.startsWith("__next."),
  );

  if (nextPayloadIndex < 0 || nextPayloadIndex === relativeParts.length - 1) {
    continue;
  }

  const routeDirectory = path.join(
    outputDirectory,
    ...relativeParts.slice(0, nextPayloadIndex),
  );
  const flattenedFileName = relativeParts.slice(nextPayloadIndex).join(".");
  const destinationPath = path.join(routeDirectory, flattenedFileName);

  await mkdir(routeDirectory, { recursive: true });
  await copyFile(sourcePath, destinationPath);
  copiedPayloads += 1;
}

console.log(
  `Prepared ${copiedPayloads} flattened Next payload aliases and removed legacy favicons from ${cleanedHtmlFiles} HTML files.`,
);
