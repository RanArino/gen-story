import type { ApplicationDependencies } from "./ports";

export const MAX_CONCURRENT_PER_PROJECT = 5;

export async function checkConcurrencyAllowed(
  deps: Pick<ApplicationDependencies, "generationRequests">,
  projectId: string,
  maxConcurrent: number = MAX_CONCURRENT_PER_PROJECT,
): Promise<boolean> {
  const count =
    await deps.generationRequests.findRunningCountByProjectId(projectId);
  return count < maxConcurrent;
}
