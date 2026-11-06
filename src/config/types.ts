export type GitHubHostKind = "github" | "ghes";

export interface HostProfile {
  readonly id: string;
  readonly kind: GitHubHostKind;
  readonly baseUrl: URL;
  readonly graphqlUrl: URL;
  readonly appClientId: string;
}

export interface AppConfig {
  readonly hosts: readonly HostProfile[];
  readonly defaultHostId?: string;
}
