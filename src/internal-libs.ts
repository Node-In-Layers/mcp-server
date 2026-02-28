import merge from 'lodash/merge.js'
import { JsonObj } from 'functional-models'
import {
  combineCrossLayerProps,
  createCrossLayerProps,
  Logger,
  NilAnnotatedFunction,
  XOR,
} from '@node-in-layers/core'
import { z, ZodType } from 'zod'
import {
  AuthInfo,
  McpTool,
  OpenApiFunctionDescription,
  RequestInfo,
} from './types.js'

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
  // c7 ignore next 3
  const items = Array.isArray(itemsAny)
    ? itemsAny
    : itemsAny
      ? Array.from(itemsAny)
      : undefined
  return Array.isArray(items) ? items[0] : undefined
}

const _defOf = (schema: any) => (schema?._zod?.def ?? schema?._def) as any

const _unwrap = (schema: any): any => {
  const defAny = _defOf(schema)
  const inner =
    defAny?.innerType || defAny?.type || defAny?.schema || defAny?.wrapped
  return inner && (inner._zod || inner._def) ? _unwrap(inner) : schema
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
  description:
    'CrossLayerProps is an optional argument you can send with NIL MCP tool calls to enable end-to-end tracing across layers (features/services) and across multiple tool invocations. It carries correlation ids that the system logs at each hop so you can stitch together a full execution story.',
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
            description:
              'Each of these are individual objects, that have a key:id pair. Example: "ids": [{"myId":"123"},{"anotherId":"456"}]',
            additionalProperties: { type: 'string' },
          },
        },
      },
    },
  },
})

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
 * Converts the MCP SDK's RequestHandlerExtra into our local RequestInfo.
 * The SDK only provides HTTP headers; all other fields default to empty values
 * since they are not available through the SDK transport layer.
 */
export const buildRequestInfoFromSdkExtra = (extra?: any): RequestInfo => {
  const sdkHeaders = extra?.requestInfo?.headers || {}
  const headers: Record<string, string> = Object.entries(
    sdkHeaders as Record<string, unknown>
  ).reduce(
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
  return {
    headers,
    body: {},
    query: {},
    params: {},
    path: '',
    method: '',
    url: '',
    protocol: '',
  }
}

/**
 * Extracts AuthInfo from the MCP SDK's RequestHandlerExtra.authInfo, if present.
 */
export const buildAuthInfoFromSdkExtra = (
  extra?: any
): AuthInfo | undefined => {
  const sdkAuthInfo = extra?.authInfo
  if (!sdkAuthInfo) {
    return undefined
  }
  return {
    token: sdkAuthInfo.token,
    clientId: sdkAuthInfo.clientId,
    scopes: sdkAuthInfo.scopes ?? [],
    ...(sdkAuthInfo.expiresAt !== undefined
      ? { expiresAt: sdkAuthInfo.expiresAt }
      : {}),
    ...(sdkAuthInfo.resource !== undefined
      ? { resource: sdkAuthInfo.resource }
      : {}),
    ...(sdkAuthInfo.extra !== undefined ? { extra: sdkAuthInfo.extra } : {}),
  }
}

/**
 * Merges crossLayerProps from all sources and returns a cleaned input object
 * with a canonical mergedCrossLayerProps.
 *
 * Sources merged (in order):
 * 1. input.crossLayerProps — client-provided CLP at the top level of tool args
 * 2. input.args.crossLayerProps — CLP nested inside args (used by features)
 * 3. { requestInfo, authInfo } — from the MCP SDK transport's extra
 * 4. logger IDs — appended via createCrossLayerProps
 */
export const buildMergedToolInput = (
  input: any,
  extra: any,
  logger: Logger
): { mergedInput: any; mergedCrossLayerProps: any } => {
  const requestInfo = buildRequestInfoFromSdkExtra(extra)
  const authInfo = buildAuthInfoFromSdkExtra(extra)

  const mergedCrossLayerProps = createCrossLayerProps(
    logger,
    combineCrossLayerProps(
      combineCrossLayerProps(
        input?.crossLayerProps || {},
        input?.args?.crossLayerProps || {}
      ),
      { requestInfo, ...(authInfo ? { authInfo } : {}) }
    )
  )

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { crossLayerProps: _argsClp, ...cleanArgs } = input?.args || {}
  const mergedInput = {
    ...input,
    crossLayerProps: mergedCrossLayerProps,
    ...(input?.args !== undefined ? { args: cleanArgs } : {}),
  }

  return { mergedInput, mergedCrossLayerProps }
}

export const openApiToZodSchema = (
  parameters: any
): Record<string, ZodType> => {
  const { properties, required } = parameters

  if (!properties) {
    return {}
  }

  return Object.entries(properties).reduce(
    (acc, [key, propDef]: [string, any]) => {
      // Create the Zod field and apply optional if needed
      const zodField = createZodTypeFromDefinition(propDef)
      const finalField = !required?.includes(key)
        ? zodField.optional()
        : zodField

      // Return new accumulated object with this field
      return { ...acc, [key]: finalField }
    },
    {}
  )
}

// Break complex handling into small helpers to satisfy lint rules
const buildUnionFromArray = (arr: any[]) => {
  const members = arr.map(createZodTypeFromDefinition)
  if (members.length === 1) {
    return members[0]
  }
  return z.union(
    members as unknown as [any, any, ...any[]]
  ) as unknown as ZodType
}

const buildIntersectionFromArray = (arr: any[]) => {
  if (arr.length === 0) {
    return z.any()
  }
  return arr
    .map(createZodTypeFromDefinition)
    .reduce((acc, member) => z.intersection(acc as any, member as any))
}

const createEnumOrLiterals = (
  enumValues: any[] | undefined,
  preferredType: 'string' | 'number' | 'boolean' | null
) => {
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    return null
  }
  if (
    preferredType === 'string' &&
    enumValues.every(v => typeof v === 'string')
  ) {
    return z.enum(enumValues as [string, ...string[]]) as ZodType
  }
  const literals = enumValues.map((v: unknown) => z.literal(v as any))
  if (literals.length === 1) {
    return literals[0]
  }
  return z.union(
    literals as unknown as [any, any, ...any[]]
  ) as unknown as ZodType
}

