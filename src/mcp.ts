import get from 'lodash/get.js'
import {
  Config,
  FeaturesContext,
  ModelCrudsFunctions,
  CrossLayerProps,
} from '@node-in-layers/core'
import { createSimpleServer } from '@l4t/mcp-ai/simple-server/index.js'
import { ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import { ExpressMiddleware, McpTool } from '@l4t/mcp-ai/common/types.js'
import {
  generateMcpToolForModelOperation,
  ToolNameGenerator,
} from 'functional-models-orm-mcp'
import { v4 as uuidv4 } from 'uuid'
import { asyncMap } from 'modern-async'
import {
  McpServerMcp,
  McpServerConfig,
  McpContext,
  McpNamespace,
} from './types.js'

const DEFAULT_RESPONSE_REQUEST_LOG_LEVEL = 'info'

const create = (
  context: McpContext<McpServerConfig & Config>
): McpServerMcp => {
  const tools: ServerTool[] = []
  const models: ServerTool[] = []
  const preRouteMiddleware: ExpressMiddleware[] = []

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
        execute: async (input: any) => {
          return cruds.create(input).then(x => x.toObj())
        },
      },
      {
        ...generateMcpToolForModelOperation(model, 'retrieve', opts),
        execute: async ({ id }: { id: string }) => {
          return cruds.retrieve(id).then(x => (x ? x.toObj() : null))
        },
      },
      {
        ...generateMcpToolForModelOperation(model, 'delete', opts),
        execute: async ({ id }: { id: string }) => {
          await cruds.delete(id)
        },
      },
      {
        ...generateMcpToolForModelOperation(model, 'search', opts),
        execute: async (input: any) => {
          return cruds.search(input).then(result => {
            const instances = asyncMap(result.instances, y => y.toObj())
            return {
              instances,
              page: result.page,
            }
          })
        },
      },
      {
        ...generateMcpToolForModelOperation(model, 'bulkInsert', opts),
        execute: async (input: any) => {
          await cruds.bulkInsert(input)
        },
      },
      {
        ...generateMcpToolForModelOperation(model, 'bulkDelete', opts),
        execute: async (input: any) => {
          await cruds.bulkDelete(input)
        },
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

  const _getServer = () => {
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
        },
      }
    )
    return server
  }

  const addPreRouteMiddleware = (middleware: ExpressMiddleware) => {
    // eslint-disable-next-line functional/immutable-data
    preRouteMiddleware.push(middleware)
  }

  const start = async () => {
    const server = _getServer()
    await server.start()
  }

  const getApp = () => {
    const server = _getServer()
    // @ts-ignore
    if (!server?.getApp) {
      throw new Error(`Server not http or sse`)
    }
    // @ts-ignore
    return server.getApp()
  }

  const addFeature = <T>(
    featureFunc: (input: T) => Promise<any>,
    tool: McpTool
  ) => {
    tools.push({
      ...tool,
      execute: async (input: any, crossLayerProps?: CrossLayerProps) => {
        return featureFunc(
          // @ts-ignore
          ...(Array.isArray(input) ? input : [input]),
          crossLayerProps
        )
      },
    })
  }

  return {
    start,
    getApp,
    addTool,
    addModelCruds,
    addPreRouteMiddleware,
    addFeature,
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
