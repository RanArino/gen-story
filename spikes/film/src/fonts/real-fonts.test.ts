import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { digestOf } from "../contracts/canonical.js";
import type {
  FontAssetManifest,
  ValidationReport,
} from "../contracts/types.js";
import { defaultPaths } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import { Registry } from "../registry/registry.js";

const paths = defaultPaths();
const families = ["noto-sans-jp", "noto-serif-jp", "cormorant-garamond"];
const promotedReady = families.every((family) =>
  existsSync(`${paths.state}registry/records/font.${family}@1.0.0.json`),
);

describe("downloaded Google Fonts", () => {
  it.skipIf(!promotedReady)(
    "[A24] the local registry retains the three fonts with passing inspection and matching operator approval",
    () => {
      const registry = new Registry(paths.state);
      for (const family of families) {
        const record = registry.record(`font.${family}`, "1.0.0")!;
        expect(record.entity).toBe("font");
        expect(record.trust).toBe("promoted");
        const manifest = registry.manifest<FontAssetManifest>(record);
        expect(digestOf(manifest)).toBe(record.manifestDigest);
        manifest.faces.forEach((face) =>
          expect(registry.readBlob(face.sha256!).length).toBeGreaterThan(0),
        );
        expect(
          registry.readBlob(manifest.license.sha256!).length,
        ).toBeGreaterThan(0);
        expect(record.validationReportDigests.length).toBeGreaterThan(0);
        for (const digest of record.validationReportDigests) {
          const report = JSON.parse(
            registry.readBlob(digest).toString("utf8"),
          ) as ValidationReport;
          expect(report.ok).toBe(true);
          expect(report.subject.digest).toBe(record.manifestDigest);
          expect(report.checks.every((check) => check.ok)).toBe(true);
        }
        expect(record.approvalIds.length).toBeGreaterThan(0);
        record.approvalIds.forEach((id) =>
          expect(
            requireApproval(paths.state, id, "promotion", record.manifestDigest)
              .operator,
          ).toBeTruthy(),
        );
      }
      expect(registry.verify()).toEqual([]);
    },
  );
});
