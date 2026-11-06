import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadAppConfig, saveAppConfig } from "../src/config/config-store.js";
import { createHostProfile } from "../src/config/host-profile.js";
import { SafeError } from "../src/errors.js";

async function withTempDir(run: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "github-projects-mcp-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("configuration round-trips host profiles and default selection without credentials", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "config.json");
    const host = createHostProfile({ id: "personal", kind: "github", appClientId: "Iv1.client" });
    await saveAppConfig({ hosts: [host], defaultHostId: host.id }, path);

    const config = await loadAppConfig(path);
    const raw = await readFile(path, "utf8");
    assert.equal(config.defaultHostId, "personal");
    assert.equal(config.hosts[0]?.graphqlUrl.href, "https://api.github.com/graphql");
    assert.match(raw, /Iv1\.client/);
    assert.doesNotMatch(raw, /accessToken|refreshToken|Bearer/);
  });
});
test("a missing configuration file produces an empty host list", async () => {
  await withTempDir(async (directory) => {
    assert.deepEqual(await loadAppConfig(join(directory, "missing.json")), { hosts: [] });
  });
});

test("invalid JSON and a default host absent from the host list fail safely", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "config.json");
    await writeFile(path, "{", "utf8");
    await assert.rejects(loadAppConfig(path), (error: unknown) => error instanceof SafeError && error.code === "configuration_error");

    await writeFile(path, JSON.stringify({ hosts: [], defaultHostId: "missing" }), "utf8");
    await assert.rejects(loadAppConfig(path), (error: unknown) => error instanceof SafeError && error.code === "configuration_error");
  });
});
