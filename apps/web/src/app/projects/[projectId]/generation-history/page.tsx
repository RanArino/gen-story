import { GenerationHistoryPage } from "../../../../components/generation-history/GenerationHistoryPage";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectGenerationHistoryPage({ params }: Props) {
  const { projectId } = await params;
  return <GenerationHistoryPage projectId={projectId} />;
}
