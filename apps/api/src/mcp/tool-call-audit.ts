import { randomUUID } from "node:crypto";

// Which attachment path the agent used. Both transports serve the same tool
// registry; this only records which one a call arrived on.
export type McpTransportKind = "http" | "stdio";

export type McpToolCallAuditEntry = {
  projectId: string;
  transport: McpTransportKind;
  toolName: string;
  // The tool's raw arguments as received. Kept verbatim: the audit exists to
  // show exactly what the agent asked for.
  arguments: unknown;
  outcome: "ok" | "error";
  errorCode?: string | null;
  errorMessage?: string | null;
  changeProposalId?: string | null;
  durationMs: number;
};

export type StoredMcpToolCallAudit = McpToolCallAuditEntry & {
  id: string;
  createdAt: string;
};

export interface McpToolCallAuditPort {
  record(entry: McpToolCallAuditEntry): Promise<void>;
  listByProjectId(projectId: string): Promise<StoredMcpToolCallAudit[]>;
}

export function toStoredMcpToolCallAudit(
  entry: McpToolCallAuditEntry,
): StoredMcpToolCallAudit {
  return {
    ...entry,
    errorCode: entry.errorCode ?? null,
    errorMessage: entry.errorMessage ?? null,
    changeProposalId: entry.changeProposalId ?? null,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

// Used by tests and by any context without a database handle. The SQLite
// implementation lives with the other repositories in `db/repositories.ts`.
export class InMemoryMcpToolCallAudits implements McpToolCallAuditPort {
  private readonly entries: StoredMcpToolCallAudit[] = [];

  async record(entry: McpToolCallAuditEntry): Promise<void> {
    this.entries.push(toStoredMcpToolCallAudit(entry));
  }

  async listByProjectId(projectId: string): Promise<StoredMcpToolCallAudit[]> {
    return this.entries.filter((entry) => entry.projectId === projectId);
  }
}
