import { copyFile, mkdir, readdir } from "node:fs/promises";
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

for (const sourcePath of exportedFiles) {
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
  `Prepared ${copiedPayloads} flattened Next payload aliases for static Apache hosting.`,
);
