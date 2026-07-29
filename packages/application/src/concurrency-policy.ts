import type { ApplicationDependencies } from "./ports";

export const MAX_CONCURRENT_PER_PROJECT = 5;

// Image generation requests and text/vision AI jobs share one per-project cap,
// because they compete for the same upstream model quota and the same local
// worker.
export async function checkConcurrencyAllowed(
  deps: Pick<ApplicationDependencies, "generationRequests" | "aiJobs">,
  projectId: string,
  maxConcurrent: number = MAX_CONCURRENT_PER_PROJECT,
): Promise<boolean> {
  const generationRequestCount =
    await deps.generationRequests.findRunningCountByProjectId(projectId);
  const aiJobCount = await deps.aiJobs.findRunningCountByProjectId(projectId);
  return generationRequestCount + aiJobCount < maxConcurrent;
}
