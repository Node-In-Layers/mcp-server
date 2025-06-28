import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import get from 'lodash/get.js'
import {
  Config,
  ModelCrudsFunctions,
  CrossLayerProps,
  Response,
  createErrorObject,
} from '@node-in-layers/core'
import { createSimpleServer } from '@l4t/mcp-ai/simple-server/index.js'
import { JsonAble, ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import {
  ExpressRoute,
  ExpressMiddleware,
  McpTool,
} from '@l4t/mcp-ai/common/types.js'
import {
  generateMcpToolForModelOperation,
  ToolNameGenerator,
} from 'functional-models-orm-mcp'
import { v4 as uuidv4 } from 'uuid'
import { asyncMap } from 'modern-async'
import {
  AppOptions,
  McpServerMcp,
  McpServerConfig,
  McpContext,
  McpNamespace,
} from './types.js'
import { ValidationError } from 'functional-models'

const DEFAULT_RESPONSE_REQUEST_LOG_LEVEL = 'info'

const create = (
  context: McpContext<McpServerConfig & Config>
): McpServerMcp => {
  const tools: ServerTool[] = []
  const models: ServerTool[] = []
  const preRouteMiddleware: ExpressMiddleware[] = []
  const additionalRoutes: ExpressRoute[] = []
  const addTool = (tool: ServerTool) => {
    // eslint-disable-next-line functional/immutable-data
    tools.push(tool)
  }

  const addModelCruds = (
    cruds: ModelCrudsFunctions<any>,
    opts?: {
      nameGenerator: ToolNameGenerator
    }
  ) => {
    // eslint-disable-next-line functional/immutable-data
    models.push(..._createToolsForModelCruds(cruds, opts))
  }

  const _createToolsForModelCruds = (
    cruds: ModelCrudsFunctions<any>,
    opts?: {
      nameGenerator: ToolNameGenerator
    }
  ): readonly ServerTool[] => {
    const model = cruds.getModel()
    const tools: ServerTool[] = [
      {
        ...generateMcpToolForModelOperation(model, 'save', opts),
        execute: _execute(async (input: any) => {
          return cruds.create(input).then(x => x.toObj())
        }),
      },
      {
        ...generateMcpToolForModelOperation(model, 'retrieve', opts),
        execute: _execute(async ({ id }: { id: string }) => {
          return cruds.retrieve(id).then(x => (x ? x.toObj() : null))
        }),
      },
      {
        ...generateMcpToolForModelOperation(model, 'delete', opts),
        execute: _execute(async ({ id }: { id: string }) => {
          await cruds.delete(id)
        }),
      },
      {
        ...generateMcpToolForModelOperation(model, 'search', opts),
        execute: _execute(async (input: any) => {
          return cruds.search(input).then(async result => {
            const instances = await asyncMap(result.instances, y => y.toObj())
            return {
              instances,
              page: result.page,
            }
          })
        }),
      },
      {
        ...generateMcpToolForModelOperation(model, 'bulkInsert', opts),
        execute: _execute(async (input: any) => {
          await cruds.bulkInsert(input.items)
        }),
      },
      {
        ...generateMcpToolForModelOperation(model, 'bulkDelete', opts),
        execute: _execute(async (input: any) => {
          await cruds.bulkDelete(input.ids)
        }),
      },
    ]
    return tools
  }

  const _wrapToolsWithLogger = (tool: ServerTool): ServerTool => {
    const execute = async (input: any) => {
      const requestId = uuidv4()
      const logger = context.log
        .getIdLogger('logRequest', 'requestId', requestId)
        .applyData({
          requestId: requestId,
        })
      const level =
        context.config[McpNamespace].logging?.requestLogLevel ||
        DEFAULT_RESPONSE_REQUEST_LOG_LEVEL
      logger[level]('Request received', {
        method: 'POST',
        // @ts-ignore
        url: context.config[McpNamespace].server?.path || '/',
        tool: tool.name,
        body: input,
      })

      const result = await tool.execute(input, {
        logging: {
          ids: logger.getIds(),
        },
      })

      logger[level]('Request Response', {
        response: result,
      })

      return result
    }

    return {
      ...tool,
      execute,
    }
  }

  const _getServer = (options?: AppOptions) => {
    const allTools = [...tools, ...models].map(_wrapToolsWithLogger)
    const server = createSimpleServer(
      {
        name: context.config[McpNamespace].name || '@node-in-layers/mcp-server',
        version: context.config[McpNamespace].version || '1.0.0',
        tools: allTools,
        stateless: context.config[McpNamespace].stateless,
        server: context.config[McpNamespace].server,
      },
      {
        express: {
          preRouteMiddleware,
          additionalRoutes,
          ...(options ? options : {}),
        },
      }
    )
    return server
  }

  const addPreRouteMiddleware = (middleware: ExpressMiddleware) => {
    // eslint-disable-next-line functional/immutable-data
    preRouteMiddleware.push(middleware)
  }

  const addAdditionalRoute = (route: ExpressRoute) => {
    // eslint-disable-next-line functional/immutable-data
    additionalRoutes.push(route)
  }

  const start = async (options?: AppOptions) => {
    const server = _getServer(options)
    await server.start()
  }

  const getApp = (options?: AppOptions) => {
    const server = _getServer(options)
    // @ts-ignore
    if (!server?.getApp) {
      throw new Error(`Server not http or sse`)
    }
    // @ts-ignore
    return server.getApp()
  }

  const _formatResponse = (result: Response<any>): CallToolResult => {
    if ((result !== null) && (result !== undefined)) {
      if (typeof result === 'object' && 'error' in result) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        }
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: result ? JSON.stringify(result) : '\"\"',
        },
      ],
    }
  }

  const _execute =
    (func: (...inputs: any[]) => Promise<Response<any>>) =>
    (...inputs: any[]) => {
      return func(...inputs)
        .then(_formatResponse)
        .catch(error => {
          if (error instanceof ValidationError) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: {
                      code: 'VALIDATION_ERROR',
                      message: 'Validation Error',
                      details: {
                        keysToErrors: error.keysToErrors,
                        modelName: error.modelName,
                      },
                    },
                  }),
                },
              ],
            }
          }
          const errorObj = createErrorObject(
            'UNCAUGHT_EXCEPTION',
            'An uncaught exception occurred while executing the feature.',
            error
          )
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(errorObj),
              },
            ],
          }
        })
    }

  const addFeature = <
    T extends object = object,
    R extends JsonAble | void = void,
  >(
    featureFunc: (input: T) => Promise<Response<R>>,
    tool: McpTool
  ) => {
    // eslint-disable-next-line functional/immutable-data
    tools.push({
      ...tool,
      execute: _execute((input: any, crossLayerProps?: CrossLayerProps) => {
        return featureFunc(
          // @ts-ignore
          ...(Array.isArray(input) ? input : [input]).concat(crossLayerProps)
        )
      }),
    })
  }

  return {
    start,
    getApp,
    addTool,
    addModelCruds,
    addPreRouteMiddleware,
    addFeature,
    addAdditionalRoute,
  }
}

/**
 * Automatically adds all the models in the given domain to the MCP server.
 * @param namespace The namespace of the domain to add the models from.
 * @param opts Options for the tool name generator.
 * @returns A function that can be used to add the models to the MCP server.
 */
const mcpModels = <TConfig extends Config = Config>(
  namespace: string,
  context: McpContext<TConfig>,
  opts?: { nameGenerator: ToolNameGenerator }
) => {
  const mcpFunctions = context.mcp[McpNamespace]
  const namedFeatures = get(context, `features.${namespace}`)
  if (!namedFeatures) {
    throw new Error(
      `features.${namespace} does not exist on context needed for mcp.`
    )
  }
  // Look for CRUDS functions.
  Object.entries(namedFeatures).forEach(
    ([key, value]: [key: string, value: any]) => {
      if (typeof value === 'object') {
        if (key === 'cruds') {
          Object.entries(value).forEach(([, modelCrudFuncs]) => {
            mcpFunctions.addModelCruds(
              modelCrudFuncs as ModelCrudsFunctions<any>,
              opts
            )
          })
        }
      }
    },
    {}
  )

  return {}
}

export { create, mcpModels }
