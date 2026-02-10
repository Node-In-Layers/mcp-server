import { randomUUID } from 'crypto'
import get from 'lodash/get.js'
import { Config, LayerContext } from '@node-in-layers/core'
import { createSimpleServer } from '@l4t/mcp-ai/simple-server/index.js'
import { ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import { ExpressRoute, ExpressMiddleware } from '@l4t/mcp-ai/common/types.js'
import {
  AppOptions,
  McpServerMcp,
  McpServerConfig,
  McpContext,
  McpNamespace,
} from './types.js'
import { create as createModelsMcp } from './models.js'
import { create as createNilMcp } from './nil.js'

const DEFAULT_RESPONSE_REQUEST_LOG_LEVEL = 'info'

const create = (
  context: McpContext<McpServerConfig & Config>
): McpServerMcp => {
  const tools: ServerTool[] = []
  const sets: [string, any][] = []
  const preRouteMiddleware: ExpressMiddleware[] = []
  const additionalRoutes: ExpressRoute[] = []
  const addTool = (tool: ServerTool) => {
    // eslint-disable-next-line functional/immutable-data
    tools.push(tool)
  }

  const _wrapToolsWithLogger = (tool: ServerTool): ServerTool => {
    const execute = async (input: any) => {
      const requestId = randomUUID()
      const logger = context.log
        .getIdLogger('logRequest', 'requestId', requestId)
        .applyData({
          requestId: requestId,
        })
      const level =
        context.config[McpNamespace].logging?.requestLogLevel ||
        DEFAULT_RESPONSE_REQUEST_LOG_LEVEL
      const requestData =
        context.config[McpNamespace].logging?.requestLogGetData?.(input) || {}
      logger[level]('Request received', {
        method: 'POST',
        // @ts-ignore
        url: context.config[McpNamespace].server?.path || '/',
        tool: tool.name,
        body: input,
        ...requestData,
      })

      const result = await tool.execute(input, {
        logging: {
          ids: logger.getIds(),
        },
      })
      const data = get(result, 'content[0].text')
      const toShow = data ? JSON.parse(data) : result

      const responseData =
        context.config[McpNamespace].logging?.responseLogGetData?.(result) || {}
      logger[level]('Request Response', {
        response: toShow,
        ...responseData,
      })

      return result
    }

    return {
      ...tool,
      execute,
    }
  }

  const _getModelsMcpTools = (systemContext: LayerContext<Config, any>) => {
    const config = systemContext.config[McpNamespace]
    if (config.hideComponents?.allModels) {
      return []
    }
    const modelsMcp = createModelsMcp(systemContext)
    return [
      modelsMcp.listModels(),
      modelsMcp.describe(),
      modelsMcp.save(),
      modelsMcp.retrieve(),
      modelsMcp.delete(),
      modelsMcp.search(),
      modelsMcp.bulkInsert(),
      modelsMcp.bulkDelete(),
    ]
  }

  const _getServer = (
    systemContext: LayerContext<Config, any>,
    options?: AppOptions
  ) => {
    const nilMcp = createNilMcp(systemContext)
    const allTools = [
      nilMcp.startHere(),
      nilMcp.listDomains(),
      nilMcp.listFeatures(),
      nilMcp.describeFeature(),
      nilMcp.executeFeature(),
      ..._getModelsMcpTools(systemContext),
      ...tools,
    ].map(_wrapToolsWithLogger)
    const server = createSimpleServer(
      {
        name:
          systemContext.config[McpNamespace].name ||
          '@node-in-layers/mcp-server',
        version: systemContext.config[McpNamespace].version || '1.0.0',
        tools: allTools,
        stateless: systemContext.config[McpNamespace].stateless,
        server: systemContext.config[McpNamespace].server,
      },
      {
        express: {
          preRouteMiddleware,
          additionalRoutes,
          ...(options ? options : {}),
        },
      }
    )
    sets.forEach(([key, value]) => {
      if ('set' in server) {
        // @ts-ignore
        server.set(key, value)
      }
    })
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

  const start = async <T extends Config>(
    systemContext: LayerContext<T, any>,
    options?: AppOptions
  ) => {
    const server = _getServer(systemContext, options)
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

  const set = (key: string, value: any) => {
    // eslint-disable-next-line functional/immutable-data
    sets.push([key, value])
  }

  return {
    start,
    getApp,
    addTool,
    addPreRouteMiddleware,
    addAdditionalRoute,
    set,
  }
}

/**
 * Automatically adds all the models in the given domain to the MCP server.
 * @param namespace The namespace of the domain to add the models from.
 * @param opts Options for the tool name generator.
 * @returns A function that can be used to add the models to the MCP server.
 */
/*
const mcpModels = <TConfig extends Config = Config>(
  namespace: string,
  context: McpContext<TConfig>
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
              modelCrudFuncs as ModelCrudsFunctions<any>
            )
          })
        }
      }
    },
    {}
  )

  return {}
}
*/

export { create }
