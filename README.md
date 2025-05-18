# MCP Server - A Node In Layers Package for building MCP Servers

This library adds the ability to easily create MCP servers with Node In Layers.

It has a companion library called '@node-in-layers/mcp-client' which is used for creating MCP clients. These two libraries share the same functions for defining models and tools.

## New Layer

This library adds a new layer `mcp` to the system. It should be placed after the `express` layer.

## Usage

In order to use this library, you must make additions to your config, as well as create and export "mcp" layers from your apps/domains.

### Config

you add this app/domain to your config file. You should do this before your apps which will add tools to the MCP server.

You then configure the `mcp` app/domain with the following:

```typescript
const mcpConfig = {
  // (optional) The name of your MCP server.
  name: 'mcp',
  // (optional) The version of your MCP server.
  version: '1.0.0',
  // The server config from @l4t/mcp-ai/simple-server/types.js
  server: {
    connection: {
      type: 'http',
      host: 'localhost',
      port: 3000,
    },
  },
  logging: {
    // optional
    // If you want to change the default. Its 'info' by default.
    requestLogLevel: 'info',
    // If you want to change the default. Its 'info' by default.
    responseLogLevel: 'info',
  },
}

const config = {
  ['@node-in-layers/mcp-server']: mcpConfig,
}
```

### Creating an MCP Layer

You can create an MCP layer by exporting a function from your app/domain that returns a layer.

```typescript
// /src/yourDomain/mcp.ts
import { McpContext, McpNamespace } from '@node-in-layers/mcp-server'
import { Config } from '@node-in-layers/core'
import { YourFeaturesLayer } from './features.js'

const create = (context: McpContext<Config, YourFeaturesLayer>) => {
  // Adds your tool.
  context.mcp[McpNamespace].addTool({
    name: 'my-hello-world-tool',
    description: 'My Tool',
    execute: async (input: any) => {
      return 'Hello, world!'
    },
  })

  // Create a tool from your feature
  context.mcp[McpNamespace].addTool({
    name: 'my-hello-world-tool',
    description: 'My Tool',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
        },
      },
      required: ['name'],
    },
    execute: (input: any) => {
      // You get an object, pass it back to your feature. Handles async for you.
      return context.features.yourDomain.yourFeature(input)
    },
  })

  return {}
}

export { create }
```

### Adding Models

You can wrap your models with CRUDS functions and add them to the MCP server with the mcp layer.
NOTE: In order for this to work your layer must have both a services and a features layer. (In addition to your models.) Node in layers will automatically create a cruds property for you with your models, and you can add them.

Here is an example of doing it one at a time. (Not generally recommended, but doable).

```typescript
// /src/yourDomain/mcp.ts
import { McpContext, McpNamespace } from '@node-in-layers/mcp-server'
import { Config } from '@node-in-layers/core'
import { YourFeaturesLayer } from './features.js'

const create = (context: McpContext<Config, YourFeaturesLayer>) => {
  // Adds your models cruds through features.
  context.mcp[McpNamespace].addModelCruds(
    context.features.yourFeature.cruds.Cars
  )

  return {}
}
```

Here is a way that you can really cook with gas. (Highly recommended)

```typescript
// /src/yourDomain/mcp.ts
import { McpContext, McpNamespace, mcpModels } from '@node-in-layers/mcp-server'
import { Config } from '@node-in-layers/core'
import { YourFeaturesLayer } from './features.js'

const create = (context: McpContext<Config, YourFeaturesLayer>) => {
  // This automatically adds ALL of your models from features.
  mcpModels('yourDomain')(context)

  return {}
}
```

Another way to organize adding models is from a centralized mcp domain. Put this as your very last domain after all your other domains have been loaded.

```typescript
// /src/mcp/mcp.ts
import { McpContext, McpNamespace, mcpModels } from '@node-in-layers/mcp-server'
import { Config } from '@node-in-layers/core'

const create = (context: McpContext<Config>) => {
  // Add all your models for your whole system in one go.
  mcpModels('yourDomain')(context)
  mcpModels('yourDomain2')(context)
  mcpModels('yourDomain3')(context)
  mcpModels('yourDomain4')(context)

  return {}
}
```
