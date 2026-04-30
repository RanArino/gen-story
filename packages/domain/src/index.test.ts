import { describe, expect, it } from "vitest";

import { createProjectSummary } from "./index";

describe("createProjectSummary", () => {
  it("trims a valid project name", () => {
    expect(createProjectSummary("project_1", " Family Story ")).toEqual({
      id: "project_1",
      name: "Family Story",
    });
  });

  it("rejects an empty project name", () => {
    expect(() => createProjectSummary("project_1", " ")).toThrow(
      "Project name is required.",
    );
  });
});
