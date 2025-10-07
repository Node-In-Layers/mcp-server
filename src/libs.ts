import get from 'lodash/get.js'
import {
  createErrorObject,
  isErrorObject,
  NilAnnotatedFunction,
  Response,
} from '@node-in-layers/core'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { JsonAble } from 'functional-models'
import { OpenApiFunctionDescription } from './types.js'

export const isNilAnnotatedFunction = (
  fn: any
): fn is NilAnnotatedFunction<any, any> => {
  if (fn.schema) {
    return true
  }
  return false
}

const _defOf = (schema: any) => (schema?._zod?.def ?? schema?._def) as any

const _unwrap = (schema: any): any => {
  const defAny = _defOf(schema)
  const inner =
    defAny?.innerType || defAny?.type || defAny?.schema || defAny?.wrapped
  return inner && (inner._zod || inner._def) ? _unwrap(inner) : schema
}

const _getDescription = (schema: any, defAny: any): string | undefined => {
  return (
    (schema && schema.description) ||
    defAny?.description ||
    defAny?.doc?.description
  )
}

// c8 ignore start
const _normalizeType = (t: string | undefined) => {
  switch (t) {
    case 'ZodString':
      return 'string'
    case 'ZodNumber':
      return 'number'
    case 'ZodBoolean':
      return 'boolean'
    case 'ZodLiteral':
      return 'literal'
    case 'ZodEnum':
      return 'enum'
    case 'ZodArray':
      return 'array'
    case 'ZodRecord':
      return 'record'
    case 'ZodObject':
      return 'object'
    case 'ZodUnion':
      return 'union'
    case 'ZodTuple':
      return 'tuple'
    case 'ZodUndefined':
      return 'undefined'
    case 'ZodVoid':
      return 'undefined'
    // c8 ignore next 3: unused mappings in current paths
    // case 'ZodUnknown':
    //   return 'unknown'
    // case 'ZodAny':
    //   return 'any'
    default:
      return t
  }
}
// c8 ignore stop

// c8 ignore start
const _numberSchema = (defAny: any, desc?: string) => {
  const checks = Array.isArray(defAny?.checks) ? defAny.checks : []
  const baseType = checks.some((c: any) => c?.kind === 'int')
    ? 'integer'
    : 'number'
  const extras = checks.reduce((acc: Record<string, any>, c: any) => {
    if (c?.kind === 'min') {
      return { ...acc, minimum: c.value }
    }
    if (c?.kind === 'max') {
      return { ...acc, maximum: c.value }
    }
    if (c?.kind === 'multipleOf') {
      return { ...acc, multipleOf: c.value }
    }
    return acc
  }, {})
  return { type: baseType, ...(desc ? { description: desc } : {}), ...extras }
}
// c8 ignore stop

// c8 ignore start
const _enumValues = (s: any, defAny: any): readonly any[] => {
  const zValues = s?._zod?.values
  return zValues && typeof zValues.forEach === 'function'
    ? Array.from(zValues)
    : Array.isArray(defAny?.entries)
      ? defAny.entries
      : defAny?.entries && typeof defAny.entries === 'object'
        ? Object.values(defAny.entries)
        : Array.isArray(defAny?.values)
          ? defAny.values
          : defAny?.values && typeof defAny.values === 'object'
            ? Object.values(defAny.values)
            : Array.isArray(defAny?.options)
              ? defAny.options
              : defAny?.options && typeof defAny.options === 'object'
                ? Object.values(defAny.options)
                : []
}
// c8 ignore stop

// c8 ignore start
const _literalSchema = (defAny: any, desc?: string) => {
  const literalValue = Array.isArray(defAny?.values)
    ? defAny.values[0]
    : defAny?.value
  const t = typeof literalValue
  const jsonType =
    t === 'string' || t === 'number' || t === 'boolean' ? t : undefined
  return {
    ...(jsonType ? { type: jsonType } : {}),
    const: literalValue,
    ...(desc ? { description: desc } : {}),
  }
}
// c8 ignore stop

const _objectFromShape = (shape: Record<string, any>, desc?: string) => {
  const entries = Object.entries(shape || {})
  const reduced = entries.reduce(
    (acc, [key, field]) => {
      const fieldDefAny = _defOf(field) || {}
      const fieldType = fieldDefAny?.type || fieldDefAny?.typeName
      const isOptional =
        fieldType === 'optional' ||
        fieldType === 'default' ||
        fieldType === 'ZodOptional' ||
        fieldType === 'ZodDefault'
      const nextProps = { ...acc.properties, [key]: zodToJson(field) }
      const nextReq = isOptional ? acc.required : acc.required.concat(key)
      return { properties: nextProps, required: nextReq }
    },
    { properties: {} as Record<string, any>, required: [] as string[] }
  )
  return {
    type: 'object',
    properties: reduced.properties,
    additionalProperties: false,
    ...(desc ? { description: desc } : {}),
    ...(reduced.required.length > 0 ? { required: reduced.required } : {}),
  }
}

const _arrayItems = (defAny: any) =>
  defAny?.element ?? defAny?.type ?? defAny?.element

const _recordValueType = (defAny: any) => defAny?.valueType ?? defAny?.value

const _zodToJsonHandlers: Record<
  string,
  (defAny: any, s: any, desc?: string) => Record<string, any>
