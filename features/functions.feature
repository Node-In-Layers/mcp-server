Feature: Annotated Functions

  Scenario: Using an annotated function
    Given we use "mcp-annotated" mcp context
    When we call MCP tool "add_numbers" with args '{"a":2,"b":3}'
    Then result should match "annotated-call-success"

  Scenario: Output schema validation fails when tool returns wrong data
    Given we use "mcp-annotated" mcp context
    When we call MCP tool "add_numbers_bad_output" with args '{"a":1,"b":2}'
    Then result should match "annotated-output-schema-validation-fails"