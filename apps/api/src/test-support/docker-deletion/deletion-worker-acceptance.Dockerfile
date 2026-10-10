# Acceptance-only layer over the production deletion worker image.
FROM gen-story-deletion-worker:hp44
COPY apps/api/src/test-support/docker-deletion/worker-entry.ts apps/api/src/test-support/docker-deletion/worker-entry.ts
COPY apps/api/src/test-support/docker-deletion/local-task-queue.ts apps/api/src/test-support/docker-deletion/local-task-queue.ts
COPY apps/api/src/test-support/docker-deletion/task-tokens.ts apps/api/src/test-support/docker-deletion/task-tokens.ts
CMD ["node", "--import", "tsx", "apps/api/src/test-support/docker-deletion/worker-entry.ts"]
