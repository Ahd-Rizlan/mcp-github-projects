import assert from "node:assert/strict";
import { test } from "node:test";
import { SafeError } from "../src/errors.js";
import { createHostProfile, resolveHost } from "../src/config/host-profile.js";

test("GitHub.com profiles use the canonical API endpoints and trim identifiers", () => {
  const host = createHostProfile({ id: "  personal  ", kind: "github", appClientId: "  Iv1.test  " });

  assert.equal(host.id, "personal");
  assert.equal(host.appClientId, "Iv1.test");
  assert.equal(host.baseUrl.href, "https://github.com/");
  assert.equal(host.graphqlUrl.href, "https://api.github.com/graphql");
});

test("GHES profiles use the instance GraphQL endpoint and reject path prefixes", () => {
  const host = createHostProfile({ id: "enterprise", kind: "ghes", baseUrl: "https://github.example.com", appClientId: "client" });
  assert.equal(host.graphqlUrl.href, "https://github.example.com/api/graphql");

  assert.throws(
    () => createHostProfile({ id: "enterprise", kind: "ghes", baseUrl: "https://github.example.com/prefix", appClientId: "client" }),
    (error: unknown) => error instanceof SafeError && error.code === "configuration_error",
  );
});

test("host profiles reject insecure, cross-origin, and credential-bearing endpoints", () => {
  const cases = [
    { baseUrl: "http://github.example.com", graphqlUrl: undefined },
    { baseUrl: "https://github.example.com", graphqlUrl: "https://api.other.example/graphql" },
    { baseUrl: "https://user:password@github.example.com", graphqlUrl: undefined },
  ];

  for (const entry of cases) {
    assert.throws(
      () => createHostProfile({ id: "enterprise", kind: "ghes", baseUrl: entry.baseUrl, ...(entry.graphqlUrl ? { graphqlUrl: entry.graphqlUrl } : {}), appClientId: "client" }),
      (error: unknown) => error instanceof SafeError && error.code === "configuration_error",
    );
  }
});

test("host resolution prefers an explicit host and requires a configured default otherwise", () => {
  const personal = createHostProfile({ id: "personal", kind: "github", appClientId: "client" });
  const enterprise = createHostProfile({ id: "enterprise", kind: "ghes", baseUrl: "https://github.example.com", appClientId: "client" });
  const config = { hosts: [personal, enterprise], defaultHostId: "personal" };

  assert.equal(resolveHost("enterprise", config), enterprise);
  assert.equal(resolveHost(undefined, config), personal);
  assert.throws(() => resolveHost("missing", config), SafeError);
  assert.throws(() => resolveHost(undefined, { hosts: [] }), SafeError);
});
