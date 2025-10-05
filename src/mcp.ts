import { randomUUID } from 'crypto'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  Config,
  ModelCrudsFunctions,
  Response,
  createErrorObject,
  isErrorObject,
} from '@node-in-layers/core'
import { JsonAble, OrmModel, ValidationError } from 'functional-models'
import {
  createMcpToolBulkDelete,
  createMcpToolBulkInsert,
  createMcpToolDelete,
  createMcpToolRetrieve,
  createMcpToolSearch,
  createMcpToolSave,
  defaultModelTypeParser,
} from 'functional-models-orm-mcp'
import { createSimpleServer } from '@l4t/mcp-ai/simple-server/index.js'
import { ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import { ExpressRoute, ExpressMiddleware } from '@l4t/mcp-ai/common/types.js'
import { asyncMap } from 'modern-async'
import {
  AppOptions,
  McpServerMcp,
  McpServerConfig,
  McpContext,
  McpNamespace,
} from './types.js'
import {
  describeFeatureMcpTool,
  listFeaturesMcpTool,
  describeModelMcpTool,
  listModelsMcpTool,
  listDomainsMcpTool,
  isNilAnnotatedFunction,
  nilAnnotatedFunctionToOpenApi,
  createOpenApiForNonNilAnnotatedFunction,
} from './libs.js'

const DEFAULT_RESPONSE_REQUEST_LOG_LEVEL = 'info'
const createMcpResponse = <T extends JsonAble>(
  result: T,
  opts?: { isError?: boolean }
): CallToolResult => {
  const isError = opts?.isError || isErrorObject(result)
  return {
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: 'text',
        text: JSON.stringify(result !== undefined ? result : '""'),
      },
    ],
  }
}

const createDomainNotFoundError = () =>
  createErrorObject('DOMAIN_NOT_FOUND', 'Domain not found')
const createModelNotFoundError = () =>
  createErrorObject('MODEL_NOT_FOUND', 'Model not found')
const createFeatureNotFoundError = () =>
  createErrorObject('FEATURE_NOT_FOUND', 'Feature not found')
const createModelsNotFoundError = () =>
  createErrorObject('MODELS_NOT_FOUND', 'Models not found')

const isDomainHidden = (hiddenPaths: Set<string>) => (domain: string) => {
  return hiddenPaths.has(domain)
}

const areAllModelsHidden = (hiddenPaths: Set<string>) => (domain: string) => {
  return hiddenPaths.has(`${domain}.cruds`)
}

const isFeatureHidden =
  (hiddenPaths: Set<string>) => (domain: string, featureName: string) => {
    return hiddenPaths.has(`${domain}.${featureName}`)
  }

const isModelHidden =
  (hiddenPaths: Set<string>) => (domain: string, modelName: string) => {
    return hiddenPaths.has(`${domain}.cruds.${modelName}`)
  }

