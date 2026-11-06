import assert from "node:assert/strict";
import { InMemoryTransport, LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { mock, test } from "node:test";
import { createHostProfile } from "../src/config/host-profile.js";
import type { AppConfig } from "../src/config/types.js";
import type { ConfigStore } from "../src/config/config-store.js";
import { createServer } from "../src/index.js";
import type { TokenStore } from "../src/auth/token-store.js";

test("MCP server completes initialization and exposes project and host tools", async () => {
  let config: AppConfig = { hosts: [createHostProfile({ id: "personal", kind: "github", appClientId: "client" })], defaultHostId: "personal" };
  const store: ConfigStore = {
    get() { return config; },
    async save(next) { config = next; },
  };
  const tokenStore: TokenStore = {
    async get() { return null; },
    async set() {},
    async delete() {},
  };
  const server = createServer(store, tokenStore);
  const harness = await connectServer(server);

  try {
    const listed = await harness.request(2, "tools/list", {});
    assert.ok("result" in listed);
    const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
    const names = new Set(tools.map((tool) => tool.name));
    assert.ok(names.has("ping"));
    assert.ok(names.has("sign_in"));
    assert.ok(names.has("list_projects"));
    assert.ok(names.has("create_project_field"));
    assert.ok(names.has("update_project_status_update"));
    assert.ok(tools.length >= 50);

    const called = await harness.request(3, "tools/call", { name: "ping", arguments: {} });
    assert.ok("result" in called);
    assert.match(JSON.stringify(called.result), /github-projects-mcp 0\.1\.0 is ready/);
  } finally {
    await server.close();
    await harness.clientTransport.close();
  }
});

test("project tools validate arguments and map inputs to static GraphQL variables", async () => {
  let config: AppConfig = { hosts: [createHostProfile({ id: "personal", kind: "github", appClientId: "client" })], defaultHostId: "personal" };
  const store: ConfigStore = { get() { return config; }, async save(next) { config = next; } };
  const tokenStore: TokenStore = {
    async get() { return { accessToken: "test-access-token" }; },
    async set() {},
    async delete() {},
  };
  let requestBody: { query?: string; variables?: Record<string, unknown>; operationName?: string } | undefined;
  let calls = 0;
  mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return new Response(JSON.stringify({ data: { organization: { projectsV2: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }, user: null } }), { status: 200 });
  });

  const server = createServer(store, tokenStore);
  const harness = await connectServer(server);
  try {
    const response = await harness.request(2, "tools/call", {
      name: "list_projects",
      arguments: { hostId: "personal", login: "octocat", first: 25, after: "cursor-1", query: "roadmap" },
    });
    assert.ok("result" in response);
    assert.deepEqual(requestBody?.variables, { login: "octocat", first: 25, after: "cursor-1", query: "roadmap" });
    assert.equal(requestBody?.operationName, "ListOwnerProjects");
    assert.match(requestBody?.query ?? "", /^query ListOwnerProjects/);

    const callsBeforeInvalidInput = calls;
    const invalid = await harness.request(3, "tools/call", { name: "list_projects", arguments: { login: "", first: 0 } });
    assert.ok(JSON.stringify(invalid).toLowerCase().includes("login") || JSON.stringify(invalid).toLowerCase().includes("first"));
    assert.equal(calls, callsBeforeInvalidInput);
  } finally {
    mock.restoreAll();
    await server.close();
    await harness.clientTransport.close();
  }
});

test("host tools persist defaults and remove host-scoped credentials", async () => {
  let config: AppConfig = { hosts: [] };
  const deletedHosts: string[] = [];
  const store: ConfigStore = { get() { return config; }, async save(next) { config = next; } };
  const tokenStore: TokenStore = {
    async get() { return null; },
    async set() {},
    async delete(hostId) { deletedHosts.push(hostId); },
  };
  const server = createServer(store, tokenStore);
  const harness = await connectServer(server);
  try {
    const added = await harness.request(2, "tools/call", { name: "add_host", arguments: { id: "personal", kind: "github", appClientId: "client" } });
    assert.ok("result" in added);
    assert.equal(config.defaultHostId, "personal");
    assert.equal(config.hosts[0]?.graphqlUrl.href, "https://api.github.com/graphql");

    const rejected = await harness.request(3, "tools/call", { name: "select_host", arguments: { id: "not-configured" } });
    assert.ok("result" in rejected);
    assert.match(JSON.stringify(rejected.result), /not configured/);

    const removed = await harness.request(4, "tools/call", { name: "remove_host", arguments: { id: "personal" } });
    assert.ok("result" in removed);
    assert.deepEqual(deletedHosts, ["personal"]);
    assert.deepEqual(config.hosts, []);
    assert.equal(config.defaultHostId, undefined);
  } finally {
    await server.close();
    await harness.clientTransport.close();
  }
});

async function connectServer(server: ReturnType<typeof createServer>) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const messages: JSONRPCMessage[] = [];
  clientTransport.onmessage = (message) => messages.push(message);
  await server.connect(serverTransport);
  await clientTransport.start();
  await clientTransport.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  } as JSONRPCMessage);
  const initialized = await waitForMessage(messages, (message) => "id" in message && message.id === 1);
  assert.ok("result" in initialized);
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage);
  return {
    clientTransport,
    request(id: number, method: string, params: Record<string, unknown>) {
      return requestMessage(clientTransport, messages, id, method, params);
    },
  };
}

async function requestMessage(clientTransport: InMemoryTransport, messages: JSONRPCMessage[], id: number, method: string, params: Record<string, unknown>): Promise<JSONRPCMessage & { id: number }> {
  await clientTransport.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
  return waitForMessage(messages, (message) => "id" in message && message.id === id);
}

async function waitForMessage(messages: JSONRPCMessage[], predicate: (message: JSONRPCMessage) => boolean): Promise<JSONRPCMessage & { id: number }> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const message = messages.find(predicate);
    if (message && "id" in message) return message as JSONRPCMessage & { id: number };
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for MCP response");
}
