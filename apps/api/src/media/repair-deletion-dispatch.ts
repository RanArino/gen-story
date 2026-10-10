import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readDeletionDispatchConfig } from "../app/deletion-dispatch-config";
import { FirestoreDeletionDispatch } from "../firestore/deletion-dispatch";
import { createFirestoreClient } from "../firestore/repositories";
import { CloudTasksWorkDispatch } from "../jobs/cloud-tasks-dispatch";

const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const args = process.argv.slice(2);
if (
  args.length &&
  !(
    args.length === 2 &&
    args[0] === "--retry-exhausted" &&
    /^[A-Za-z0-9_-]{1,200}$/.test(args[1]!)
  )
)
  throw new Error(
    "Use no arguments for repair, or --retry-exhausted <deletionId> for approved operator recovery.",
  );
const config = readDeletionDispatchConfig(process.env);
const db = createFirestoreClient(config);
const queue = new CloudTasksWorkDispatch({
  ...config,
  callerEmail: config.taskCaller.email,
});
const dispatch = new FirestoreDeletionDispatch(db, queue);
try {
  if (args.length) await dispatch.retryExhausted(args[1]!);
  else {
    const result = await dispatch.repair();
    console.log(JSON.stringify(result));
    if (result.failed || result.yielded) process.exitCode = 1;
  }
} finally {
  await Promise.all([db.terminate(), queue.close()]);
}
