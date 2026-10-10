import type { RouteHandler, Router } from "./router";
import { getParam } from "./router";
import { bodyErrorStatus, readJsonBody, sendJson, HttpBodyError } from "./json";
import { errorBody, notFoundBody, unauthorizedBody } from "./errors";
import {
  hasValidCsrfToken,
  requiresCookieCsrf,
} from "../auth/firebase-session";
import { MediaError } from "../photos/upload-session";
import { UploadGrantSchema, MediaVariantSchema } from "./media-schemas";
import type { PrivateMediaService } from "../media/media-service";
import { z } from "zod";

export function addMediaRoutes(router: Router, media: PrivateMediaService) {
  const protect =
    (handler: RouteHandler): RouteHandler =>
    async (req, res, params, context) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!context.principal) {
        sendJson(res, 401, unauthorizedBody());
        return;
      }
      if (requiresCookieCsrf(req) && !hasValidCsrfToken(req)) {
        sendJson(res, 403, errorBody("forbidden", "Invalid CSRF token."));
        return;
      }
      try {
        await handler(req, res, params, context);
      } catch (error) {
        if (error instanceof MediaError)
          sendJson(
            res,
            error.code === "not_found"
              ? 404
              : error.code === "validation_error"
                ? 422
                : 409,
            error.code === "not_found"
              ? notFoundBody()
              : errorBody(error.code, error.message),
          );
        else if (error instanceof z.ZodError)
          sendJson(
            res,
            422,
            errorBody("validation_error", "Invalid media request."),
          );
        else if (error instanceof HttpBodyError)
          sendJson(
            res,
            bodyErrorStatus(error),
            errorBody("bad_request", "Invalid media request."),
          );
        else
          sendJson(
            res,
            500,
            errorBody("internal_error", "An unexpected error occurred."),
          );
      }
    };
  router.add(
    "POST",
    "/api/projects/:projectId/upload-grants",
    protect(async (req, res, params, ctx) => {
      const body = UploadGrantSchema.parse(await readJsonBody(req));
      sendJson(
        res,
        201,
        await media.issue(ctx.principal!, getParam(params, "projectId"), body),
      );
    }),
  );
  router.add(
    "POST",
    "/api/projects/:projectId/upload-sessions/:uploadId/complete",
    protect(async (req, res, params, ctx) => {
      // Empty body or an empty object is allowed; object keys are never accepted.
      if (
        Number(req.headers["content-length"] ?? 0) > 0 ||
        req.headers["transfer-encoding"] != null
      )
        z.object({})
          .strict()
          .parse(await readJsonBody(req));
      sendJson(
        res,
        202,
        await media.complete(
          ctx.principal!,
          getParam(params, "projectId"),
          getParam(params, "uploadId"),
        ),
      );
    }),
  );
  router.add(
    "GET",
    "/api/projects/:projectId/upload-sessions/:uploadId",
    protect(async (_req, res, params, ctx) => {
      sendJson(
        res,
        200,
        await media.status(
          ctx.principal!,
          getParam(params, "projectId"),
          getParam(params, "uploadId"),
        ),
      );
    }),
  );
  router.add(
    "DELETE",
    "/api/projects/:projectId",
    protect(async (_req, res, params, ctx) => {
      await media.deleteProject(ctx.principal!, getParam(params, "projectId"));
      res.writeHead(204);
      res.end();
    }),
  );
  router.add(
    "POST",
    "/api/projects/:projectId/restore",
    protect(async (_req, res, params, ctx) => {
      sendJson(
        res,
        200,
        await media.restoreProject(
          ctx.principal!,
          getParam(params, "projectId"),
        ),
      );
    }),
  );
  for (const [path, entity] of [
    ["photo-assets", "photo"],
    ["generated-images", "generated"],
    ["character-sheets", "character-sheet"],
  ] as const) {
    router.add(
      "GET",
      `/api/${path}/:entityId/media-url`,
      protect(async (req, res, params, ctx) => {
        const variant = MediaVariantSchema.parse(
          new URL(req.url!, "https://api.invalid").searchParams.get(
            "variant",
          ) ?? "preview",
        );
        sendJson(
          res,
          200,
          await media.url(
            ctx.principal!,
            entity,
            getParam(params, "entityId"),
            variant,
          ),
        );
      }),
    );
  }
}
