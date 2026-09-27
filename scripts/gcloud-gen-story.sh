#!/usr/bin/env bash

set -euo pipefail

# Keep the Google Cloud project scoped to this invocation. Do not use
# `gcloud config set project` here: that setting is shared with other
# repositories on the same machine.
readonly PROJECT_ID="gen-story-496911"

for argument in "$@"; do
  case "$argument" in
    --project|--project=*)
      echo "Do not pass --project to this command; it is fixed to ${PROJECT_ID}." >&2
      exit 2
      ;;
  esac
done

exec gcloud "--project=${PROJECT_ID}" "$@"
