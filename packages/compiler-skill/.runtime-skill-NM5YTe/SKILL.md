---
name: demo-resource-workflow
description: Standard Skill capsule generated from generic FS-native resource facts.
---

# Demo Resource Workflow

This Skill is generated from FS-native XML resource facts.
Treat XML descriptors as identity authority, TypeScript contracts as schema authority, and generated files as rebuildable projections.

<composed_functions>

- Demo.ResourceWorkflow.ComposedFunction.PrepareWorkflow: Prepare a workflow by composing lower-level procedure preparation logic. (`references/ComposedFunctions/PrepareWorkflow.md`)

</composed_functions>

<functions>

- Demo.ResourceWorkflow.Function.PrepareProcedure: Prepare a procedure draft from structured input. (`references/Functions/PrepareProcedure.md`)

</functions>

<business_objects>

- Demo.ResourceWorkflow.BO.MakerSpace.Member: Member business-object resource. (`references/BusinessObjects/Member/BUSINESS_OBJECT.md`)

- Demo.ResourceWorkflow.BO.MakerSpace.Reservation: Reservation business-object resource and local capability manifest. (`references/BusinessObjects/Reservation/BUSINESS_OBJECT.md`)

- Demo.ResourceWorkflow.BO.MakerSpace.Tool: Tool business-object resource. (`references/BusinessObjects/Tool/BUSINESS_OBJECT.md`)

</business_objects>

<business_actions>

- Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Action.Approve: Approve a requested reservation after its domain rules pass. (`references/BusinessActions/Approve.md`)

</business_actions>

<business_mutations>

- Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Mutation.MarkApproved: Move the reservation state to approved. (`references/BusinessMutations/MarkApproved.md`)

</business_mutations>

<prompt_fragments>

- Demo.ResourceWorkflow.Shared.PromptFragment.ReusableWorkflowGuidance: Reusable guidance for deterministic workflow preparation. (`references/PromptFragments/ReusableWorkflowGuidance.md`)

- Demo.ResourceWorkflow.PromptFragment.SkillPrelude: Opening guidance for the generated demo Skill. (`references/PromptFragments/SkillPrelude.md`)

</prompt_fragments>

<application_sops>

- Demo.ResourceWorkflow.ApplicationSOP.MakerSpaceReservationApproval: Application-level SOP for approving a MakerSpace reservation. (`references/ApplicationSOPs/MakerSpaceReservationApproval.md`)

</application_sops>

<wiki_pages>

- Demo.ResourceWorkflow.Wiki.MakerSpaceReservationLifecycle: Concept page for the MakerSpace Reservation lifecycle. (`references/Wiki/MakerSpaceReservationLifecycle.md`)

</wiki_pages>

<callable_artifacts>
Use `functions/bundle.js` for target-neutral callable access:

```js
import {
  run_callable_resource,
} from "./functions/bundle.js"
```
</callable_artifacts>
