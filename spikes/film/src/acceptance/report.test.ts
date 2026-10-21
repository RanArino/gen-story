import { describe, expect, it } from "vitest";
import { evaluateRow, type Row } from "./report.js";

const row: Row = {
  id: "A24",
  title: "Font promotion",
  scope: "Imported fonts must be explicitly promoted",
  milestone: "M2",
  check: { vitestTag: "[A24]" },
  requires: ["operator-fonts"],
};

describe("acceptance evidence", () => {
  it("does not pass a row whose tagged integration test was skipped", () => {
    const result = evaluateRow(
      row,
      [
        { fullName: "[A24] fixture lifecycle", status: "passed" },
        { fullName: "[A24] real font registry", status: "pending" },
      ],
      "M3",
      { "operator-fonts": () => true },
    );
    expect(result.status).toBe("pending");
  });

  it("fails a row with failing evidence even when its dependency is missing", () => {
    const result = evaluateRow(
      row,
      [{ fullName: "[A24] real font registry", status: "failed" }],
      "M3",
      {},
    );
    expect(result.status).toBe("fail");
  });

  it("keeps later milestones pending and requires tagged tests for implemented rows", () => {
    expect(evaluateRow(row, [], "M1", {}).status).toBe("pending");
    expect(evaluateRow(row, [], "M3", {}).status).toBe("fail");
  });

  it("passes only with executed passing evidence and available dependencies", () => {
    const tests = [{ fullName: "[A24] real font registry", status: "passed" }];
    expect(evaluateRow(row, tests, "M3", {}).status).toBe("pending");
    expect(
      evaluateRow(row, tests, "M3", { "operator-fonts": () => true }).status,
    ).toBe("pass");
  });
});
