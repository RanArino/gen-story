import type { ProgressEventPort } from "@gen-story/application";

export type ProgressEvent = {
  kind: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
};

export type ProgressEventListener = (event: ProgressEvent) => void;

// Resolve the project a subscriber cares about. Events that carry no project
// reference are not fanned out: correctness never depends on the stream, and
// delivering them to every project would be worse than delivering them to none.
function resolveProjectId(event: ProgressEvent): string | null {
  const fromPayload = event.payload?.projectId;
  if (typeof fromPayload === "string" && fromPayload.length > 0) {
    return fromPayload;
  }
  if (event.entityType === "project") return event.entityId;
  return null;
}

// In-process fan-out. Gen Story runs as a single local API process, so no
// broker is involved; MCP tool calls (milestone M2) are hosted inside this same
// process precisely so their mutations reach this emitter.
export class LocalProgressEvents implements ProgressEventPort {
  private readonly listeners = new Map<string, Set<ProgressEventListener>>();

  subscribe(projectId: string, listener: ProgressEventListener): () => void {
    let forProject = this.listeners.get(projectId);
    if (forProject == null) {
      forProject = new Set();
      this.listeners.set(projectId, forProject);
    }
    forProject.add(listener);

    return () => {
      const current = this.listeners.get(projectId);
      if (current == null) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(projectId);
    };
  }

  async publish(event: ProgressEvent): Promise<void> {
    const projectId = resolveProjectId(event);
    if (projectId == null) return;

    const forProject = this.listeners.get(projectId);
    if (forProject == null) return;

    for (const listener of forProject) {
      try {
        listener(event);
      } catch (err) {
        // A broken subscriber must not fail the job that published the event.
        console.error("[LocalProgressEvents] listener error:", err);
      }
    }
  }
}