// Single function to handle all types of definitions
const createZodTypeFromDefinition = (def: any): ZodType => {
  if (!def || typeof def !== 'object') {
    return z.any()
  }

  const {
    type,
    items,
    nullable,
    anyOf,
    oneOf,
    allOf,
    enum: enumValues,
    format,
  } = def

  // Handle combinators first
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    return buildUnionFromArray(anyOf)
  }
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    return buildUnionFromArray(oneOf)
  }
  if (Array.isArray(allOf) && allOf.length > 0) {
    return buildIntersectionFromArray(allOf)
  }

  // Compute by base type
  const zodType: ZodType = (() => {
    switch (type) {
      case 'string': {
        const enumType = createEnumOrLiterals(enumValues, 'string')
        const base = enumType ?? z.string()
        if (format === 'date-time' && (base as any).datetime) {
          return (base as any).datetime()
        }
        return base
      }
      case 'number':
      case 'integer': {
        const enumType = createEnumOrLiterals(enumValues, 'number')
        return enumType ?? z.number()
      }
      case 'boolean': {
        const enumType = createEnumOrLiterals(enumValues, 'boolean')
        return enumType ?? z.boolean()
      }
      case 'array':
        return z.array(items ? createZodTypeFromDefinition(items) : z.any())
      case 'object':
        return z.object(openApiToZodSchema(def)).loose()
      default: {
        const enumType = createEnumOrLiterals(enumValues, null)
        return enumType ?? z.any()
      }
    }
  })()

  if (nullable) {
    return zodType.nullable()
  }
  return zodType
}

export const isZodSchema = (schema: any): schema is ZodType => {
  if (!schema || typeof schema !== 'object') {
    return false
  }
  // Zod v4 schemas have `_zod`; Zod v3 schemas have `_def`.
  // Using these + `parse` is more reliable than `instanceof` across ESM/CJS boundaries.
  return (
    (schema as any)._zod !== undefined ||
    (schema as any)._def !== undefined ||
    typeof (schema as any).parse === 'function'
  )
}

const _getInputSchema = <TIn extends JsonObj, TOut extends XOR<JsonObj, void>>(
  annotatedFunction: NilAnnotatedFunction<TIn, TOut>
) => {
  const functionSchema = annotatedFunction.schema as {
    _zod?: { def?: { input?: unknown; output?: unknown } }
    _def?: { input?: unknown; output?: unknown }
    def?: { input?: unknown; output?: unknown }
  }
  const fnDef =
    functionSchema._zod?.def ?? functionSchema._def ?? functionSchema.def
  const tupleInputSchema = fnDef?.input
  const tupleDef =
    (tupleInputSchema as any)?._zod?.def ??
    (tupleInputSchema as any)?._def ??
    (tupleInputSchema as any)?.def
  const argsSchema = tupleDef?.items?.[0] ?? tupleDef?.args?.[0]
  return argsSchema
}

const _getOutputSchema = <TOut extends XOR<JsonObj, void>>(
  annotatedFunction: NilAnnotatedFunction<any, TOut>
) => {
  const functionSchema = annotatedFunction.schema as {
    _zod?: { def?: { output?: unknown } }
    _def?: { output?: unknown }
    def?: { output?: unknown }
  }
  const fnDef =
    functionSchema._zod?.def ?? functionSchema._def ?? functionSchema.def
  const outputSchemaOpenApi =
    fnDef && typeof fnDef === 'object' ? zodToJson(fnDef) : undefined
  return outputSchemaOpenApi?.type === 'object'
    ? outputSchemaOpenApi
    : undefined
}

export const createMcpToolFromAnnotatedFunction = <
  TIn extends JsonObj,
  TOut extends XOR<JsonObj, void>,
>(
  annotatedFunction: NilAnnotatedFunction<TIn, TOut>,
  options?: {
    name?: string
    description?: string
  }
): Omit<McpTool, 'execute'> => {
  const name = options?.name || annotatedFunction.functionName
  const description =
    options?.description || annotatedFunction.schema?.description
  const inputSchema = _getInputSchema<TIn, TOut>(annotatedFunction)
  const outputSchema = _getOutputSchema<TOut>(annotatedFunction)
  const tool: Omit<McpTool, 'execute'> = {
    name,
    description: description || '',
    inputSchema,
    outputSchema,
  }

  return tool
}
