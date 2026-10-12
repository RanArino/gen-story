import { describe, expect, it } from "vitest";

import { validateEditPlan } from "./edit-plan";

function plan() {
  return {
    schema_version: 1,
    video: { aspect_ratio: "9:16", language: "ja" },
    scenes: [
      {
        order: 1,
        asset_path: "assets/scene-01.jpg",
        start_sec: 0,
        end_sec: 2,
        transition: { name: "Dissolve", duration_sec: 0.35 },
        text: { content: "Opening", start_sec: 0.2, end_sec: 1.8 },
      },
      {
        order: 2,
        asset_path: "assets/scene-02.jpg",
        start_sec: 2,
        end_sec: 4,
        transition: { name: "None", duration_sec: 0 },
        text: null,
      },
    ],
  };
}

describe("validateEditPlan", () => {
  it("accepts a contiguous editor-neutral plan", () => {
    expect(validateEditPlan(plan()).scenes).toHaveLength(2);
  });

  it("rejects a gap between scenes", () => {
    const value = plan();
    value.scenes[1]!.start_sec = 2.1;
    expect(() => validateEditPlan(value)).toThrow("contiguous");
  });

  it("rejects a transition longer than its outgoing clip", () => {
    const value = plan();
    value.scenes[0]!.transition.duration_sec = 2.1;
    expect(() => validateEditPlan(value)).toThrow("outgoing clip");
  });

  it("rejects text outside its scene", () => {
    const value = plan();
    value.scenes[0]!.text!.end_sec = 2.1;
    expect(() => validateEditPlan(value)).toThrow("within its scene");
  });

  it("rejects a timeline longer than 60 seconds", () => {
    const value = plan();
    value.scenes[1]!.end_sec = 60.01;
    expect(() => validateEditPlan(value)).toThrow("60.00-second");
  });

  it("rejects an asset path that escapes the bundle", () => {
    const value = plan();
    value.scenes[0]!.asset_path = "../private.jpg";
    expect(() => validateEditPlan(value)).toThrow("inside the bundle");
  });

  it("rejects a Windows absolute asset path on every host platform", () => {
    const value = plan();
    value.scenes[0]!.asset_path = "C:\\private.jpg";
    expect(() => validateEditPlan(value)).toThrow("inside the bundle");
  });

  it("rejects a transition after the final scene", () => {
    const value = plan();
    value.scenes[1]!.transition = {
      name: "Fade",
      duration_sec: 0.4,
    };
    expect(() => validateEditPlan(value)).toThrow("final scene transition");
  });
});
