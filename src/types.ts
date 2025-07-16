import {
  ExpressRoute,
  ExpressMiddleware,
  McpTool,
} from '@l4t/mcp-ai/common/types.js'
import { ServerTool } from '@l4t/mcp-ai/simple-server/types.js'
import {
  ServerHttpConfig,
  ServerCliConfig,
  ServerSseConfig,
  ServerStatelessHttpConfig,
} from '@l4t/mcp-ai'
import {
  Config,
  CommonContext,
  LogLevelNames,
  LayerContext,
  ModelCrudsFunctions,
  Response,
} from '@node-in-layers/core'
import { Express } from 'express'
import { ToolNameGenerator } from 'functional-models-orm-mcp'
import { JsonAble } from 'functional-models'

type Connection =
  | ServerHttpConfig
  | ServerCliConfig
  | ServerSseConfig
  | ServerStatelessHttpConfig

export type McpServerConfig = Readonly<{
  [McpNamespace]: {
    name?: string
    version?: string
    stateless?: boolean
    server: {
      connection: Connection
    }
    logging?: {
      requestLogLevel?: LogLevelNames
      responseLogLevel?: LogLevelNames
      requestLogGetData?: (req: Request) => Record<string, any>
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
  addModelCruds: (
    modelCruds: ModelCrudsFunctions<any>,
    opts?: {
      nameGenerator: ToolNameGenerator
    }
  ) => void
  addPreRouteMiddleware: (middleware: ExpressMiddleware) => void
  addFeature: <T extends object = object, R extends JsonAble | void = void>(
    featureFunc: (input: T) => Promise<Response<R>>,
    tool: McpTool
  ) => void
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
> &
  CommonContext<TConfig>
