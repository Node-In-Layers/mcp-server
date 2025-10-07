import { assert } from 'chai'
import { describe, it } from 'mocha'
import {
  annotatedFunction,
  createErrorObject,
  CrossLayerProps,
} from '@node-in-layers/core'
import z from 'zod'
import {
  commonMcpExecute,
  createMcpResponse,
  nilAnnotatedFunctionToOpenApi,
} from '../../src/libs.js'

const errorObjectJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cause: {},
        code: { type: 'string' },
        data: { type: 'object', additionalProperties: {} },
        details: { type: 'string' },
        message: { type: 'string' },
        trace: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
}

describe('/src/libs.ts', () => {
  describe('#commonMcpExecute()', () => {
    it('should return the same response if its already an MCP response', async () => {
      const fn = () => Promise.resolve(createMcpResponse({}))
      const actual = await commonMcpExecute(fn)()
      const expected = {
        content: [{ type: 'text', text: '{}' }],
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
    it('should format properly format a response when its just an object', async () => {
      const fn = () => Promise.resolve({})
      const actual = await commonMcpExecute(fn)()
      const expected = {
        content: [{ type: 'text', text: '{}' }],
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
    it('should format properly format a response when its an error object', async () => {
      const fn = () =>
        Promise.resolve(createErrorObject('TEST_ERROR', 'Test error'))
      const actual = await commonMcpExecute(fn)()
      const expected = {
        isError: true,
        content: [
          {
            type: 'text',
            text: '{"error":{"code":"TEST_ERROR","message":"Test error"}}',
          },
        ],
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
    it('should format properly format a response when its an error object with a cause', async () => {
      const fn = () =>
        Promise.resolve(
          createErrorObject('TEST_ERROR', 'Test error', new Error('Test cause'))
        )
      const actual = await commonMcpExecute(fn)()
      const expected = {
        isError: true,
        content: [
          {
            type: 'text',
            text: '{"error":{"code":"TEST_ERROR","message":"Test error","details":"Test cause","errorDetails":"Error: Test cause"}}',
          },
        ],
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
    it('should properly format if there is an exception thrown', async () => {
      const fn = () => Promise.reject(new Error('Test exception'))
      const actual = await commonMcpExecute(fn)()
      const expected = {
        isError: true,
        content: [
          {
            type: 'text',
            text: '{"error":{"code":"UNCAUGHT_EXCEPTION","message":"An uncaught exception occurred while executing the feature."}}',
          },
        ],
      }
    })
    it('should properly format if there is an exception thrown', async () => {
      const fn = () => Promise.reject(new Error('Test exception'))
      const actual = await commonMcpExecute(fn)()
      const expected = {
        isError: true,
        content: [
          {
            type: 'text',
            text: '{"error":{"code":"UNCAUGHT_EXCEPTION","message":"An uncaught exception occurred while executing the feature.","details":"Test exception","errorDetails":"Error: Test exception"}}',
          },
        ],
      }
      // @ts-ignore
      assert.deepEqual(actual, expected)
    })
  })
  describe('#nilAnnotatedFunctionToOpenApi()', () => {
    it('should convert a realworld function to an OpenAPI function description', () => {
      const myFunc = annotatedFunction(
        {
          description: 'A description to convert',
          args: z.object({
            organizationId: z.string(),
            from: z.string().optional(),
            to: z.string().optional(),
            daysBack: z.number().optional(),
          }),
        },
        async (params, crossLayerProps?: CrossLayerProps) => {
          return
        }
      )
      const actual = nilAnnotatedFunctionToOpenApi('myFunc', myFunc)
      const expected = {
        name: 'myFunc',
        description: 'A description to convert',
        input: {
          type: 'object',
          additionalProperties: false,
          properties: {
            args: {
              type: 'object',
              additionalProperties: false,
              properties: {
                organizationId: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                daysBack: { type: 'number' },
              },
              required: ['organizationId'],
            },
            crossLayerProps: {
              type: 'object',
              additionalProperties: true,
              properties: {
                logging: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    ids: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          required: ['args'],
        },
        output: { anyOf: [{ type: 'null' }, errorObjectJson] },
      }
      assert.deepEqual(actual, expected)
    })
    it('should convert a nil annotated function to an OpenAPI function description', () => {
      const fn = annotatedFunction(
        {
          description: 'Hello World',
          args: z.object({
            name: z.string(),
          }),
          returns: z.object({
            out: z.string(),
          }),
        },
        (args: { name: string }) => ({
          out: `Hello ${args.name}`,
        })
      )
      const openApi = nilAnnotatedFunctionToOpenApi('hello', fn)
      const expected = {
        name: 'hello',
        description: 'Hello World',
        input: {
          type: 'object',
          additionalProperties: false,
          properties: {
            args: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
              },
              required: ['name'],
            },
            crossLayerProps: {
              type: 'object',
              additionalProperties: true,
              properties: {
                logging: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    ids: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          required: ['args'],
        },
        output: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: { out: { type: 'string' } },
              required: ['out'],
            },
            errorObjectJson,
          ],
        },
      }
      assert.deepEqual(openApi, expected)
    })
    it('should convert complex inputs and outputs for nil annotated functions', () => {
      const fn = annotatedFunction(
        {
          description: 'Hello World',
          args: z
            .object({
              innerObj: z
                .object({
                  name: z.string(),
                })
                .describe('This is a fully loaded props object'),
              innerArray: z
                .array(z.string())
                .optional()
                .describe('Another argument'),
              innerEnum: z.enum(['a', 'b', 'c']),
              innerLiteral: z.literal('a'),
              innerNumber: z.number().describe('A number'),
              preferences: z
                .object({
                  theme: z
                    .enum(['light', 'dark', 'system'])
                    .describe('Preferred application theme'),
                  notifications: z
                    .object({
                      marketing: z
                        .boolean()
                        .describe('Receives marketing emails'),
                      alerts: z
                        .boolean()
                        .optional()
                        .describe('Receives alert emails'),
                    })
                    .describe('Notification preferences'),
                })
                .describe('Application preferences'),
              tags: z
                .array(z.string())
                .optional()
                .describe('User-defined tags'),
              metadata: z
                .record(z.string(), z.string())
                .optional()
                .describe('Freeform metadata'),
              status: z.literal('active').describe('Current account status'),
              age: z.number().optional().describe('Age in years'),
            })
            .describe('This is a fully loaded props object'),
          returns: z.object({
            complex: z.object({
              innerObj: z.object({
                name: z.string(),
                innerArray: z.array(z.string()),
                innerEnum: z.enum(['a', 'b', 'c']),
                innerLiteral: z.literal('a'),
                innerNumber: z.number(),
              }),
            }),
          }),
        },
        args => ({
          complex: {
            innerObj: {
              name: 'The name',
              innerArray: ['a', 'b', 'c'],
              innerEnum: 'a',
              innerLiteral: 'a',
              innerNumber: 1,
            },
          },
        })
      )
      const actual = nilAnnotatedFunctionToOpenApi('hello', fn)
      const expected = {
        name: 'hello',
        description: 'Hello World',
        input: {
          type: 'object',
          additionalProperties: false,
          properties: {
            args: {
              type: 'object',
              description: 'This is a fully loaded props object',
              additionalProperties: false,
              properties: {
                innerObj: {
                  type: 'object',
                  description: 'This is a fully loaded props object',
                  additionalProperties: false,
                  properties: { name: { type: 'string' } },
                  required: ['name'],
                },
                innerArray: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Another argument',
                },
                innerEnum: { type: 'string', enum: ['a', 'b', 'c'] },
                innerLiteral: { type: 'string', const: 'a' },
                innerNumber: { type: 'number', description: 'A number' },
                preferences: {
                  type: 'object',
                  description: 'Application preferences',
                  additionalProperties: false,
                  properties: {
                    theme: {
                      type: 'string',
                      enum: ['light', 'dark', 'system'],
                      description: 'Preferred application theme',
                    },
                    notifications: {
                      type: 'object',
                      description: 'Notification preferences',
                      additionalProperties: false,
                      properties: {
                        marketing: {
                          type: 'boolean',
                          description: 'Receives marketing emails',
                        },
                        alerts: {
                          type: 'boolean',
                          description: 'Receives alert emails',
                        },
                      },
                      required: ['marketing'],
                    },
                  },
                  required: ['theme', 'notifications'],
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'User-defined tags',
                },
                metadata: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                  description: 'Freeform metadata',
                },
                status: {
                  type: 'string',
                  const: 'active',
                  description: 'Current account status',
                },
                age: { type: 'number', description: 'Age in years' },
              },
              required: [
                'innerObj',
                'innerEnum',
                'innerLiteral',
                'innerNumber',
                'preferences',
                'status',
              ],
            },
            crossLayerProps: {
              type: 'object',
              additionalProperties: true,
              properties: {
                logging: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    ids: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          required: ['args'],
        },
        output: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                complex: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    innerObj: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        name: { type: 'string' },
                        innerArray: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        innerEnum: { type: 'string', enum: ['a', 'b', 'c'] },
                        innerLiteral: { type: 'string', const: 'a' },
                        innerNumber: { type: 'number' },
                      },
                      required: [
                        'name',
                        'innerArray',
                        'innerEnum',
                        'innerLiteral',
                        'innerNumber',
                      ],
                    },
                  },
                  required: ['innerObj'],
                },
              },
              required: ['complex'],
            },
            errorObjectJson,
          ],
        },
      }
      assert.deepEqual(actual, expected)
    })

    it('should handle empty args object and undefined output', () => {
      const fn = annotatedFunction(
        {
          description: 'No-op function',
          args: z.object({}),
        },
        () => undefined
      )
      const actual = nilAnnotatedFunctionToOpenApi('noop', fn)
      const expected = {
        name: 'noop',
        description: 'No-op function',
        input: {
          type: 'object',
          additionalProperties: false,
          properties: {
            args: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
            crossLayerProps: {
              type: 'object',
              additionalProperties: true,
              properties: {
                logging: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    ids: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          required: ['args'],
        },
        output: { anyOf: [{ type: 'null' }, errorObjectJson] },
      }
      assert.deepEqual(actual, expected)
    })
  })
})
