Feature: Model CRUD operations via MCP HTTP server

  Scenario: Can list models for a domain
    Given we use "mcp-default" mcp context
    When we call MCP tool "list_models" with args '{"domain":"test-app"}'
    Then result should match "models-list-success"

  Scenario: Can describe a model
    Given we use "mcp-default" mcp context
    When we call MCP tool "describe_model" with args '{"domain":"test-app","modelType":"test-app/TodoItems"}'
    Then result should match "model-describe-success"

  Scenario: Can save a model instance
    Given we use "mcp-default" mcp context
    When we call MCP tool "model_save" with args '{"modelType":"test-app/TodoItems","instance":{"title":"My First Todo"}}'
    Then result should match "model-save-success"

  Scenario: Can retrieve a saved model instance
    Given we use "mcp-default" mcp context
    When we call MCP tool "model_save" with args '{"modelType":"test-app/TodoItems","instance":{"title":"Retrieve Me"}}'
    And we call MCP tool "model_retrieve" with id from last save result
    Then result should match "model-retrieve-success"

  Scenario: Can delete a model instance
    Given we use "mcp-default" mcp context
    When we call MCP tool "model_save" with args '{"modelType":"test-app/TodoItems","instance":{"title":"Delete Me"}}'
    And we call MCP tool "model_delete" with id from last save result
    Then result should match "model-delete-success"

  Scenario: Can search model instances
    Given we use "mcp-default" mcp context
    When we call MCP tool "model_save" with args '{"modelType":"test-app/TodoItems","instance":{"title":"Searchable Todo"}}'
    And we call MCP tool "model_search" with args '{"modelType":"test-app/TodoItems","search":{"take":10,"query":[]}}'
    Then result should match "model-search-success"

  Scenario: Can bulk insert model instances
    Given we use "mcp-default" mcp context
    When we call MCP tool "model_bulk_insert" with args '{"modelType":"test-app/TodoItems","items":[{"title":"Bulk One"},{"title":"Bulk Two"}]}'
    Then result should match "model-bulk-insert-success"

  Scenario: Can bulk delete model instances
    Given we use "mcp-default" mcp context
    When we call MCP tool "model_save" with args '{"modelType":"test-app/TodoItems","instance":{"title":"Bulk Delete One"}}' and track id
    And we call MCP tool "model_save" with args '{"modelType":"test-app/TodoItems","instance":{"title":"Bulk Delete Two"}}' and track id
    And we call MCP tool "model_bulk_delete" with ids from saved instances
    Then result should match "model-bulk-delete-success"
