const host = process.env.FIRESTORE_EMULATOR_HOST;
if (
  !host ||
  !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) ||
  (process.env.GCLOUD_PROJECT != null &&
    process.env.GCLOUD_PROJECT !== "demo-gen-story")
) {
  throw new Error(
    "Mandatory Firestore contracts require a loopback demo-gen-story Emulator; skipped suites are not acceptance evidence.",
  );
}