> = {
  string: (_defAny, _s, desc) => ({
    type: 'string',
    ...(desc ? { description: desc } : {}),
  }),
  number: (defAny, _s, desc) => _numberSchema(defAny, desc),
  boolean: (_defAny, _s, desc) => ({
    type: 'boolean',
    ...(desc ? { description: desc } : {}),
  }),
  literal: (defAny, _s, desc) => _literalSchema(defAny, desc),
  enum: (defAny, s, desc) => ({
    type: 'string',
    enum: _enumValues(s, defAny),
    ...(desc ? { description: desc } : {}),
  }),
  array: (defAny, _s, desc) => {
    const item = _arrayItems(defAny)
    return {
      type: 'array',
      items: zodToJson(item),
      ...(desc ? { description: desc } : {}),
    }
  },
  record: (defAny, _s, desc) => {
    const valueType = _recordValueType(defAny)
    return {
      type: 'object',
      additionalProperties: zodToJson(valueType),
      ...(desc ? { description: desc } : {}),
    }
  },
  object: (defAny, _s, desc) => {
    const shapeGetter = defAny?.shape
    const shape =
      typeof shapeGetter === 'function' ? shapeGetter() : shapeGetter || {}
    return _objectFromShape(shape, desc)
  },
  union: (defAny, _s, desc) => {
    const options = (defAny?.options ?? []) as readonly any[]
    return {
      anyOf: options.map(zodToJson),
      ...(desc ? { description: desc } : {}),
    }
  },
  // undefined -> OpenAPI null
  undefined: (_defAny, _s, desc) => ({
    type: 'null',
    ...(desc ? { description: desc } : {}),
  }),
  // tuple handler intentionally ignored
  // c8 ignore next 7
  // tuple: (defAny, _s, desc) => {
  //   const items = _tupleItems(defAny)
  //   const arr = Array.isArray(items) ? items : Array.from(items as any)
  //   return {
  //     type: 'array',
  //     prefixItems: arr.map(_zodToJson),
  //     ...(desc ? { description: desc } : {}),
  //   }
  // },
}

export const zodToJson = (schema: any): Record<string, any> => {
  // c8 ignore next 2
  if (!schema) {
    return {}
  }
  const original = schema
  const s = _unwrap(schema)
  const defAny = _defOf(s)
  const t = _normalizeType(defAny?.type || defAny?.typeName) || 'unknown'
  const desc =
    _getDescription(original, _defOf(original)) || _getDescription(s, defAny)
  const handler = _zodToJsonHandlers[t]
  if (handler) {
    return handler(defAny, s, desc)
  }
  // Map void/undefined schemas to OpenAPI null
  if (t === 'undefined' || t === 'void') {
    return { type: 'null', ...(desc ? { description: desc } : {}) }
  }
  // c8 ignore next: fallback defensive return
  return {}
}

/**
 * CrossLayerProps OpenAPI schema (static):
 * {
 *   logging?: {
 *     ids?: Array<Record<string,string>>
 *   }
 * }
 */
export const crossLayerPropsOpenApi = (): any => ({
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
})

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

const _firstDefined = <T>(...vals: readonly (T | undefined)[]) =>
  vals.find(v => v !== undefined)

const _getFirstArgSchema = (fnSchema: any): any => {
  const def = _defOf(fnSchema)
  const inputSchema = def?.input
  const tupleDef = _firstDefined(_defOf(inputSchema), inputSchema)
  const itemsAny = _firstDefined(
    tupleDef?.items,
    tupleDef?.elements,
    tupleDef?.itemsArray
  )
  // c8 ignore next 3
  const items = Array.isArray(itemsAny)
    ? itemsAny
    : itemsAny
      ? Array.from(itemsAny)
      : undefined
  return Array.isArray(items) ? items[0] : undefined
}

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

export const nilAnnotatedFunctionToOpenApi = (
  name: string,
  fn: NilAnnotatedFunction<any, any>
): OpenApiFunctionDescription => {
  const schema = fn.schema
  const def = _defOf(schema)
  const returnsSchema = _firstDefined(
    def?.output,
    def?.returns,
    def?.returnType,
    def?.result
  )

  const argsSchema = _getFirstArgSchema(schema)

  const argsJson = argsSchema ? zodToJson(argsSchema) : {}
  const outputJson = returnsSchema ? zodToJson(returnsSchema) : {}

  const inputObject = {
    type: 'object',
    additionalProperties: false,
    properties: {
      args: argsJson,
      crossLayerProps: crossLayerPropsOpenApi(),
    },
    required: ['args'],
  }

  const output =
    outputJson?.type === 'object' && outputJson?.properties
      ? outputJson.properties
      : outputJson

  const description: string | undefined =
    (schema as any).description ?? _defOf(schema)?.description

  return {
    name,
    ...(description ? { description } : {}),
    input: inputObject,
    output,
  }
}

export const createMcpResponse = <T extends JsonAble>(
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

export const createDomainNotFoundError = () =>
  createErrorObject('DOMAIN_NOT_FOUND', 'Domain not found')
export const createModelNotFoundError = () =>
  createErrorObject('MODEL_NOT_FOUND', 'Model not found')
export const createFeatureNotFoundError = () =>
  createErrorObject('FEATURE_NOT_FOUND', 'Feature not found')
export const createModelsNotFoundError = () =>
  createErrorObject('MODELS_NOT_FOUND', 'Models not found')

export const isDomainHidden =
  (hiddenPaths: Set<string>) => (domain: string) => {
    return hiddenPaths.has(domain)
  }

export const areAllModelsHidden =
  (hiddenPaths: Set<string>) => (domain: string) => {
    return hiddenPaths.has(`${domain}.cruds`)
  }

export const isFeatureHidden =
  (hiddenPaths: Set<string>) => (domain: string, featureName: string) => {
    return hiddenPaths.has(`${domain}.${featureName}`)
  }

export const isModelHidden =
  (hiddenPaths: Set<string>) => (domain: string, modelName: string) => {
    return hiddenPaths.has(`${domain}.cruds.${modelName}`)
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
