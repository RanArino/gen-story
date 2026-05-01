import { createProjectSummary, type ProjectSummary } from "@gen-story/domain";

export type CreateProjectInput = {
  id: string;
  name: string;
};

export function createProject(input: CreateProjectInput): ProjectSummary {
  return createProjectSummary(input.id, input.name);
}
