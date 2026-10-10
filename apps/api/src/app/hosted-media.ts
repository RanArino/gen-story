export function readR2StorageConfig(env: NodeJS.ProcessEnv) {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucket = env.R2_BUCKET_NAME;
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId))
    throw new Error(
      "R2_ACCOUNT_ID must identify the Gen Story Cloudflare account.",
    );
  const expected =
    env.FIRESTORE_DATABASE_ID === "gen-story-staging"
      ? "gen-story-staging-media"
      : env.FIRESTORE_DATABASE_ID === "gen-story-production"
        ? "gen-story-production-media"
        : null;
  if (!expected || bucket !== expected)
    throw new Error("R2 bucket must match the explicit Firestore environment.");
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
    throw new Error("R2 runtime credentials are required.");
  return {
    accountId,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
}

export function readR2Config(env: NodeJS.ProcessEnv) {
  const config = readR2StorageConfig(env);
  const origins = env.R2_CORS_ORIGINS?.split(",").map((origin) =>
    origin.trim(),
  );
  if (
    !origins?.length ||
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          url.origin !== origin ||
          url.hostname.includes("*") ||
          (url.protocol !== "https:" &&
            !(
              config.bucket === "gen-story-staging-media" &&
              env.R2_ALLOW_STAGING_LOCALHOST === "true" &&
              origin === "http://localhost:3000"
            ))
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error("Exact approved R2 browser origins are required.");
  return { ...config, origins };
}
