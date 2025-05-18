import { ExpressMiddleware } from '@l4t/mcp-ai/common/types.js'
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
} from '@node-in-layers/core'
import { Express } from 'express'
import { ToolNameGenerator } from 'functional-models-orm-mcp'

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
      requestLogLevel: LogLevelNames
      responseLogLevel: LogLevelNames
    }
  }
}>

export const McpNamespace = '@node-in-layers/mcp-server'

export type McpServerMcp = Readonly<{
  start: () => Promise<void>
  addTool: (tool: ServerTool) => void
  getApp: () => Express
  addModelCruds: (
    modelCruds: ModelCrudsFunctions<any>,
    opts: {
      nameGenerator: ToolNameGenerator
    }
  ) => void
  addPreRouteMiddleware: (middleware: ExpressMiddleware) => void
}>

export type McpServerMcpLayer = Readonly<{
  [McpNamespace]: McpServerMcp
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
