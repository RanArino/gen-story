import { PhotosPage } from "../../../../components/photos/PhotosPage";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectPhotosPage({ params }: Props) {
  const { projectId } = await params;
  return <PhotosPage projectId={projectId} />;
}
