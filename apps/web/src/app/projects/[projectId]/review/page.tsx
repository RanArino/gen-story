import { ReviewPage } from "../../../../components/review/ReviewPage";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectReviewPage({ params }: Props) {
  const { projectId } = await params;
  return <ReviewPage projectId={projectId} />;
}
