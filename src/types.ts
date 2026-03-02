import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  Config,
  LogLevelNames,
  LayerContext,
  XOR,
  CrossLayerProps,
  NilAnnotatedFunction,
} from '@node-in-layers/core'
import express from 'express'
import { JsonAble, JsonObj } from 'functional-models'

/**
 * The namespace key used to scope all `@node-in-layers/mcp-server` configuration
 * inside the system config object.
 *
 * @example
 * ```ts
 * const config = {
 *   [McpNamespace]: {
 *     version: '1.0.0',
 *     server: { connection: { type: 'http', url: 'http://localhost:3000' } },
 *   },
 * }
 * ```
 */
export const McpNamespace = '@node-in-layers/mcp-server'

// ─── Connection types ─────────────────────────────────────────────────────────

/**
 * @interface
 * CLI (stdio) connection configuration. Use this when the MCP server is
 * launched as a subprocess and communicates over stdin/stdout.
 *
 * @example
 * ```ts
 * const connection: CliConnection = { type: 'cli' }
 * ```
 */
export type CliConnection = Readonly<{
  type: 'cli'
}>

/**
 * @interface
 * HTTP connection configuration. Use this when the MCP server is exposed over
 * a network via the Streamable HTTP transport.
 *
 * @example
 * ```ts
 * const connection: HttpConnection = {
 *   type: 'http',
 *   url: 'http://localhost:3000/mcp',
 *   headers: { 'x-api-key': 'secret' },
 *   timeout: 5000,
 *   retry: { attempts: 3, backoff: 500 },
 * }
 * ```
 */
export type HttpConnection = Readonly<{
  type: 'http'
  /** Base URL of the MCP HTTP endpoint (e.g. `http://localhost:3000/mcp`). */
  url: string
  /** Static headers sent with every request to the server. */
  headers?: Readonly<Record<string, string>>
  /** Request timeout in milliseconds. */
  timeout?: number
  /** Retry policy for failed requests. */
  retry?: Readonly<{
    /** Number of retry attempts before giving up. */
    attempts: number
    /** Base backoff interval in milliseconds between retries. */
    backoff: number
  }>
}>

/**
 * A discriminated union of the supported MCP transport connections.
 * Exactly one of `CliConnection` or `HttpConnection` must be provided.
 *
 * @see {@link CliConnection}
 * @see {@link HttpConnection}
 */
export type Connection = XOR<CliConnection, HttpConnection>

// ─── Server config ────────────────────────────────────────────────────────────

/**
 * @interface
 * A named example of system usage, shown in the `START_HERE` tool response to
 * give AI clients concrete guidance on how to use the system.
 */
export type SystemUseExample = Readonly<{
  /** Short label for the example (e.g. `"Create a user"`). */
  name: string
  /** One-sentence description of what the example demonstrates. */
  description?: string
  /** A representative value or input to show. */
  value?: string
  /** Optional tags for categorisation. */
  tags?: string[]
  /** Longer free-form explanation. */
  details?: string
  /** Concrete example payload or invocation. */
  example?: string
}>

/**
 * @interface
 * Top-level configuration for the `@node-in-layers/mcp-server` package.
 * Placed under the `McpNamespace` key inside the system config.
 *
 * @example
 * ```ts
 * const config: McpServerConfig = {
 *   [McpNamespace]: {
 *     version: '1.0.0',
 *     stateful: false,
 *     server: {
 *       connection: { type: 'http', url: 'http://localhost:3000' },
 *     },
 *   },
 * }
 * ```
 */
