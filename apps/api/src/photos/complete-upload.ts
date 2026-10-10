import { calculateSha256Hex } from "../storage/checksum";
import { IMAGE_RESOURCE_LIMITS } from "../http/security-policy";
import type { PrivateMediaStorage } from "../storage/r2-object-storage";
import { uploadManifest } from "../storage/r2-storage-keys";
import type { BoundedImageDecoder } from "./bounded-image-decoder";
import { MediaError, type UploadSessionRepository } from "./upload-session";

export async function executeUploadCompletion(input: {
  uploadId: string;
  executorId: string;
  sessions: UploadSessionRepository;
  storage: PrivateMediaStorage;
  decoder: BoundedImageDecoder;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  const claim = await input.sessions.claim(
    input.uploadId,
    input.executorId,
    clock().toISOString(),
  );
  if (!claim) return { status: "not_claimed" as const };
  const session = claim.session;
  try {
    let snapshot: Uint8Array | null;
    try {
      snapshot = await input.storage.readBounded(
        session.temporaryKey,
        IMAGE_RESOURCE_LIMITS.encodedBytes,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Object exceeds byte limit."
      )
        throw new MediaError("validation_error");
      throw error;
    }
    if (
      !snapshot ||
      snapshot.length !== session.size ||
      calculateSha256Hex(snapshot) !== session.sha256
    )
      throw new MediaError("validation_error", "Source validation failed.");
    const decoded = await input.decoder.decode(snapshot);
    if (decoded.mimeType !== session.mimeType)
      throw new MediaError("validation_error", "Source type mismatch.");
    const manifest = uploadManifest(
      session.userId,
      session.projectId,
      session.id,
      claim.token,
      decoded.extension,
    );
    await input.sessions.writeIntent(claim, manifest, clock().toISOString());
    // These writes use the validated snapshot, never a second temporary GET/copy.
    await input.storage.putObject({
      key: manifest.original,
      body: snapshot,
      contentType: decoded.mimeType,
    });
    await input.sessions.writeIntent(claim, manifest, clock().toISOString());
    await input.storage.putObject({
      key: manifest.preview,
      body: decoded.preview,
      contentType: "image/jpeg",
    });
    await input.sessions.writeIntent(claim, manifest, clock().toISOString());
    await input.storage.putObject({
      key: manifest.agentPreview,
      body: decoded.agentPreview,
      contentType: "image/jpeg",
    });
    const photo = await input.sessions.publish(
      claim,
      decoded,
      clock().toISOString(),
    );
    // Cleanup failure cannot reverse publication; manifests allow later purge.
    try {
      await input.storage.deleteObject(session.temporaryKey);
    } catch {
      /* Retry through media cleanup. */
    }
    return { status: "completed" as const, photo };
  } catch (error) {
    // An uncertain transaction result is resolved before touching its outputs.
    const durable = await input.sessions.find(session.id);
    if (durable?.status === "completed")
      return { status: "completed" as const };
    if (error instanceof MediaError && error.code !== "lost_claim") {
      await input.sessions.fail(
        claim,
        error.code === "conflict" ? "duplicate_source" : "invalid_source",
        clock().toISOString(),
      );
      if (claim.session.manifest) {
        for (const key of Object.values(claim.session.manifest))
          await input.storage.deleteObject(key);
      }
      return { status: "failed" as const };
    }
    if (!(error instanceof MediaError && error.code === "lost_claim"))
      await input.sessions.release(claim);
    throw new Error("Upload execution interrupted; retry persisted work.");
  }
}
