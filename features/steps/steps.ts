import * as http from 'http'
import { Given, When, Then, After, setDefaultTimeout } from '@cucumber/cucumber'
import {
  CoreNamespace,
  LogFormat,
  LogLevelNames,
  loadSystem,
  annotatedFunction,
} from '@node-in-layers/core'
import { McpNamespace } from '../../src/index.js'
import { DataNamespace } from '@node-in-layers/data/index.js'
import { TextProperty } from 'functional-models'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import z from 'zod'

setDefaultTimeout(30_000)

type _World = {
  server?: http.Server
  port?: number
  result?: any
  savedIds: string[]
}

// ─── Test app ────────────────────────────────────────────────────────────────

const _createTestApp = () => ({
  name: 'test-app',
  features: {
    create: (_context: any) => {
      const inspectHeaders = annotatedFunction(
        {
          args: z.object({}),
          returns: z.object({ headers: z.record(z.string(), z.string()) }),
          description:
            'Returns the HTTP request headers received via crossLayerProps.requestInfo',
        },
        async (_args: any, crossLayerProps: any) => {
          return { headers: crossLayerProps?.requestInfo?.headers ?? {} }
        }
      )
      return { inspectHeaders }
    },
  },
  services: { create: () => ({}) },
  models: {
    TodoItems: {
      create: ({ Model, getPrimaryKeyProperty }: any) =>
        Model({
          pluralName: 'TodoItems',
          singularName: 'TodoItem',
          namespace: 'test-app',
          primaryKeyName: 'id',
          properties: {
            id: getPrimaryKeyProperty('test-app', 'TodoItems', {}),
            title: TextProperty({ required: true }),
          },
        }),
    },
  },
})

// ─── Context factory ─────────────────────────────────────────────────────────

const _CONTEXT: Record<
  string,
  () => Promise<{ server: http.Server; port: number }>
> = {
  'mcp-default': async () => {
    const config = {
      systemName: 'mcp-server-feature-test',
      environment: 'test',
      [CoreNamespace.root]: {
        apps: [
          await import('@node-in-layers/data/index.js'),
          await import('../../src/index.js'),
          _createTestApp(),
        ],
        layerOrder: ['services', 'features', ['entries', 'mcp']],
        logging: {
          logFormat: LogFormat.json,
          logLevel: LogLevelNames.silent,
        },
        modelFactory: '@node-in-layers/data',
        modelCruds: true,
      },
      [DataNamespace.root]: {
        databases: {
          default: { datastoreType: 'memory' },
        },
      },
      [McpNamespace]: {
        version: '1.0.0',
        server: { connection: { type: 'http' } },
      },
    }

    const system = await loadSystem({ environment: 'test', config })
    // @ts-ignore
    const app = await system.mcp[McpNamespace].getApp(system as any)

    const server = http.createServer(app)
    await new Promise<void>(resolve => server.listen(0, resolve))
    const port = (server.address() as any).port
    return { server, port }
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const _callTool = async (
  port: number,
  toolName: string,
  args: any,
  headers?: Record<string, string>
): Promise<any> => {
  const client = new Client({ name: 'feature-test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/`),
    headers ? { requestInit: { headers } } : undefined
  )
  await client.connect(transport)
  const result = await client.callTool({ name: toolName, arguments: args })
  await transport.close()
  return result
}

const _parsePayload = (result: any): any => {
  if (result?.structuredContent !== undefined) {
    return result.structuredContent
  }
  const text = result?.content?.[0]?.text
  if (typeof text === 'string') {
    try {
      return JSON.parse(text)
    } catch {
      return { error: { code: 'PARSE_ERROR', message: text } }
    }
  }
  return result
}

const _assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message)
  }
}

// ─── Assertions ───────────────────────────────────────────────────────────────

