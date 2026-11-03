import { z } from "zod";
import { markOriginalImageAdopted } from "@gen-story/application";
import { digestBytes } from "@gen-story/infrastructure/film";
import type { ApiDependencies } from "../app/create-api-context";
import type { Router } from "../http/router";
import { getParam } from "../http/router";
import { readJsonBody, sendJson } from "../http/json";

const draftSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(200),
  recipe: z.enum(["quiet-cinema", "memory-board", "pulse-cut"]),
  reducedMotion: z.boolean(),
  outputAspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
  sceneCaptions: z
    .record(
      z.string().min(1),
      z.object({ ja: z.string().max(120), en: z.string().max(200) }),
    )
    .optional(),
  chapters: z.array(
    z.object({
      settings: z
        .object({
          pacing: z.number().min(0.5).max(2).optional(),
          motionAmount: z.number().min(0).max(1).optional(),
          emphasis: z.number().min(0).max(1).optional(),
          sfxLevel: z.number().min(0).max(1).optional(),
          visualIntensity: z.number().min(0).max(1).optional(),
        })
        .optional(),
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      limitMs: z.number().int().positive().nullable(),
      scenes: z.array(
        z.object({
          sceneId: z.string().min(1),
          durationMs: z.number().int().positive().optional(),
        }),
      ),
    }),
  ),
});
const subtitleModeSchema = z.enum(["both", "ja", "en", "none"]);
const directionRequestSchema = z.object({
  scope: z.enum(["film", "chapter"]),
  chapterId: z.string().uuid().optional(),
  regenerate: z.boolean().default(false),
  sceneId: z.string().min(1).optional(),
});
// Content is validated against the Chapter's photos by the domain rules.
const directionUpdateSchema = z.object({ content: z.unknown() });
const directionApproveSchema = z.object({
  expectedRevision: z.number().int().positive(),
});
const revisionSchema = z.object({
  revision: z.number().int().positive(),
  subtitles: subtitleModeSchema.default("both"),
});

