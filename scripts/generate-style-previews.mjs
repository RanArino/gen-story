import sharp from "sharp";
import { createWriteStream, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../apps/web/public/style-previews");

// Create directory if it doesn't exist
mkdirSync(publicDir, { recursive: true });

// Define style presets with their colors and names
const styles = [
  { name: "cinematic", color: "#2a2a3e", label: "Cinematic" },
  { name: "vibrant", color: "#ff6b9d", label: "Vibrant" },
  { name: "moody", color: "#1a1a2e", label: "Moody" },
  { name: "soft", color: "#f0e6d2", label: "Soft" },
  { name: "warm", color: "#d4a574", label: "Warm" },
  { name: "cool", color: "#5f9ea0", label: "Cool" },
  { name: "retro", color: "#a4773b", label: "Retro" },
  { name: "neon", color: "#00ff88", label: "Neon" },
  { name: "noir", color: "#1a1a1a", label: "Noir" },
];

async function generatePreview(name, color, label) {
  const width = 600;
  const height = 400;

  // Create a simple gradient background
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color};stop-opacity:1" />
          <stop offset="100%" style="stop-color:#000000;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)"/>
      <text x="${width / 2}" y="${height / 2 + 20}" font-size="48" font-family="Arial, sans-serif" fill="white" text-anchor="middle" font-weight="bold">${label}</text>
    </svg>
  `;

  const outputPath = join(publicDir, `${name}.jpg`);
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  console.log(`✓ Generated ${name}.jpg`);
}

async function main() {
  console.log(`Creating style preview images in ${publicDir}...`);

  for (const style of styles) {
    await generatePreview(style.name, style.color, style.label);
  }

  console.log("\n✓ All preview images generated successfully!");
}

main().catch(console.error);
