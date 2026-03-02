import z from 'zod'
import flow from 'lodash/flow.js'
import merge from 'lodash/merge.js'
import get from 'lodash/get.js'
import {
  createErrorObject,
  ErrorObject,
  isErrorObject,
  NilAnnotatedFunction,
  Response,
} from '@node-in-layers/core'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { JsonAble } from 'functional-models'
import {
  McpNamespace,
  McpServerConfig,
  RequestCrossLayerProps,
  ExecuteModelData,
  ExecuteFeatureData,
  ExecuteFunctionData,
  ModelAction,
  ModelActionToolName,
  executeModelSchema,
  executeFeatureSchema,
  executeFunctionSchema,
} from './types.js'
import { crossLayerPropsOpenApi } from './internal-libs.js'
import { zodParse } from './utils.js'

const ACTION_TOOL_NAMES = Object.values(ModelActionToolName)

export const isRequestCrossLayerProps = (
  props: any
): props is RequestCrossLayerProps => {
  if (typeof props !== 'object' || props === null) {
    return false
  }
  return props.requestInfo !== undefined
}

export const isNilAnnotatedFunction = (
  fn: any
): fn is NilAnnotatedFunction<any, any> => {
  if (fn.schema) {
    return true
  }
  return false
}

/**
 * NOTE: Unused breadth-first search fallback for tuple/object discovery. Commented out to avoid
 * non-functional patterns (loops/mutation) and because current Zod v4 paths cover our use-cases.
 */
/*
const _findZodNodesByType = (
  root: any,
  typeName: string,
  maxDepth = 6
): any[] => {
  return []
}
*/

export const createOpenApiForNonNilAnnotatedFunction = (name: string) => {
  return {
    name,
    input: {
      type: 'object',
      additionalProperties: true,
      properties: {
        args: {
          type: 'object',
        },
        crossLayerProps: crossLayerPropsOpenApi(),
      },
      required: ['args'],
    },
    output: {
      type: 'object',
      additionalProperties: true,
    },
  }
}

export const createMcpResponse = <T extends JsonAble>(
  result: T,
  opts?: { isError?: boolean }
): CallToolResult => {
  const isError = opts?.isError || isErrorObject(result)

  const structuredContent: Record<string, unknown> | undefined = (() => {
    if (result === null || result === undefined) {
      return undefined
    }
    // MCP structuredContent must be an object at the root.
    // Don't reshape arrays/primitives here — tools should return objects that match their outputSchema.
    if (typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>
    }
    return undefined
  })()

  return {
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: 'text',
        text: JSON.stringify(result !== undefined ? result : '""'),
      },
    ],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

export const createDomainNotFoundError = (): ErrorObject =>
  createErrorObject('DOMAIN_NOT_FOUND', 'Domain not found')
export const createModelNotFoundError = (): ErrorObject =>
  createErrorObject('MODEL_NOT_FOUND', 'Model not found')
export const createFeatureNotFoundError = (): ErrorObject =>
  createErrorObject('FEATURE_NOT_FOUND', 'Feature not found')
export const createModelsNotFoundError = (): ErrorObject =>
  createErrorObject('MODELS_NOT_FOUND', 'Models not found')

export const doesDomainNotExist = context => (domain: string) => {
  return Boolean(context.features[domain]) === false
}

export const isDomainHidden =
  (hiddenPaths: Set<string>, config: McpServerConfig) => (domain: string) => {
    return (
      hiddenPaths.has(domain) ||
      config[McpNamespace].hideComponents?.domains?.includes(domain)
    )
  }

export const areAllModelsHidden =
  (hiddenPaths: Set<string>, config: McpServerConfig) => (domain: string) => {
    return (
      hiddenPaths.has(`${domain}.cruds`) ||
      config[McpNamespace].hideComponents?.allModels
    )
  }

export const isFeatureHidden =
  (hiddenPaths: Set<string>, config: McpServerConfig) =>
  (domain: string, featureName: string) => {
    return (
      hiddenPaths.has(`${domain}.${featureName}`) ||
      config[McpNamespace].hideComponents?.paths?.includes(
        `${domain}.${featureName}`
      )
    )
  }

