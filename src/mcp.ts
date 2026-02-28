import { randomUUID } from 'crypto'
import z from 'zod'
import get from 'lodash/get.js'
import merge from 'lodash/merge.js'
import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import { JsonObj } from 'functional-models'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import {
  Config,
  createErrorObject,
  isErrorObject,
  LayerContext,
  NilAnnotatedFunction,
  XOR,
} from '@node-in-layers/core'
import {
  AppOptions,
  McpServerMcp,
  McpServerConfig,
  McpContext,
  McpNamespace,
  McpTool,
  ExpressOptions,
  ExpressRoute,
  ExpressMiddleware,
} from './types.js'
import { create as createModelsMcp } from './models.js'
import { create as createNilMcp } from './nil.js'
import {
  buildMergedToolInput,
  isZodSchema,
  openApiToZodSchema,
  createMcpToolFromAnnotatedFunction,
} from './internal-libs.js'
import { createMcpResponse } from './libs.js'

const DEFAULT_RESPONSE_REQUEST_LOG_LEVEL = 'info'
const DEFAULT_PORT = 3000
const BAD_REQUEST_STATUS = 400
const NOT_FOUND_STATUS = 404
const UNHANDLED_REQUEST_STATUS = 405

const create = (
  context: McpContext<McpServerConfig & Config>
): McpServerMcp => {
  const tools: McpTool[] = []
  const sets: [string, any][] = []
  const preRouteMiddleware: ExpressMiddleware[] = []
  const additionalRoutes: ExpressRoute[] = []

  const addTool = (tool: McpTool) => {
    // eslint-disable-next-line functional/immutable-data
    tools.push(tool)
  }

  const _wrapToolsWithLogger = (tool: McpTool): McpTool => {
    // This execute is what the MCP SDK calls: (args, extra) where extra is RequestHandlerExtra.
    // extra.requestInfo contains HTTP headers (and only headers) provided by the SDK transport.
    const execute = async (input: any, extra?: any) => {
      const requestId = randomUUID()
      const logger = context.log
        .getIdLogger('logRequest', 'requestId', requestId)
        .applyData({ requestId })
      const level =
        context.config[McpNamespace].logging?.requestLogLevel ||
        DEFAULT_RESPONSE_REQUEST_LOG_LEVEL
      const requestData =
        context.config[McpNamespace].logging?.requestLogGetData?.(input) || {}
      logger[level]('Request received', {
        method: 'POST',
        // @ts-ignore
        url: context.config[McpNamespace].server?.path || '/',
        tool: tool.name,
        body: input,
        ...requestData,
      })

      const { mergedInput, mergedCrossLayerProps } = buildMergedToolInput(
        input,
        extra,
        logger
      )

      const result = await tool.execute(mergedInput, mergedCrossLayerProps)
      const data = get(result, 'content[0].text')
      const toShow = data ? JSON.parse(data as string) : result

      const responseData =
        // @ts-ignore — responseLogGetData receives the tool result, not a Request
        context.config[McpNamespace].logging?.responseLogGetData?.(result) || {}
      logger[level]('Request Response', {
        response: toShow,
        ...responseData,
      })

      return result
    }

    return { ...tool, execute }
  }

  const _buildAllTools = (
    systemContext: LayerContext<Config, any>
  ): McpTool[] => {
    const config = systemContext.config[McpNamespace]
    const nilMcp = createNilMcp(systemContext)
    const modelTools = config.hideComponents?.allModels
      ? []
      : (() => {
          const modelsMcp = createModelsMcp(systemContext)
          return [
            modelsMcp.listModels(),
            modelsMcp.describe(),
            modelsMcp.save(),
            modelsMcp.retrieve(),
            modelsMcp.delete(),
            modelsMcp.search(),
            modelsMcp.bulkInsert(),
            modelsMcp.bulkDelete(),
          ]
        })()

    return [
      nilMcp.startHere(),
      nilMcp.listDomains(),
      nilMcp.listFeatures(),
      nilMcp.describeFeature(),
      nilMcp.executeFeature(),
      ...modelTools,
      ...tools,
    ].map(_wrapToolsWithLogger)
  }

  const _buildMcpServer = (
    systemContext: LayerContext<Config, any>
  ): McpServer => {
    const config = systemContext.config[McpNamespace]
    const server = new McpServer({
      name: systemContext.config.systemName,
      version: config.version || '1.0.0',
    })

    _buildAllTools(systemContext).forEach(tool => {
      const inputSchema = isZodSchema(tool.inputSchema)
        ? tool.inputSchema
        : z.object(openApiToZodSchema(tool.inputSchema))
      const outputSchema = (() => {
        const raw = tool.outputSchema
        if (!raw) {
          return undefined
        }
        // If already Zod, pass through (SDK validates structuredContent with it)
        if (isZodSchema(raw)) {
          return raw
        }
        // If OpenAPI/JSON-schema-ish object at root, convert to a Zod object schema.
        // If it's null/array/anyOf/etc at root, return undefined (no output validation).
        if (typeof raw === 'object' && (raw as any).type === 'object') {
          return z.object(openApiToZodSchema(raw)).loose()
        }
        return undefined
      })()
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema,
          ...(outputSchema ? { outputSchema } : {}),
        },
        tool.execute
      )
    })

    return server
  }

  // ─── HTTP transport ────────────────────────────────────────────────────────

  const _buildExpressOptions = (options?: AppOptions): ExpressOptions => ({
    preRouteMiddleware,
    additionalRoutes,
    ...(options || {}),
  })

  const _buildHttpApp = async (
    systemContext: LayerContext<Config, any>,
    options?: AppOptions
  ): Promise<express.Express> => {
    const config = systemContext.config[McpNamespace]
    const isStateful = Boolean(config.stateful)
    // @ts-ignore
    const path: string = config.server?.path || '/'
    const expressOpts = _buildExpressOptions(options)

    const app = express()
    app.use(bodyParser.json(expressOpts.jsonBodyParser))
    app.use(cors())
    expressOpts.preRouteMiddleware?.forEach(middleware => app.use(middleware))

    // Session map used only in stateful mode
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {}

    const _routeWrapper = (
      func: (
        req: express.Request,
        res: express.Response
      ) => Promise<void> | void
    ) => {
      if (expressOpts.afterRouteCallback) {
        return async (req: express.Request, res: express.Response) => {
          await func(req, res)
          // @ts-ignore
          await expressOpts.afterRouteCallback(req, res)
        }
      }
      return func
    }

    const handleStatelessRequest = async (
      req: express.Request,
      res: express.Response
    ) => {
      const server = _buildMcpServer(systemContext)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      res.on('close', () => {
        transport.close()
        server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    }

    const handleStatefulRequest = async (
      req: express.Request,
      res: express.Response
    ) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      // eslint-disable-next-line functional/no-let
      let transport: StreamableHTTPServerTransport

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId]
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const server = _buildMcpServer(systemContext)
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: newSessionId => {
            // eslint-disable-next-line functional/immutable-data
            transports[newSessionId] = transport
          },
        })
        // eslint-disable-next-line functional/immutable-data
        transport.onclose = () => {
          if (transport.sessionId) {
            // eslint-disable-next-line functional/immutable-data
            delete transports[transport.sessionId]
          }
        }
        await server.connect(transport)
      } else {
        res.status(BAD_REQUEST_STATUS).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        })
        return
      }

      await transport.handleRequest(req, res, req.body)
    }

    const handleSessionRequest = async (
      req: express.Request,
      res: express.Response
    ) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (!sessionId || !transports[sessionId]) {
        res.status(BAD_REQUEST_STATUS).send('Invalid or missing session ID')
        return
      }
      await transports[sessionId].handleRequest(req, res)
    }

    const _unhandledRequest = (
      _req: express.Request,
      res: express.Response
    ) => {
      res.writeHead(UNHANDLED_REQUEST_STATUS).end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        })
      )
    }

    expressOpts.additionalRoutes?.forEach(route => {
      app[route.method.toLowerCase()](route.path, route.handler)
    })

    app.post(
      path,
      _routeWrapper(isStateful ? handleStatefulRequest : handleStatelessRequest)
    )

    if (isStateful) {
      app.get(path, _routeWrapper(handleSessionRequest))
      app.delete(path, _routeWrapper(handleSessionRequest))
    } else {
      app.get(path, _routeWrapper(_unhandledRequest))
      app.delete(path, _routeWrapper(_unhandledRequest))
    }

    app.use(
      _routeWrapper((_req, res) => {
        res.status(NOT_FOUND_STATUS).json({
          error: 'Not Found',
          message: `The requested URL ${_req.url} was not found on this server`,
          status: NOT_FOUND_STATUS,
        })
      })
    )

    sets.forEach(([key, value]) => app.set(key, value))
    return app
  }

  // ─── CLI transport ─────────────────────────────────────────────────────────

  const _startCli = async (systemContext: LayerContext<Config, any>) => {
    const server = _buildMcpServer(systemContext)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  const addPreRouteMiddleware = (middleware: ExpressMiddleware) => {
    // eslint-disable-next-line functional/immutable-data
    preRouteMiddleware.push(middleware)
  }

  const addAdditionalRoute = (route: ExpressRoute) => {
    // eslint-disable-next-line functional/immutable-data
    additionalRoutes.push(route)
  }

  const start = async <T extends Config>(
    systemContext: LayerContext<T, any>,
    options?: AppOptions
  ) => {
    const connectionType =
      systemContext.config[McpNamespace].server.connection.type
    if (connectionType === 'cli') {
      await _startCli(systemContext)
    } else if (connectionType === 'http') {
      const app = await _buildHttpApp(systemContext, options)
      // @ts-ignore
      const port =
        (systemContext.config[McpNamespace].server.connection as any).port ||
        DEFAULT_PORT
      app.listen(port)
    } else {
      throw new Error(`Unsupported connection type: ${connectionType}`)
    }
  }

  const getApp = async (
    systemContext: LayerContext<Config, any>,
    options?: AppOptions
  ): Promise<express.Express> => {
    const connectionType =
      systemContext.config[McpNamespace].server.connection.type
    if (connectionType !== 'http') {
      throw new Error(`getApp is only supported for HTTP connections`)
    }
    return _buildHttpApp(systemContext, options)
  }

  const set = (key: string, value: any) => {
    // eslint-disable-next-line functional/immutable-data
    sets.push([key, value])
  }

  const _createExecute = <TIn extends JsonObj, TOut extends XOR<JsonObj, void>>(
    annotatedFunction: NilAnnotatedFunction<TIn, TOut>
  ) => {
    return async (input: any, crossLayerProps: any) => {
      // @ts-ignore
      return Promise.resolve()
        .then(async () => {
          const result = await annotatedFunction(input, crossLayerProps ?? {})
          return result
        })
        .catch(e => {
          if (isErrorObject(e)) {
            return e
          }
          return createErrorObject(
            'UNCAUGHT_EXCEPTION',
            'An uncaught exception occurred while executing the function.',
            e
          )
        })
        .then(x => {
          return createMcpResponse(x as JsonObj | undefined)
        })
    }
  }

  const addAnnotatedFunction = <
    TIn extends JsonObj,
    TOut extends XOR<JsonObj, void>,
  >(
    annotatedFunction: NilAnnotatedFunction<TIn, TOut>,
    options?: {
      name?: string
      description?: string
    }
  ) => {
    const baseTool = createMcpToolFromAnnotatedFunction(
      annotatedFunction,
      options
    )
    const tool = merge(baseTool, {
      execute: _createExecute(annotatedFunction),
    })
    addTool(tool)
  }

  return {
    start,
    getApp,
    addTool,
    addAnnotatedFunction,
    addPreRouteMiddleware,
    addAdditionalRoute,
    set,
  }
}

export { create }
