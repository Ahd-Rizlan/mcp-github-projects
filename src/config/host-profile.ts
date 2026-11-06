import { SafeError } from "../errors.js";
import type { GitHubHostKind, HostProfile } from "./types.js";

export interface HostProfileInput {
  readonly id: string;
  readonly kind: GitHubHostKind;
  readonly baseUrl?: string;
  readonly graphqlUrl?: string;
  readonly appClientId: string;
}

function parseHttpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeError(`${label} must be a valid absolute URL.`, "configuration_error");
  }

  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new SafeError(`${label} must use HTTPS and must not contain credentials, query parameters, or a fragment.`, "configuration_error");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

export function createHostProfile(input: HostProfileInput): HostProfile {
  const id = input.id.trim();
  const appClientId = input.appClientId.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) {
    throw new SafeError("Host ID must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.", "configuration_error");
  }
  if (!appClientId) {
    throw new SafeError("A GitHub App Client ID is required for each host.", "configuration_error");
  }

  if (input.kind === "github") {
    const baseUrl = new URL("https://github.com");
    const graphqlUrl = new URL("https://api.github.com/graphql");
    return { id, kind: "github", baseUrl, graphqlUrl, appClientId };
  }

  if (!input.baseUrl) {
    throw new SafeError("A base URL is required for a GitHub Enterprise Server host.", "configuration_error");
  }
  const baseUrl = parseHttpsUrl(input.baseUrl, "GHES base URL");
  if (baseUrl.pathname !== "/") {
    throw new SafeError("GHES base URL must be the instance origin without a path prefix; its device sign-in endpoints are hosted at the origin root.", "configuration_error");
  }
  const graphqlUrl = input.graphqlUrl
    ? parseHttpsUrl(input.graphqlUrl, "GHES GraphQL URL")
    : new URL(`${baseUrl.origin}${baseUrl.pathname === "/" ? "" : baseUrl.pathname}/api/graphql`);

  if (graphqlUrl.origin !== baseUrl.origin) {
    throw new SafeError("The GHES GraphQL endpoint must use the same HTTPS origin as its base URL.", "configuration_error");
  }

  return { id, kind: "ghes", baseUrl, graphqlUrl, appClientId };
}

export function resolveHost(hostId: string | undefined, config: { readonly hosts: readonly HostProfile[]; readonly defaultHostId?: string }): HostProfile {
  const targetId = hostId ?? config.defaultHostId;
  if (!targetId) {
    throw new SafeError("No host was specified and no default host is configured. Add a GitHub host first.", "configuration_error");
  }
  const host = config.hosts.find((candidate) => candidate.id === targetId);
  if (!host) {
    throw new SafeError(`GitHub host '${targetId}' is not configured.`, "configuration_error");
  }
  return host;
}