export type McpServerConfig = Readonly<{
  [McpNamespace]: {
    /**
     * Semver string reported by the MCP server during the initialize handshake.
     * Defaults to `'1.0.0'` if omitted.
     */
    version?: string
    /**
     * When `true` the HTTP transport manages persistent sessions (one
     * `McpServer` instance per session). When `false` (the default) each
     * HTTP request spins up a fresh server instance (stateless mode).
     *
     * Stateful mode is required when you need server-sent events or long-lived
     * session state. Stateless mode is simpler and works well for most REST-style
     * AI tool calls.
     */
    stateful?: boolean
    /**
     * Transport configuration. Must specify a `connection` that selects either
     * CLI (stdio) or HTTP transport.
     */
    server: {
      /**
       * Transport connection — either `{ type: 'cli' }` or
       * `{ type: 'http', url: '...', ... }`.
       *
       * @see {@link Connection}
       */
      connection: Connection
    }
    /**
     * Configuration for the built-in `START_HERE` tool.
     * This tool is always registered and is the recommended first call for any
     * AI client — it returns a system overview that helps the client navigate
     * the available domains, features, and models.
     */
    startHere?: {
      /**
       * Override the tool name. Default: `'START_HERE'`.
       */
      name?: string
      /**
       * Override the tool description shown to the AI client.
       */
      description?: string
      /**
       * When `true`, suppresses the built-in Node-in-Layers navigation
       * documentation from the response. Generally not recommended unless you
       * are providing a completely custom system description.
       */
      hideDefaultSystemEntries?: boolean
      /**
       * When `true`, the response includes the domain list (equivalent to
       * calling `list_domains` first).
       */
      includeDomains?: boolean
      /**
       * When `true`, the response includes the full feature list per domain
       * (equivalent to calling `list_features` for every domain). Implies
       * `includeDomains: true`.
       */
      includeFeatures?: boolean
      /**
       * Optional worked examples of end-to-end usage flows to include in the
       * `START_HERE` response. Prefer JSON object examples with minimal prose.
       *
       * @see {@link SystemUseExample}
       */
      examplesOfUse?: ReadonlyArray<SystemUseExample>
    }
    /**
     * @deprecated Use `hideComponents` instead.
     * Dot-path strings of tools/domains to suppress.
     */
    hiddenPaths?: string[]
    /**
     * Fine-grained control over which tools are exposed to AI clients.
     * All suppressed items are completely omitted — they will not appear in
     * tool listings or `START_HERE` output.
     *
     * Dot-path format for `paths`:
     * - `'myDomain'` — hides the entire domain and all its features/models.
     * - `'myDomain.myFeature'` — hides one specific feature.
     * - `'myDomain.cruds'` — hides all model CRUD tools for a domain.
     * - `'myDomain.cruds.MyModel'` — hides CRUD tools for one specific model.
     */
    hideComponents?: {
      /**
       * Dot-path strings identifying individual tools, features, or model CRUD
       * groups to suppress.
       */
      paths?: ReadonlyArray<string>
      /**
       * Domain names to hide entirely (domain will not appear in `list_domains`).
       */
      domains?: string[]
      /**
       * When `true`, suppresses ALL model CRUD tools across every domain.
       */
      allModels?: boolean
    }
    /**
     * Static metadata injected into the `START_HERE` response.
     */
    systemDescription?: {
      /** Human-readable description of the system shown to the AI client. */
      description?: string
      /** System version string shown to the AI client. */
      version?: string
    }
    /**
     * Logging configuration for inbound tool calls and their responses.
     * All logging uses the Node-in-Layers logger already present in the context.
     */
    logging?: {
      /**
       * Log level used when logging the incoming tool request.
       * Defaults to `'info'`.
       * One of the `LogLevelNames` string literals from `@node-in-layers/core`
       * (e.g. `'info'`, `'warn'`, `'error'`, `'debug'`).
       */
      requestLogLevel?: LogLevelNames
      /**
       * Log level used when logging the tool response.
       * Defaults to `'info'`.
       * One of the `LogLevelNames` string literals from `@node-in-layers/core`
       * (e.g. `'info'`, `'warn'`, `'error'`, `'debug'`).
       */
      responseLogLevel?: LogLevelNames
      /**
       * Optional callback that extracts additional structured fields to merge
       * into the request log entry. Return a plain object of key/value pairs.
       */
      requestLogGetData?: (req: Request) => Record<string, any>
      /**
       * Optional callback that extracts additional structured fields to merge
       * into the response log entry. Return a plain object of key/value pairs.
       */
      responseLogGetData?: (req: Request) => Record<string, any>
    }
  }
}>

