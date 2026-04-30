export type ProjectId = string;

export type ProjectSummary = {
  id: ProjectId;
  name: string;
};

export function createProjectSummary(
  id: ProjectId,
  name: string,
): ProjectSummary {
  const trimmedName = name.trim();

  if (trimmedName.length === 0) {
    throw new Error("Project name is required.");
  }

  return {
    id,
    name: trimmedName,
  };
}