export const isModelHidden =
  (hiddenPaths: Set<string>, config: McpServerConfig) =>
  (domain: string, modelName: string) => {
    return (
      hiddenPaths.has(`${domain}.cruds.${modelName}`) ||
      config[McpNamespace].hideComponents?.paths?.includes(
        `${domain}.cruds.${modelName}`
      )
    )
  }

const isMcpResponse = (result: any): boolean => {
  if (!result) {
    return false
  }
  const data = get(result, 'content[0].type')
  if (data === undefined) {
    return false
  }
  return data === 'text'
}

const _formatResponse = (result: Response<any>): CallToolResult => {
  if (isMcpResponse(result)) {
    return result
  }
  if (result !== null && result !== undefined) {
    if (isErrorObject(result)) {
      return createMcpResponse(result, { isError: true })
    }
  }
  return createMcpResponse(result)
}

export const commonMcpExecute =
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

export const cleanupSearchQuery = (query: any) => {
  const ensureHasQuery = (q: any) => merge({ query: [] }, q)

  const isPlainObject = (v: any) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)

  const inferValueType = (
    value: any
  ): 'string' | 'number' | 'boolean' | 'object' | 'date' => {
    if (value instanceof Date) {
      return 'date'
    }
    const t = typeof value
    if (t === 'string') {
      return 'string'
    }
    if (t === 'number') {
      return 'number'
    }
    if (t === 'boolean') {
      return 'boolean'
    }
    return 'object'
  }

  const normalizeProperty = (token: any) => {
    const valueType = token.valueType || inferValueType(token.value)
    const equalitySymbol = token.equalitySymbol || '='
    const options = token.options || {}
    return {
      ...token,
      type: 'property',
      valueType,
      equalitySymbol,
      options,
    }
  }

  const normalizeDatesAfter = (token: any) => {
    const valueType = token.valueType || 'date'
    const options = token.options || {}
    return {
      ...token,
      type: 'datesAfter',
      valueType,
      options: {
        ...options,
        ...(options.equalToAndAfter === undefined
          ? { equalToAndAfter: false }
          : {}),
      },
    }
  }

  const normalizeDatesBefore = (token: any) => {
    const valueType = token.valueType || 'date'
    const options = token.options || {}
    return {
      ...token,
      type: 'datesBefore',
      valueType,
      options: {
        ...options,
        ...(options.equalToAndBefore === undefined
          ? { equalToAndBefore: false }
          : {}),
      },
    }
  }

  const normalizeToken = (token: any): any => {
    if (token === 'AND' || token === 'OR') {
      return token
    }
    if (Array.isArray(token)) {
      return token.map(normalizeToken)
    }
    if (isPlainObject(token)) {
      if (token.type === 'property') {
        return normalizeProperty(token)
      }
      if (token.type === 'datesAfter') {
        return normalizeDatesAfter(token)
      }
      if (token.type === 'datesBefore') {
        return normalizeDatesBefore(token)
      }
      // Unknown object token, return as-is
      return token
    }
    return token
  }

  const normalizeQueryTokens = (tokens: any): any => {
    if (!tokens) {
      return []
    }
    if (Array.isArray(tokens)) {
      return tokens.map(normalizeToken)
    }
    return normalizeToken(tokens)
  }

  const addSortDefaults = (q: any) => {
    if (!q.sort) {
      return q
    }
    const { sort } = q
    if (sort && typeof sort === 'object') {
      return {
        ...q,
        sort: {
          key: sort.key,
          order: sort.order || 'asc',
        },
      }
    }
    return q
  }

  const addSearchDefaults = (q: any) => ({
    ...q,
    page: q.page,
    take: q.take,
    query: normalizeQueryTokens(q.query),
  })

  return flow([ensureHasQuery, addSortDefaults, addSearchDefaults])(query)
}