// ─── Tool types ───────────────────────────────────────────────────────────────

/**
 * @interface
 * Schema-only metadata for an MCP tool — everything except the `execute`
 * handler. Used when building tool definitions before the execute function is
 * attached (e.g. in `nil.ts` / `models.ts` helper factories).
 *
 * @see {@link McpTool}
 */
export type McpToolSchema = Readonly<{
  /** Unique tool name as it appears in the MCP tool listing. */
  name: string
  /** Description shown to the AI client to explain what this tool does. */
  description?: string
  /**
   * JSON Schema (or Zod schema) describing the tool's input object.
   * The SDK validates incoming tool calls against this schema before invoking
   * the execute handler.
   */
  inputSchema: any
  /**
   * Optional JSON Schema describing the tool's output object.
   * Provided for documentation/type-generation purposes; the MCP SDK does not
   * currently enforce it at runtime.
   */
  outputSchema?: any
}>

/**
 * @interface
 * A fully-defined MCP tool: schema metadata plus an execute handler.
 *
 * The `execute` function is called by the server for every matching tool
 * invocation. The second argument (`crossLayerProps`) carries the merged
 * {@link RequestCrossLayerProps} for the request, including `requestInfo`,
 * `authInfo`, and logger correlation IDs.
 *
 * @example
 * ```ts
 * const myTool: McpTool = {
 *   name: 'greet',
 *   description: 'Returns a greeting.',
 *   inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
 *   execute: async (input, crossLayerProps) => createMcpResponse({ hello: input.name }),
 * }
 * ```
 *
 * @see {@link McpToolSchema}
 * @see {@link RequestCrossLayerProps}
 */
export type McpTool = McpToolSchema &
  Readonly<{
    /**
     * Async handler invoked for each tool call.
     *
     * @param input - The validated tool arguments as received from the AI client.
     *   Will always contain a `crossLayerProps` field injected by the server
     *   (merged from the client-supplied value, the HTTP transport headers, and
     *   auth info).
     * @param crossLayerProps - The fully-merged {@link RequestCrossLayerProps} for
     *   this request. Passed as a convenience — identical to `input.crossLayerProps`.
     */
    execute: (input: any, crossLayerProps?: any) => Promise<CallToolResult>
  }>

// ─── Express integration types ────────────────────────────────────────────────

/**
 * @interface
 * An additional Express route to mount on the HTTP server alongside the MCP
 * endpoint. Useful for health checks, webhooks, or any non-MCP HTTP traffic
 * that should share the same process.
 *
 * @example
 * ```ts
 * const healthRoute: ExpressRoute = {
 *   path: '/health',
 *   method: 'GET',
 *   handler: async (_req, res) => { res.json({ ok: true }) },
 * }
 * ```
 */
export type ExpressRoute = Readonly<{
  /** URL path for the route (e.g. `'/health'`). */
  path: string
  /** HTTP method for the route. */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Async Express request handler. */
  handler: (req: express.Request, res: express.Response) => Promise<void>
}>

/**
 * An Express middleware function to mount before the MCP route handler.
 * Standard use-cases include authentication, request logging, and rate limiting.
 *
 * @example
 * ```ts
 * const authMiddleware: ExpressMiddleware = async (req, res, next) => {
 *   if (!req.headers.authorization) {
 *     res.status(401).json({ error: 'Unauthorized' })
 *     return
 *   }
 *   await next()
 * }
 * ```
 */
export type ExpressMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void>

