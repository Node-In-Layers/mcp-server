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

type Connection =
  | ServerHttpConfig
  | ServerCliConfig
  | ServerSseConfig
  | ServerStatelessHttpConfig

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
     * Dot paths, to hide from the server.
     * Example:
     * myDomain - hides an entire domain.
     * myDomain.myFeature - hides a feature.
     * myDomain.cruds - hides ALL models of the domain
     * myDomain.cruds.MyModel - hides a specific model
     */
    hiddenPaths?: string[]
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
  start: (options?: AppOptions) => Promise<void>
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
