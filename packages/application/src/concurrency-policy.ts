// Image generation requests and text/vision AI jobs share one per-project cap,
// because they compete for the same upstream model quota and the same local
// worker.
//
// Enforcement lives in the worker, against its own in-flight set rather than
// against `running` rows: the worker no longer waits for a job it started, so a
// database count would not yet include jobs dispatched moments ago and the cap
// would be exceeded on every scan.
export const MAX_CONCURRENT_PER_PROJECT = 5;
