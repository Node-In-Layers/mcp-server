Feature: NIL feature operations via MCP HTTP server

  Scenario: Can list features for a domain
    Given we use "mcp-default" mcp context
    When we call MCP tool "list_features" with args '{"domain":"test-app"}'
    Then result should match "features-list-success"

  Scenario: Can describe an annotated feature
    Given we use "mcp-default" mcp context
    When we call MCP tool "describe_feature" with args '{"domain":"test-app","featureName":"inspectHeaders"}'
    Then result should match "feature-describe-success"

  Scenario: Can execute a feature
    Given we use "mcp-default" mcp context
    When we call MCP tool "execute_feature" with args '{"domain":"test-app","featureName":"inspectHeaders","args":{}}'
    Then result should match "feature-execute-success"

  Scenario: Executed feature receives requestInfo with HTTP headers
    Given we use "mcp-default" mcp context
    When we call MCP tool "execute_feature" with args '{"domain":"test-app","featureName":"inspectHeaders","args":{}}' and header "Authorization" set to "Bearer xyz"
    Then result should match "feature-has-authorization-header"
