import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStoragePort } from "@gen-story/application";
import type { MediaUrlDto, UploadGrantDto } from "@gen-story/shared";
import { IMAGE_RESOURCE_LIMITS } from "../http/security-policy";

export type MediaObject = {
  key: string;
  size: number;
  lastModified: string | null;
};
export interface PrivateMediaStorage extends ObjectStoragePort {
  readBounded(key: string, maxBytes: number): Promise<Uint8Array | null>;
  head(
    key: string,
  ): Promise<{ size: number; contentType: string | null } | null>;
  list(
    prefix: string,
    cursor?: string,
  ): Promise<{ objects: MediaObject[]; cursor?: string }>;
}

export function createR2Client(config: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    ...config,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    region: "auto",
    requestHandler: { connectionTimeout: 3000, requestTimeout: 15_000 },
    maxAttempts: 2,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export class R2ObjectStorage implements PrivateMediaStorage {
  constructor(
    readonly client: S3Client,
    readonly bucket: string,
  ) {}

  async putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: "private, no-store",
      }),
    );
  }
  getObject(key: string) {
    return this.readBounded(key, IMAGE_RESOURCE_LIMITS.encodedBytes);
  }
  async readBounded(key: string, maxBytes: number): Promise<Uint8Array | null> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new Error("Invalid read limit.");
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${maxBytes}`,
        }),
      );
      const body = result.Body;
      if (!body) throw new Error("Missing object body.");
      const stream = body as AsyncIterable<Uint8Array> & {
        destroy?: () => void;
      };
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if ((result.ContentLength ?? 0) > maxBytes)
          throw new Error("Object exceeds byte limit.");
        for await (const chunk of stream) {
          size += chunk.byteLength;
          if (size > maxBytes) throw new Error("Object exceeds byte limit.");
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      } finally {
        stream.destroy?.();
      }
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
  async head(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  async list(prefix: string, cursor?: string) {
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: cursor,
        MaxKeys: 200,
      }),
    );
    if (result.IsTruncated && !result.NextContinuationToken)
      throw new Error("Missing object page cursor.");
    return {
      objects: (result.Contents ?? []).map((object) => ({
        key: object.Key!,
        size: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString() ?? null,
      })),
      ...(result.IsTruncated ? { cursor: result.NextContinuationToken! } : {}),
    };
  }
}

export class R2UploadGrantService {
  constructor(
    private readonly storage: R2ObjectStorage,
    private readonly clock = () => new Date(),
  ) {}
  async issue(input: {
    uploadId: string;
    key: string;
    mimeType: string;
    sha256: string;
    issuedAt?: string;
  }): Promise<UploadGrantDto> {
    const now = input.issuedAt ? new Date(input.issuedAt) : this.clock();
    const headers = {
      "Content-Type": input.mimeType,
      "x-amz-meta-sha256": input.sha256,
    };
    const url = await getSignedUrl(
      this.storage.client,
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: input.key,
        ContentType: input.mimeType,
        Metadata: { sha256: input.sha256 },
      }),
      {
        expiresIn: 600,
        signingDate: now,
        signableHeaders: new Set(["content-type", "x-amz-meta-sha256"]),
        unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
      },
    );
    return {
      uploadId: input.uploadId,
      method: "PUT",
      url,
      headers,
      expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    };
  }
  async read(
    key: string,
    downloadName?: string,
    head = false,
  ): Promise<MediaUrlDto> {
    const now = this.clock();
    const command = head
      ? new HeadObjectCommand({ Bucket: this.storage.bucket, Key: key })
      : new GetObjectCommand({
          Bucket: this.storage.bucket,
          Key: key,
          ResponseCacheControl: "private, no-store",
          ...(downloadName
            ? {
                ResponseContentDisposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(downloadName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
              }
            : {}),
        });
    const url = await getSignedUrl(this.storage.client, command, {
      expiresIn: 300,
      signingDate: now,
    });
    return {
      method: head ? "HEAD" : "GET",
      url,
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    };
  }
}
function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      ("$metadata" in error &&
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode ===
          404))
  );
}
