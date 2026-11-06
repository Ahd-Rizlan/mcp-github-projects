import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { TokenStore } from "../src/auth/token-store.js";
import { createHostProfile } from "../src/config/host-profile.js";
import { SafeError } from "../src/errors.js";
import { GraphQLClient } from "../src/github/graphql-client.js";
import { checkConnection, discoverCapabilities } from "../src/github/capabilities.js";

const host = createHostProfile({ id: "enterprise", kind: "ghes", baseUrl: "https://github.example.com", appClientId: "client" });
const tokenStore: TokenStore = {
  async get() { return { accessToken: "test-token" }; },
  async set() {},
  async delete() {},
};

afterEach(() => mock.restoreAll());

test("capability discovery reports query, mutation, field, enum, and GHES version support", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: {
    __schema: { queryType: { name: "Query", fields: [{ name: "viewer" }, { name: "organization" }] }, mutationType: { name: "Mutation", fields: [{ name: "createProjectV2Field" }] } },
    projectType: { name: "ProjectV2", fields: [{ name: "items" }, { name: "views" }] },
    multiSelectFieldType: { name: "ProjectV2MultiSelectField", fields: [{ name: "multiSelectOptions" }] },
    multiSelectValueType: { name: "ProjectV2ItemFieldMultiSelectValue", fields: [{ name: "options" }] },
    customFieldEnum: { name: "ProjectV2CustomFieldType", enumValues: [{ name: "TEXT" }, { name: "MULTI_SELECT" }] },
  } }), { status: 200, headers: { "x-github-enterprise-version": "3.22.1" } }));

  const profile = await discoverCapabilities(new GraphQLClient(tokenStore), host);
  assert.equal(profile.hostId, "enterprise");
  assert.equal(profile.version, "3.22.1");
  assert.deepEqual(profile.queryFields, ["viewer", "organization"]);
  assert.deepEqual(profile.mutationFields, ["createProjectV2Field"]);
  assert.deepEqual(profile.projectFields, ["items", "views"]);
  assert.deepEqual(profile.fieldConfigurationTypes, ["ProjectV2MultiSelectField"]);
  assert.deepEqual(profile.itemFieldValueTypes, ["ProjectV2ItemFieldMultiSelectValue"]);
  assert.deepEqual(profile.customFieldTypes, ["TEXT", "MULTI_SELECT"]);
  assert.deepEqual(profile.limitations, []);
});

test("restricted introspection returns explicit capability limitations but permission denials remain visible", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ errors: [{ message: "Introspection is disabled" }] }), { status: 200 }));
  const profile = await discoverCapabilities(new GraphQLClient(tokenStore), host);
  assert.match(profile.limitations[0] ?? "", /did not allow GraphQL schema introspection/);
  assert.deepEqual(profile.queryFields, []);

  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ errors: [{ message: "Resource not accessible by integration" }] }), { status: 200 }));
  await assert.rejects(discoverCapabilities(new GraphQLClient(tokenStore), host), (error: unknown) => error instanceof SafeError && error.code === "permission_denied");
});

test("connection check returns the authenticated login and rate-limit snapshot", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: {
    viewer: { login: "octocat" },
    rateLimit: { remaining: 4300, limit: 5000, resetAt: "2026-11-07T00:00:00Z" },
  } }), { status: 200 }));

  assert.deepEqual(await checkConnection(new GraphQLClient(tokenStore), host), {
    hostId: "enterprise",
    login: "octocat",
    rateLimit: { remaining: 4300, limit: 5000, resetAt: "2026-11-07T00:00:00Z" },
  });
});
