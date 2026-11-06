import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { SafeError, safeErrorMessage } from "../errors.js";
import { createConfigStore, type ConfigStore } from "../config/config-store.js";
import { createHostProfile, resolveHost } from "../config/host-profile.js";
import type { AppConfig } from "../config/types.js";
import { clearPendingSignIn, completeSignIn, getAuthStatus, startSignIn } from "../auth/device-flow.js";
import type { TokenStore } from "../auth/token-store.js";
import { GraphQLClient } from "../github/graphql-client.js";
import { checkConnection, discoverCapabilities } from "../github/capabilities.js";

const addHostSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["github", "ghes"]),
  baseUrl: z.string().url().optional(),
  graphqlUrl: z.string().url().optional(),
  appClientId: z.string().min(1),
});

function hostSummary(config: AppConfig) {
  return config.hosts.map((host) => ({
    id: host.id,
    kind: host.kind,
    baseUrl: host.baseUrl.toString(),
    graphqlUrl: host.graphqlUrl.toString(),
    isDefault: host.id === config.defaultHostId,
  }));
}

async function withSafeError(handler: () => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>) {
  try {
    return await handler();
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: safeErrorMessage(error) }],
    };
  }
}

export function registerHostTools(server: McpServer, store: ConfigStore, tokenStore: TokenStore): void {
  server.registerTool("list_hosts", {
    description: "List configured GitHub.com and GitHub Enterprise Server hosts and show the default host.",
    inputSchema: z.object({}),
  }, async () => {
    const config = store.get();
    return { content: [{ type: "text", text: JSON.stringify({ hosts: hostSummary(config) }, null, 2) }] };
  });

  server.registerTool("add_host", {
    description: "Add a GitHub.com or GitHub Enterprise Server host profile. For GHES, provide its HTTPS base URL and instance-specific GitHub App Client ID. This writes host settings to local configuration.",
    inputSchema: addHostSchema,
  }, async (input) => withSafeError(async () => {
    const current = store.get();
    const id = input.id.trim();
    if (current.hosts.some((host) => host.id === id)) {
      throw new SafeError(`Host '${id}' already exists.`, "configuration_error");
    }
    const profile = createHostProfile({
      id,
      kind: input.kind,
      appClientId: input.appClientId,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.graphqlUrl ? { graphqlUrl: input.graphqlUrl } : {}),
    });
    const next: AppConfig = {
      hosts: [...current.hosts, profile],
      defaultHostId: current.defaultHostId ?? profile.id,
    };
    await store.save(next);
    return { content: [{ type: "text", text: JSON.stringify({ added: profile.id, hosts: hostSummary(next) }, null, 2) }] };
  }));

  server.registerTool("remove_host", {
    description: "Remove a configured GitHub host profile and its locally saved credential. This does not uninstall the GitHub App or delete any GitHub data.",
    inputSchema: z.object({ id: z.string().min(1) }),
  }, async ({ id }) => withSafeError(async () => {
    const current = store.get();
    if (!current.hosts.some((host) => host.id === id)) throw new SafeError(`Host '${id}' is not configured.`, "configuration_error");
    await tokenStore.delete(id);
    clearPendingSignIn(id);
    const hosts = current.hosts.filter((host) => host.id !== id);
    const next: AppConfig = {
      hosts,
      ...(current.defaultHostId && current.defaultHostId !== id
        ? { defaultHostId: current.defaultHostId }
        : hosts[0]
          ? { defaultHostId: hosts[0].id }
          : {}),
    };
    await store.save(next);
    return { content: [{ type: "text", text: JSON.stringify({ removed: id, hosts: hostSummary(next) }, null, 2) }] };
  }));

  server.registerTool("select_host", {
    description: "Set the default host used only when a later GitHub tool call omits hostId. Explicit hostId values always take precedence, including in parallel calls.",
    inputSchema: z.object({ id: z.string().min(1) }),
  }, async ({ id }) => withSafeError(async () => {
    const current = store.get();
    if (!current.hosts.some((host) => host.id === id)) throw new SafeError(`Host '${id}' is not configured.`, "configuration_error");
    const next: AppConfig = { ...current, defaultHostId: id };
    await store.save(next);
    return { content: [{ type: "text", text: JSON.stringify({ defaultHostId: id, hosts: hostSummary(next) }, null, 2) }] };
  }));
}

export function registerAuthTools(server: McpServer, store: ConfigStore, tokenStore: TokenStore): void {
  const client = new GraphQLClient(tokenStore);
  server.registerTool("sign_in", {
    description: "Start GitHub App device sign-in for a configured host. Return the verification URL and one-time user code, ask the user to authorize it in their browser, then call complete_sign_in after they confirm. The device code stays in process memory and is never returned.",
    inputSchema: z.object({ hostId: z.string().optional() }),
  }, async ({ hostId }) => withSafeError(async () => {
    const host = resolveHost(hostId, store.get());
    const result = await startSignIn(host);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }));

  server.registerTool("complete_sign_in", {
    description: "Check whether the user completed GitHub App device authorization. Call after the user confirms approval. Polls once, respects GitHub's interval, and returns a retry delay if authorization is still pending.",
    inputSchema: z.object({ hostId: z.string().optional() }),
  }, async ({ hostId }) => withSafeError(async () => {
    const host = resolveHost(hostId, store.get());
    const result = await completeSignIn(host, tokenStore);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }));

  server.registerTool("get_auth_status", {
    description: "Show whether this host has a locally saved GitHub sign-in and its expiry, without returning any credential values.",
    inputSchema: z.object({ hostId: z.string().optional() }),
  }, async ({ hostId }) => withSafeError(async () => {
    const host = resolveHost(hostId, store.get());
    const status = await getAuthStatus(host.id, tokenStore);
    return { content: [{ type: "text", text: JSON.stringify({ hostId: host.id, ...status }, null, 2) }] };
  }));

  server.registerTool("sign_out", {
    description: "Remove this host's locally saved GitHub credential and pending device sign-in. This does not revoke the app authorization at GitHub; users can revoke it in GitHub settings.",
    inputSchema: z.object({ hostId: z.string().optional() }),
  }, async ({ hostId }) => withSafeError(async () => {
    const host = resolveHost(hostId, store.get());
    await tokenStore.delete(host.id);
    clearPendingSignIn(host.id);
    return { content: [{ type: "text", text: `Removed local GitHub credentials for '${host.id}'.` }] };
  }));

  server.registerTool("check_connection", {
    description: "Verify GitHub sign-in and GraphQL access for a configured host. Returns the authenticated GitHub login and rate-limit summary.",
    inputSchema: z.object({ hostId: z.string().optional() }),
  }, async ({ hostId }) => withSafeError(async () => {
    const host = resolveHost(hostId, store.get());
    const result = await checkConnection(client, host);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }));

  server.registerTool("check_capabilities", {
    description: "Inspect the configured host's GraphQL schema for Projects V2 types and fields. Introspection may be restricted by enterprise policy.",
    inputSchema: z.object({ hostId: z.string().optional() }),
  }, async ({ hostId }) => withSafeError(async () => {
    const host = resolveHost(hostId, store.get());
    const result = await discoverCapabilities(client, host);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }));
}

export async function createHostConfigStore(config?: AppConfig): Promise<ConfigStore> {
  return createConfigStore(config);
}