/**
 * @interface
 * Full Express configuration accepted when building the HTTP app via
 * `getApp()` or `start()`.
 *
 * @see {@link McpServerMcp.getApp}
 */
export type ExpressOptions = Readonly<{
  /** Additional routes to mount on the Express app. @see {@link ExpressRoute} */
  additionalRoutes?: ExpressRoute[]
  /** Middleware to run before the MCP route handler. @see {@link ExpressMiddleware} */
  preRouteMiddleware?: ExpressMiddleware[]
  /**
   * Optional callback invoked after every route handler completes.
   * Useful for post-request instrumentation or cleanup.
   */
  afterRouteCallback?: (
    req: express.Request,
    res: express.Response
  ) => Promise<void> | void
  /** Body-size limit forwarded to `body-parser` (e.g. `'10mb'`). */
  limit?: string
  /** Fine-grained options passed directly to `bodyParser.json()`. */
  jsonBodyParser?: {
    /** Maximum request body size (e.g. `'1mb'`). */
    limit?: string
    /** When `false`, allows non-object/array JSON at the top level. */
    strict?: boolean
  }
}>

/**
 * @interface
 * Subset of {@link ExpressOptions} accepted by `start()` and `getApp()` on the
 * public API. Currently covers only the `jsonBodyParser` settings; additional
 * options (routes, middleware) are registered via dedicated methods instead.
 *
 * @see {@link McpServerMcp.start}
 * @see {@link McpServerMcp.getApp}
 */
export type AppOptions = Readonly<{
  /** Fine-grained options passed directly to `bodyParser.json()`. */
  jsonBodyParser?: {
    /** Maximum request body size (e.g. `'1mb'`). */
    limit?: string
    /** When `false`, allows non-object/array JSON at the top level. */
    strict?: boolean
  }
}>

// ─── CrossLayerProps / request context ───────────────────────────────────────

/**
 * @interface
 * HTTP request metadata extracted from the MCP transport layer and made
 * available to every tool call via {@link RequestCrossLayerProps}.
 *
 * For HTTP connections, `headers` is populated from the live HTTP request
 * (via the MCP SDK's `RequestHandlerExtra.requestInfo`). The remaining fields
 * (`body`, `query`, `params`, `path`, `method`, `url`, `protocol`) are
 * populated when an Express request is available; for CLI (stdio) connections
 * they default to empty strings / empty objects.
 */
export type RequestInfo = Readonly<{
  /** Normalised HTTP request headers (all values coerced to strings). */
  headers: Record<string, string>
  /** Parsed request body (JSON object). Empty object for CLI connections. */
  body: Record<string, any>
  /** Parsed query-string parameters. Empty object for CLI connections. */
  query: Record<string, string>
  /** URL path parameters (e.g. from `/users/:id`). Empty object for CLI connections. */
  params: Record<string, string>
  /** URL path component (e.g. `'/mcp'`). Empty string for CLI connections. */
  path: string
  /** HTTP method in upper-case (e.g. `'POST'`). Empty string for CLI connections. */
  method: string
  /** Full request URL including query string. Empty string for CLI connections. */
  url: string
  /** Protocol (e.g. `'http'` or `'https'`). Empty string for CLI connections. */
  protocol: string
}>

/**
 * @interface
 * OAuth / token auth information for the current request, sourced from the
 * MCP SDK's `RequestHandlerExtra.authInfo`. Only present when the MCP server
 * is configured with an OAuth provider and the client has authenticated.
 *
 * @see {@link RequestCrossLayerProps}
 */
export type AuthInfo = Readonly<{
  /** The raw bearer access token string. */
  token: string
  /** The OAuth client ID that obtained this token. */
  clientId: string
  /** Scopes granted to this token (e.g. `['read', 'write']`). */
  scopes: string[]
  /**
   * Unix timestamp (seconds since epoch) at which the token expires.
   * Omitted if the token has no expiry.
   */
  expiresAt?: number
  /**
   * The RFC 8707 resource server identifier for which this token is valid.
   * When set, must match the MCP server's own resource identifier.
   */
  resource?: URL
  /** Any additional provider-specific data attached to the token. */
  extra?: Record<string, unknown>
}>

