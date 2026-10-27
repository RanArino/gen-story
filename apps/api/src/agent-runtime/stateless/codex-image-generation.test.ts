import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { runCodexImageGeneration } from "./codex-image-generation";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(body: string, login = "Logged in using ChatGPT") {
  const root = await mkdtemp(join(tmpdir(), "gen-story-codex-images-test-"));
  roots.push(root);
  const bin = join(root, "bin");
  await mkdir(bin);
  const png = await sharp({
    create: { width: 2, height: 3, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await writeFile(
    join(bin, "codex"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.164.0'); process.exit(0); }
if (args[0] === 'login') { console.error(${JSON.stringify(login)}); process.exit(0); }
fs.writeFileSync(${JSON.stringify(join(root, "invocation.json"))}, JSON.stringify({args, cwd:process.cwd(), hasApiKey: !!process.env.OPENAI_API_KEY || !!process.env.GEMINI_API_KEY}));
const png = ${JSON.stringify(png.toString("base64"))};
const write = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', raw => {
  const line = JSON.parse(raw);
  fs.appendFileSync(${JSON.stringify(join(root, "requests.jsonl"))}, raw+'\\n');
  if (line.method === 'initialize') write({id:line.id,result:{}});
  if (line.method === 'thread/start') write({id:line.id,result:{thread:{id:'thread-1'}}});
  if (line.method === 'turn/start') {
    ${body}
  }
});
`,
    { mode: 0o755 },
  );
  return {
    root,
    png,
    input: {
      repositoryRoot: root,
      prompt: "A family portrait",
      size: "1536x1024",
      quality: "high",
      environment: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        OPENAI_API_KEY: "not-forwarded",
        GEMINI_API_KEY: "not-forwarded",
      },
      timeoutMs: 5000,
    },
  };
}

const success = `
write({method:'item/completed',params:{item:{type:'imageGeneration',status:'completed',result:png}}});
write({method:'turn/completed',params:{turn:{id:'turn-1',status:'completed'}}});
write({id:line.id,result:{turn:{id:'turn-1'}}});
`;

describe("runCodexImageGeneration", () => {
  it("handles early image events, forwards references, confines sessions, and cleans up", async () => {
    const f = await fixture(success);
    const bytes = await runCodexImageGeneration({
      ...f.input,
      images: [f.png, f.png],
    });
    expect((await sharp(Buffer.from(bytes)).metadata()).width).toBe(2);
    const invocation = JSON.parse(
      await readFile(join(f.root, "invocation.json"), "utf8"),
    );
    expect(invocation.hasApiKey).toBe(false);
    expect(invocation.args).toContain("project_doc_max_bytes=0");
    expect(invocation.args).toContain('forced_login_method="chatgpt"');
    const requests = (await readFile(join(f.root, "requests.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      requests.find((r) => r.method === "thread/start").params,
    ).toMatchObject({
      ephemeral: true,
      sandbox: "workspace-write",
      approvalPolicy: "never",
    });
    const turn = requests.find((r) => r.method === "turn/start").params;
    expect(
      turn.input.filter((i: { type: string }) => i.type === "localImage"),
    ).toHaveLength(2);
    expect(turn.input[0].text).toContain("1536x1024");
    expect(turn.input[0].text).toContain("A family portrait");
    expect(
      await readdir(join(f.root, "data/agent-runtime-scratch/codex-images")),
    ).toEqual([]);
  });

  it("reads an output file inside the scratch directory", async () => {
    const f = await fixture(
      success
        .replace(
          "result:png",
          "savedPath:path.join(process.cwd(),'result.png')",
        )
        .replace(
          "write({method:'item/completed'",
          "fs.writeFileSync(path.join(process.cwd(),'result.png'),Buffer.from(png,'base64')); write({method:'item/completed'",
        ),
    );
    expect((await runCodexImageGeneration(f.input)).byteLength).toBeGreaterThan(
      0,
    );
  });

  it.each([
    ["empty output", success.replace("result:png", "fileId:'attachment-only'")],
    [
      "invalid bytes",
      success.replace("result:png", "result:'bm90LWFuLWltYWdl'"),
    ],
    [
      "tool failure",
      success.replace(
        "result:png",
        "result:png,failure:{type:'usageLimitExceeded'}",
      ),
    ],
    [
      "failed turn",
      success.replace(
        "id:'turn-1',status:'completed'",
        "id:'turn-1',status:'failed',error:{message:'quota exceeded'}",
      ),
    ],
    ["process exit", "process.exit(1);"],
    ["outside output", success.replace("result:png", "savedPath:__filename")],
    [
      "symlink escape",
      success
        .replace(
          "result:png",
          "savedPath:path.join(process.cwd(),'result.png')",
        )
        .replace(
          "write({method:'item/completed'",
          "fs.symlinkSync(__filename,path.join(process.cwd(),'result.png')); write({method:'item/completed'",
        ),
    ],
  ])("rejects %s and removes scratch files", async (_name, body) => {
    const f = await fixture(body);
    await expect(runCodexImageGeneration(f.input)).rejects.toThrow();
    expect(
      await readdir(join(f.root, "data/agent-runtime-scratch/codex-images")),
    ).toEqual([]);
  });

  it("requires a subscription login before starting generation", async () => {
    const f = await fixture(success, "Logged in using an API key");
    await expect(runCodexImageGeneration(f.input)).rejects.toThrow(
      "subscription_login_required",
    );
    await expect(readFile(join(f.root, "invocation.json"))).rejects.toThrow();
  });

  it("kills a hanging process at the overall deadline and removes scratch files", async () => {
    const f = await fixture("write({id:line.id,result:{turn:{id:'turn-1'}}});");
    await expect(
      runCodexImageGeneration({ ...f.input, timeoutMs: 900 }),
    ).rejects.toThrow("timed out");
    expect(
      await readdir(join(f.root, "data/agent-runtime-scratch/codex-images")),
    ).toEqual([]);
  });
});
