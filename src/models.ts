import { JsonAble, OrmModel, ValidationError } from 'functional-models'
import {
  defaultModelTypeParser,
  createMcpToolSave,
  createMcpToolRetrieve,
  createMcpToolDelete,
  createMcpToolSearch,
  createMcpToolBulkInsert,
  createMcpToolBulkDelete,
} from 'functional-models-orm-mcp'
import {
  ModelCrudsFunctions,
  createErrorObject,
  Response,
  isErrorObject,
  LayerContext,
  Config,
} from '@node-in-layers/core'
import { modelToOpenApi } from 'functional-models-openapi'
import { ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import { McpTool } from '@l4t/mcp-ai/common/types.js'
import { asyncMap } from 'modern-async'
import {
  isDomainHidden,
  areAllModelsHidden,
  isModelHidden,
  commonMcpExecute,
  createDomainNotFoundError,
  createModelsNotFoundError,
  createMcpResponse,
  createModelNotFoundError,
  cleanupSearchQuery,
  doesDomainNotExist,
} from './libs.js'
import { McpNamespace, McpServerConfig } from './types.js'

const describeModelMcpTool = (): McpTool => {
  return {
    name: 'describe_model',
    description: 'Gets the schema of a given model',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        modelType: { type: 'string' },
      },
      required: ['domain', 'modelType'],
    },
    outputSchema: {
      type: 'object',
      // @ts-ignore
      additionalProperties: true,
    },
  }
}

const listModelsMcpTool = (): McpTool => {
  return {
    name: 'list_models',
    description:
      'Gets a list of models for a given domain and their description.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
      },
      required: ['domain'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        models: {
          type: 'array',
          // @ts-ignore
          items: {
            type: 'object',
            required: ['modelType'],
            properties: {
              modelType: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  }
}

export const create = <TConfig extends McpServerConfig & Config>(
  context: LayerContext<TConfig, any>
) => {
  const hiddenPaths = new Set([
    '@node-in-layers/core',
    '@node-in-layers/data',
    '@node-in-layers/mcp-server',
    ...(context.config[McpNamespace].hiddenPaths || []),
  ])

  const doesDomainNotExistFunc = doesDomainNotExist(context)
  const isDomainHiddenFunc = isDomainHidden(hiddenPaths)
  const areAllModelsHiddenFunc = areAllModelsHidden(hiddenPaths)
  const isModelHiddenFunc = isModelHidden(hiddenPaths)

  const listModels = (): ServerTool => {
    return {
      ...listModelsMcpTool(),
      execute: commonMcpExecute(async (input: any) => {
        const domain = input.domain
        if (
          doesDomainNotExistFunc(domain) ||
          isDomainHiddenFunc(domain) ||
          areAllModelsHiddenFunc(domain)
        ) {
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

  const describe = (): ServerTool => {
    return {
      ...describeModelMcpTool(),
      execute: commonMcpExecute(async (input: any) => {
        const domain = input.domain
        if (doesDomainNotExistFunc(domain) || isDomainHiddenFunc(domain)) {
          return createDomainNotFoundError()
        }
        const { pluralName, namespace } = defaultModelTypeParser(
          input.modelType
        )
        if (!pluralName || !namespace) {
          return createModelNotFoundError()
        }
        const model = context.features[domain].cruds[pluralName]
        if (
          !model ||
          isModelHiddenFunc(domain, pluralName) ||
          areAllModelsHiddenFunc(domain)
        ) {
          return createModelNotFoundError()
        }
        const asJson = modelToOpenApi(model.getModel())
        return createMcpResponse(asJson)
      }),
    }
  }

  const _createMcpModelFunc = (
    modelFunc: (input: any, model: OrmModel<any>) => Promise<Response<JsonAble>>
  ) => {
    return commonMcpExecute(async (input: any) => {
      const modelType = input.modelType
      const { namespace, pluralName } = defaultModelTypeParser(modelType)
      if (doesDomainNotExistFunc(namespace) || isDomainHiddenFunc(namespace)) {
        return createDomainNotFoundError()
      }
      if (!pluralName) {
        return createModelNotFoundError()
      }
      const model = context.features[namespace].cruds[pluralName]
      if (
        !model ||
        isModelHiddenFunc(namespace, pluralName) ||
        areAllModelsHiddenFunc(namespace)
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

  const save = (): ServerTool => {
    return {
      ...createMcpToolSave(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        const data = input.instance
        const result = await model.save(model.create(data)).catch(e => {
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

  const retrieve = (): ServerTool => {
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

  const deleteFunc = (): ServerTool => {
    return {
      ...createMcpToolDelete(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        await model.delete(input.id)
        return null
      }),
    }
  }

  const search = (): ServerTool => {
    return {
      ...createMcpToolSearch(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        const cleanedQuery = cleanupSearchQuery(input.search)
        const result = await model.search(cleanedQuery)
        const instances = await asyncMap(result.instances, i => i.toObj())
        return { instances, page: result.page }
      }),
    }
  }

  const bulkInsert = (): ServerTool => {
    return {
      ...createMcpToolBulkInsert(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        const objs = input.items.map(i => model.create(i))
        await model.bulkInsert(objs)
        return null
      }),
    }
  }

  const bulkDelete = (): ServerTool => {
    return {
      ...createMcpToolBulkDelete(),
      execute: _createMcpModelFunc(async (input: any, model) => {
        await model.bulkDelete(input.ids)
        return null
      }),
    }
  }

  return {
    listModels,
    describe,
    save,
    retrieve,
    delete: deleteFunc,
    search,
    bulkInsert,
    bulkDelete,
  }
}
