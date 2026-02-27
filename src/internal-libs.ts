import merge from 'lodash/merge.js'
import {
  combineCrossLayerProps,
  createCrossLayerProps,
  Logger,
} from '@node-in-layers/core'
import { z, ZodType } from 'zod'
import { AuthInfo, RequestInfo } from './types.js'

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
