import type { AuthoringModuleDescriptor } from "halfcode-compiler-application-assembly"

export const halfcodeResourceDslSystemSkillModule: AuthoringModuleDescriptor = {
  id: "ResourceDsl",
  packageName: "halfcode-resource-dsl-system-skill",
  family: "halfcode-resource-dsl",
  scope: "shared",
  resourceRootDir: new URL("../../../docs/resource-dsl", import.meta.url).pathname,
}
