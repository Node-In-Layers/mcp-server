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
  NestedFeatureToolOptions,
} from './types.js'
import { ValidationError } from 'functional-models'

const DEFAULT_RESPONSE_REQUEST_LOG_LEVEL = 'info'

const create = (
  context: McpContext<McpServerConfig & Config>
): McpServerMcp => {
  const tools: ServerTool[] = []
  const models: ServerTool[] = []
  const sets: [string, any][] = []
  const preRouteMiddleware: ExpressMiddleware[] = []
  const additionalRoutes: ExpressRoute[] = []
  let nestedFeatureToolsEnabled = false
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

  const _extractDescription = (value: any): string | undefined => {
    if (!value) {
      return undefined
    }
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'function') {
      const description = (value as { description?: string }).description
      return typeof description === 'string' ? description : undefined
    }
    if (typeof value === 'object') {
      if (typeof (value as { description?: string }).description === 'string') {
        return (value as { description: string }).description
      }
      if (typeof (value as { desc?: string }).desc === 'string') {
        return (value as { desc: string }).desc
      }
      const meta = (value as { meta?: { description?: string } }).meta
      if (meta && typeof meta.description === 'string') {
        return meta.description
      }
      const metadata = (value as { metadata?: { description?: string } }).metadata
      if (metadata && typeof metadata.description === 'string') {
        return metadata.description
      }
    }
    return undefined
  }

  const _normalizeArgs = (
    payload: any,
    crossLayerProps?: CrossLayerProps
  ): readonly any[] => {
    const baseArgs =
      payload === undefined
        ? []
        : Array.isArray(payload)
          ? payload
          : [payload]
    return crossLayerProps === undefined
      ? baseArgs
      : [...baseArgs, crossLayerProps]
  }

  const _normalizeResult = async (value: any): Promise<any> => {
    const resolved = await value
    if (Array.isArray(resolved)) {
      return Promise.all(resolved.map(item => _normalizeResult(item)))
    }
    if (resolved && typeof resolved === 'object') {
      if (typeof (resolved as { toObj?: () => any }).toObj === 'function') {
        return (resolved as { toObj: () => any }).toObj()
      }
    }
    return resolved
  }

  const _getModelDescription = (modelCruds: ModelCrudsFunctions<any>) => {
    try {
      const model = modelCruds.getModel()
      if (!model) {
        return undefined
      }
      return (
        _extractDescription(model) ||
        _extractDescription((model as { meta?: unknown }).meta) ||
        _extractDescription((model as { metadata?: unknown }).metadata)
      )
    } catch (error) {
      context.log.warn('Failed to retrieve model description', {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      })
      return undefined
    }
  }

  const _createNestedFeatureTools = (
    options?: NestedFeatureToolOptions
  ): readonly ServerTool[] => {
    const toolNames = {
      listDomains: 'list-domains',
      listDomainFeatures: 'list-domain-features',
      listDomainModels: 'list-domain-models',
      executeFeature: 'execute-domain-feature',
      executeModelFunction: 'execute-model-function',
      ...options?.toolNames,
    }

    const domainDescriptions = options?.domainDescriptions ?? {}
    const featureDescriptions = options?.featureDescriptions ?? {}
    const modelDescriptions = options?.modelDescriptions ?? {}
    const hiddenPaths = new Set(options?.hiddenPaths ?? [])

    const isHidden = (path: readonly string[]): boolean =>
      path.reduce(
        (state, segment) => {
          if (state.hidden) {
            return state
          }
          const segments = [...state.segments, segment]
          const candidate = segments.join('.')
          return {
            hidden: state.hidden || hiddenPaths.has(candidate),
            segments,
          }
        },
        { hidden: false, segments: [] as string[] }
      ).hidden

    const listDomainsTool: ServerTool = {
      name: toolNames.listDomains,
      description: 'Lists the available feature domains.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
      },
      execute: _execute(async () => {
        const features = (context as { features?: Record<string, unknown> }).features
        if (!features || typeof features !== 'object') {
          return []
        }
        return Object.entries(features)
          .filter(([domain]) => !isHidden([domain]))
          .map(([domain, value]) => ({
            name: domain,
            description:
              domainDescriptions[domain] || _extractDescription(value) || undefined,
          }))
      }),
    }

    const listDomainFeaturesTool: ServerTool = {
      name: toolNames.listDomainFeatures,
      description: 'Lists the features available for a domain.',
      inputSchema: {
        type: 'object',
        required: ['domain'],
        additionalProperties: false,
        properties: {
          domain: {
            type: 'string',
            description: 'The domain to inspect.',
          },
        },
      },
      execute: _execute(async ({ domain }: { domain: string }) => {
        if (isHidden([domain])) {
          return createErrorObject(
            'DOMAIN_NOT_FOUND',
            `Domain "${domain}" was not found.`,
            { domain }
          )
        }
        const domainFeatures = get(context, `features.${domain}`)
        if (!domainFeatures || typeof domainFeatures !== 'object') {
          return createErrorObject(
            'DOMAIN_NOT_FOUND',
            `Domain "${domain}" was not found.`,
            { domain }
          )
        }

        type FeatureSummary = { name: string; description?: string }

        return Object.entries(domainFeatures as Record<string, unknown>).reduce(
          (features, [key, value]) => {
            if (key === 'cruds' || isHidden([domain, key])) {
              return features
            }
            if (typeof value !== 'function') {
              return features
            }
            const featureDescription =
              (featureDescriptions[domain] || {})[key] ||
              _extractDescription(value) ||
              undefined
            return features.concat({
              name: key,
              description: featureDescription,
            })
          },
          [] as FeatureSummary[]
        )
      }),
    }

    const listDomainModelsTool: ServerTool = {
      name: toolNames.listDomainModels,
      description: 'Lists the models and CRUD operations available for a domain.',
      inputSchema: {
        type: 'object',
        required: ['domain'],
        additionalProperties: false,
        properties: {
          domain: {
            type: 'string',
            description: 'The domain to inspect.',
          },
        },
      },
      execute: _execute(async ({ domain }: { domain: string }) => {
        if (isHidden([domain])) {
          return createErrorObject(
            'DOMAIN_NOT_FOUND',
            `Domain "${domain}" was not found.`,
            { domain }
          )
        }

        const domainModels = get(context, `features.${domain}.cruds`)

        if (!domainModels || typeof domainModels !== 'object') {
          return []
        }

        type ModelSummary = {
          name: string
          description?: string
          operations: readonly string[]
        }

        return Object.entries(domainModels as Record<string, unknown>).reduce(
          (models, [modelName, modelCruds]) => {
            if (
              isHidden([domain, 'cruds']) ||
              isHidden([domain, 'cruds', modelName]) ||
              !modelCruds ||
              typeof modelCruds !== 'object'
            ) {
              return models
            }

            const operations = Object.entries(
              modelCruds as Record<string, unknown>
            ).reduce<readonly string[]>(
              (operationAcc, [operationName, operation]) => {
                if (isHidden([domain, 'cruds', modelName, operationName])) {
                  return operationAcc
                }
                if (typeof operation === 'function' && operationName !== 'getModel') {
                  return operationAcc.concat(operationName)
                }
                return operationAcc
              },
              []
            )

            if (operations.length === 0) {
              return models
            }

            const modelDescription =
              (modelDescriptions[domain] || {})[modelName] ||
              _getModelDescription(modelCruds as ModelCrudsFunctions<any>) ||
              undefined

            return models.concat({
              name: modelName,
              description: modelDescription,
              operations,
            })
          },
          [] as ModelSummary[]
        )
      }),
    }

    const executeFeatureTool: ServerTool = {
      name: toolNames.executeFeature,
      description: 'Executes a feature within a domain.',
      inputSchema: {
        type: 'object',
        required: ['domain', 'feature'],
        additionalProperties: true,
        properties: {
          domain: {
            type: 'string',
          },
          feature: {
            type: 'string',
          },
          payload: {
            description:
              'Arguments to pass to the feature. Provide an array to send multiple arguments.',
          },
        },
      },
      execute: _execute(
        async (
          {
            domain,
            feature,
            payload,
          }: { domain: string; feature: string; payload?: any },
          crossLayerProps?: CrossLayerProps
        ) => {
          if (isHidden([domain])) {
            return createErrorObject(
              'DOMAIN_NOT_FOUND',
              `Domain "${domain}" was not found.`,
              { domain }
            )
          }
          if (isHidden([domain, feature])) {
            return createErrorObject(
              'FEATURE_NOT_FOUND',
              `Feature "${feature}" was not found in domain "${domain}".`,
              {
                domain,
                feature,
              }
            )
          }
          const featureFunc = get(
            context,
            `features.${domain}.${feature}`
          ) as ((...inputs: any[]) => any) | undefined
          if (typeof featureFunc !== 'function') {
            return createErrorObject(
              'FEATURE_NOT_FOUND',
              `Feature "${feature}" was not found in domain "${domain}".`,
              {
                domain,
                feature,
              }
            )
          }
          const args = _normalizeArgs(payload, crossLayerProps)
          const result = await featureFunc(...args)
          return _normalizeResult(result)
        }
      ),
    }

    const executeModelFunctionTool: ServerTool = {
      name: toolNames.executeModelFunction,
      description: 'Executes a model CRUD operation within a domain.',
      inputSchema: {
        type: 'object',
        required: ['domain', 'model', 'operation'],
        additionalProperties: true,
        properties: {
          domain: {
            type: 'string',
          },
          model: {
            type: 'string',
          },
          operation: {
            type: 'string',
            description: 'The CRUD operation to execute.',
          },
          payload: {
            description:
              'Arguments to pass to the model operation. Provide an array to send multiple arguments.',
          },
        },
      },
      execute: _execute(
        async (
          {
            domain,
            model,
            operation,
            payload,
          }: {
            domain: string
            model: string
            operation: string
            payload?: any
          },
          crossLayerProps?: CrossLayerProps
        ) => {
          if (isHidden([domain])) {
            return createErrorObject(
              'DOMAIN_NOT_FOUND',
              `Domain "${domain}" was not found.`,
              { domain }
            )
          }
          if (isHidden([domain, 'cruds']) || isHidden([domain, 'cruds', model])) {
            return createErrorObject(
              'MODEL_NOT_FOUND',
              `Model "${model}" was not found in domain "${domain}".`,
              { domain, model }
            )
          }
          if (isHidden([domain, 'cruds', model, operation])) {
            return createErrorObject(
              'OPERATION_NOT_FOUND',
              `Operation "${operation}" was not found on model "${model}" in domain "${domain}".`,
              { domain, model, operation }
            )
          }
          const modelCruds = get(
            context,
            `features.${domain}.cruds.${model}`
          ) as ModelCrudsFunctions<any> | undefined
          if (!modelCruds || typeof modelCruds !== 'object') {
            return createErrorObject(
              'MODEL_NOT_FOUND',
              `Model "${model}" was not found in domain "${domain}".`,
              { domain, model }
            )
          }
          const operationFunc = (modelCruds as Record<string, unknown>)[
            operation
          ] as ((...inputs: any[]) => any) | undefined
          if (typeof operationFunc !== 'function') {
            return createErrorObject(
              'OPERATION_NOT_FOUND',
              `Operation "${operation}" was not found on model "${model}" in domain "${domain}".`,
              { domain, model, operation }
            )
          }
          const args = _normalizeArgs(payload, crossLayerProps)
          const result = await operationFunc(...args)
          return _normalizeResult(result)
        }
      ),
    }

    return [
      listDomainsTool,
      listDomainFeaturesTool,
      listDomainModelsTool,
      executeFeatureTool,
      executeModelFunctionTool,
    ]
  }

  const enableNestedFeatureTools = (options?: NestedFeatureToolOptions) => {
    if (nestedFeatureToolsEnabled) {
      return
    }
    nestedFeatureToolsEnabled = true
    const nestedTools = _createNestedFeatureTools(options)
    nestedTools.reduce<undefined>((_, tool) => {
      addTool(tool)
      return undefined
    }, undefined)
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

  const set = (key: string, value: any) => {
    sets.push([key, value])
  }

  return {
    start,
    getApp,
    addTool,
    addModelCruds,
    addPreRouteMiddleware,
    addFeature,
    addAdditionalRoute,
    set,
    enableNestedFeatureTools,
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
