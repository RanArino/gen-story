import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createService } from "../authoring/service.js";
import { defaultPaths } from "../paths.js";

const paths = defaultPaths();
const transcriptFile = `${paths.out}evidence/skill-walkthrough.md`;
const walkthroughPending = !existsSync(transcriptFile) || readFileSync(transcriptFile, "utf8").includes("A30 is incomplete.");
const skill = readFileSync(`${paths.root}skills/capability-authoring/SKILL.md`, "utf8");

const operations = {
  "catalog search": "catalogSearch",
  "catalog inspect": "catalogInspect",
  "recipe fork": "recipeFork",
  validate: "validate",
  "candidate scaffold": "candidateScaffold",
  "candidate static-check": "candidateStaticCheck",
  "candidate compile": "candidateCompile",
  "candidate run": "candidateRun",
  "candidate evidence": "candidateEvidence",
  "candidate promotion-target": "candidatePromotionTarget",
  "review record": "reviewRecord",
  "registry promote": "registryPromote",
  replay: "replay",
} as const;

describe("Capability Authoring Skill", () => {
  it("[A30] every film-spike operation mention names an existing service operation", () => {
    const service = createService({ paths });
    const mentions = [...skill.matchAll(/film-spike ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)];
    expect(mentions.length).toBeGreaterThan(0);
    for (const [, command, subcommand] of mentions) {
      const operation = command === "validate" || command === "replay" ? command : `${command} ${subcommand}`;
      expect(operations, operation).toHaveProperty(operation);
      const method = operations[operation as keyof typeof operations];
      expect(typeof service[method], operation).toBe("function");
    }
  });

  it.skipIf(walkthroughPending)("[A30] walkthrough reaches the promotion handoff with exact operator stops and no agent approval command", () => {
    const transcript = readFileSync(`${paths.out}evidence/skill-walkthrough.md`, "utf8");
    expect(transcript).toMatch(/Status:.*A30 complete.*promotion remains unauthorized/i);
    expect(transcript).toMatch(/independent review is not required to complete A30/i);
    const executedSection = transcript.split("## Executed CLI transcript")[1]?.split("\n## ")[0];
    expect(executedSection).toBeTruthy();
    const executed = [...executedSection!.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
    expect(executed.length).toBeGreaterThan(0);
    for (const command of executed) expect(command).not.toMatch(/(?:^|\s)approve(?:\s|$)/);
    for (const kind of ["request", "execution", "promotion"]) {
      const command = transcript.match(new RegExp(`pnpm (?:--filter @gen-story/film-spike )?cli approve ${kind} (sha256:[a-f0-9]{64}) --subject [^\\n]+`));
      expect(command, `${kind} stop must give the exact operator command`).not.toBeNull();
      expect(transcript).toContain(`Confirmation: \`${command![1]!.slice(7, 15)}\``);
    }
    expect(executed.some((command) => command.includes("candidate promotion-target"))).toBe(true);
  });

  it("has agent-neutral front matter without editor registration", () => {
    expect(skill).toMatch(/^---\nname: capability-authoring\ndescription: [^\n]+\n---\n/);
  });
});
