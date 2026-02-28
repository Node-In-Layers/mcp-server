import flow from 'lodash/flow.js'
import merge from 'lodash/merge.js'
import get from 'lodash/get.js'
import express from 'express'
import {
  createErrorObject,
  ErrorObject,
  isErrorObject,
  NilAnnotatedFunction,
  Response,
  combineCrossLayerProps,
} from '@node-in-layers/core'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { JsonAble } from 'functional-models'
import {
  McpNamespace,
  McpServerConfig,
  RequestCrossLayerProps,
  RequestInfo,
} from './types.js'
import { crossLayerPropsOpenApi } from './internal-libs.js'

export { zodToJson } from './internal-libs.js'

export const isRequestCrossLayerProps = (
  props: any
): props is RequestCrossLayerProps => {
  if (typeof props !== 'object' || props === null) {
    return false
  }
  return props.requestInfo !== undefined
}

export const buildRequestInfoFromExpressRequest = (
  req: express.Request
): RequestInfo => {
  const headers: Record<string, string> = Object.entries(req.headers).reduce(
    (acc, [key, value]) => {
      if (Array.isArray(value)) {
        return merge(acc, { [key]: value.join(', ') })
      } else if (value !== undefined) {
        return merge(acc, { [key]: String(value) })
      }
      return acc
    },
    {} as Record<string, string>
  )

  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, any>)
      : {}

  const query: Record<string, string> = Object.entries(req.query).reduce(
    (acc, [key, value]) => {
      if (Array.isArray(value)) {
        return merge(acc, { [key]: value.join(',') })
      } else if (value !== null && value !== undefined) {
        return merge(acc, { [key]: String(value) })
      }
      return acc
    },
    {} as Record<string, string>
  )

  return {
    headers,
    body,
    query,
    params: req.params as Record<string, string>,
    path: req.path,
    method: req.method,
    url: req.originalUrl,
    protocol: req.protocol,
  }
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
