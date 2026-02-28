import {
  Config,
  createErrorObject,
  ErrorObject,
  FeaturesContext,
  isErrorObject,
  memoizeValueSync,
} from '@node-in-layers/core'
import {
  McpTool,
  McpToolSchema,
  McpNamespace,
  McpServerConfig,
  SystemUseExample,
} from './types.js'
import {
  createDomainNotFoundError,
  createMcpResponse,
  createFeatureNotFoundError,
  isNilAnnotatedFunction,
  createOpenApiForNonNilAnnotatedFunction,
  isDomainHidden,
  isFeatureHidden,
  areAllModelsHidden,
  isModelHidden,
  commonMcpExecute,
  doesDomainNotExist,
} from './libs.js'
import {
  nilAnnotatedFunctionToOpenApi,
  crossLayerPropsOpenApi,
} from './internal-libs.js'
import { default as nilSystem } from './docs/node-in-layers-system.json' with { type: 'json' }

const describeFeatureMcpTool = (): McpToolSchema => {
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

const listFeaturesMcpTool = (): McpToolSchema => {
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

const executeFeatureMcpTool = (): McpToolSchema => {
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

const listDomainsMcpTool = (): McpToolSchema => {
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

const _listDomains = (context: FeaturesContext<McpServerConfig & Config>) => {
  const hiddenPaths = _getHiddenPaths(context)
  const doesDomainNotExistFunc = doesDomainNotExist(context)
  const isDomainHiddenFunc = isDomainHidden(hiddenPaths, context.config)
  const areAllModelsHiddenFunc = areAllModelsHidden(hiddenPaths, context.config)
  const isModelHiddenFunc = isModelHidden(hiddenPaths, context.config)

  return Object.entries(context.features).reduce(
    (acc, [domainName]) => {
      if (
        doesDomainNotExistFunc(domainName) ||
        isDomainHiddenFunc(domainName)
      ) {
        return acc
      }
      const featuresResult = _listFeaturesOfDomain(context, domainName)
      const hasExposedFeatures =
        !isErrorObject(featuresResult) && featuresResult.length > 0

      const cruds = context.features[domainName]?.cruds as
        | Record<string, unknown>
        | undefined
      const hasExposedModels =
        !context.config[McpNamespace].hideComponents?.allModels &&
        Boolean(cruds) &&
        !areAllModelsHiddenFunc(domainName) &&
        Object.keys(cruds ?? {}).some(
          modelName => !isModelHiddenFunc(domainName, modelName)
        )

      if (!hasExposedFeatures && !hasExposedModels) {
        return acc
      }

      const description = context.config['@node-in-layers/core'].apps.find(
        app => app.name === domainName
      )?.description
      return acc.concat({
        name: domainName,
        ...(description ? { description } : {}),
      })
    },
    [] as { name: string; description?: string }[]
  )
}

const _listFeaturesOfDomain = (
  context: FeaturesContext<McpServerConfig & Config>,
  domain: string
): ReadonlyArray<{ name: string; description?: string }> | ErrorObject => {
  const hiddenPaths = _getHiddenPaths(context)
  const doesDomainNotExistFunc = doesDomainNotExist(context)
  const isFeatureHiddenFunc = isFeatureHidden(hiddenPaths, context.config)
  const isDomainHiddenFunc = isDomainHidden(hiddenPaths, context.config)
  if (doesDomainNotExistFunc(domain) || isDomainHiddenFunc(domain)) {
    const e: ErrorObject = createDomainNotFoundError()
    return e
  }
  const features = context.features
  if (!features || !context.features[domain]) {
    return []
  }
  return Object.entries(features[domain]).reduce(
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
}

const _getHiddenPaths = memoizeValueSync((context: FeaturesContext<Config>) => {
  return new Set([
    '@node-in-layers/core',
    '@node-in-layers/data',
    '@node-in-layers/mcp-server',
    ...(context.config[McpNamespace].hiddenPaths || []),
  ])
})

export const create = <TConfig extends McpServerConfig & Config>(
  context: FeaturesContext<TConfig>
) => {
  const hiddenPaths = _getHiddenPaths(context)

  const doesDomainNotExistFunc = doesDomainNotExist(context)
  const isDomainHiddenFunc = isDomainHidden(hiddenPaths, context.config)
  const isFeatureHiddenFunc = isFeatureHidden(hiddenPaths, context.config)

  const _listDomainsTool = (): McpTool => {
    return {
      ...listDomainsMcpTool(),
      execute: commonMcpExecute(async () => {
        const domains = _listDomains(context)
        return createMcpResponse({ domains })
      }),
    }
  }

  const _describeFeatureTool = (): McpTool => {
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

  const _listFeaturesTool = (): McpTool => {
    return {
      ...listFeaturesMcpTool(),
      execute: commonMcpExecute(async (input: any) => {
        const domain = input.domain
        const features = _listFeaturesOfDomain(context, domain)
        if (isErrorObject(features)) {
          return features
        }
        return createMcpResponse({ features })
      }),
    }
  }

  const _executeFeatureTool = (): McpTool => {
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

  const startHereMcpTool = (): McpToolSchema => {
    const startHereData = context.config[McpNamespace].startHere ?? {}
    return {
      name: startHereData.name ?? 'START_HERE',
      description:
        startHereData.description ??
        'BEFORE YOU DO ANYTHING, you should call this tool first!!! It provides a robust description about the system and how to use it.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      // @ts-ignore
      outputSchema: { type: 'object', additionalProperties: true },
    }
  }

  const _getSystemEntries = () => {
    const startHereConfig = context.config[McpNamespace].startHere
    const shouldHideAlltogether = startHereConfig?.hideDefaultSystemEntries
    if (shouldHideAlltogether) {
      return []
    }
    if (context.config[McpNamespace].hideComponents?.allModels) {
      return nilSystem.filter(x => !x.name.startsWith('Model CRUD'))
    }
    return nilSystem
  }

  const _getDomainsSystemEntry = () => {
    const startHereConfig = context.config[McpNamespace].startHere
    const includeDomains = startHereConfig?.includeDomains
    if (includeDomains) {
      return [
        {
          name: 'List of Domains',
          description:
            'A list of all the domains on the system. This is the output of the list_domains tool.',
          domains: _listDomains(context),
        },
      ]
    }
    return []
  }

  const _getListFeaturesSystemEntries = () => {
    const startHereConfig = context.config[McpNamespace].startHere
    const includeFeatures = startHereConfig?.includeFeatures
    if (includeFeatures) {
      const domains = _listDomains(context)
      return domains.map(domain => {
        return {
          name: `List of Features for ${domain.name}`,
          description: `A list of all the features for the ${domain.name} domain. This is the output of the list_features tool for the ${domain.name} domain. You will still need to call describe_feature to get the schema of a given feature.`,
          features: _listFeaturesOfDomain(context, domain.name),
        }
      })
    }
    return []
  }

  const _startHereTool = (): McpTool => {
    return {
      ...startHereMcpTool(),
      execute: commonMcpExecute(async () => {
        const systemDescription = context.config[McpNamespace].systemDescription
        const startHereConfig = context.config[McpNamespace].startHere
        const examplesOfUse = startHereConfig?.examplesOfUse || []
        const systemName = context.config.systemName
        const systemEntries = _getSystemEntries()
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
          ...examplesOfUse,
          ...systemEntries,
          ..._getDomainsSystemEntry(),
          ..._getListFeaturesSystemEntries(),
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