const _ASSERTIONS: Record<string, (world: _World) => void | Promise<void>> = {
  'models-list-success': world => {
    const payload = _parsePayload(world.result)
    const models = payload?.models
    _assert(Array.isArray(models), 'Expected payload.models array')
    _assert(
      models.some((m: any) => m.modelType === 'test-app/TodoItems'),
      `Expected test-app/TodoItems in model list, got: ${JSON.stringify(models)}`
    )
  },
  'model-describe-success': world => {
    const payload = _parsePayload(world.result)
    _assert(
      typeof payload === 'object' && payload !== null,
      'Expected model schema object'
    )
    _assert(
      !payload.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
  },
  'model-save-success': world => {
    const payload = _parsePayload(world.result)
    _assert(
      !payload?.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
    _assert(
      typeof payload?.id !== 'undefined',
      'Expected saved instance to have an id'
    )
    _assert(
      typeof payload?.title === 'string',
      'Expected saved instance to have a title'
    )
  },
  'model-retrieve-success': world => {
    const payload = _parsePayload(world.result)
    _assert(
      !payload?.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
    _assert(
      typeof payload?.id !== 'undefined',
      'Expected retrieved instance to have an id'
    )
  },
  'model-delete-success': world => {
    _assert(
      !world.result?.isError,
      `Expected no error, got: ${JSON.stringify(world.result)}`
    )
  },
  'model-search-success': world => {
    const payload = _parsePayload(world.result)
    _assert(
      !payload?.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
    _assert(
      Array.isArray(payload?.instances),
      'Expected instances array in search result'
    )
    _assert(
      payload.instances.length > 0,
      'Expected at least one result in search'
    )
  },
  'model-bulk-insert-success': world => {
    _assert(
      !world.result?.isError,
      `Expected no error, got: ${JSON.stringify(world.result)}`
    )
  },
  'model-bulk-delete-success': world => {
    _assert(
      !world.result?.isError,
      `Expected no error, got: ${JSON.stringify(world.result)}`
    )
  },
  'features-list-success': world => {
    const payload = _parsePayload(world.result)
    _assert(
      !payload?.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
    _assert(Array.isArray(payload?.features), 'Expected features array')
    _assert(
      payload.features.some((f: any) => f.name === 'inspectHeaders'),
      `Expected inspectHeaders in features, got: ${JSON.stringify(payload.features)}`
    )
  },
  'feature-describe-success': world => {
    const payload = _parsePayload(world.result)
    _assert(
      !payload?.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
    _assert(
      typeof payload?.name === 'string',
      'Expected feature schema with name'
    )
    _assert(
      typeof payload?.input === 'object',
      'Expected feature schema with input'
    )
  },
  'feature-execute-success': world => {
    const payload = _parsePayload(world.result)
    _assert(
      !payload?.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
    _assert(
      typeof payload?.headers === 'object',
      'Expected headers object in result'
    )
  },
  'feature-has-authorization-header': world => {
    const payload = _parsePayload(world.result)
    _assert(
      !payload?.error,
      `Expected no error, got: ${JSON.stringify(payload)}`
    )
    _assert(
      typeof payload?.headers === 'object',
      'Expected headers object in result'
    )
    const auth = payload.headers['authorization']
    _assert(
      auth === 'Bearer xyz',
      `Expected Authorization header "Bearer xyz", got: "${auth}"`
    )
  },
}

// ─── Steps ───────────────────────────────────────────────────────────────────

Given(
  'we use {string} mcp context',
  async function (this: _World, contextKey: string) {
    const factory = _CONTEXT[contextKey]
    if (!factory) {
      throw new Error(`Unknown mcp context key "${contextKey}"`)
    }
    const { server, port } = await factory()
    this.server = server
    this.port = port
    this.savedIds = []
  }
)

When(
  'we call MCP tool {string} with args {string}',
  async function (this: _World, toolName: string, argsJson: string) {
    const args = JSON.parse(argsJson)
    this.result = await _callTool(this.port!, toolName, args)
  }
)

When(
  'we call MCP tool {string} with args {string} and header {string} set to {string}',
  async function (
    this: _World,
    toolName: string,
    argsJson: string,
    headerName: string,
    headerValue: string
  ) {
    const args = JSON.parse(argsJson)
    this.result = await _callTool(this.port!, toolName, args, {
      [headerName]: headerValue,
    })
  }
)

When(
  'we call MCP tool {string} with args {string} and track id',
  async function (this: _World, toolName: string, argsJson: string) {
    const args = JSON.parse(argsJson)
    this.result = await _callTool(this.port!, toolName, args)
    const saved = _parsePayload(this.result)
    const id = saved?.id
    _assert(typeof id !== 'undefined', 'No id found in save result to track')
    this.savedIds.push(String(id))
  }
)

When(
  'we call MCP tool {string} with id from last save result',
  async function (this: _World, toolName: string) {
    const saved = _parsePayload(this.result)
    const id = saved?.id
    _assert(typeof id !== 'undefined', 'No id found in last save result')
    this.savedIds.push(String(id))

    this.result = await _callTool(this.port!, toolName, {
      modelType: 'test-app/TodoItems',
      id: String(id),
    })
  }
)

When(
  'we call MCP tool {string} with ids from saved instances',
  async function (this: _World, toolName: string) {
    _assert(this.savedIds.length > 0, 'No saved ids to bulk delete')
    this.result = await _callTool(this.port!, toolName, {
      modelType: 'test-app/TodoItems',
      ids: this.savedIds,
    })
  }
)

Then(
  'result should match {string}',
  async function (this: _World, assertionKey: string) {
    const assertion = _ASSERTIONS[assertionKey]
    if (!assertion) {
      throw new Error(`Unknown assertion key "${assertionKey}"`)
    }
    await assertion(this)
  }
)

After(async function (this: _World) {
  if (this.server) {
    await new Promise<void>(resolve => this.server!.close(() => resolve()))
    this.server = undefined
  }
})
