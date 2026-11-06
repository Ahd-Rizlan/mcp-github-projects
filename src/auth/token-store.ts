import { AsyncEntry } from "@napi-rs/keyring";
import { SafeError } from "../errors.js";

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly refreshTokenExpiresAt?: number;
}

export interface TokenStore {
  get(hostId: string): Promise<TokenSet | null>;
  set(hostId: string, tokens: TokenSet): Promise<void>;
  delete(hostId: string): Promise<void>;
}

const SERVICE_NAME = "github-projects-mcp";

function credentialEntry(hostId: string): AsyncEntry {
  return new AsyncEntry(SERVICE_NAME, hostId);
}

function parseTokenSet(value: string): TokenSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SafeError("The saved GitHub credential could not be read. Sign out and sign in again.", "credential_store_unavailable");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new SafeError("The saved GitHub credential is incomplete. Sign out and sign in again.", "credential_store_unavailable");
  }
  const valueRecord = parsed as Record<string, unknown>;
  if (typeof valueRecord.accessToken !== "string") {
    throw new SafeError("The saved GitHub credential is incomplete. Sign out and sign in again.", "credential_store_unavailable");
  }
  return {
    accessToken: valueRecord.accessToken,
    ...(typeof valueRecord.refreshToken === "string" ? { refreshToken: valueRecord.refreshToken } : {}),
    ...(typeof valueRecord.expiresAt === "number" ? { expiresAt: valueRecord.expiresAt } : {}),
    ...(typeof valueRecord.refreshTokenExpiresAt === "number" ? { refreshTokenExpiresAt: valueRecord.refreshTokenExpiresAt } : {}),
  };
}

export function createTokenStore(): TokenStore {
  return {
    async get(hostId) {
      try {
        const password = await credentialEntry(hostId).getPassword();
        return password ? parseTokenSet(password) : null;
      } catch (error) {
        if (error instanceof SafeError) throw error;
        throw new SafeError("The operating system credential store is unavailable or locked.", "credential_store_unavailable");
      }
    },
    async set(hostId, tokens) {
      try {
        await credentialEntry(hostId).setPassword(JSON.stringify(tokens));
      } catch {
        throw new SafeError("Could not save the GitHub credential to the operating system credential store.", "credential_store_unavailable");
      }
    },
    async delete(hostId) {
      try {
        const existing = await credentialEntry(hostId).getPassword();
        if (!existing) return;
        await credentialEntry(hostId).deletePassword();
      } catch {
        throw new SafeError("Could not remove the GitHub credential from the operating system credential store.", "credential_store_unavailable");
      }
    },
  };
}
