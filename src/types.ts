import {
  ServerTool,
  SimpleServerConfig,
} from '@l4t/mcp-ai/simple-server/types.js'
import {
  Config,
  CommonContext,
  LogLevelNames,
  LayerContext,
  ModelCrudsFunctions,
} from '@node-in-layers/core'
import { Express } from 'express'
import { ToolNameGenerator } from 'functional-models-orm-mcp'

export type McpServerConfig = Readonly<{
  [McpNamespace]: {
    name?: string
    version?: string
    server: SimpleServerConfig
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
