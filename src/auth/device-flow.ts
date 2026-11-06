import * as z from "zod/v4";
import { SafeError } from "../errors.js";
import type { HostProfile } from "../config/types.js";
import type { TokenSet, TokenStore } from "./token-store.js";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const pendingByHost = new Map<string, PendingDeviceFlow>();

interface PendingDeviceFlow {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: number;
  intervalSeconds: number;
  nextPollAt: number;
}

const deviceResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  expires_in: z.number().positive(),
  interval: z.number().positive().optional(),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  refresh_token_expires_in: z.number().positive().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  interval: z.number().positive().optional(),
});

function deviceEndpoints(host: HostProfile): { device: URL; token: URL; verificationOrigin: string } {
  const origin = host.baseUrl.origin;
  return {
    device: new URL("/login/device/code", origin),
    token: new URL("/login/oauth/access_token", origin),
    verificationOrigin: origin,
  };
}

async function postForm(url: URL, values: URLSearchParams): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: values,
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SafeError("Could not reach the GitHub authorization endpoint. Check the host and network, then retry.", "authentication_required", true);
  }
  if (!response.ok) {
    throw new SafeError(`GitHub authorization failed with HTTP ${response.status}.`, "authentication_required", response.status >= 500);
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new SafeError("GitHub returned an invalid authorization response.", "authentication_required");
  }
}

export interface SignInStarted {
  readonly status: "authorization_required";
  readonly hostId: string;
  readonly verificationUri: string;
  readonly userCode: string;
  readonly expiresAt: number;
}

export async function startSignIn(host: HostProfile): Promise<SignInStarted> {
  const endpoints = deviceEndpoints(host);
  const values = new URLSearchParams({ client_id: host.appClientId, scope: "offline_access" });
  const raw = await postForm(endpoints.device, values);
  const parsed = deviceResponseSchema.safeParse(raw);
  if (!parsed.success) throw new SafeError("GitHub returned an incomplete device authorization response.", "authentication_required");

  const verificationUri = new URL(parsed.data.verification_uri);
  if (verificationUri.protocol !== "https:" || verificationUri.origin !== endpoints.verificationOrigin) {
    throw new SafeError("GitHub returned a verification URL outside the configured host.", "authentication_required");
  }

  const now = Date.now();
  const pending: PendingDeviceFlow = {
    deviceCode: parsed.data.device_code,
    userCode: parsed.data.user_code,
    verificationUri: verificationUri.toString(),
    expiresAt: now + parsed.data.expires_in * 1000,
    intervalSeconds: parsed.data.interval ?? 5,
    nextPollAt: now + (parsed.data.interval ?? 5) * 1000,
  };
  pendingByHost.set(host.id, pending);
  return {
    status: "authorization_required",
    hostId: host.id,
    verificationUri: pending.verificationUri,
    userCode: pending.userCode,
    expiresAt: pending.expiresAt,
  };
}

export type SignInCompletion =
  | { readonly status: "pending"; readonly retryAfterSeconds: number; readonly expiresAt: number }
  | { readonly status: "authenticated"; readonly expiresAt?: number; readonly refreshTokenExpiresAt?: number };

function tokenSetFromResponse(response: z.infer<typeof tokenResponseSchema>, now: number): TokenSet {
  if (!response.access_token) throw new SafeError("GitHub authorization did not return an access token.", "authentication_required");
  return {
    accessToken: response.access_token,
    ...(response.refresh_token ? { refreshToken: response.refresh_token } : {}),
    ...(response.expires_in ? { expiresAt: now + response.expires_in * 1000 } : {}),
    ...(response.refresh_token_expires_in ? { refreshTokenExpiresAt: now + response.refresh_token_expires_in * 1000 } : {}),
  };
}

export async function completeSignIn(host: HostProfile, tokenStore: TokenStore): Promise<SignInCompletion> {
  const pending = pendingByHost.get(host.id);
  if (!pending) throw new SafeError("Start sign-in for this host first, then authorize the displayed code.", "authentication_required");
  const now = Date.now();
  if (now >= pending.expiresAt) {
    pendingByHost.delete(host.id);
    throw new SafeError("The device code expired. Start sign-in again.", "authentication_required");
  }
  if (now < pending.nextPollAt) {
    return { status: "pending", retryAfterSeconds: Math.ceil((pending.nextPollAt - now) / 1000), expiresAt: pending.expiresAt };
  }

  const endpoints = deviceEndpoints(host);
  const raw = await postForm(endpoints.token, new URLSearchParams({
    client_id: host.appClientId,
    device_code: pending.deviceCode,
    grant_type: DEVICE_GRANT,
  }));
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success) throw new SafeError("GitHub returned an invalid token response.", "authentication_required");

  const error = parsed.data.error;
  if (error === "authorization_pending" || error === "slow_down") {
    if (error === "slow_down") pending.intervalSeconds = parsed.data.interval ?? pending.intervalSeconds + 5;
    pending.nextPollAt = Date.now() + pending.intervalSeconds * 1000;
    return { status: "pending", retryAfterSeconds: pending.intervalSeconds, expiresAt: pending.expiresAt };
  }
  if (error) {
    pendingByHost.delete(host.id);
    const message = error === "access_denied"
      ? "GitHub sign-in was declined. Start again if you want to authorize the app."
      : error === "expired_token" || error === "token_expired"
        ? "The device code expired. Start sign-in again."
        : `GitHub device authorization failed (${error}).`;
    throw new SafeError(message, "authentication_required");
  }

  const tokens = tokenSetFromResponse(parsed.data, Date.now());
  await tokenStore.set(host.id, tokens);
  pendingByHost.delete(host.id);
  return { status: "authenticated", ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}), ...(tokens.refreshTokenExpiresAt ? { refreshTokenExpiresAt: tokens.refreshTokenExpiresAt } : {}) };
}

export function clearPendingSignIn(hostId: string): void {
  pendingByHost.delete(hostId);
}

export async function getAuthStatus(hostId: string, tokenStore: TokenStore): Promise<{ authenticated: boolean; expiresAt?: number; refreshAvailable: boolean }> {
  const tokens = await tokenStore.get(hostId);
  if (!tokens) return { authenticated: false, refreshAvailable: false };
  return {
    authenticated: true,
    ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
    refreshAvailable: Boolean(tokens.refreshToken),
  };
}

export async function getAccessToken(host: HostProfile, tokenStore: TokenStore): Promise<string> {
  const tokens = await tokenStore.get(host.id);
  if (!tokens) throw new SafeError("Sign in to this GitHub host before making API calls.", "authentication_required");
  if (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  if (!tokens.refreshToken || (tokens.refreshTokenExpiresAt && tokens.refreshTokenExpiresAt <= Date.now())) {
    throw new SafeError("The GitHub access token expired. Sign in again.", "authentication_required");
  }

  const endpoints = deviceEndpoints(host);
  const raw = await postForm(endpoints.token, new URLSearchParams({
    client_id: host.appClientId,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  }));
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.error || !parsed.data.access_token) {
    throw new SafeError("Could not refresh the GitHub access token. Sign in again.", "authentication_required");
  }
  const refreshedBase = tokenSetFromResponse(parsed.data, Date.now());
  const refreshed: TokenSet = {
    ...refreshedBase,
    ...(!refreshedBase.refreshToken && tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    ...(!refreshedBase.refreshTokenExpiresAt && tokens.refreshTokenExpiresAt ? { refreshTokenExpiresAt: tokens.refreshTokenExpiresAt } : {}),
  };
  await tokenStore.set(host.id, refreshed);
  return refreshed.accessToken;
}
