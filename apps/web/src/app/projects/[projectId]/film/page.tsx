import { FilmPage } from "../../../../components/film/FilmPage";
export default async function ProjectFilmPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return <FilmPage projectId={(await params).projectId} />;
}
