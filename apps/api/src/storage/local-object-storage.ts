import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import * as path from "node:path";

import type { ObjectStoragePort } from "@gen-story/application";

const STORAGE_KEY_PREFIX = "data/uploads/";

export class LocalObjectStorage implements ObjectStoragePort {
  constructor(private readonly repositoryRoot: string = process.cwd()) {}

  async putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    const filePath = this.resolveKey(input.key);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const filePath = this.resolveKey(key);

    try {
      return await readFile(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.resolveKey(key);

    await rm(filePath, { force: true });
  }

  private resolveKey(key: string): string {
    assertValidStorageKey(key);

    const resolvedRepositoryRoot = resolve(this.repositoryRoot);
    const resolvedPath = resolve(
      resolvedRepositoryRoot,
      ...key.split("/").filter(Boolean),
    );
    const resolvedUploadsRoot = resolve(
      resolvedRepositoryRoot,
      "data",
      "uploads",
    );

    if (
      resolvedPath !== resolvedUploadsRoot &&
      !resolvedPath.startsWith(`${resolvedUploadsRoot}${sep}`)
    ) {
      throw new Error("Storage key resolves outside the uploads directory.");
    }

    return resolvedPath;
  }
}

export function assertValidStorageKey(key: string): void {
  if (key.length === 0) {
    throw new Error("Storage key must not be empty.");
  }

  if (key !== key.trim()) {
    throw new Error("Storage key must not contain surrounding whitespace.");
  }

  if (isAbsolute(key)) {
    throw new Error("Storage key must not be an absolute path.");
  }

  if (key.includes("\\")) {
    throw new Error("Storage key must use forward slashes.");
  }

  const normalizedKey = path.posix.normalize(key);

  if (normalizedKey !== key || normalizedKey.includes("..")) {
    throw new Error("Storage key must not contain traversal segments.");
  }

  if (!key.startsWith(STORAGE_KEY_PREFIX) || key === STORAGE_KEY_PREFIX) {
    throw new Error("Storage key must start with data/uploads/.");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
