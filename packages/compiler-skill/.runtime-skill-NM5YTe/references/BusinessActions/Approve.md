# Approve

<fqn>Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Action.Approve</fqn>
<kind>BusinessAction</kind>
<description>Approve a requested reservation after its domain rules pass.</description>

<usage>
Call `run_callable_resource("Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Action.Approve", input, runtime)` with an input object matching <input_schema>.
</usage>

<input_schema>
```json
{
  "type": "object",
  "properties": {
    "subject": {
      "type": "object"
    }
  }
}
```
</input_schema>

<output_schema>
```json
{
  "type": "object",
  "properties": {
    "done": {
      "type": "boolean"
    }
  }
}
```
</output_schema>

<instruction>
Use this action only after the reservation window and member certification constraints are satisfied.
The action follows BO message style with Reservation as the subject and Approve as the verb.
</instruction>
