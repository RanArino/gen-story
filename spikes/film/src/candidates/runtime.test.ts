import { describe, expect, it } from "vitest";
import type { CapabilityInput } from "../capability-sdk/abi.js";
import type { CapabilityManifest } from "../contracts/types.js";
import { readFixture } from "../testing/fixtures.js";
import { tempPaths } from "../testing/state.js";
import { checkOutput, executeContained } from "./runtime.js";

describe("candidate contained runner infrastructure", () => {
  const inputs = [{} as CapabilityInput];
  it("runs twice within a process and exposes stateful output differences", () => {
    const paths = tempPaths();
    const source = 'let counter = 0; export default () => ({ layers: [], audio: [], counter: counter++ });';
    const first = executeContained(source, inputs, `${paths.state}run-a`, 2);
    const second = executeContained(source, inputs, `${paths.state}run-b`, 1);
    expect(first[0]?.[0]).toBe(second[0]?.[0]);
    expect(first[0]?.[0]).not.toBe(first[0]?.[1]);
  });
  it("loads only the trusted SDK and rejects filesystem access in the child", () => {
    const paths = tempPaths();
    expect(executeContained('import { empty } from "film-capability-sdk"; export default empty;', inputs, `${paths.state}sdk`, 1)).toEqual([['{"layers":[],"audio":[]}']]);
    // Direct low-level runner test: static checks would reject this source before execution.
    expect(() => executeContained('import fs from "node:fs"; export default () => fs.readFileSync("/etc/hosts");', inputs, `${paths.state}denied`, 1)).toThrow("FS_RUNTIME_ERROR");
  });
  it("counts transition envelope keyframes in the declared budget", () => {
    const manifest = readFixture<CapabilityManifest>("valid/capability-manifest.json");
    manifest.budgets.maxKeyframes = 1;
    const output = { layers: [], audio: [], envelopes: { incoming: { opacity: { keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } } } };
    expect(() => checkOutput(JSON.stringify(output), manifest)).toThrow("FS_RESOURCE_CEILING");
  });
});
