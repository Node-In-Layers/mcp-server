import { assert } from 'chai'
import { describe, it } from 'mocha'
import { createErrorObject } from '@node-in-layers/core'
import {
  commonMcpExecute,
  createMcpResponse,
  cleanupSearchQuery,
} from '../../src/libs.js'

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
})
