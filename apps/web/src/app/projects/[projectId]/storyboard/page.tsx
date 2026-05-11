import { StoryboardPage } from "../../../../components/storyboard/StoryboardPage";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectStoryboardPage({ params }: Props) {
  const { projectId } = await params;
  return <StoryboardPage projectId={projectId} />;
}
