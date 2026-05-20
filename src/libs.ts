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
} from './types.js'
import { crossLayerPropsOpenApi } from './internal-libs.js'

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

const _isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object'

export const getMcpToolName = (body: unknown): string | undefined => {
  if (!_isRecord(body)) {
    return undefined
  }
  if (typeof body.toolName === 'string') {
    return body.toolName
  }
  if (typeof body.name === 'string') {
    return body.name
  }
  const params = body.params
  if (_isRecord(params)) {
    if (typeof params.toolName === 'string') {
      return params.toolName
    }
    if (typeof params.name === 'string') {
      return params.name
    }
  }
  return undefined
}

export const getMcpToolArguments = (body: unknown): any | undefined => {
  if (!_isRecord(body)) {
    return undefined
  }
  if (body.arguments) {
    return body.arguments
  }
  if (body.args) {
    return body.args
  }
  const params = body.params
  if (_isRecord(params)) {
    if (params.arguments) {
      return params.arguments
    }
    if (params.args) {
      return params.args
    }
  }
  return undefined
}

export const isExecuteModel = (
  reqOrBody: any
): ExecuteModelData | undefined => {
  const body = reqOrBody?.body ? reqOrBody.body : reqOrBody
  const toolName = getMcpToolName(body)
  const args = getMcpToolArguments(body)

  if (!toolName || !toolName.startsWith('model_')) {
    return undefined
  }

  const actionMapping: Record<string, string> = {
    model_save: 'save',
    model_retrieve: 'retrieve',
    model_delete: 'delete',
    model_search: 'search',
    model_bulk_insert: 'bulkInsert',
    model_bulk_delete: 'bulkDelete',
  }

  const action = actionMapping[toolName]
  if (!action) {
    return undefined
  }

  const modelType = args?.modelType
  if (!modelType || typeof modelType !== 'string') {
    return undefined
  }

  const dotIndex = modelType.lastIndexOf('.')
  if (dotIndex === -1) {
    return undefined
  }

  const domain = modelType.slice(0, dotIndex)
  const modelName = modelType.slice(dotIndex + 1)

  return {
    toolName,
    action,
    domain,
    modelName,
    args,
  }
}

export const isExecuteFeature = (
  reqOrBody: any
): ExecuteFeatureData | undefined => {
  const body = reqOrBody?.body ? reqOrBody.body : reqOrBody
  const toolName = getMcpToolName(body)
  const args = getMcpToolArguments(body)

  if (!toolName) {
    return undefined
  }

  // Exclude built-in model tools and describe/list tools
  if (
    toolName.startsWith('model_') ||
    toolName === 'list_models' ||
    toolName === 'describe_model' ||
    toolName === 'list_domains' ||
    toolName === 'list_features' ||
    toolName === 'describe_feature' ||
    toolName === 'describe_system'
  ) {
    return undefined
  }

  if (toolName === 'execute_feature') {
    return {
      toolName,
      domain: args?.domain,
      featureName: args?.featureName || '',
      args: args?.args || {},
    }
  }

  // For directly added features
  return {
    toolName,
    domain: undefined, // Domain is often unknown from just the request body for direct tools
    featureName: toolName,
    args: args || {},
  }
}

export {
  buildRequestInfoFromExpressRequest,
  nilAnnotatedFunctionToOpenApi,
} from './internal-libs.js'
