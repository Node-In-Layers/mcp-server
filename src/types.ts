import { ExpressRoute, ExpressMiddleware } from '@l4t/mcp-ai/common/types.js'
import { ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import {
  ServerHttpConfig,
  ServerCliConfig,
  ServerSseConfig,
  ServerStatelessHttpConfig,
} from '@l4t/mcp-ai'
import { Config, LogLevelNames, LayerContext } from '@node-in-layers/core'
import { Express } from 'express'
import { JsonAble } from 'functional-models'

export type HttpConnection = ServerHttpConfig['server']
export type CliConnection = ServerCliConfig['server']
export type SseConnection = ServerSseConfig['server']
export type StatelessHttpConnection = ServerStatelessHttpConfig['server']

export type Connection =
  | ServerHttpConfig
  | ServerCliConfig
  | ServerSseConfig
  | ServerStatelessHttpConfig

export type SystemUseExample = Readonly<{
  name: string
  description?: string
  value?: string
  tags?: string[]
  details?: string
  example?: string
}>

/**
 * Configuration for the MCP server.
 * @interface
 */
export type McpServerConfig = Readonly<{
  [McpNamespace]: {
    /**
     * The name of the MCP server.
     */
    name?: string
    /**
     * The version of the MCP server.
     */
    version?: string
    /**
     * Whether the MCP server is stateless.
     */
    stateless?: boolean
    /**
     * The server configuration.
     */
    server: {
      /**
       * Connection configuration.
       */
      connection: Connection
    }
    /**
     * Configuration for the start-here tool (name, description, and what to include in its response).
     */
    startHere?: {
      /**
       * Overrides the name of the tool. Default: 'START_HERE'
       */
      name?: string
      /**
       * Overrides the description of the tool.
       */
      description?: string
      /**
       * Completely hides default system entries (built-in navigation docs). Generally not recommended.
       */
      hideDefaultSystemEntries?: boolean
      /**
       * When true, the start-here response includes the list of domains (as if list_domains had been called).
       */
      includeDomains?: boolean
      /**
       * When true, the start-here response includes the list of features per domain (as if list_features had been called). Implies includeDomains.
       */
      includeFeatures?: boolean
      /**
       * Custom examples of use (flows) shown in the start-here response. Prefer JSON object examples with minimal annotation.
       */
      examplesOfUse?: ReadonlyArray<SystemUseExample>
    }
    /**
     * (Deprecated) Dot paths, to hide from the server.
     * Use hideComponents instead.
     */
    hiddenPaths?: string[]
    /**
     * If provided, hides the components configured.
     */
    hideComponents?: {
      /**
       * Dot paths, to hide from the server.
       * Example:
       * myDomain - hides an entire domain.
       * myDomain.myFeature - hides a feature.
       * myDomain.cruds - hides ALL models of the domain
       * myDomain.cruds.MyModel - hides a specific model
       */
      paths?: ReadonlyArray<string>
      /**
       * Which domains to completely hide. (Will not show up in the domain list).
       */
      domains?: string[]
      /**
       * Whether to hide all model cruds entirely.
       * This will not show any tools related to models.
       */
      allModels?: boolean
    }
    /**
     * Static system metadata shown in the start-here response (description, version).
     */
    systemDescription?: {
      description?: string
      version?: string
    }
    /**
     * Logging configuration.
     */
    logging?: {
      /**
       * The log level for requests.
       */
      requestLogLevel?: LogLevelNames
      /**
       * The log level for responses.
       */
      responseLogLevel?: LogLevelNames
      /**
       * The data to get for requests.
       */
      requestLogGetData?: (req: Request) => Record<string, any>
      /**
       * The data to get for responses.
       */
      responseLogGetData?: (req: Request) => Record<string, any>
    }
  }
}>

export const McpNamespace = '@node-in-layers/mcp-server'

export type McpServerMcp = Readonly<{
  start: <T extends McpServerConfig & Config>(
    systemContext: LayerContext<T, any>,
    options?: AppOptions
  ) => Promise<void>
  addTool: (tool: ServerTool) => void
  getApp: (options?: AppOptions) => Express
  set: (key: string, value: any) => void
  addPreRouteMiddleware: (middleware: ExpressMiddleware) => void
  addAdditionalRoute: (route: ExpressRoute) => void
}>

export type McpServerMcpLayer = Readonly<{
  [McpNamespace]: McpServerMcp
}>

export type AppOptions = Readonly<{
  jsonBodyParser?: {
    limit?: string
    strict?: boolean
  }
}>

export type McpContext<
  TConfig extends Config = Config,
  TFeatures extends object = object,
  TMcpLayer extends object = object,
> = LayerContext<
  TConfig,
  {
    features: TFeatures
    mcp: McpServerMcpLayer & TMcpLayer
  }
>

export type OpenApiFunctionDescription = Readonly<{
  name: string
  description?: string
  input: Record<string, JsonAble>
  output: Record<string, JsonAble>
}>