/**
 * @interface
 * The cross-layer props shape used throughout `@node-in-layers/mcp-server`.
 * Extends the base `CrossLayerProps` from `@node-in-layers/core` with MCP-specific request context.
 *
 * This object is automatically built and merged by the server on every tool
 * call — you should never construct it manually. Use `combineCrossLayerProps`
 * or `createCrossLayerProps` from `@node-in-layers/core` if you need to merge
 * additional data into an existing instance.
 *
 * Sources merged into every tool call (in order):
 * 1. `crossLayerProps` supplied by the AI client in the tool arguments
 * 2. `crossLayerProps` nested inside `args` (used by feature-executor tools)
 * 3. `requestInfo` from the HTTP transport (headers) and `authInfo` if present
 * 4. Logger correlation IDs from the per-request logger
 *
 * @example
 * ```ts
 * // Accessing in a feature function:
 * const myFeature = async (args: MyArgs, crossLayerProps: McpCrossLayerProps) => {
 *   const { headers } = crossLayerProps.requestInfo
 *   const token = crossLayerProps.authInfo?.token
 *   // ...
 * }
 * ```
 *
 * @see {@link RequestInfo}
 * @see {@link AuthInfo}
 */
export type RequestCrossLayerProps = Readonly<{
  /** HTTP request metadata for the current tool call. @see {@link RequestInfo} */
  requestInfo: RequestInfo
  /**
   * OAuth auth info for the current request, if the server is configured with
   * an OAuth provider and the client has authenticated.
   * @see {@link AuthInfo}
   */
  authInfo?: AuthInfo
}> &
  CrossLayerProps

// ─── Public MCP layer API ─────────────────────────────────────────────────────

/**
 * A middleware function that can pullout information that will be put into the cross layer props
 * and passed down stream with the request.
 * @interface
 */
export type CrossLayerPropMiddleware = (
  /**
   * The express request object.
   */
  req: express.Request,
  /**
   * The express response object.
   */
  res: express.Response,
  /**
   * The next function to call.
   */
  next: express.NextFunction
) => Promise<Record<string, any> | void>

/**
 * @interface
 * The public interface returned by `create()` in `mcp.ts` and stored in the
 * MCP layer of the Node-in-Layers system context.
 *
 * Typical usage:
 * ```ts
 * const mcpServer = mcp.create(context)
 * mcpServer.addTool(myTool)
 * await mcpServer.start(systemContext)
 * ```
 */
