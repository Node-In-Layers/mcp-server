import { assert } from 'chai'
import { describe, it } from 'mocha'
import { createErrorObject } from '@node-in-layers/core'
import {
  commonMcpExecute,
  createMcpResponse,
  cleanupSearchQuery,
  parseExecuteData,
  isExecuteFeatureData,
  isExecuteFunctionData,
  isExecuteModelData,
  isExecuteModelSave,
  isExecuteModelRetrieve,
  isExecuteModelDelete,
  isExecuteModelSearch,
  isExecuteModelBulkInsert,
  isExecuteModelBulkDelete,
} from '../../src/libs.js'
import { ModelAction, ModelActionToolName } from '../../src/types.js'

describe('/src/libs.ts', () => {
  describe('#commonMcpExecute()', () => {
    it('should return the same response if its already an MCP response', async () => {
      const fn = () => Promise.resolve(createMcpResponse({}))
      const actual = await commonMcpExecute(fn)()
      const expected = createMcpResponse({})
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
    it('should format properly format a response when its just an object', async () => {
      const fn = () => Promise.resolve({})
      const actual = await commonMcpExecute(fn)()
      const expected = createMcpResponse({})
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
    it('should format properly format a response when its an error object', async () => {
      const err = createErrorObject('TEST_ERROR', 'Test error')
      const fn = () => Promise.resolve(err)
      const actual = await commonMcpExecute(fn)()
      const expected = createMcpResponse(err, { isError: true })
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
    it('should format properly format a response when its an error object with a cause', async () => {
      const fn = () =>
        Promise.resolve(
          createErrorObject('TEST_ERROR', 'Test error', new Error('Test cause'))
        )
      const actual = await commonMcpExecute(fn)()
      assert.isTrue(actual.isError)
      // @ts-ignore
      const parsed = JSON.parse(actual.content[0].text)
      assert.deepInclude(parsed.error, {
        code: 'TEST_ERROR',
        message: 'Test error',
        details: 'Test cause',
      })
      assert.property(parsed.error, 'cause')
    })
    it('should properly format if there is an exception thrown', async () => {
      const fn = () => Promise.reject(new Error('Test exception'))
      const actual = await commonMcpExecute(fn)()
      assert.isTrue(actual.isError)
      // @ts-ignore
      const parsed = JSON.parse(actual.content[0].text)
      assert.deepInclude(parsed.error, {
        code: 'UNCAUGHT_EXCEPTION',
        message: 'An uncaught exception occurred while executing the feature.',
      })
    })
    it('should include error details and cause when an exception is thrown', async () => {
      const fn = () => Promise.reject(new Error('Test exception'))
      const actual = await commonMcpExecute(fn)()
      assert.isTrue(actual.isError)
      // @ts-ignore
      const parsed = JSON.parse(actual.content[0].text)
      assert.deepInclude(parsed.error, {
        code: 'UNCAUGHT_EXCEPTION',
        message: 'An uncaught exception occurred while executing the feature.',
        details: 'Test exception',
      })
      assert.property(parsed.error, 'cause')
    })
  })
  describe('#cleanupSearchQuery()', () => {
    it('should ensure query exists when missing', () => {
      const input = {}
      const actual = cleanupSearchQuery(input)
      assert.deepEqual(actual.query, [])
    })

    it('should default property token: equalitySymbol, options and infer valueType', () => {
      const input = {
        query: [{ type: 'property', key: 'sku', value: 'ABC-123' }],
      }
      const actual = cleanupSearchQuery(input)
      assert.equal(actual.query[0].type, 'property')
      assert.equal(actual.query[0].key, 'sku')
      assert.equal(actual.query[0].value, 'ABC-123')
      assert.equal(actual.query[0].equalitySymbol, '=')
      assert.equal(actual.query[0].valueType, 'string')
      assert.deepEqual(actual.query[0].options, {})
    })

    it('should default datesAfter token: valueType=date and equalToAndAfter=false', () => {
      const input = {
        query: [
          {
            type: 'datesAfter',
            key: 'createdAt',
            date: new Date().toISOString(),
          },
        ],
      }
      const actual = cleanupSearchQuery(input)
      assert.equal(actual.query[0].type, 'datesAfter')
      assert.equal(actual.query[0].key, 'createdAt')
      assert.equal(actual.query[0].valueType, 'date')
      assert.deepEqual(actual.query[0].options, { equalToAndAfter: false })
    })

    it('should default datesBefore token: valueType=date and equalToAndBefore=false', () => {
      const input = {
        query: [
          {
            type: 'datesBefore',
            key: 'createdAt',
            date: new Date().toISOString(),
          },
        ],
      }
      const actual = cleanupSearchQuery(input)
      assert.equal(actual.query[0].type, 'datesBefore')
      assert.equal(actual.query[0].key, 'createdAt')
      assert.equal(actual.query[0].valueType, 'date')
      assert.deepEqual(actual.query[0].options, { equalToAndBefore: false })
    })

    it('should default sort.order to asc when sort is provided without order', () => {
      const input = { sort: { key: 'name' }, query: [] }
      const actual = cleanupSearchQuery(input)
      assert.deepEqual(actual.sort, { key: 'name', order: 'asc' })
    })

    it('should handle nested arrays and boolean tokens', () => {
      const input = {
        query: [
          [
            [{ type: 'property', key: 'active', value: true }],
            'AND',
            [{ type: 'property', key: 'role', value: 'admin' }],
          ],
          'OR',
          {
            type: 'datesAfter',
            key: 'createdAt',
            date: '2024-01-01T00:00:00.000Z',
          },
        ],
      }
      const actual = cleanupSearchQuery(input)
      // left nested group
      const leftGroup = actual.query[0]
      assert.isArray(leftGroup)
      const leftFirst = leftGroup[0][0]
      assert.equal(leftFirst.type, 'property')
      assert.equal(leftFirst.key, 'active')
      assert.equal(leftFirst.valueType, 'boolean')
      assert.deepEqual(leftFirst.options, {})
      assert.equal(actual.query[1], 'OR')
      const right = actual.query[2]
      assert.equal(right.type, 'datesAfter')
      assert.equal(right.valueType, 'date')
      assert.deepEqual(right.options, { equalToAndAfter: false })
    })
  })
  describe('#parseExecuteData()', () => {
    it('should return undefined when body is not an object', () => {
      const input = null
      const actual = parseExecuteData(input)
      assert.isUndefined(actual)
    })

    it('should parse execute_feature calls with toolName and args', () => {
      const input = {
        toolName: 'execute_feature',
        args: {
          domain: 'users',
          featureName: 'createUser',
          foo: 'bar',
        },
      }
      const actual = parseExecuteData(input)
      const expected = {
        toolName: 'execute_feature',
        domain: 'users',
        featureName: 'createUser',
        args: input.args,
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
      // @ts-ignore
      assert.isTrue(isExecuteFeatureData(actual))
    })

    it('should parse execute_feature calls using name and arguments aliases', () => {
      const input = {
        name: 'execute_feature',
        arguments: {
          domain: 'orders',
          featureName: 'listOrders',
        },
      }
      const actual = parseExecuteData(input)
      const expected = {
        toolName: 'execute_feature',
        domain: 'orders',
        featureName: 'listOrders',
        // falls back to arguments when args is missing
        // @ts-ignore
        args: input.arguments,
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
      // @ts-ignore
      assert.isTrue(isExecuteFeatureData(actual))
    })

    it('should parse model save actions into ExecuteModelData', () => {
      const input = {
        toolName: ModelActionToolName.Save,
        args: {
          modelType: 'inventory.Product',
          instance: { id: '1' },
        },
      }
      const actual = parseExecuteData(input)
      const expected = {
        toolName: ModelActionToolName.Save,
        action: ModelAction.Save,
        domain: 'inventory',
        modelName: 'Product',
        args: input.args,
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
      // @ts-ignore
      assert.isTrue(isExecuteModelData(actual))
      // @ts-ignore
      assert.isTrue(isExecuteModelSave(actual))
    })

    it('should parse model search actions using name alias', () => {
      const input = {
        name: ModelActionToolName.Search,
        arguments: {
          modelType: 'billing.Invoice',
          search: { query: [] },
        },
      }
      const actual = parseExecuteData(input)
      const expected = {
        toolName: ModelActionToolName.Search,
        action: ModelAction.Search,
        domain: 'billing',
        modelName: 'Invoice',
        // @ts-ignore
        args: input.arguments,
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
      // @ts-ignore
      assert.isTrue(isExecuteModelData(actual))
      // @ts-ignore
      assert.isTrue(isExecuteModelSearch(actual))
    })

    it('should parse generic function execution when toolName is not a model or feature action', () => {
      const input = {
        toolName: 'custom_function',
        args: { foo: 'bar' },
      }
      const actual = parseExecuteData(input)
      const expected = {
        toolName: 'custom_function',
        functionName: 'custom_function',
        args: input.args,
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
      // @ts-ignore
      assert.isTrue(isExecuteFunctionData(actual))
      // @ts-ignore
      assert.isFalse(isExecuteFeatureData(actual))
      // @ts-ignore
      assert.isFalse(isExecuteModelData(actual))
    })

    it('should return undefined when no toolName or name is provided', () => {
      const input = { args: { foo: 'bar' } }
      const actual = parseExecuteData(input)
      assert.isUndefined(actual)
    })
  })

  describe('Execute data type guards', () => {
    describe('#isExecuteFeatureData()', () => {
      it('should return true for execute_feature data', () => {
        const input = {
          toolName: 'execute_feature',
          domain: 'users',
          featureName: 'createUser',
          args: {},
        }
        const actual = isExecuteFeatureData(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false for non-execute_feature toolName', () => {
        const input = {
          toolName: ModelActionToolName.Save,
          domain: 'users',
          featureName: 'createUser',
          args: {},
        }
        const actual = isExecuteFeatureData(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteFunctionData()', () => {
      it('should return true when functionName is defined and toolName is not feature or model action', () => {
        const input = {
          toolName: 'custom_function',
          functionName: 'custom_function',
          args: {},
        }
        const actual = isExecuteFunctionData(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false for execute_feature even if functionName exists', () => {
        const input = {
          toolName: 'execute_feature',
          functionName: 'execute_feature',
          args: {},
        }
        const actual = isExecuteFunctionData(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })

      it('should return false for model action toolNames', () => {
        const input = {
          toolName: ModelActionToolName.Delete,
          functionName: 'model_delete',
          args: {},
        }
        const actual = isExecuteFunctionData(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteModelData()', () => {
      it('should return true for all model action toolNames', () => {
        const inputs = [
          { toolName: ModelActionToolName.Save },
          { toolName: ModelActionToolName.Retrieve },
          { toolName: ModelActionToolName.Delete },
          { toolName: ModelActionToolName.Search },
          { toolName: ModelActionToolName.BulkInsert },
          { toolName: ModelActionToolName.BulkDelete },
        ]

        inputs.forEach(input => {
          const actual = isExecuteModelData(input)
          const expected = true
          assert.strictEqual(actual, expected)
        })
      })

      it('should return false for non-model action toolNames', () => {
        const input = { toolName: 'custom_function' }
        const actual = isExecuteModelData(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteModelSave()', () => {
      it('should return true when action is save', () => {
        const input = {
          toolName: ModelActionToolName.Save,
          action: ModelAction.Save,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelSave(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false when action is not save', () => {
        const input = {
          toolName: ModelActionToolName.Delete,
          action: ModelAction.Delete,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelSave(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })

      it('should return false when not model data', () => {
        const input = {
          toolName: 'custom_function',
          action: ModelAction.Save,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelSave(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteModelRetrieve()', () => {
      it('should return true when action is retrieve', () => {
        const input = {
          toolName: ModelActionToolName.Retrieve,
          action: ModelAction.Retrieve,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelRetrieve(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false when not model data', () => {
        const input = {
          toolName: 'custom_function',
          action: ModelAction.Retrieve,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelRetrieve(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteModelDelete()', () => {
      it('should return true when action is delete', () => {
        const input = {
          toolName: ModelActionToolName.Delete,
          action: ModelAction.Delete,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelDelete(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false when action is not delete', () => {
        const input = {
          toolName: ModelActionToolName.Delete,
          action: ModelAction.Save,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelDelete(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })

      it('should return false when not model data', () => {
        const input = {
          toolName: 'custom_function',
          action: ModelAction.Delete,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelDelete(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteModelSearch()', () => {
      it('should return true when action is search', () => {
        const input = {
          toolName: ModelActionToolName.Search,
          action: ModelAction.Search,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelSearch(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false when toolName is not a model action', () => {
        const input = {
          toolName: 'custom_function',
          action: ModelAction.Search,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelSearch(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteModelBulkInsert()', () => {
      it('should return true when action is bulkInsert', () => {
        const input = {
          toolName: ModelActionToolName.BulkInsert,
          action: ModelAction.BulkInsert,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelBulkInsert(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false when not model data', () => {
        const input = {
          toolName: 'custom_function',
          action: ModelAction.BulkInsert,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelBulkInsert(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })

    describe('#isExecuteModelBulkDelete()', () => {
      it('should return true when action is bulkDelete', () => {
        const input = {
          toolName: ModelActionToolName.BulkDelete,
          action: ModelAction.BulkDelete,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelBulkDelete(input)
        const expected = true
        assert.strictEqual(actual, expected)
      })

      it('should return false when action is not bulkDelete', () => {
        const input = {
          toolName: ModelActionToolName.BulkDelete,
          action: ModelAction.BulkInsert,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelBulkDelete(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })

      it('should return false when not model data', () => {
        const input = {
          toolName: 'custom_function',
          action: ModelAction.BulkDelete,
          domain: 'inventory',
          modelName: 'Product',
          args: {},
        }
        const actual = isExecuteModelBulkDelete(input)
        const expected = false
        assert.strictEqual(actual, expected)
      })
    })
  })
})
