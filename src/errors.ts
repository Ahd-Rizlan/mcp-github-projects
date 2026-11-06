export type SafeErrorCode =
  | "configuration_error"
  | "authentication_required"
  | "permission_denied"
  | "unsupported_capability"
  | "credential_store_unavailable"
  | "rate_limited"
  | "github_api_error"
  | "internal_error";

export class SafeError extends Error {
  readonly code: SafeErrorCode;
  readonly retryable: boolean;

  constructor(message: string, code: SafeErrorCode, retryable = false) {
    super(message);
    this.name = "SafeError";
    this.code = code;
    this.retryable = retryable;
  }
}

const sensitivePatterns = [
  /(bearer\s+)[^\s"']+/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
];

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sensitivePatterns.reduce(
    (safe, pattern) => safe.replace(pattern, (_match, prefix?: string) => `${prefix ?? ""}[REDACTED]`),
    message,
  ).slice(0, 1000);
}