export type McpServerMcp = Readonly<{
  /**
   * Adds a middleware function that will be called before the MCP route, that can extract
   * information that will be placed into the cross layer props.
   *
   * NOTE: If you return "logging" cross layer props, it will be merged in appropriately
   * with the normal cross layer props. This can be useful for adding additional IDS.
   *
   * Having said that, NON-"logging" properties, are merged together, and can result in overriding values.
   * @param middleware
   * @returns
   */
  addCrossLayerPropMiddleware: (middleware: CrossLayerPropMiddleware) => void
  /**
   * Starts the MCP server. For HTTP connections, binds an Express app to the
   * configured port. For CLI connections, connects the stdio transport.
   *
   * @param systemContext - The fully-initialised Node-in-Layers system context,
   *   used to resolve features and models at runtime.
   * @param options - Optional Express body-parser settings.
   */
  start: <T extends McpServerConfig & Config>(
    systemContext: LayerContext<T, any>,
    options?: AppOptions
  ) => Promise<void>
  /**
   * Registers a custom {@link McpTool} with the server. Call this before
   * `start()` or `getApp()`.
   *
   * @param tool - The tool definition to register.
   */
  addTool: (tool: McpTool) => void

  /**
   * Adds an annotated function as a tool.
   * @param annotatedFunction - The annotated function to add as a tool.
   * @returns void
   */
  addAnnotatedFunction: <TIn extends JsonObj, TOut extends XOR<JsonObj, void>>(
    annotatedFunction: NilAnnotatedFunction<TIn, TOut>,
    options?: {
      /**
       * A replacement name for the function.
       */
      name?: string
      /**
       * A replacement description for the function.
       */
      description?: string
    }
  ) => void
  /**
   * Builds and returns the configured Express app without starting the HTTP
   * listener. Useful when you want to integrate the MCP server into an existing
   * Express application or test the app directly.
   *
   * Throws if the connection type is not `'http'`.
   *
   * @param systemContext - The fully-initialised Node-in-Layers system context.
   * @param options - Optional Express body-parser settings.
   */
  getApp: <T extends McpServerConfig & Config>(
    systemContext: LayerContext<T, any>,
    options?: AppOptions
  ) => Promise<express.Express>
  /**
   * Calls `app.set(key, value)` on the underlying Express app. Must be called
   * before `start()` or `getApp()`.
   *
   * @param key - Express setting name (e.g. `'trust proxy'`).
   * @param value - Value to assign.
   */
  set: (key: string, value: any) => void
  /**
   * Registers an Express middleware to run before the MCP route handler.
   * Useful for auth, logging, or rate-limiting. Must be called before
   * `start()` or `getApp()`.
   *
   * @param middleware - An {@link ExpressMiddleware} function.
   */
  addPreRouteMiddleware: (middleware: ExpressMiddleware) => void
  /**
   * Registers an additional Express route alongside the MCP endpoint. Must be
   * called before `start()` or `getApp()`.
   *
   * @param route - An {@link ExpressRoute} definition.
   */
  addAdditionalRoute: (route: ExpressRoute) => void
}>

/**
 * @interface
 * The MCP layer slice of the Node-in-Layers system context, keyed by
 * {@link McpNamespace}.
 */
export type McpServerMcpLayer = Readonly<{
  [McpNamespace]: McpServerMcp
}>

/**
 * The full Node-in-Layers `LayerContext` shape expected by MCP server
 * internals. Parameterised over config, features, and any additional MCP-layer
 * services the consuming application adds.
 *
 * @template TConfig - System config type (must extend `Config`).
 * @template TFeatures - Features layer shape (domain → feature functions).
 * @template TMcpLayer - Any additional entries in the MCP layer beyond the
 *   built-in `McpServerMcpLayer`.
 */
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

// ─── OpenAPI / misc ───────────────────────────────────────────────────────────

/**
 * @interface
 * A simplified OpenAPI-style description of a single function, used to
 * generate tool input/output schemas for non-NIL-annotated features.
 */
export type OpenApiFunctionDescription = Readonly<{
  /** Function name as it appears in the tool listing. */
  name: string
  /** Optional description shown to the AI client. */
  description?: string
  /** JSON Schema object describing the function's input. */
  input: Record<string, JsonAble>
  /** JSON Schema object describing the function's output. */
  output: Record<string, JsonAble>
}>

/**
 * @interface
 * A lightweight optional-value container (similar to `Option<T>` in functional
 * languages). Avoids returning `null` / `undefined` directly from functions
 * that may not produce a value.
 *
 * @template T - The type of the wrapped value.
 *
 * @example
 * ```ts
 * const maybeUser: Maybe<User> = findUser(id)
 * if (maybeUser.hasValue()) {
 *   const user = maybeUser.instance()
 * }
 * ```
 */
export type Maybe<T> = Readonly<{
  /** Returns the wrapped value, or `undefined` if absent. */
  instance: () => T | undefined
  /** Returns `true` if a value is present. */
  hasValue: () => boolean
}>
