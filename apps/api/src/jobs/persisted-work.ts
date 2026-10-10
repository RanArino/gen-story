export type PersistedDeletionWork = {
  workType: "media_deletion";
  workId: string;
  notBefore: string;
  generation: number;
};

export interface PersistedDeletionDispatch {
  dispatch(work: PersistedDeletionWork): Promise<void>;
}
