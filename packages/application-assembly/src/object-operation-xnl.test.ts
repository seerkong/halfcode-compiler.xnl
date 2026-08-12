import { describe, expect, test } from "bun:test"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadResourceTree } from "halfcode-compiler-resource-core"
import { loadApplicationAssembly } from "./index"

const demoResourceRootDir = join(import.meta.dir, "../../../apps/demo-resource-workflow-authoring/resources-xnl")
const resourceRootDir = await canonicalDemoFixture()

describe("XNL object-operation assembly", () => {
  test("projects BusinessObject and PageObject owners with distinct private bindings", async () => {
    const assembly = await loadApplicationAssembly({
      resourceRootDir,
      packageName: "demo-resource-workflow-authoring",
    })

    const reservation = assembly.businessObjects.find((item) =>
      item.fqn === "Demo.ResourceWorkflow.BO.MakerSpace.Reservation"
    )
    expect(reservation?.operations).toEqual([
      expect.objectContaining({
        ref: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.approve",
        behavior: "action",
        targets: { kind: "single", kindFqn: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation" },
        invocationModes: ["single", "batch"],
      }),
      expect.objectContaining({
        ref: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.markApproved",
        behavior: "mutation",
      }),
    ])
    expect(assembly.byFqn.has("Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Action.Approve")).toBe(false)
    expect(assembly.byFqn.has("Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Mutation.MarkApproved")).toBe(false)
    expect(assembly.pageObjects[0]).toEqual(expect.objectContaining({
      fqn: "Demo.ResourceWorkflow.PageObject.ReservationDetail",
      id: "reservation-detail",
      operations: expect.arrayContaining([
        expect.objectContaining({
          ref: "Demo.ResourceWorkflow.PageObject.ReservationDetail.open",
          behavior: "action",
          targets: { kind: "none" },
        }),
        expect.objectContaining({
          ref: "Demo.ResourceWorkflow.PageObject.ReservationDetail.reconcile",
          behavior: "mutation",
        }),
      ]),
    }))

    const tree = await loadResourceTree({ rootDir: resourceRootDir })
    expect([...tree.registry.byKind.values()].flat().every((record) => record.format === "xnl")).toBe(true)
  })

  test("rejects an XNL owner that targets an unpublished kind", async () => {
    const root = await copyFixture("halfcode-xnl-target-")
    await replaceIn(root, "PageObjects/ReservationDetail/manifest.xnl",
      "Demo.ResourceWorkflow.PageObject.ReservationDetail.Form",
      "Demo.ResourceWorkflow.PageObject.ReservationDetail.Unknown",
    )
    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("targets unpublished kind")
  })

  test("rejects duplicate XNL operation refs", async () => {
    const root = await copyFixture("halfcode-xnl-duplicate-")
    await replaceIn(root, "PageObjects/ReservationDetail/manifest.xnl", "#save", "#fill")
    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("duplicate operation ref")
  })

  test("rejects an XNL resource binding whose owner does not match", async () => {
    const root = await copyFixture("halfcode-xnl-owner-")
    await replaceIn(root, "BusinessObjects/Reservation/Actions/Approve/manifest.xnl",
      "resource://Demo.ResourceWorkflow.BO.MakerSpace.Reservation",
      "resource://Demo.ResourceWorkflow.BO.MakerSpace.Tool",
    )
    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("owner does not match")
  })

  test("rejects an XNL executable resource without CodeBinding", async () => {
    const root = await copyFixture("halfcode-xnl-binding-")
    await replaceIn(root, "BusinessObjects/Reservation/Mutations/MarkApproved/manifest.xnl",
      "<CodeBinding { package = \"demo-resource-workflow-authoring\" module = \"./src/BusinessMutations/ReservationMarkApproved\" export = \"markApprovedReservationMutation\" }>",
      "",
    )
    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("is missing CodeBinding")
  })
})

async function copyFixture(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await cp(resourceRootDir, root, { recursive: true })
  return root
}

async function canonicalDemoFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "halfcode-object-operation-demo-"))
  await cp(demoResourceRootDir, root, { recursive: true })
  const metadataPath = join(root, "SkillCapsules/Main/SKILL.metadata.yaml")
  const metadata = await readFile(metadataPath, "utf8")
  await writeFile(metadataPath, metadata.replace("version: 0.0.0", "version: 1.0.0"))
  return root
}

async function replaceIn(root: string, relativePath: string, from: string, to: string): Promise<void> {
  const file = join(root, relativePath)
  const source = await readFile(file, "utf8")
  expect(source).toContain(from)
  await writeFile(file, source.replace(from, to))
}
