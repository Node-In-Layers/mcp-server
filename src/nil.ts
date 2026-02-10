import {
  Config,
  CoreNamespace,
  createErrorObject,
  FeaturesContext,
  isErrorObject,
  LayerContext,
  ServicesContext,
} from '@node-in-layers/core'
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
  crossLayerPropsOpenApi,
  doesDomainNotExist,
} from './libs.js'
import { default as nilSystem } from './docs/node-in-layers-system.json' with { type: 'json' }
import { McpNamespace, McpServerConfig, SystemUseExample } from './types.js'

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

const executeFeatureMcpTool = (): McpTool => {
  return {
    name: 'execute_feature',
    description: 'Executes a given feature',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        featureName: { type: 'string' },
        // @ts-ignore
        args: { type: 'object', additionalProperties: true },
        crossLayerProps: crossLayerPropsOpenApi(),
      },
      required: ['domain', 'featureName', 'args'],
    },
    outputSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
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
  context: FeaturesContext<TConfig>
) => {
  const hiddenPaths = new Set([
    '@node-in-layers/core',
    '@node-in-layers/data',
    '@node-in-layers/mcp-server',
    ...(context.config[McpNamespace].hiddenPaths || []),
  ])

  const doesDomainNotExistFunc = doesDomainNotExist(context)
  const isDomainHiddenFunc = isDomainHidden(hiddenPaths, context.config)
  const isFeatureHiddenFunc = isFeatureHidden(hiddenPaths, context.config)

  const _listDomainsTool = (): ServerTool => {
    return {
      ...listDomainsMcpTool(),
      execute: commonMcpExecute(async () => {
        const domains = Object.entries(context.features).reduce(
          (acc, [domainName]) => {
            if (
              doesDomainNotExistFunc(domainName) ||
              isDomainHiddenFunc(domainName)
            ) {
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
        const feature = context.features[domain]?.[featureName]
        if (
          !feature ||
          doesDomainNotExistFunc(domain) ||
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
        if (doesDomainNotExistFunc(domain) || isDomainHiddenFunc(domain)) {
          return createDomainNotFoundError()
        }
        const features = context.features
        if (!features || !context.features[domain]) {
          return createMcpResponse({ features: [] })
        }
        const result = Object.entries(features[domain]).reduce(
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

  const _executeFeatureTool = (): ServerTool => {
    return {
      ...executeFeatureMcpTool(),
      execute: commonMcpExecute(async (input: any) => {
        const domain = input.domain
        const featureName = input.featureName
        const feature = context.features[domain]?.[featureName]
        if (
          !feature ||
          doesDomainNotExistFunc(domain) ||
          isDomainHiddenFunc(domain) ||
          isFeatureHiddenFunc(domain, featureName)
        ) {
          return createFeatureNotFoundError()
        }
        const result = await feature(input.args, input.crossLayerProps).catch(
          e => {
            if (isErrorObject(e)) {
              return e
            }
            return createErrorObject(
              'UNCAUGHT_EXCEPTION',
              'An uncaught exception occurred while executing the feature.',
              e
            )
          }
        )
        return createMcpResponse(result)
      }),
    }
  }

  const startHereMcpTool = (): McpTool => {
    const startHereData = context.config[McpNamespace].startHere || {
      name: 'START_HERE',
      description:
        'BEFORE YOU DO ANYTHING, you should call this tool first!!! It provides a robust description about the system and how to use it.',
    }
    return {
      name: startHereData.name,
      description: startHereData.description,
      inputSchema: { type: 'object', properties: {}, required: [] },
      // @ts-ignore
      outputSchema: { type: 'object', additionalProperties: true },
    }
  }

  const _startHereTool = (): ServerTool => {
    return {
      ...startHereMcpTool(),
      execute: commonMcpExecute(async () => {
        const systemDescription = context.config[McpNamespace].systemDescription
        const systemName = context.config.systemName
        const systemEntries = nilSystem
        const systemNameExample: SystemUseExample = {
          name: 'systemName',
          value: systemName,
        }
        const systemDescriptionExample: SystemUseExample = {
          name: 'systemDescription',
          value: systemDescription?.description || '',
        }
        const systemVersionExample: SystemUseExample = {
          name: 'systemVersion',
          value: systemDescription?.version || '',
        }
        const entries = [
          systemNameExample,
          systemDescriptionExample,
          systemVersionExample,
          ...(systemDescription?.examplesOfUse || []),
          ...systemEntries,
        ]
        return createMcpResponse({
          entries,
        })
      }),
    }
  }

  return {
    listDomains: _listDomainsTool,
    describeFeature: _describeFeatureTool,
    listFeatures: _listFeaturesTool,
    executeFeature: _executeFeatureTool,
    startHere: _startHereTool,
  }
}
