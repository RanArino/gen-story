# Single-File POC Instructions

These instructions apply to files under `scripts/poc/`.

- Keep POCs isolated from the app runtime and workspace package graph.
- Prefer one self-contained file per experiment.
- Do not add packages to root `package.json`, app/package manifests, Python environments, or lockfiles for a POC unless the user explicitly approves it.
- Prefer language standard libraries for network calls, file IO, and argument parsing.
- Write generated outputs under `scripts/poc/output/`, which is gitignored.
- Do not import application code from `apps/*` or `packages/*` unless the POC is explicitly testing that integration.
- If a POC requires third-party dependencies, document the requirement in the POC file and ask before installing anything.
