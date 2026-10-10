import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TaskAuthenticator, TaskCaller } from "../auth/task-oidc";
import { executeMediaDeletion } from "../media/execute-media-deletion";
import { readJsonBody, sendJson } from "./json";

const WorkSchema = z
  .object({
    workType: z.literal("media_deletion"),
    workId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  })
  .strict();
type Outcome = Awaited<ReturnType<typeof executeMediaDeletion>>;
export function createDeletionTaskHandler(input: {
  auth: Pick<TaskAuthenticator, "authenticate">;
  taskCaller: TaskCaller;
  schedulerCaller: TaskCaller;
  execute: (id: string, executorId: string) => Promise<Outcome>;
  repair: () => Promise<{ examined: number; failed: number; yielded: boolean }>;
  log?: (entry: {
    route: string;
    status: number;
    outcome: string;
    durationMs: number;
  }) => void;
}) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const start = Date.now();
    const path = req.url;
    const respond = (status: number, outcome: string) => {
      input.log?.({
        route:
          path === "/internal/tasks/work"
            ? "/internal/tasks/work"
            : "/internal/tasks/deletion-dispatch/repair",
        status,
        outcome,
        durationMs: Date.now() - start,
      });
      if (status === 204) {
        res.writeHead(204);
        res.end();
      } else sendJson(res, status, { status: outcome });
    };
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "gen-story-deletion-worker",
      });
      return;
    }
    if (
      req.method !== "POST" ||
      ![
        "/internal/tasks/work",
        "/internal/tasks/deletion-dispatch/repair",
      ].includes(path ?? "")
    ) {
      sendJson(res, 404, { status: "not_found" });
      return;
    }
    const work = path === "/internal/tasks/work";
    if (
      !(await input.auth.authenticate(
        req,
        work ? input.taskCaller : input.schedulerCaller,
      ))
    ) {
      respond(401, "unauthorized");
      return;
    }
    let id: string | undefined;
    try {
      const body = await readJsonBody(req, 4096);
      if (work) id = WorkSchema.parse(body).workId;
      else z.object({}).strict().parse(body);
    } catch {
      respond(400, "bad_request");
      return;
    }
    try {
      if (work) {
        const result = await input.execute(id!, randomUUID());
        respond(
          ["completed", "canceled", "missing"].includes(result.status)
            ? 204
            : 503,
          result.status,
        );
      } else {
        const result = await input.repair();
        respond(
          result.failed || result.yielded ? 503 : 204,
          result.failed
            ? "repair_interrupted"
            : result.yielded
              ? "repair_yielded"
              : "repaired",
        );
      }
    } catch {
      respond(503, "interrupted");
    }
  };
}