export function registerFilmRoutes(router: Router, deps: ApiDependencies) {
  const service = deps.film;
  if (!service) return;
  const base = "/api/projects/:projectId/film";
  const guarded =
    (
      handler: (
        req: Parameters<Router["handle"]>[0],
        res: Parameters<Router["handle"]>[1],
        params: import("../http/router").RouteParams,
        projectId: string,
      ) => Promise<void>,
    ): import("../http/router").RouteHandler =>
    async (req, res, params) => {
      const principal = await deps.authContext.getCurrentPrincipal();
      if (!principal) {
        sendJson(res, 401, {
          error: { code: "unauthorized", message: "Sign in first." },
        });
        return;
      }
      const projectId = getParam(params, "projectId");
      const project = await deps.projects.findById(projectId);
      if (!project || project.deletedAt !== null) {
        sendJson(res, 404, {
          error: { code: "not_found", message: "Project not found." },
        });
        return;
      }
      if (project.organizationId !== principal.organization.id) {
        sendJson(res, 403, {
          error: { code: "forbidden", message: "Access denied." },
        });
        return;
      }
      try {
        await handler(req, res, params, projectId);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sendJson(
          res,
          message.includes("another editor") ||
            message.includes("revision before rendering") ||
            message.includes("Approve the AI direction") ||
            message.includes("changed after this direction") ||
            message.includes("already working")
            ? 409
            : 422,
          { error: { code: "invalid_state", message } },
        );
      }
    };
  router.add(
    "GET",
    base,
    guarded(async (req, res, _params, id) => {
      const subtitles = subtitleModeSchema
        .default("both")
        .parse(
          new URL(req.url!, "http://localhost").searchParams.get("subtitles") ??
            undefined,
        );
      sendJson(res, 200, await service.detail(id, subtitles));
    }),
  );
  router.add(
    "PUT",
    base,
    guarded(async (req, res, _params, id) => {
      const body = draftSchema.parse(await readJsonBody(req));
      await service.save(
        { ...body, projectId: id, revision: body.expectedRevision },
        body.expectedRevision,
      );
      sendJson(res, 200, await service.detail(id));
    }),
  );
  router.add(
    "GET",
    `${base}/recipes`,
    guarded(async (_req, res) => {
      sendJson(res, 200, [
        { id: "quiet-cinema", title: "Quiet Cinema" },
        { id: "memory-board", title: "Memory Board" },
        { id: "pulse-cut", title: "Pulse Cut" },
      ]);
    }),
  );
  router.add(
    "POST",
    `${base}/chapters/:chapterId/renders`,
    guarded(async (req, res, params, id) => {
      const body = revisionSchema.parse(await readJsonBody(req));
      sendJson(
        res,
        202,
        await service.render(
          id,
          getParam(params, "chapterId"),
          body.revision,
          body.subtitles,
        ),
      );
    }),
  );
  router.add(
    "POST",
    `${base}/assembly-renders`,
    guarded(async (req, res, _params, id) => {
      const body = revisionSchema.parse(await readJsonBody(req));
      sendJson(
        res,
        202,
        await service.render(id, null, body.revision, body.subtitles),
      );
    }),
  );
  router.add(
    "POST",
    `${base}/directions`,
    guarded(async (req, res, _params, id) => {
      const body = directionRequestSchema.parse(await readJsonBody(req));
      if (body.scope === "chapter" && !body.chapterId)
        throw new Error("Choose a Chapter for AI direction.");
      sendJson(res, 202, await service.requestDirection(id, body));
    }),
  );
  router.add(
    "PATCH",
    `${base}/directions/:directionId`,
    guarded(async (req, res, params, id) => {
      const body = directionUpdateSchema.parse(await readJsonBody(req));
      sendJson(
        res,
        200,
        await service.updateDirection(
          id,
          getParam(params, "directionId"),
          body.content,
        ),
      );
    }),
  );
  router.add(
    "POST",
    `${base}/directions/:directionId/approve`,
    guarded(async (req, res, params, id) => {
      const body = directionApproveSchema.parse(await readJsonBody(req));
      await service.approveDirection(
        id,
        getParam(params, "directionId"),
        body.expectedRevision,
      );
      sendJson(res, 200, await service.detail(id));
    }),
  );
  router.add(
    "POST",
    `${base}/scenes/:sceneId/original`,
    guarded(async (_req, res, params, id) => {
      const scene = await deps.scenes.findById(getParam(params, "sceneId"));
      if (!scene || scene.projectId !== id) {
        sendJson(res, 404, {
          error: { code: "not_found", message: "Scene not found." },
        });
        return;
      }
      const result = await markOriginalImageAdopted(deps, {
        sceneId: scene.id,
      });
      if (!result.ok) throw new Error(result.error.message);
      sendJson(res, 200, { sceneId: scene.id, selectedImageId: null });
    }),
  );
  router.add(
    "GET",
    `${base}/jobs/:jobId`,
    guarded(async (_req, res, params, id) => {
      const job = (await service.repository.jobs(id)).find(
        (j) => j.id === getParam(params, "jobId"),
      );
      sendJson(
        res,
        job ? 200 : 404,
        job ?? { error: { code: "not_found", message: "Job not found." } },
      );
    }),
  );
  router.add(
    "GET",
    `${base}/artifacts/:artifactId`,
    guarded(async (req, res, params, id) => {
      const job = (await service.repository.jobs(id)).find(
        (j) => j.id === getParam(params, "artifactId"),
      );
      if (!job || job.status !== "succeeded" || !job.artifactKey) {
        sendJson(res, 404, {
          error: { code: "not_found", message: "Film output not found." },
        });
        return;
      }
      const bytes = await deps.objectStorage.getObject(job.artifactKey);
      if (!bytes || digestBytes(bytes) !== job.artifactDigest)
        throw new Error("Film output is missing or damaged. Render again.");
      const data = Buffer.from(bytes);
      const download = new URL(req.url!, "http://localhost").searchParams.has(
        "download",
      );
      const headers = {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${job.chapterId ? "chapter" : "film"}-${job.id}.mp4"`,
      };
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start = match?.[1] ? Number(match[1]) : 0;
        let end = match?.[2] ? Number(match[2]) : data.length - 1;
        if (match && !match[1] && match[2]) {
          start = Math.max(0, data.length - Number(match[2]));
          end = data.length - 1;
        }
        if (
          !match ||
          (!match[1] && !match[2]) ||
          start > end ||
          start >= data.length
        ) {
          res.writeHead(416, { "content-range": `bytes */${data.length}` });
          res.end();
          return;
        }
        end = Math.min(end, data.length - 1);
        res.writeHead(206, {
          ...headers,
          "content-range": `bytes ${start}-${end}/${data.length}`,
          "content-length": end - start + 1,
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.writeHead(200, { ...headers, "content-length": data.length });
        res.end(data);
      }
    }),
  );
}
