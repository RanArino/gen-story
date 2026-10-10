import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createDeletionWorkerContext } from "./app/deletion-worker-context";
import { createDeletionTaskHandler } from "./http/deletion-task-handler";

export async function startDeletionWorker(
  env: NodeJS.ProcessEnv = process.env,
) {
  const context = createDeletionWorkerContext(env);
  const server = createServer(
    createDeletionTaskHandler({
      ...context,
      log: (entry) => console.log(JSON.stringify(entry)),
    }),
  );
  server.headersTimeout = 15_000;
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 5000;
  server.timeout = 300_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(env.PORT ?? env.API_PORT ?? 4001), "0.0.0.0", resolve);
  }).catch(async (error) => {
    await context.close();
    throw error;
  });
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await context.close();
  };
  return { server, close };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const worker = await startDeletionWorker();
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      void worker.close().then(() => process.exit(0));
    });
}
