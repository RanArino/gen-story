// Font inspection entry point. Runs only inside the contained child process (see
// containment/contained.ts): read access to a temporary copy of the candidate and to fontkit,
// no write access, no network. It prints one JSON report on stdout and never throws past main.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const REQUIRED_TABLES = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "post"];

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function tableDirectory(bytes) {
  if (bytes.length < 12) throw new Error("file is shorter than an sfnt header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x4f54544f) throw new Error(`unsupported sfnt version 0x${version.toString(16)}`);
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.length) throw new Error("table directory is truncated");
  const tables = {};
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > bytes.length) throw new Error(`table ${tag} extends past the end of the file`);
    tables[tag] = { offset, length };
  }
  for (const tag of REQUIRED_TABLES) if (!tables[tag]) throw new Error(`required table ${tag} is missing`);
  if (!(tables.glyf && tables.loca) && !tables["CFF "] && !tables.CFF2) throw new Error("no glyph outlines (glyf/loca or CFF)");
  return tables;
}

function toRanges(codepoints) {
  const ranges = [];
  for (const cp of codepoints) {
    const last = ranges.at(-1);
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return ranges;
}

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const fontkit = await import(job.fontkitModule);
  const checks = [];
  const check = (name, ok, code, message) => checks.push(ok ? { name, ok } : { name, ok, code, message });
  const covered = new Set();
  const faces = [];

  for (const face of job.faces) {
    const size = statSync(face.path).size;
    if (size > job.maxBytes) {
      check("size", false, "FS_FONT_INVALID", `${face.file} is ${size} bytes, over the ${job.maxBytes} byte ceiling`);
      continue;
    }
    check("size", true);
    const bytes = readFileSync(face.path);
    const digest = sha256(bytes);
    check("digest", !face.sha256 || face.sha256 === digest, "FS_DIGEST_MISMATCH", `${face.file} digest ${digest} differs from the manifest`);
    let font;
    try {
      tableDirectory(bytes);
      font = fontkit.create(bytes);
      // Force the lazily parsed tables that the renderer and coverage checks rely on.
      void font.unitsPerEm;
      void font.numGlyphs;
      for (const cp of font.characterSet) covered.add(cp);
      for (let g = 0; g < Math.min(font.numGlyphs, 8); g += 1) void font.getGlyph(g).path.toSVG();
      check("tables", true);
    } catch (error) {
      check("tables", false, "FS_FONT_INVALID", `${face.file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const os2 = font["OS/2"];
    const axes = font.variationAxes ?? {};
    const weightOk = axes.wght ? face.weight >= axes.wght.min && face.weight <= axes.wght.max : os2?.usWeightClass === face.weight;
    check("face-weight", weightOk, "FS_FONT_INVALID", `${face.file} does not provide declared weight ${face.weight}`);
    const italic = Boolean(os2 && os2.fsSelection && os2.fsSelection.italic);
    check("face-style", (face.style === "italic") === italic, "FS_FONT_INVALID", `${face.file} style differs from declared ${face.style}`);
    // fontkit decodes fsType bit 1 (0x0002) as the noEmbedding boolean.
    const embedding = os2?.fsType;
    check("embedding", Boolean(embedding) && !embedding.noEmbedding, "FS_LICENSE_INCOMPLETE", `${face.file} restricts embedding or has no embedding metadata`);
    faces.push({ file: face.file, sha256: digest, numGlyphs: font.numGlyphs, weightClass: os2?.usWeightClass ?? null, variable: Boolean(axes.wght) });
  }

  for (const script of job.manifest.coverage.scripts) {
    const samples = job.samples[script] ?? [];
    const missing = samples.filter((c) => !covered.has(c.codePointAt(0)));
    check(
      `coverage-${script.toLowerCase()}`,
      missing.length === 0,
      "FS_FONT_COVERAGE_CLAIM",
      `declares ${script} but lacks ${missing.length} sample glyphs: ${missing.slice(0, 20).join("")}`,
    );
  }

  const license = job.license;
  let licenseOk = Boolean(license.path);
  if (licenseOk) {
    const text = readFileSync(license.path);
    licenseOk = text.length > 0 && (!license.sha256 || sha256(text) === license.sha256);
  }
  check("license-file", licenseOk, "FS_LICENSE_INCOMPLETE", `license file ${job.manifest.license.file} is missing, empty, or altered`);
  const rights = job.manifest.rights ?? {};
  check(
    "rights",
    rights.redistribution === true && rights.videoEmbedding === true,
    "FS_LICENSE_INCOMPLETE",
    "redistribution and video-embedding rights must both be recorded as granted",
  );

  const codepoints = [...covered].sort((a, b) => a - b);
  process.stdout.write(JSON.stringify({ checks, data: { faces, coverage: toRanges(codepoints), glyphCount: codepoints.length } }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ checks: [{ name: "inspector", ok: false, code: "FS_FONT_INVALID", message: String(error) }], data: {} }));
});
