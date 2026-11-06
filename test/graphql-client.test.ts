import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { createHostProfile } from "../src/config/host-profile.js";
import { SafeError } from "../src/errors.js";
import { GraphQLClient, type Operation } from "../src/github/graphql-client.js";
import type { TokenSet, TokenStore } from "../src/auth/token-store.js";

const host = createHostProfile({ id: "personal", kind: "github", appClientId: "client" });

function tokenStore(tokens: TokenSet | null = { accessToken: "ghp_exampletoken000000000000000000000000" }): TokenStore {
  return {
    async get() { return tokens; },
    async set() {},
    async delete() {},
  };
}

function operation(retry: Operation<{ ok: boolean }>['retry']): Operation<{ ok: boolean }> {
  return {
    name: "TestOperation",
    document: "query TestOperation { ok }",
    decode(value) {
      if (!value || typeof value !== "object" || !("ok" in value) || typeof value.ok !== "boolean") throw new Error("bad data");
      return { ok: value.ok };
    },
    retry,
  };
}

afterEach(() => mock.restoreAll());

test("GraphQL requests send only the static document and caller variables with bearer auth", async () => {
  let received: { url: string; init: RequestInit | undefined } | undefined;
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    received = { url: String(input), init };
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const client = new GraphQLClient(tokenStore());

  assert.deepEqual(await client.request(host, operation("safe-read"), { projectId: "PVT_1" }), { ok: true });
  assert.equal(received?.url, "https://api.github.com/graphql");
  assert.equal((received?.init?.headers as Record<string, string>).authorization, "Bearer ghp_exampletoken000000000000000000000000");
  assert.deepEqual(JSON.parse(String(received?.init?.body)), {
    query: "query TestOperation { ok }",
    variables: { projectId: "PVT_1" },
    operationName: "TestOperation",
  });
  assert.equal(received?.init?.redirect, "error");
});

test("read operations retry transient HTTP failures and then decode the result", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  });

  assert.deepEqual(await new GraphQLClient(tokenStore()).request(host, operation("safe-read")), { ok: true });
  assert.equal(calls, 2);
});

test("mutations are not retried after an ambiguous server failure", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("unavailable", { status: 503 });
  });

  await assert.rejects(new GraphQLClient(tokenStore()).request(host, operation("never")), (error: unknown) => error instanceof SafeError && error.code === "github_api_error");
  assert.equal(calls, 1);
});

test("GraphQL rate-limit errors honor the returned retry delay for reads only", async () => {
  let readCalls = 0;
  mock.method(globalThis, "fetch", async () => {
    readCalls += 1;
    if (readCalls === 1) return new Response(JSON.stringify({ errors: [{ message: "API rate limit exceeded", extensions: { retryAfterSeconds: 0 } }] }), { status: 200 });
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  });
  assert.deepEqual(await new GraphQLClient(tokenStore()).request(host, operation("safe-read")), { ok: true });
  assert.equal(readCalls, 2);

  mock.restoreAll();
  let mutationCalls = 0;
  mock.method(globalThis, "fetch", async () => {
    mutationCalls += 1;
    return new Response(JSON.stringify({ errors: [{ message: "API rate limit exceeded", extensions: { retryAfterSeconds: 0 } }] }), { status: 200 });
  });
  await assert.rejects(new GraphQLClient(tokenStore()).request(host, operation("never")), (error: unknown) => error instanceof SafeError && error.code === "rate_limited");
  assert.equal(mutationCalls, 1);
});

test("authentication and GraphQL permission errors map to safe error categories", async () => {
  mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));
  await assert.rejects(new GraphQLClient(tokenStore()).request(host, operation("safe-read")), (error: unknown) => error instanceof SafeError && error.code === "authentication_required");

  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ errors: [{ message: "Resource not accessible by integration" }] }), { status: 200 }));
  await assert.rejects(new GraphQLClient(tokenStore()).request(host, operation("never")), (error: unknown) => error instanceof SafeError && error.code === "permission_denied");
});

test("missing GraphQL data and invalid decoded data fail as unsupported responses", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: { other: true } }), { status: 200 }));
  await assert.rejects(new GraphQLClient(tokenStore()).request(host, operation("safe-read")), (error: unknown) => error instanceof SafeError && error.code === "unsupported_capability");

  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ errors: [] }), { status: 200 }));
  await assert.rejects(new GraphQLClient(tokenStore()).request(host, operation("safe-read")), (error: unknown) => error instanceof SafeError && error.code === "github_api_error");
});

test("unauthenticated hosts fail before any network request", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("unexpected", { status: 200 });
  });
  await assert.rejects(new GraphQLClient(tokenStore(null)).request(host, operation("safe-read")), (error: unknown) => error instanceof SafeError && error.code === "authentication_required");
  assert.equal(calls, 0);
});
