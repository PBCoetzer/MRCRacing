import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const images = path.resolve(scriptsDirectory, "..", "public", "images");

await sharp(path.join(images, "mrc-racing-tips-logo.jpeg"))
  .resize({ width: 640, withoutEnlargement: true })
  .webp({ quality: 82, smartSubsample: true })
  .toFile(path.join(images, "mrc-racing-tips-hero.webp"));

await sharp(path.join(images, "mrc-racing-tips-logo.jpeg"))
  .resize({ width: 160, withoutEnlargement: true })
  .webp({ quality: 80, smartSubsample: true })
  .toFile(path.join(images, "mrc-racing-tips-logo.webp"));

for (const name of ["playabets", "10bet", "world-sports-betting", "hollywoodbets"]) {
  await sharp(path.join(images, "affiliates", `${name}.jpg`))
    .resize({ width: 640, withoutEnlargement: true })
    .webp({ quality: 78, smartSubsample: true })
    .toFile(path.join(images, "affiliates", `${name}.webp`));
}