export const parseExecuteData = (
  body: any
):
  | ExecuteFeatureData
  | ExecuteModelData<any>
  | ExecuteFunctionData
  | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined
  }

  const toolName = body.toolName || body.name
  const args = body.args || body.arguments || {}

  if (toolName === 'execute_feature') {
    return zodParse(executeFeatureSchema(z.object().loose()), {
      toolName: 'execute_feature',
      domain: args.domain || '',
      featureName: args.featureName || '',
      args,
    }) as ExecuteFeatureData
  }

  const modelActionMap: Record<string, ModelAction> = {
    [ModelActionToolName.Save]: ModelAction.Save,
    [ModelActionToolName.Retrieve]: ModelAction.Retrieve,
    [ModelActionToolName.Delete]: ModelAction.Delete,
    [ModelActionToolName.Search]: ModelAction.Search,
    [ModelActionToolName.BulkInsert]: ModelAction.BulkInsert,
    [ModelActionToolName.BulkDelete]: ModelAction.BulkDelete,
  }

  const action = modelActionMap[toolName]
  if (action) {
    const [domain = '', modelName = ''] = (args.modelType || '').split('.')
    return zodParse(executeModelSchema, {
      toolName: toolName as any,
      action,
      domain,
      modelName,
      args,
    }) as ExecuteModelData<any>
  }

  if (toolName) {
    return zodParse(executeFunctionSchema, {
      toolName: toolName as any,
      functionName: toolName,
      args,
    }) as ExecuteFunctionData
  }

  return undefined
}

export const isExecuteFeatureData = (data: any): data is ExecuteFeatureData => {
  return data?.toolName === 'execute_feature'
}

export const isExecuteFunctionData = (
  data: any
): data is ExecuteFunctionData => {
  return (
    data?.functionName !== undefined &&
    data?.toolName !== 'execute_feature' &&
    !ACTION_TOOL_NAMES.includes(data?.toolName)
  )
}

export const isExecuteModelData = (data: any): data is ExecuteModelData => {
  return ACTION_TOOL_NAMES.includes(data?.toolName)
}

export const isExecuteModelSave = (
  data: any
): data is ExecuteModelData<ModelAction.Save> => {
  if (!isExecuteModelData(data)) {
    return false
  }
  return data?.action === ModelAction.Save
}

export const isExecuteModelRetrieve = (
  data: any
): data is ExecuteModelData<ModelAction.Retrieve> => {
  if (!isExecuteModelData(data)) {
    return false
  }
  return data?.action === ModelAction.Retrieve
}

export const isExecuteModelDelete = (
  data: any
): data is ExecuteModelData<ModelAction.Delete> => {
  if (!isExecuteModelData(data)) {
    return false
  }
  return data?.action === ModelAction.Delete
}

export const isExecuteModelSearch = (
  data: any
): data is ExecuteModelData<ModelAction.Search> => {
  if (!isExecuteModelData(data)) {
    return false
  }
  return data?.action === ModelAction.Search
}

export const isExecuteModelBulkInsert = (
  data: any
): data is ExecuteModelData<ModelAction.BulkInsert> => {
  if (!isExecuteModelData(data)) {
    return false
  }
  return data?.action === ModelAction.BulkInsert
}

export const isExecuteModelBulkDelete = (
  data: any
): data is ExecuteModelData<ModelAction.BulkDelete> => {
  if (!isExecuteModelData(data)) {
    return false
  }
  return data?.action === ModelAction.BulkDelete
}

export const isZodError = (error: any): error is z.ZodError => {
  return error instanceof z.ZodError
}

export const convertZodErrorToErrorObject = (
  error: z.ZodError
): ErrorObject => {
  // AI: Convert this into a proper error object.
  const issues = error.issues.map((issue: z.ZodIssue) => {
    return {
      path: issue.path.join('.'),
      message: issue.message,
    }
  })
  return createErrorObject('VALIDATION_ERROR', 'A validation error occurred', {
    issues,
  })
}

export { buildRequestInfoFromExpressRequest } from './internal-libs.js'
