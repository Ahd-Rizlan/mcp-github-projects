import { SafeError } from "../errors.js";
import type { HostProfile } from "../config/types.js";
import { GraphQLClient, type GraphQLResponseMetadata, type Operation } from "./graphql-client.js";

export interface CapabilityProfile {
  readonly hostId: string;
  readonly version?: string;
  readonly queryFields: readonly string[];
  readonly mutationFields: readonly string[];
  readonly projectFields: readonly string[];
  readonly fieldConfigurationTypes: readonly string[];
  readonly itemFieldValueTypes: readonly string[];
  readonly customFieldTypes: readonly string[];
  readonly limitations: readonly string[];
}

interface TypeFields {
  readonly name?: string;
  readonly fields?: readonly { readonly name?: string }[] | null;
}

function stringFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => field && typeof field === "object" && "name" in field && typeof field.name === "string" ? [field.name] : []);
}

function typeFields(value: unknown): TypeFields | null {
  if (!value || typeof value !== "object") return null;
  return value as TypeFields;
}

function decodeSchema(value: unknown): CapabilityProfile {
  if (!value || typeof value !== "object" || !("__schema" in value)) throw new Error("Missing schema");
  const schema = value.__schema;
  if (!schema || typeof schema !== "object" || !("queryType" in schema) || !("mutationType" in schema)) throw new Error("Invalid schema");
  const queryType = typeFields(schema.queryType);
  const mutationType = typeFields(schema.mutationType);
  const projectTypeRecord = typeFields("projectType" in value ? value.projectType : null);
  const multiSelectFieldTypeRecord = typeFields("multiSelectFieldType" in value ? value.multiSelectFieldType : null);
  const multiSelectTypeRecord = typeFields("multiSelectValueType" in value ? value.multiSelectValueType : null);
  const customFieldEnumRecord = typeFields("customFieldEnum" in value ? value.customFieldEnum : null);
  const limitations: string[] = [];
  if (!queryType) limitations.push("GraphQL query root is not available through schema introspection.");
  if (!mutationType) limitations.push("GraphQL mutation root is not available through schema introspection.");
  if (!projectTypeRecord) limitations.push("ProjectV2 type was not exposed by this host schema.");
  if (multiSelectFieldTypeRecord?.name !== "ProjectV2MultiSelectField") limitations.push("ProjectV2MultiSelectField was not exposed; multi-select custom-field tools are unavailable for this host.");
  if (multiSelectTypeRecord?.name !== "ProjectV2ItemFieldMultiSelectValue") limitations.push("ProjectV2ItemFieldMultiSelectValue was not exposed; item lists omit multi-select values for this host.");
  const customFieldEnumValues = customFieldEnumRecord && "enumValues" in customFieldEnumRecord && Array.isArray(customFieldEnumRecord.enumValues) ? customFieldEnumRecord.enumValues : [];
  return {
    hostId: "",
    queryFields: stringFields(queryType?.fields),
    mutationFields: stringFields(mutationType?.fields),
    projectFields: stringFields(projectTypeRecord?.fields),
    fieldConfigurationTypes: multiSelectFieldTypeRecord?.name === "ProjectV2MultiSelectField" ? [multiSelectFieldTypeRecord.name] : [],
    itemFieldValueTypes: multiSelectTypeRecord?.name === "ProjectV2ItemFieldMultiSelectValue" ? [multiSelectTypeRecord.name] : [],
    customFieldTypes: stringFields(customFieldEnumValues),
    limitations,
  };
}

const schemaOperation: Operation<CapabilityProfile> = {
  name: "DiscoverProjectsCapabilities",
  document: `query DiscoverProjectsCapabilities {
    __schema {
      queryType { name fields { name } }
      mutationType { name fields { name } }
    }
    projectType: __type(name: "ProjectV2") { name fields { name } }
    multiSelectFieldType: __type(name: "ProjectV2MultiSelectField") { name fields { name } }
    multiSelectValueType: __type(name: "ProjectV2ItemFieldMultiSelectValue") { name fields { name } }
    customFieldEnum: __type(name: "ProjectV2CustomFieldType") { name enumValues { name } }
  }`,
  decode: decodeSchema,
  retry: "safe-read",
};

export async function discoverCapabilities(client: GraphQLClient, host: HostProfile): Promise<CapabilityProfile> {
  try {
    const metadata: GraphQLResponseMetadata = {};
    const profile = await client.request(host, schemaOperation, {}, {}, metadata);
    return { ...profile, hostId: host.id, ...(metadata.githubEnterpriseVersion ? { version: metadata.githubEnterpriseVersion } : {}) };
  } catch (error) {
    if (error instanceof SafeError && error.code === "permission_denied") throw error;
    return {
      hostId: host.id,
      queryFields: [],
      mutationFields: [],
      projectFields: [],
      fieldConfigurationTypes: [],
      itemFieldValueTypes: [],
      customFieldTypes: [],
      limitations: ["This host did not allow GraphQL schema introspection; connectivity is available, but capability details could not be discovered."],
    };
  }
}

export async function checkConnection(client: GraphQLClient, host: HostProfile): Promise<{ hostId: string; login: string; rateLimit?: { remaining: number; limit: number; resetAt: string } }> {
  const operation: Operation<{ login: string; rateLimit?: { remaining: number; limit: number; resetAt: string } }> = {
    name: "CheckGitHubConnection",
    document: `query CheckGitHubConnection {
      viewer { login }
      rateLimit { remaining limit resetAt }
    }`,
    decode(value) {
      if (!value || typeof value !== "object" || !("viewer" in value) || !value.viewer || typeof value.viewer !== "object" || !("login" in value.viewer) || typeof value.viewer.login !== "string") {
        throw new Error("Invalid viewer response");
      }
      const rate = "rateLimit" in value ? value.rateLimit : undefined;
      if (rate && typeof rate === "object" && "remaining" in rate && typeof rate.remaining === "number" && "limit" in rate && typeof rate.limit === "number" && "resetAt" in rate && typeof rate.resetAt === "string") {
        return { login: value.viewer.login, rateLimit: { remaining: rate.remaining, limit: rate.limit, resetAt: rate.resetAt } };
      }
      return { login: value.viewer.login };
    },
    retry: "safe-read",
  };
  const result = await client.request(host, operation);
  return { hostId: host.id, ...result };
}
