import { SafeError } from "../errors.js";
import type { HostProfile } from "../config/types.js";
import { getAccessToken } from "../auth/device-flow.js";
import type { TokenStore } from "../auth/token-store.js";

export interface Operation<T> {
  readonly name: string;
  readonly document: string;
  readonly decode: (value: unknown) => T;
  readonly retry: "safe-read" | "never";
}

export interface GraphQLRequestOptions {
  readonly signal?: AbortSignal;
}

export interface GraphQLResponseMetadata {
  githubEnterpriseVersion?: string;
}

interface GraphQLResponse {
  readonly data?: unknown;
  readonly errors?: readonly { readonly message?: string; readonly type?: string; readonly extensions?: { readonly type?: string; readonly code?: string; readonly retryAfterSeconds?: number; readonly retryAfter?: number; readonly resetAt?: string } }[];
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function safeGraphQLError(errors: NonNullable<GraphQLResponse["errors"]>): SafeError {
  const joined = errors.map((error) => `${error.type ?? ""} ${error.extensions?.type ?? ""} ${error.extensions?.code ?? ""} ${error.message ?? ""}`).join(" ").toLowerCase();
  if (/rate.?limit|secondary rate/.test(joined)) return new SafeError("GitHub rate limit reached. Retry after the delay returned by the server.", "rate_limited", true);
  if (/resource not accessible|permission|forbidden/.test(joined)) return new SafeError("GitHub denied this operation. Check account access and GitHub App permissions.", "permission_denied");
  if (/could not resolve to a node|was not found|not found/.test(joined)) return new SafeError("GitHub could not find the requested project resource.", "github_api_error");
  return new SafeError("GitHub rejected the GraphQL operation. Check the input and host capabilities.", "github_api_error");
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export class GraphQLClient {
  constructor(private readonly tokenStore: TokenStore) {}

  async request<T>(host: HostProfile, operation: Operation<T>, variables: Readonly<Record<string, unknown>> = {}, options: GraphQLRequestOptions = {}, metadata?: GraphQLResponseMetadata): Promise<T> {
    const maxAttempts = operation.retry === "safe-read" ? 3 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const token = await getAccessToken(host, this.tokenStore);
      let response: Response;
      try {
        response = await fetch(host.graphqlUrl, {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({ query: operation.document, variables, operationName: operation.name }),
          redirect: "error",
          signal: options.signal ?? AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (attempt + 1 < maxAttempts) {
          await delay(250 * (2 ** attempt), options.signal);
          continue;
        }
        throw new SafeError("Could not reach the configured GitHub GraphQL endpoint. Check network and host settings.", "github_api_error", true);
      }

      if (response.status === 401) throw new SafeError("GitHub authentication expired or was revoked. Sign in again.", "authentication_required");
      if (response.status === 403 || response.status === 404 || response.status === 429) {
        const rateLimited = response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
        if (rateLimited) {
          const waitMs = parseRetryAfter(response.headers.get("retry-after")) ?? Math.max(1000, Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000 - Date.now());
          if (operation.retry === "safe-read" && attempt + 1 < maxAttempts && waitMs < 60_000) {
            await delay(waitMs, options.signal);
            continue;
          }
          throw new SafeError(`GitHub rate limit reached. Retry in about ${Math.ceil(waitMs / 1000)} seconds.`, "rate_limited", true);
        }
        throw new SafeError("GitHub denied access to this API endpoint or resource.", response.status === 403 ? "permission_denied" : "github_api_error");
      }
      if (!response.ok) {
        if (response.status >= 500 && operation.retry === "safe-read" && attempt + 1 < maxAttempts) {
          await delay(250 * (2 ** attempt), options.signal);
          continue;
        }
        throw new SafeError(`GitHub GraphQL request failed with HTTP ${response.status}.`, "github_api_error", response.status >= 500);
      }

      let result: GraphQLResponse;
      try {
        result = await response.json() as GraphQLResponse;
      } catch {
        throw new SafeError("GitHub returned an invalid GraphQL response.", "github_api_error");
      }
      if (result.errors?.length) {
        const error = safeGraphQLError(result.errors);
        if (error.code === "rate_limited" && operation.retry === "safe-read" && attempt + 1 < maxAttempts) {
          const extensionSeconds = result.errors.map((entry) => entry.extensions?.retryAfterSeconds ?? entry.extensions?.retryAfter).find((value) => typeof value === "number" && value >= 0);
          const extensionResetAt = result.errors.map((entry) => entry.extensions?.resetAt).find((value) => typeof value === "string");
          const waitMs = (typeof extensionSeconds === "number" ? extensionSeconds * 1000 : undefined)
            ?? (extensionResetAt ? Math.max(0, Date.parse(extensionResetAt) - Date.now()) : undefined)
            ?? parseRetryAfter(response.headers.get("retry-after"))
            ?? Math.max(1000, Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000 - Date.now());
          if (waitMs <= 60_000) {
            await delay(waitMs, options.signal);
            continue;
          }
        }
        throw error;
      }
      if (result.data === undefined) throw new SafeError("GitHub returned no GraphQL data.", "github_api_error");
      try {
        const decoded = operation.decode(result.data);
        if (metadata) {
          const version = response.headers.get("x-github-enterprise-version");
          if (version) metadata.githubEnterpriseVersion = version;
        }
        return decoded;
      } catch {
        throw new SafeError(`GitHub returned an unexpected response for ${operation.name}.`, "unsupported_capability");
      }
    }
    throw new SafeError("GitHub read could not be completed after retries.", "github_api_error", true);
  }
}
