import { describe, expect, it } from "vitest";
import { checkSource } from "./static.js";

describe("candidate static parsing", () => {
  it("allows the ABI window property without allowing the browser window global", () => {
    expect(() => checkSource("export default input => ({ layers: [], audio: [], end: input.window.endMs });")).not.toThrow();
    expect(() => checkSource("window.location;")).toThrow("FS_FORBIDDEN_GLOBAL");
  });
  it("never executes top-level candidate code", () => {
    expect(() => checkSource('throw new Error("must not execute"); export default () => ({layers: [], audio: []});')).not.toThrow();
  });
  it.each([
    ['import fs from "node:fs";', "FS_FORBIDDEN_IMPORT"],
    ['export { x } from "node:fs";', "FS_FORBIDDEN_IMPORT"],
    ['fetch("https://example.com");', "FS_FORBIDDEN_GLOBAL"],
    ['import("node:fs");', "FS_FORBIDDEN_GLOBAL"],
    ['Math.random();', "FS_FORBIDDEN_GLOBAL"],
    ['const x = globalThis;', "FS_FORBIDDEN_GLOBAL"],
    ['const x = (() => {}).constructor;', "FS_FORBIDDEN_GLOBAL"],
    ['Math["ran" + "dom"]();', "FS_FORBIDDEN_GLOBAL"],
    [' '.repeat(256 * 1024 + 1), "FS_RESOURCE_CEILING"],
  ])("rejects forbidden source without executing it", (source, code) => {
    expect(() => checkSource(source)).toThrow(code);
  });
});
