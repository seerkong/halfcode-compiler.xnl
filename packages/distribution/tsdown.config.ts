import { defineConfig } from "tsdown"

const internalPackages = [
  "halfcode-compiler-application-assembly",
  "halfcode-compiler-authoring-runtime",
  "halfcode-compiler-contract-schema",
  "halfcode-compiler-kind-definition",
  "halfcode-compiler-resource-core",
  "halfcode-compiler-resource-mapping",
  "halfcode-compiler-resource-projection",
  "halfcode-compiler-runtime-testing",
  "halfcode-compiler-skill-capsule",
]

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "application-assembly": "src/application-assembly.ts",
    "skill-capsule": "src/skill-capsule.ts",
    "contract-schema": "src/contract-schema.ts",
    "authoring-runtime": "src/authoring-runtime.ts",
    "resource-core": "src/resource-core.ts",
    "resource-mapping": "src/resource-mapping.ts",
    "resource-projection": "src/resource-projection.ts",
    "kind-definition": "src/kind-definition.ts",
    testing: "src/testing.ts",
  },
  clean: true,
  dts: true,
  fixedExtension: false,
  format: "esm",
  platform: "node",
  target: "node20",
  deps: {
    alwaysBundle: internalPackages,
    onlyImport: ["typescript", "yaml"],
  },
})
