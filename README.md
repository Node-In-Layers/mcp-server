# MCP Server - A Node In Layers Package for building MCP Servers

A Node In Layers package for building MCP servers. It exposes your domains, features, and model CRUDs as MCP tools so an AI can discover and call them. Companion library: `@node-in-layers/mcp-client` (shared protocols for features, models, and tools).

This system is `self-describing` and automatically organizes tools into an optimized and efficient system, that reduces the total number of tools. This system also automatically includes prompting and examples that greatly increase AI tool selection and formatting accuracy in systems, to include in systems with hundreds, if not thousands of tools.

[API Docs](https://node-in-layers.github.io/mcp-server/)

---

## How To Use This

### 1. Install

```bash
npm install @node-in-layers/mcp-server
```

### 2. Configure

```typescript
// /config.base.mts
import { CoreNamespace } from '@node-in-layers/core'
import { McpNamespace, HttpConnection } from '@node-in-layers/mcp-server'

export default () => ({
  systemName: 'your-system-name',
  [CoreNamespace.root]: {
    /* 1. Add to the Apps List */
    apps: await Promise.all([
      // Other Very Early Modules
      //import('@node-in-layers/data/index.js'),

      // Insert Here
      import('@node-in-layers/mcp-server/index.js'),

      // Insert Your Domains Here
    ]),
    /* 2. Add mcp layer. NOTE: You must have entries between features and mcp */
    layerOrder: ['services', 'features', ['entries', 'mcp']], // can also be ['entries', 'express', 'mcp']
  },
  /* 3. Add Mcp Server Configurations */
  [McpNamespace]: {
    // Required: The configuration of the server itself.
    server: {
      connection: {
        type: 'http',
        url: 'http://localhost',
        port: 4000,
      } as HttpConnection,
    },
    // Optional arguments go here.
  },
})
```

### 3. What's Now Available

1. Features are automatically exposed (unless specifically hidden)
2. Model CRUDS are automatically exposed (unless specifically hidden)
3. An `mcp` layer is now available to features, and includes additional capabilities in the namespace: `McpNamespace`. (Explained later)

### 4. Run The Server

You can very easily run the server in a simple script by doing the following:

```typescript
import { McpNamespace } from '@node-in-layers/mcp-server'
const system: System = (await core.loadSystem<SystemConfig>({
  environment,
})) as any // "System" is your typed System object.
await system.mcp[McpNamespace].start(context)
```

#### Example with ./bin/mcp_server.mts file (feel free to copy paste)

```typescript
#!/usr/bin/env tsx

import esMain from 'es-main'
import { ArgumentParser } from 'argparse'
import * as core from '@node-in-layers/core'
import { McpNamespace } from '@node-in-layers/mcp-server'
import { SystemConfig } from '../src/types.js'
import { System } from '../src/system/types.js'

const _parseArguments = () => {
  const parser = new ArgumentParser({
    description: 'Starts the MCP server.',
  })
  parser.add_argument('environment', {
    help: 'The environment for the service.',
  })
  return parser.parse_args()
}

const startServer = async (environment: string) => {
  const system = (await core.loadSystem<SystemConfig>({
    environment,
  })) as unknown as System
  if (system.config[McpNamespace].server.connection.type === 'http') {
    console.info(
      `Starting MCP server on ${system.config[McpNamespace].server.connection.port}...`
    )
  }
  process.on('SIGINT', async function () {
    await system.services['@node-in-layers/data'].cleanup()
    process.exit()
  })

  await system.mcp[McpNamespace].start(system)
}

if (esMain(import.meta)) {
  const args = _parseArguments()
  startServer(args.environment).catch((error: any) => {
    console.error('Failed to start the server:', error)
    process.exit(1)
  })
}
```

## Background and How This Works

### MCP interface (domains, features, models)

The MCP tool surface is **organized by domain, then features and models**:

- **Domains** — The AI can list domains (`list_domains`), then for each domain list features (`list_features`) and (if present) list models. Only domains that have features or models exposed will be shown.
- **Features** — For a given domain/feature, the AI can get the schema (`describe_feature`) and run it (`execute_feature`).
- **Models** — For a given domain/model, the AI can get the schema and run save, retrieve, delete, search, bulkInsert, bulkDelete.

The **documentation returned to the AI** (including what START_HERE returns) is **configurable**. By default the server provides instructions so the AI will:

1. List domains.
2. List features (and models) within a domain.
3. Describe a feature or model when it needs the schema.
4. Execute features and model CRUD operations with the right arguments.

So the AI learns the shape of the system from the configurable “start here” and default system entries, then uses the tools to list/describe/execute as needed.

### Hiding components

You can restrict what is visible (as well as executable) to callers (e.g. certain domains, features, or all model CRUDs) so only the intended surface is exposed.

Configure `hideComponents` under the MCP config:

- **paths** — Dot-separated paths to hide, e.g. `myDomain`, `myDomain.myFeature`, `myDomain.cruds`, `myDomain.cruds.MyModel`.
- **domains** — Domain names to hide entirely (they won’t appear in `list_domains`).
- **allModels** — If `true`, no model CRUD tools are exposed.

Everything not hidden remains available. See [Configuration details](#configuration-details) for the full shape.

Example (partial config):

```typescript
// /config.base.mts
import { McpNamespace } from '@node-in-layers/mcp-server'

export default () => ({
  // ...
  [McpNamespace]: {
    // ...
    hideComponents: {
      // Completely hide these domains from the MCP surface
      domains: ['internalAdmin', 'experimental'],

      // Hide specific paths (domains, features, or models)
      paths: [
        'billing.cruds', // hide all models in the billing domain
        'users.cruds.ApiKeys', // hide a single model. (The ApiKeys table located in the users domain)
        'debug.internalFeature', // hide a specific feature
      ],

      // Or hide all models everywhere. Good for "feature" oriented systems.
      allModels: false, // set true to hide all model CRUD tools
    },
  },
})
```

---

## System description

Under `systemDescription` you set **static metadata** for your system that is included in the start-here response:

- **description** — Short system description for the AI.
- **version** — System version string.

This is the right place for “what this system is” and version; it does not control which tools exist or what the START_HERE tool includes (that is under `startHere`).

Example (partial config):

```typescript
// /config.base.mts
import { McpNamespace } from '@node-in-layers/mcp-server'

export default () => ({
  // ...
  [McpNamespace]: {
    // ...
    systemDescription: {
      description: 'Order management and billing system for ACME Corp.',
      version: '2.3.0',
    },
  },
})
```

---

## Start here

The **START_HERE** tool is what makes the system navigable: the AI is instructed to call it first (or when the user asks for help). Its response is built from:

1. **System metadata** — `systemName`, `systemDescription`, `systemVersion` from config.
2. **Default system entries** — Built-in docs (e.g. “this is a domain-layered system”, “MCP navigation workflow”, “cross-layer props”). You can turn these off with `startHere.hideDefaultSystemEntries`.
3. **Optional: include domains / include features** — If `startHere.includeDomains` is true, the response includes the current list of domains (as if `list_domains` had been called). If `startHere.includeFeatures` is true, it also includes the list of features per domain (as if `list_features` had been called for each). So the AI gets domains and/or features **without** making extra tool calls.
4. **Examples of use** — Custom entries you add under `startHere.examplesOfUse`. These are where you document **higher-level flows** (e.g. “run feature A, then B, then C”). The built-in docs explain domains, features, and models; they do **not** explain your app-specific sequences. Put those in `examplesOfUse`, as **JSON object examples with minimal prose** so the AI can apply them directly.

**Include domains / include features**  
Enabling these is like pre-running `list_domains` and/or `list_features` and embedding the result in START_HERE. The downside is **context size**: for large systems (many tools), that can consume a lot of context and add noise. For **small systems (on the order of 1–10 tools)** it’s usually fine. For larger systems, prefer **examples of use** and let the AI call `list_domains` / `list_features` when needed.

Example (partial config):

````typescript
// /config.base.mts
import { McpNamespace } from '@node-in-layers/mcp-server'

export default () => ({
  // ...
  [McpNamespace]: {
    // ...
    startHere: {
      // Optional: override tool identity
      name: 'START_HERE',
      description:
        'BEFORE YOU DO ANYTHING, call this first to learn how to navigate the system.',

      // What to include in the start-here response
      hideDefaultSystemEntries: false, // do we want the ones that come by default? Usually this is yes.
      includeDomains: true, // Should we go ahead and tell it the domains? Commonly this should be true.
      includeFeatures: false, // Should we tell them all the features on the first go? In most cases this should be FALSE. Unless its a small system with few functions.

      // Higher-level flows through your system
      examplesOfUse: [
        {
          name: 'Create order then fetch it',
          description: 'Typical flow that creates an order and then retrieves it.',
          // Giving ACTUAL examples (json data, + small annotations) works amazingly.
          example: `
```markdown
// 1. Create an order
{ "tool": "execute_feature", "args": { "domain": "orders", "featureName": "createOrder" } }
// 2. Get the order by id (using the id from step 1)
{ "tool": "execute_feature", "args": { "domain": "orders", "featureName": "getOrderById" } }
````

          `,
          tags: ['orders', 'flow'],
        },
      ],
    },

},
})

````

---

## Extending with custom tools

You can add your own MCP tools via the MCP layer using `addTool`. Use this from a layer that has access to `mcp[McpNamespace]` (e.g. after the MCP layer in the stack).

Example (conceptual):

```typescript
// In a layer that runs after the MCP layer and has context.mcp[McpNamespace]
const mcp = context.mcp[McpNamespace]
mcp.addTool({
  name: 'my_custom_tool',
  description: 'Does something custom',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  outputSchema: { type: 'object' },
  execute: async (input) => ({ result: input.id }),
})
````

Your tool is then exposed alongside the built-in domain/feature/model tools.

---

## How to run the server

- **start** — Start the MCP server (listens on the connection defined in config).  
  `mcp[McpNamespace].start(systemContext, options?)`
- **getApp** — Get the Express app (for HTTP/SSE) so you can mount it in your own server.  
  `mcp[McpNamespace].getApp(options?)`

Use **start** when the MCP server is the main process. Use **getApp** when you compose with an existing Express app (e.g. mount the MCP app at a path).

---

## Middleware and routes

- **addPreRouteMiddleware(middleware)** — Add Express middleware that runs before MCP route handling.
- **addAdditionalRoute(route)** — Register an extra Express route (e.g. health or admin) on the same app.

Call these during setup (e.g. from a layer that has access to `mcp[McpNamespace]`) before the server is started or the app is used.

---

## Changing logging configuration

Logging is configured under the `logging` section of the MCP config. You can control log levels and optionally add structured data to each request/response log entry.

- **requestLogLevel** / **responseLogLevel**: Override the default log level (`info`) for incoming requests and outgoing responses.
- **requestLogGetData(input)**: Function that maps the raw request input into extra data to log.
- **responseLogGetData(result)**: Function that maps the raw tool result into extra data to log.

Example (partial config):

```typescript
// /config.base.mts
import { McpNamespace } from '@node-in-layers/mcp-server'

export default () => ({
  // ...
  [McpNamespace]: {
    // ...
    logging: {
      // Adjust verbosity
      requestLogLevel: 'debug',
      responseLogLevel: 'info',

      // Attach additional request information to the log.
      requestLogGetData: (input: Request) => ({
        something: input.something,
      }),
      responseLogGetData: (input: Request) => ({
        // Shape this to your needs; example:
        truncated: true,
      }),
    },
  },
})
```

---
