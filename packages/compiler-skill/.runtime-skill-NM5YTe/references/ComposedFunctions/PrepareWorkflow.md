# PrepareWorkflow

<fqn>Demo.ResourceWorkflow.ComposedFunction.PrepareWorkflow</fqn>
<kind>ComposedFunction</kind>
<description>Prepare a workflow by composing lower-level procedure preparation logic.</description>

<usage>
Call `run_callable_resource("Demo.ResourceWorkflow.ComposedFunction.PrepareWorkflow", input, runtime)` with an input object matching <input_schema>.
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
    "ready": {
      "type": "boolean"
    }
  }
}
```
</output_schema>

<instruction>
Use this ComposedFunction when a caller wants an end-to-end preparation result instead of a single primitive calculation.
It may call lower-level Functions but should expose a business-level result.
</instruction>
