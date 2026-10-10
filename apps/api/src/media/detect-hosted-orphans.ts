import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readHostedDatabaseConfig } from "../app/hosted-persistence";
import { readR2StorageConfig } from "../app/hosted-media";
import { createFirestoreClient } from "../firestore/repositories";
import { createR2Client, R2ObjectStorage } from "../storage/r2-object-storage";
import { detectMediaOrphans } from "./detect-media-orphans";

const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
if (process.argv.length !== 2)
  throw new Error("Hosted orphan reporting accepts no mutation flags.");
const persistence = readHostedDatabaseConfig(process.env);
const config = readR2StorageConfig(process.env);
const db = createFirestoreClient(persistence);
const client = createR2Client(config);
try {
  const storage = new R2ObjectStorage(client, config.bucket);
  const findings = await detectMediaOrphans({
    db,
    storage: {
      list: storage.list.bind(storage),
      head: storage.head.bind(storage),
    },
    now: new Date().toISOString(),
  });
  console.log(JSON.stringify({ findings }));
} finally {
  client.destroy();
  await db.terminate();
}
