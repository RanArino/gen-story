// Executes the acceptance matrix: runs the spike's Vitest suite once, maps tagged tests to rows,
// prints a pass / fail / pending table, and writes out/acceptance/report.json.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeJson, defaultPaths } from "../paths.js";
import { evaluateRow, type Assertion, type Row } from "./report.js";

interface Matrix {
  implementedThrough: string;
  rows: Row[];
}
interface VitestJson {
  testResults: { assertionResults: Assertion[] }[];
}

const paths = defaultPaths();
const matrix = JSON.parse(readFileSync(`${paths.root}acceptance/matrix.json`, "utf8")) as Matrix;
const outFile = `${paths.out}acceptance/vitest.json`;
const reportFile = `${paths.out}acceptance/report.json`;

// Generated reports must describe this run, even when the test runner cannot start.
rmSync(outFile, { force: true });
rmSync(reportFile, { force: true });
const run = spawnSync("pnpm", ["exec", "vitest", "run", "--maxWorkers=2", "--reporter=json", `--outputFile=${outFile}`], { cwd: paths.root, encoding: "utf8" });
if (!existsSync(outFile)) {
  console.error(run.stderr || run.stdout);
  process.exit(1);
}
const results = (JSON.parse(readFileSync(outFile, "utf8")) as VitestJson).testResults.flatMap((t) => t.assertionResults);

const available: Record<string, () => boolean> = {
  chrome: () => !!process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH),
  ffmpeg: () => spawnSync("ffmpeg", ["-version"]).status === 0,
  "operator-fonts": () => ["noto-sans-jp", "noto-serif-jp", "cormorant-garamond"].every((family) => existsSync(`${paths.state}registry/records/font.${family}@1.0.0.json`)),
};

const rows = matrix.rows.map((row) => evaluateRow(row, results, matrix.implementedThrough, available));

for (const r of rows) console.log(`${r.id}  ${r.status.padEnd(7)} ${r.milestone}  ${r.title.padEnd(44)} ${r.detail}`);
const counts = { pass: 0, fail: 0, pending: 0 };
for (const r of rows) counts[r.status] += 1;
console.log(`\n${counts.pass} pass, ${counts.fail} fail, ${counts.pending} pending`);
const suite = { ok: run.status === 0, exitCode: run.status };
writeJson(reportFile, { implementedThrough: matrix.implementedThrough, suite, counts, rows });
if (!suite.ok) console.error(run.stderr || run.stdout || "test runner failed");
process.exit(!suite.ok || counts.fail > 0 ? 1 : 0);
