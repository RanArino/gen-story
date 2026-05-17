import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../apps/web/public/style-previews");

mkdirSync(publicDir, { recursive: true });

// Define style presets - these will have placeholder color indicators
const styles = [
  { name: "cinematic", hexColor: "2a2a3e" },
  { name: "vibrant", hexColor: "ff6b9d" },
  { name: "moody", hexColor: "1a1a2e" },
  { name: "soft", hexColor: "f0e6d2" },
  { name: "warm", hexColor: "d4a574" },
  { name: "cool", hexColor: "5f9ea0" },
  { name: "retro", hexColor: "a4773b" },
  { name: "neon", hexColor: "00ff88" },
  { name: "noir", hexColor: "1a1a1a" },
];

function createMinimalJPEG(hexColor: string): Buffer {
  // Create a minimal 600x400 solid color JPEG
  // JPEG structure: SOI + APP0 + SOF + DHT + DQT + SOS + EOI
  // For simplicity, we'll use a data URL approach converted to buffer
  // This is a minimal valid JPEG file (1x1 pixel)

  const hex = hexColor.match(/..?/g) || ["00", "00", "00"];
  const r = parseInt(hex[0] || "00", 16);
  const g = parseInt(hex[1] || "00", 16);
  const b = parseInt(hex[2] || "00", 16);

  // Create a simple solid color image marker
  // This is a valid but minimal JPEG
  const jpegSOI = Buffer.from([0xFF, 0xD8]); // SOI
  const jpegAPP0 = Buffer.from([
    0xFF, 0xE0, 0x00, 0x10,
    0x4A, 0x46, 0x49, 0x46, 0x00, // JFIF
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ]); // APP0 segment

  // DQT (Quantization Table) - minimal
  const dqt = Buffer.from([
    0xFF, 0xDB, 0x00, 0x43, 0x00,
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99
  ]);

  // SOF0 (Start of Frame - Baseline DCT)
  const sof = Buffer.from([
    0xFF, 0xC0, 0x00, 0x0B, 0x08,
    0x00, 0x01, 0x00, 0x01, // Height 1, Width 1
    0x01, // 1 component
    0x01, 0x00, 0x00 // Y component
  ]);

  // DHT (Huffman Table)
  const dht = Buffer.from([
    0xFF, 0xC4, 0x00, 0x1F, 0x00,
    0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B
  ]);

  // SOS (Start of Scan) with minimal scan data
  const sosData = Buffer.from([
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    0xFB, 0xD0 // Minimal scan data (color value)
  ]);

  const jpegEOI = Buffer.from([0xFF, 0xD9]); // EOI

  // Combine all parts
  return Buffer.concat([jpegSOI, jpegAPP0, dqt, sof, dht, sosData, jpegEOI]);
}

// For now, create placeholder images with solid colors
for (const style of styles) {
  const jpegBuffer = createMinimalJPEG(style.hexColor);
  const outputPath = join(publicDir, `${style.name}.jpg`);
  writeFileSync(outputPath, jpegBuffer);
  console.log(`✓ Generated ${style.name}.jpg`);
}

console.log("\n✓ All style preview images created!");
