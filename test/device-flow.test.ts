import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { startSignIn, completeSignIn, clearPendingSignIn, getAccessToken, getAuthStatus } from "../src/auth/device-flow.js";
import type { TokenSet, TokenStore } from "../src/auth/token-store.js";
import { createHostProfile } from "../src/config/host-profile.js";
import { SafeError } from "../src/errors.js";

const github = createHostProfile({ id: "personal", kind: "github", appClientId: "client-id" });
const enterprise = createHostProfile({ id: "enterprise", kind: "ghes", baseUrl: "https://github.example.com", appClientId: "enterprise-client" });

function memoryTokenStore(initial: Record<string, TokenSet> = {}) {
  const values = new Map(Object.entries(initial));
  const store: TokenStore = {
    async get(hostId) { return values.get(hostId) ?? null; },
    async set(hostId, tokens) { values.set(hostId, tokens); },
    async delete(hostId) { values.delete(hostId); },
  };
  return { store, values };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  mock.restoreAll();
  clearPendingSignIn(github.id);
  clearPendingSignIn(enterprise.id);
});

test("device sign-in returns a same-host verification code without exposing device or access tokens", async () => {
  let requestedUrl = "";
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return jsonResponse({ device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 600, interval: 1 });
  });

  const result = await startSignIn(github);
  assert.equal(result.status, "authorization_required");
  assert.equal(result.userCode, "ABCD-EFGH");
  assert.equal(result.verificationUri, "https://github.com/login/device");
  assert.equal(requestedUrl, "https://github.com/login/device/code");
  assert.doesNotMatch(JSON.stringify(result), /device-secret|access_token/);
});

test("device sign-in rejects a verification URL that leaves the configured host", async () => {
  mock.method(globalThis, "fetch", async () => jsonResponse({
    device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://attacker.example/login/device", expires_in: 600,
  }));

  await assert.rejects(startSignIn(enterprise), (error: unknown) => error instanceof SafeError && error.code === "authentication_required");
});

test("completion waits for GitHub's poll interval, then stores tokens per host", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    calls += 1;
    if (String(input).endsWith("/device/code")) {
      return jsonResponse({ device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 600, interval: 5 });
    }
    return jsonResponse({ access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600, refresh_token_expires_in: 7200 });
  });
  const { store, values } = memoryTokenStore();
  await startSignIn(github);

  const pending = await completeSignIn(github, store);
  assert.equal(pending.status, "pending");
  assert.equal(calls, 1);

  await new Promise((resolve) => setTimeout(resolve, 5100));
  const completed = await completeSignIn(github, store);
  assert.equal(completed.status, "authenticated");
  assert.equal(calls, 2);
  assert.equal(values.get("personal")?.accessToken, "access-secret");
  assert.equal(values.get("personal")?.refreshToken, "refresh-secret");
  assert.doesNotMatch(JSON.stringify(completed), /access-secret|refresh-secret/);
  assert.deepEqual(await getAuthStatus("personal", store), {
    authenticated: true,
    expiresAt: values.get("personal")?.expiresAt,
    refreshAvailable: true,
  });
});

test("device authorization state is isolated by host", async () => {
  mock.method(globalThis, "fetch", async () => jsonResponse({
    device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 600,
  }));
  await startSignIn(github);
  await assert.rejects(completeSignIn(enterprise, memoryTokenStore().store), (error: unknown) => error instanceof SafeError && error.code === "authentication_required");
});

test("expired access tokens refresh and persist replacement credentials", async () => {
  let current: TokenSet | null = {
    accessToken: "expired-access",
    refreshToken: "refresh-secret",
    expiresAt: Date.now() + 1_000,
    refreshTokenExpiresAt: Date.now() + 60_000,
  };
  const store: TokenStore = {
    async get() { return current; },
    async set(_hostId, tokens) { current = tokens; },
    async delete() { current = null; },
  };
  let formBody = "";
  mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    formBody = String(init?.body);
    return jsonResponse({ access_token: "fresh-access", expires_in: 3600 });
  });

  assert.equal(await getAccessToken(github, store), "fresh-access");
  assert.equal(current?.accessToken, "fresh-access");
  assert.match(formBody, /grant_type=refresh_token/);
  assert.doesNotMatch(formBody, /access_token/);
});
