import { compileContractSchemas } from "halfcode-compiler-contract-schema"

const packageRoot = new URL("..", import.meta.url).pathname
const checkOnly = process.argv.includes("--check")

const report = await compileContractSchemas({
  packageRoot,
  checkOnly,
  expectedKind: "Contract",
})

console.log(`${checkOnly ? "checked" : "generated"} ${report.facts.length} contract fact(s)`)
