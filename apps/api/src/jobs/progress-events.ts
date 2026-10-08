export type ProgressEvent = {
  kind: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
};

export type ProgressEventListener = (event: ProgressEvent) => void;
