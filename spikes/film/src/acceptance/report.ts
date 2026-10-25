export interface Row {
  id: string;
  title: string;
  scope: string;
  milestone: string;
  check: { vitestTag: string };
  requires: string[];
}

export interface Assertion {
  fullName: string;
  status: string;
}

export function evaluateRow(
  row: Row,
  results: Assertion[],
  implementedThrough: string,
  available: Record<string, () => boolean>,
) {
  const tests = results.filter((r) => r.fullName.includes(row.check.vitestTag));
  const passed = tests.filter((t) => t.status === "passed").length;
  const failed = tests.filter((t) => t.status === "failed").length;
  const missing = row.requires.filter((r) => !available[r]?.());
  let status: "pass" | "fail" | "pending";
  let detail: string;
  if (failed > 0) {
    status = "fail";
    detail = `${failed} of ${tests.length} tests failed`;
  } else if (
    Number(row.milestone.slice(1)) > Number(implementedThrough.slice(1))
  ) {
    status = "pending";
    detail = `${row.milestone} not implemented yet`;
  } else if (tests.length === 0) {
    status = "fail";
    detail = "no test carries this tag";
  } else if (missing.length || passed < tests.length) {
    status = "pending";
    detail = `${passed} of ${tests.length} tests pass${missing.length ? `; waiting for ${missing.join(", ")}` : "; remaining tests did not execute"}`;
  } else {
    status = "pass";
    detail = `${passed} tests pass`;
  }
  return {
    id: row.id,
    title: row.title,
    milestone: row.milestone,
    status,
    detail,
    tests: tests.map((t) => `${t.status}: ${t.fullName}`),
  };
}
