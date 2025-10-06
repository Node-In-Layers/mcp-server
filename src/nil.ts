import { Config, LayerContext } from '@node-in-layers/core'
import { McpTool } from '@l4t/mcp-ai/common/types.js'
import { ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import {
  createDomainNotFoundError,
  createMcpResponse,
  createFeatureNotFoundError,
  isNilAnnotatedFunction,
  nilAnnotatedFunctionToOpenApi,
  createOpenApiForNonNilAnnotatedFunction,
  isDomainHidden,
  isFeatureHidden,
  commonMcpExecute,
} from './libs.js'
import { McpNamespace, McpServerConfig } from './types.js'

const describeFeatureMcpTool = (): McpTool => {
  return {
    name: 'describe_feature',
    description: 'Gets the schema of a given feature',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        featureName: { type: 'string' },
      },
      required: ['domain', 'featureName'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'object' },
      },
    },
  }
}

const listFeaturesMcpTool = (): McpTool => {
  return {
    name: 'list_features',
    description: 'Gets a list of features for a given domain',
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
        features: {
          type: 'array',
          // @ts-ignore
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  }
}

const listDomainsMcpTool = (): McpTool => {
  return {
    name: 'list_domains',
    description:
      'Gets a list of domains on the system, including their descriptions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          // @ts-ignore
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
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

  const isDomainHiddenFunc = isDomainHidden(hiddenPaths)
  const isFeatureHiddenFunc = isFeatureHidden(hiddenPaths)

  const _listDomainsTool = (): ServerTool => {
    return {
      ...listDomainsMcpTool(),
      execute: commonMcpExecute(async () => {
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
      execute: commonMcpExecute(async (input: any) => {
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
      execute: commonMcpExecute(async (input: any) => {
        const domain = input.domain
        if (isDomainHiddenFunc(domain)) {
          return createDomainNotFoundError()
        }
        const features = context[domain].features
        if (!features) {
          return createMcpResponse({features: []})
        }
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

  return {
    listDomains: _listDomainsTool,
    describeFeature: _describeFeatureTool,
    listFeatures: _listFeaturesTool,
  }
}
