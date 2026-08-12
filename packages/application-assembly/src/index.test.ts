import { describe, expect, test } from "bun:test"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadResourceTree } from "halfcode-compiler-resource-core"
import { loadApplicationAssembly, resolveApplicationAssembly } from "./index"

const resourceRootDir = join(import.meta.dir, "../../../apps/demo-resource-workflow-authoring/resources-xnl")
const xnlAssemblyRoot = join(import.meta.dir, "../tests/fixtures/XnlAssembly")

describe("application-assembly", () => {
  test("normalizes XNL resource registry facts for compiler input", async () => {
    const assembly = await loadApplicationAssembly({ resourceRootDir })

    expect(assembly.functions.map((item) => item.fqn)).toEqual([
      "Demo.ResourceWorkflow.Function.PrepareProcedure",
    ])
    expect(assembly.composedFunctions.map((item) => item.fqn)).toEqual([
      "Demo.ResourceWorkflow.ComposedFunction.PrepareWorkflow",
    ])
    expect(assembly.businessObjects.map((item) => item.fqn).sort()).toEqual([
      "Demo.ResourceWorkflow.BO.MakerSpace.Member",
      "Demo.ResourceWorkflow.BO.MakerSpace.Reservation",
      "Demo.ResourceWorkflow.BO.MakerSpace.Tool",
    ])
    const reservation = assembly.businessObjects.find((item) => item.fqn === "Demo.ResourceWorkflow.BO.MakerSpace.Reservation")
    expect(reservation?.targetKinds).toEqual([{
      kindFqn: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation",
      ownerKindFqn: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation",
      role: "object",
    }])
    expect(reservation?.operations).toEqual([
      expect.objectContaining({
        ref: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.approve",
        behavior: "action",
        targets: { kind: "single", kindFqn: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation" },
        invocationModes: ["single", "batch"],
        effect: "write",
      }),
      expect.objectContaining({
        ref: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.markApproved",
        behavior: "mutation",
      }),
    ])
    expect(reservation?.source.logicalPath).toBe(
      "BusinessObjects/Reservation/manifest.xnl",
    )
    expect(assembly.byFqn.has("Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Action.Approve")).toBe(false)
    expect(assembly.byFqn.has("Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Mutation.MarkApproved")).toBe(false)
    expect(assembly.skillCapsules[0]?.template.content).toContain("<composed_functions>")
    expect(assembly.pageObjects).toEqual([expect.objectContaining({
      kind: "PageObject",
      fqn: "Demo.ResourceWorkflow.PageObject.ReservationDetail",
      id: "reservation-detail",
      targetKinds: [
        {
          kindFqn: "Demo.ResourceWorkflow.PageObject.ReservationDetail",
          ownerKindFqn: "Demo.ResourceWorkflow.PageObject.ReservationDetail",
          role: "object",
        },
        {
          kindFqn: "Demo.ResourceWorkflow.PageObject.ReservationDetail.Form",
          ownerKindFqn: "Demo.ResourceWorkflow.PageObject.ReservationDetail",
          role: "nested-subject",
        },
      ],
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
    })])
    expect(assembly.byFqn.get("Demo.ResourceWorkflow.PageObject.ReservationDetail")?.kind).toBe("PageObject")
    expect(assembly.skillCapsules.find((skill) => skill.fqn === "Demo.ResourceWorkflow.Skill.Main")?.metadata).toEqual(
      expect.objectContaining({ version: "1.0.0" }),
    )

    const tree = await loadResourceTree({ rootDir: resourceRootDir })
    expect(tree.registry.byKind.get("BusinessObject")?.[0]?.sourceShape).toBe("manifest")
    expect(tree.registry.byKind.get("BusinessAction")?.[0]?.sourceShape).toBe("manifest")
    expect(tree.registry.byKind.get("BusinessMutation")?.[0]?.sourceShape).toBe("manifest")
  })

  test("composes shared and domain modules with provenance and typed port bindings", async () => {
    const sharedRoot = join(import.meta.dir, "../../../apps/demo-resource-workflow-shared-authoring/resources-xnl")
    const assembly = await resolveApplicationAssembly({
      modules: [{
        id: "SharedAuthoring",
        packageName: "demo-resource-workflow-shared-authoring",
        family: "demo-resource-workflow",
        scope: "shared",
        resourceRootDir: sharedRoot,
        ports: [{
          fqn: "Demo.ResourceWorkflow.Shared.Port.PrepareProcedure",
          description: "Prepare procedure provider.",
          resourceKind: "Function",
          contractRef: "resource://Demo.ResourceWorkflow.Contract.PrepareProcedure.Input",
        }],
      }, {
        id: "DomainAuthoring",
        packageName: "demo-resource-workflow-authoring",
        family: "demo-resource-workflow",
        scope: "domain",
        resourceRootDir,
      }],
      portBindings: [{
        portFqn: "Demo.ResourceWorkflow.Shared.Port.PrepareProcedure",
        resourceRef: "resource://Demo.ResourceWorkflow.Function.PrepareProcedure",
      }],
    })

    expect(assembly.modules).toHaveLength(2)
    expect(assembly.portBindings[0]?.resource.fqn).toBe("Demo.ResourceWorkflow.Function.PrepareProcedure")
    expect(assembly.byFqn.get("Demo.ResourceWorkflow.Shared.PromptFragment.ReusableWorkflowGuidance")?.source.packageName)
      .toBe("demo-resource-workflow-shared-authoring")
    expect(assembly.byFqn.get("Demo.ResourceWorkflow.Function.PrepareProcedure")?.source.moduleId)
      .toBe("DomainAuthoring")
  })

  test("projects canonical XNL Skill versions and typed sibling dependencies", async () => {
    const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
    const rootSkill = assembly.skillCapsules.find((item) => item.fqn === "demo.xnl_assembly.skill.demo")
    const dependencySkill = assembly.skillCapsules.find((item) => item.fqn === "demo.xnl_assembly.skill.dependency")

    expect(rootSkill).toEqual(expect.objectContaining({
      apiVersion: "halfcode.resources/v1",
      version: "1.0.0",
      metadata: expect.objectContaining({ version: "1.0.0" }),
      dependencies: [{
        ref: "resource://demo.xnl_assembly.skill.dependency",
        fqn: "demo.xnl_assembly.skill.dependency",
        version: "1.0.0",
      }],
    }))
    expect(dependencySkill).toEqual(expect.objectContaining({
      apiVersion: "halfcode.resources/v1",
      version: "1.0.0",
      metadata: expect.objectContaining({ version: "1.0.0" }),
      dependencies: [],
    }))
  })

  test("rejects conflicting YAML Skill versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-skill-version-"))
    await cp(xnlAssemblyRoot, root, { recursive: true })
    await writeFile(join(root, "Skills/Dependency/skill.yaml"), [
      "name: dependency-xnl",
      "description: XNL dependency fixture skill",
      "version: 2.0.0",
      "",
    ].join("\n"))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("SKILL_CAPSULE_VERSION_CONFLICT")
  })

  test.each([
    ["missing", "resource://demo.xnl_assembly.skill.missing", "SKILL_DEPENDENCY_MISSING"],
    ["wrong kind", "resource://demo.xnl_assembly.function.prepare", "SKILL_DEPENDENCY_KIND_MISMATCH"],
  ])("rejects %s Skill dependencies", async (_label, dependencyRef, expectedCode) => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-skill-dependency-"))
    await cp(xnlAssemblyRoot, root, { recursive: true })
    const descriptorPath = join(root, "Skills/Demo/manifest.xnl")
    const descriptor = await readFile(descriptorPath, "utf8")
    await writeFile(descriptorPath, descriptor.replace(
      "resource://demo.xnl_assembly.skill.dependency",
      dependencyRef,
    ))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow(expectedCode)
  })

  test("rejects exact Skill dependency version mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-skill-dependency-version-"))
    await cp(xnlAssemblyRoot, root, { recursive: true })
    const descriptorPath = join(root, "Skills/Demo/manifest.xnl")
    const descriptor = await readFile(descriptorPath, "utf8")
    await writeFile(descriptorPath, descriptor.replace(
      'ref = "resource://demo.xnl_assembly.skill.dependency" version = "1.0.0"',
      'ref = "resource://demo.xnl_assembly.skill.dependency" version = "2.0.0"',
    ))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("SKILL_DEPENDENCY_VERSION_MISMATCH")
  })

  test("rejects duplicate FQNs across authoring modules", async () => {
    await expect(resolveApplicationAssembly({
      modules: [{
        id: "DomainOne",
        packageName: "demo-one",
        family: "demo-resource-workflow",
        scope: "domain",
        resourceRootDir,
      }, {
        id: "DomainTwo",
        packageName: "demo-two",
        family: "demo-resource-workflow",
        scope: "domain",
        resourceRootDir,
      }],
    })).rejects.toThrow("Duplicate resource FQN")
  })

  test("rejects duplicate PageObject operation ids before projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-pageobject-"))
    await cp(resourceRootDir, root, { recursive: true })
    const descriptorPath = join(root, "PageObjects/ReservationDetail/manifest.xnl")
    const descriptor = await readFile(descriptorPath, "utf8")
    await writeFile(descriptorPath, descriptor.replace(
      "#save",
      "#fill",
    ))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("duplicate operation ref")
  })

  test("rejects unpublished operation targets before projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-pageobject-target-"))
    await cp(resourceRootDir, root, { recursive: true })
    const descriptorPath = join(root, "PageObjects/ReservationDetail/manifest.xnl")
    const descriptor = await readFile(descriptorPath, "utf8")
    await writeFile(descriptorPath, descriptor.replace(
      'targetKindFqn = "Demo.ResourceWorkflow.PageObject.ReservationDetail.Form"',
      'targetKindFqn = "Demo.ResourceWorkflow.PageObject.ReservationDetail.Unknown"',
    ))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("targets unpublished kind")
  })

  test("rejects BusinessObject operation bindings with the wrong owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-businessobject-owner-"))
    await cp(resourceRootDir, root, { recursive: true })
    const descriptorPath = join(root, "BusinessObjects/Reservation/Actions/Approve/manifest.xnl")
    const descriptor = await readFile(descriptorPath, "utf8")
    await writeFile(descriptorPath, descriptor.replace(
      'ownerRef = "resource://Demo.ResourceWorkflow.BO.MakerSpace.Reservation"',
      'ownerRef = "resource://Demo.ResourceWorkflow.BO.MakerSpace.Tool"',
    ))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("owner does not match")
  })

  test("rejects target kinds owned by another object", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-businessobject-target-owner-"))
    await cp(resourceRootDir, root, { recursive: true })
    const descriptorPath = join(root, "BusinessObjects/Reservation/manifest.xnl")
    const descriptor = await readFile(descriptorPath, "utf8")
    await writeFile(descriptorPath, descriptor.replace(
      'targetKindFqn = "Demo.ResourceWorkflow.BO.MakerSpace.Reservation"',
      'targetKindFqn = "Demo.ResourceWorkflow.BO.MakerSpace.Tool"',
    ))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("is owned by Demo.ResourceWorkflow.BO.MakerSpace.Tool")
  })

  test("rejects executable mutation resources without a code binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-businessmutation-binding-"))
    await cp(resourceRootDir, root, { recursive: true })
    const descriptorPath = join(root, "BusinessObjects/Reservation/Mutations/MarkApproved/manifest.xnl")
    const descriptor = await readFile(descriptorPath, "utf8")
    await writeFile(descriptorPath, descriptor.replace(/^\s*<CodeBinding[^\n]+\n/m, ""))

    await expect(loadApplicationAssembly({ resourceRootDir: root }))
      .rejects.toThrow("is missing CodeBinding")
  })
})
