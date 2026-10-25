// Prepares the spike's fixture media under .media/ and pins it in media-lock.json.
// A second run verifies the existing files and reports drift; it never overwrites them.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "../env/fingerprint.js";

const PKG = fileURLToPath(new URL("../../", import.meta.url));
const MEDIA = `${PKG}.media/`;
const LOCK = `${MEDIA}media-lock.json`;
const SANDO = `${PKG}../../film-making-idea/film-studio/productions/sando/images/`;

const BEAT_MS = 625; // 96 BPM
const BGM_SECONDS = 600;

interface Source {
  path: string;
  kind: "image" | "sound";
  command: string[];
  produce: (target: string) => void;
}

interface LockEntry {
  path: string;
  kind: "image" | "sound";
  sha256: string;
  widthPx?: number;
  heightPx?: number;
  durationMs?: number;
  command: string[];
}

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

function syntheticImage(name: string, w: number, h: number, c0: string, c1: string, box: string): Source {
  const filter = `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:n=2:seed=7,drawbox=${box}:color=white@0.85:t=fill`;
  const args = ["-f", "lavfi", "-i", filter, "-frames:v", "1", "-fflags", "+bitexact", "-flags", "+bitexact"];
  return {
    path: `images/${name}.png`,
    kind: "image",
    command: ["ffmpeg", ...args],
    produce: (target) => ffmpeg([...args, target]),
  };
}

function sound(name: string, args: string[]): Source {
  const full = [...args, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact"];
  return {
    path: `sounds/${name}.wav`,
    kind: "sound",
    command: ["ffmpeg", ...full],
    produce: (target) => ffmpeg([...full, target]),
  };
}

const beat = BEAT_MS / 1000;
const sources: Source[] = [
  ...["s1", "s2", "s3", "s4"].map<Source>((id) => ({
    path: `images/${id}.jpg`,
    kind: "image",
    command: ["copy", `film-making-idea/film-studio/productions/sando/images/${id}.jpg`],
    produce: (target) => copyFileSync(`${SANDO}${id}.jpg`, target),
  })),
  // Off-center subjects exercise subject-aware cropping into 16:9.
  syntheticImage("s5-landscape-3x2", 2400, 1600, "0x2b3a55", "0xe8b26a", "x=1500:y=500:w=500:h=500"),
  syntheticImage("s6-portrait-2x3", 1600, 2400, "0x3d2b55", "0xf0c08a", "x=300:y=500:w=600:h=600"),
  syntheticImage("s7-portrait-4x5", 1600, 2000, "0x1f4037", "0x99f2c8", "x=900:y=1200:w=450:h=450"),
  syntheticImage("s8-ultrawide-21x9", 2520, 1080, "0x41295a", "0x2f0743", "x=300:y=300:w=420:h=420"),
  sound("bgm-96bpm", [
    "-f", "lavfi", "-i",
    `aevalsrc=0.18*sin(2*PI*110*t)+0.12*sin(2*PI*164.81*t)+0.25*sin(2*PI*55*t)*exp(-9*mod(t\\,${beat})):d=${BGM_SECONDS}`,
  ]),
  sound("ambience", ["-f", "lavfi", "-i", "anoisesrc=d=120:c=pink:a=0.08:seed=11", "-af", "lowpass=f=900"]),
  sound("hit", ["-f", "lavfi", "-i", "aevalsrc=0.6*sin(2*PI*180*t)*exp(-14*t):d=0.4"]),
];

function probe(target: string, kind: "image" | "sound"): Pick<LockEntry, "widthPx" | "heightPx" | "durationMs"> {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", target],
    { encoding: "utf8" },
  );
  const info = JSON.parse(out) as { streams: { width?: number; height?: number }[]; format: { duration?: string } };
  if (kind === "image") return { widthPx: info.streams[0]?.width, heightPx: info.streams[0]?.height };
  return { durationMs: Math.round(Number(info.format.duration) * 1000) };
}

function main(): number {
  mkdirSync(`${MEDIA}images`, { recursive: true });
  mkdirSync(`${MEDIA}sounds`, { recursive: true });
  const previous = existsSync(LOCK) ? (JSON.parse(readFileSync(LOCK, "utf8")) as { files: LockEntry[] }) : null;
  const byPath = new Map(previous?.files.map((f) => [f.path, f]));
  const entries: LockEntry[] = [];
  let created = 0;
  let changed = 0;

  for (const source of sources) {
    const target = `${MEDIA}${source.path}`;
    if (!existsSync(target)) {
      source.produce(target);
      created += 1;
    }
    const digest = sha256(readFileSync(target));
    const locked = byPath.get(source.path);
    if (locked && locked.sha256 !== digest) {
      changed += 1;
      console.error(`DRIFT ${source.path}: locked ${locked.sha256}, found ${digest}`);
    }
    const entry: LockEntry = { path: source.path, kind: source.kind, sha256: digest, ...probe(target, source.kind), command: source.command };
    entries.push(locked ?? entry);
    const size = entry.widthPx ? `${entry.widthPx}x${entry.heightPx}` : `${entry.durationMs}ms`;
    console.log(`${source.kind.padEnd(5)} ${source.path.padEnd(32)} ${size.padEnd(10)} ${digest}`);
  }

  if (!previous) {
    writeFileSync(LOCK, `${JSON.stringify({ version: 1, beatMs: BEAT_MS, files: entries }, null, 2)}\n`);
    console.log(`created ${created} files, wrote .media/media-lock.json`);
    return 0;
  }
  console.log(`verified ${entries.length} files, ${changed} changed${created ? `, ${created} recreated` : ""}`);
  return changed === 0 ? 0 : 1;
}

process.exit(main());
