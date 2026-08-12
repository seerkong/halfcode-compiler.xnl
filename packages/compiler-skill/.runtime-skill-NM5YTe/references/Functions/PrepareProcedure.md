# PrepareProcedure

<fqn>Demo.ResourceWorkflow.Function.PrepareProcedure</fqn>
<kind>Function</kind>
<description>Prepare a procedure draft from structured input.</description>

<usage>
Call `run_callable_resource("Demo.ResourceWorkflow.Function.PrepareProcedure", input, runtime)` with an input object matching <input_schema>.
</usage>

<input_schema>
```json
{
  "type": "object",
  "properties": {
    "procedureName": {
      "type": "string"
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
    "accepted": {
      "type": "boolean"
    }
  }
}
```
</output_schema>

<instruction>
Use this Function when the caller already knows the procedure name and objective.
Return the deterministic draft status only; broader workflow planning belongs in the ComposedFunction or Skill-level SOP.
</instruction>
