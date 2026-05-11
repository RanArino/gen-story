import { GeneratePage } from "../../../../components/generate/GeneratePage";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectGeneratePage({ params }: Props) {
  const { projectId } = await params;
  return <GeneratePage projectId={projectId} />;
}