const create = (
  context: McpContext<McpServerConfig & Config>
): McpServerMcp => {
  const hiddenPaths = new Set([
    '@node-in-layers/core',
    '@node-in-layers/data',
    '@node-in-layers/mcp-server',
    ...(context.config[McpNamespace].hiddenPaths || []),
  ])

  const tools: ServerTool[] = []
  const sets: [string, any][] = []
  const preRouteMiddleware: ExpressMiddleware[] = []
  const additionalRoutes: ExpressRoute[] = []
  const addTool = (tool: ServerTool) => {
    // eslint-disable-next-line functional/immutable-data
    tools.push(tool)
  }

  const isDomainHiddenFunc = isDomainHidden(hiddenPaths)
  const areAllModelsHiddenFunc = areAllModelsHidden(hiddenPaths)
  const isFeatureHiddenFunc = isFeatureHidden(hiddenPaths)
  const isModelHiddenFunc = isModelHidden(hiddenPaths)

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

      const responseData =
        context.config[McpNamespace].logging?.responseLogGetData?.(result) || {}
      logger[level]('Request Response', {
        response: result,
        ...responseData,
      })

      return result
    }

    return {
      ...tool,
      execute,
    }
  }

  const _listDomainsTool = (): ServerTool => {
    return {
      ...listDomainsMcpTool(),
      execute: _execute(async () => {
        const domains = Object.entries(context.features).reduce(
          (acc, [domainName]) => {
            if (isDomainHiddenFunc(domainName)) {
              return acc
            }
            const description = context.config[
              '@node-in-layers/core'
            ].apps.find(app => app.name === domainName)?.description
            return acc.concat({
              name: domainName,
              ...(description ? { description } : {}),
            })
          },
          [] as { name: string; description?: string }[]
        )
        return createMcpResponse(domains)
      }),
    }
  }

  const _describeFeatureTool = (): ServerTool => {
    return {
      ...describeFeatureMcpTool(),
      execute: _execute(async (input: any) => {
        const domain = input.domain
        const featureName = input.featureName
        const feature = context[domain]?.[featureName]
        if (
          !feature ||
          isDomainHiddenFunc(domain) ||
          isFeatureHiddenFunc(domain, featureName)
        ) {
          return createFeatureNotFoundError()
        }
        const openapi = isNilAnnotatedFunction(feature)
          ? nilAnnotatedFunctionToOpenApi(feature.name, feature)
          : createOpenApiForNonNilAnnotatedFunction(feature.name)
        return createMcpResponse(openapi)
      }),
    }
  }

  const _listFeaturesTool = (): ServerTool => {
    return {
      ...listFeaturesMcpTool(),
      execute: _execute(async (input: any) => {
        const domain = input.domain
        if (isDomainHiddenFunc(domain)) {
          return createDomainNotFoundError()
        }
        const features = domain.features
        const result = Object.entries(features).reduce(
          (acc, [featureName, feature]) => {
            if (typeof feature !== 'function') {
              return acc
            }
            if (isFeatureHiddenFunc(domain, featureName)) {
              return acc
            }
            const obj = {
              name: featureName,
              // @ts-ignore
              ...(feature.schema?.description
                ? // @ts-ignore
                  { description: feature.schema.description }
                : {}),
            }
            return acc.concat(obj)
          },
          [] as { name: string; description?: string }[]
        )
        return createMcpResponse(result)
      }),
    }
  }

  const _listModelsTool = (): ServerTool => {
    return {
      ...listModelsMcpTool(),
      execute: _execute(async (input: any) => {
        const domain = input.domain
        if (isDomainHiddenFunc(domain) || areAllModelsHiddenFunc(domain)) {
          return createDomainNotFoundError()
        }
        const models = context.features[domain].cruds as Record<
          string,
          ModelCrudsFunctions<any>
        >
        if (!models) {
          return createMcpResponse(createModelsNotFoundError())
        }
        const result = Object.entries(models).reduce(
          (acc, [modelName, model]) => {
            if (isModelHiddenFunc(domain, modelName)) {
              return acc
            }
            const description = model
              .getModel()
              .getModelDefinition().description
            return acc.concat({
              modelType: model.getModel().getName(),
              ...(description ? { description } : {}),
            })
          },
          [] as { modelType: string; description?: string }[]
        )
        return createMcpResponse(result)
      }),
    }
  }

  const _describeModelTool = (): ServerTool => {
    return {
      ...describeModelMcpTool(),
      execute: _execute(async (input: any) => {
        const domain = input.domain
        if (isDomainHiddenFunc(domain)) {
          return createDomainNotFoundError()
        }
        const { modelName } = defaultModelTypeParser(input.modelType)
        const model = context.features[domain].cruds[modelName]
        if (
          !model ||
          isModelHiddenFunc(domain, modelName) ||
          areAllModelsHiddenFunc(domain)
        ) {
          return createModelNotFoundError()
        }
        const schema = model.getModel().getModelDefinition().schema
        return createMcpResponse(schema)
      }),
    }
  }

  const _createMcpModelFunc = async (
    modelFunc: (input: any, model: OrmModel<any>) => Promise<Response<JsonAble>>
  ) => {
    return _execute(async (input: any) => {
      const modelType = input.modelType
      const { domain, modelName } = defaultModelTypeParser(modelType)
      if (isDomainHiddenFunc(domain)) {
        return createDomainNotFoundError()
      }
      const model = context.features[domain].cruds[modelName]
      if (
        !model ||
        isModelHiddenFunc(domain, modelName) ||
        areAllModelsHiddenFunc(domain)
      ) {
        return createModelNotFoundError()
      }
      const result = await modelFunc(input, model.getModel()).catch(e => {
        if (e instanceof ValidationError) {
          return createErrorObject('VALIDATION_ERROR', 'Validation Error', {
            details: {
              keysToErrors: e.keysToErrors,
              modelName: e.modelName,
            },
          })
        }
        return createErrorObject(
          'UNCAUGHT_EXCEPTION',
          'An uncaught exception occurred while executing the feature.',
          e
        )
      })
      if (isErrorObject(result)) {
        return createMcpResponse(result, { isError: true })
      }
      return createMcpResponse(result)
    })
  }

  const _createMcpToolSave = (): ServerTool => {
    return {
      ...createMcpToolSave(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        const data = input.instance
        const result = await model.save(data).catch(e => {
          if (e instanceof ValidationError) {
            return createErrorObject('VALIDATION_ERROR', 'Validation Error', e)
          }
          return createErrorObject(
            'UNCAUGHT_EXCEPTION',
            'An uncaught exception occurred while executing the feature.',
            e
          )
        })
        if (isErrorObject(result)) {
          return result
        }
        return result.toObj()
      }),
    }
  }

  const _createMcpToolRetrieve = (): ServerTool => {
    return {
      ...createMcpToolRetrieve(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        const result = await model.retrieve(input.id)
        if (!result) {
          return createModelNotFoundError()
        }
        return result.toObj()
      }),
    }
  }

  const _createMcpToolDelete = (): ServerTool => {
    return {
      ...createMcpToolDelete(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        await model.delete(input.id)
        return null
      }),
    }
  }

  const _createMcpToolSearch = (): ServerTool => {
    return {
      ...createMcpToolSearch(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        const result = await model.search(input.query)
        const instances = await asyncMap(result.instances, i => i.toObj())
        return { instances, page: result.page }
      }),
    }
  }

  const _createMcpToolBulkInsert = (): ServerTool => {
    return {
      ...createMcpToolBulkInsert(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        await model.bulkInsert(input.items)
        return null
      }),
    }
  }

  const _createMcpToolBulkDelete = (): ServerTool => {
    return {
      ...createMcpToolBulkDelete(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        await model.bulkDelete(input.ids)
        return null
      }),
    }
  }

  const _getServer = (options?: AppOptions) => {
    const allTools = [
      _listDomainsTool(),
      _listFeaturesTool(),
      _describeFeatureTool(),
      _listModelsTool(),
      _describeModelTool(),
      _createMcpToolSave(),
      _createMcpToolRetrieve(),
      _createMcpToolDelete(),
      _createMcpToolSearch(),
      _createMcpToolBulkInsert(),
      _createMcpToolBulkDelete(),
      ...tools,
    ].map(_wrapToolsWithLogger)
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
    if (result !== null && result !== undefined) {
      if (isErrorObject(result)) {
        return createMcpResponse(result, { isError: true })
      }
    }
    return createMcpResponse(result)
  }

  const _execute =
    (func: (...inputs: any[]) => Promise<Response<any>>) =>
    (...inputs: any[]) => {
      return func(...inputs)
        .then(_formatResponse)
        .catch(error => {
          return _formatResponse(
            createErrorObject(
              'UNCAUGHT_EXCEPTION',
              'An uncaught exception occurred while executing the feature.',
              error
            )
          )
        })
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
