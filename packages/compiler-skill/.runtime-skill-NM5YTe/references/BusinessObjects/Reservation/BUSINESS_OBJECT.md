# Reservation

<fqn>Demo.ResourceWorkflow.BO.MakerSpace.Reservation</fqn>
<kind>BusinessObject</kind>
<description>Reservation business-object resource and local capability manifest.</description>

<available_actions>
- Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Action.Approve: references/BusinessActions/Approve.md
</available_actions>

<available_mutations>
- Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Mutation.MarkApproved: references/BusinessMutations/MarkApproved.md
</available_mutations>

<available_sops>
</available_sops>

<instruction>
Reservation is the central MakerSpace BO for approving a member's request to use a tool.
Check member certification, tool state, and reservation time-window rules before approving.
</instruction>
