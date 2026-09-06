import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const removedVersionField = /\b(?:apiVersion|currentApiVersion|supportedApiVersions|currentSpecVersion|supportedSpecVersions)\b/;
const removedRootVersion = /^<[A-Z][A-Za-z0-9]*\s+#[^\n>]*\bversion\s*=/m;

function collectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolute);
    return entry.isFile() && /\.(?:xnl|md)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("first-party resource version authoring ratchet", () => {
  test("keeps success resources and project Skills on envelopeVersion/specVersion", () => {
    const files = [
      ...collectSourceFiles(resolve(repoRoot, "apps")),
      ...collectSourceFiles(resolve(repoRoot, "docs/resource-dsl")),
      ...collectSourceFiles(resolve(repoRoot, "packages/application-assembly/tests/fixtures")),
      ...collectSourceFiles(resolve(repoRoot, "packages/resource-core/tests/fixtures")),
      resolve(repoRoot, "skills/app-develop/SKILL.md"),
      resolve(repoRoot, "skills/framework-resource-dsl/SKILL.md"),
    ];
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return removedVersionField.test(source) || removedRootVersion.test(source)
        ? [relative(repoRoot, file)]
        : [];
    });

    expect(files.length).toBeGreaterThan(50);
    expect(violations).toEqual([]);
  });
});
