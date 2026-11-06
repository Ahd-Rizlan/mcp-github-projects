import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SafeError } from "../errors.js";
import { createHostProfile } from "./host-profile.js";
import type { AppConfig, GitHubHostKind, HostProfile } from "./types.js";

interface StoredConfig {
  readonly hosts?: readonly {
    readonly id?: unknown;
    readonly kind?: unknown;
    readonly baseUrl?: unknown;
    readonly graphqlUrl?: unknown;
    readonly appClientId?: unknown;
  }[];
  readonly defaultHostId?: unknown;
}

export interface ConfigStore {
  get(): AppConfig;
  save(config: AppConfig): Promise<void>;
}

export function getConfigPath(): string {
  if (process.env.GITHUB_PROJECTS_MCP_CONFIG) return process.env.GITHUB_PROJECTS_MCP_CONFIG;

  const root = process.platform === "win32"
    ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(root, "github-projects-mcp", "config.json");
}

function parseStoredConfig(value: unknown): AppConfig {
  if (!value || typeof value !== "object") {
    throw new SafeError("The GitHub Projects MCP configuration must be a JSON object.", "configuration_error");
  }
  const stored = value as StoredConfig;
  const hosts: HostProfile[] = [];
  for (const record of stored.hosts ?? []) {
    if (typeof record.id !== "string" || (record.kind !== "github" && record.kind !== "ghes") || typeof record.appClientId !== "string") {
      throw new SafeError("A configured host is missing its ID, supported host kind, or GitHub App Client ID.", "configuration_error");
    }
    hosts.push(createHostProfile({
      id: record.id,
      kind: record.kind as GitHubHostKind,
      ...(typeof record.baseUrl === "string" ? { baseUrl: record.baseUrl } : {}),
      ...(typeof record.graphqlUrl === "string" ? { graphqlUrl: record.graphqlUrl } : {}),
      appClientId: record.appClientId,
    }));
  }

  const defaultHostId = typeof stored.defaultHostId === "string" ? stored.defaultHostId : undefined;
  if (defaultHostId && !hosts.some((host) => host.id === defaultHostId)) {
    throw new SafeError("The configured default host is not present in the host list.", "configuration_error");
  }
  return { hosts, ...(defaultHostId ? { defaultHostId } : {}) };
}

export async function loadAppConfig(path = getConfigPath()): Promise<AppConfig> {
  try {
    return parseStoredConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { hosts: [] };
    if (error instanceof SafeError) throw error;
    if (error instanceof SyntaxError) throw new SafeError("The host configuration file is not valid JSON.", "configuration_error");
    throw new SafeError("Could not read the host configuration file.", "configuration_error");
  }
}

function serializeHost(host: HostProfile) {
  return {
    id: host.id,
    kind: host.kind,
    baseUrl: host.baseUrl.toString(),
    graphqlUrl: host.graphqlUrl.toString(),
    appClientId: host.appClientId,
  };
}

export async function saveAppConfig(config: AppConfig, path = getConfigPath()): Promise<void> {
  const parent = dirname(path);
  const temporaryPath = `${path}.tmp`;
  try {
    await mkdir(parent, { recursive: true });
    const contents = JSON.stringify({
      hosts: config.hosts.map(serializeHost),
      ...(config.defaultHostId ? { defaultHostId: config.defaultHostId } : {}),
    }, null, 2);
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch {
    throw new SafeError("Could not save the host configuration. Check the config directory permissions.", "configuration_error");
  }
}

export async function createConfigStore(initialConfig?: AppConfig): Promise<ConfigStore> {
  let current = initialConfig ?? await loadAppConfig();
  return {
    get: () => current,
    save: async (nextConfig) => {
      await saveAppConfig(nextConfig);
      current = nextConfig;
    },
  };
}
