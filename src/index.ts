#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { createHostConfigStore, registerAuthTools, registerHostTools } from "./tools/host-tools.js";
import type { AppConfig } from "./config/types.js";
import type { ConfigStore } from "./config/config-store.js";
import { createTokenStore, type TokenStore } from "./auth/token-store.js";
import { registerProjectTools } from "./tools/project-tools.js";

const SERVER_NAME = "github-projects-mcp";
const SERVER_VERSION = "0.1.0";

export function createServer(store: ConfigStore, tokenStore: TokenStore = createTokenStore()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "ping",
    {
      description: "Check that the GitHub Projects MCP server is running.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `${SERVER_NAME} ${SERVER_VERSION} is ready. Configured hosts: ${store.get().hosts.length}.`,
        },
      ],
    }),
  );
  registerHostTools(server, store, tokenStore);
  registerAuthTools(server, store, tokenStore);
  registerProjectTools(server, store, tokenStore);

  return server;
}

export async function startServer(config?: AppConfig): Promise<void> {
  const store = await createHostConfigStore(config);
  const tokenStore = createTokenStore();
  await serveStdio(() => createServer(store, tokenStore));
}

if (import.meta.main) {
  console.error(`${SERVER_NAME} starting on stdio.`);
  await startServer();
}
