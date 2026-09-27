import { execFileSync } from "node:child_process";

const workspaces = JSON.parse(
  execFileSync(
    "pnpm",
    ["list", "--recursive", "--prod", "--json", "--depth", "20"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  ),
);

const components = new Map();
const dependencyEdges = new Map();

for (const workspace of workspaces) {
  const workspaceRef = componentRef(workspace.name, workspace.version);
  addComponent(workspace.name, workspace.version, "application", workspaceRef);
  walkDependencies(workspaceRef, workspace.dependencies ?? {});
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "gen-story",
      version: "0.0.0",
      "bom-ref": componentRef("gen-story", "0.0.0"),
    },
  },
  components: [...components.values()].sort((a, b) =>
    a["bom-ref"].localeCompare(b["bom-ref"]),
  ),
  dependencies: [...dependencyEdges.entries()]
    .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
    .sort((a, b) => a.ref.localeCompare(b.ref)),
};

process.stdout.write(`${JSON.stringify(bom, null, 2)}\n`);

function walkDependencies(parentRef, dependencies) {
  const edges = dependencyEdges.get(parentRef) ?? new Set();
  dependencyEdges.set(parentRef, edges);

  for (const [name, dependency] of Object.entries(dependencies)) {
    const version = dependency.version ?? "unknown";
    const ref = componentRef(name, version);
    edges.add(ref);
    addComponent(
      name,
      version,
      version.startsWith("link:") ? "library" : "library",
      ref,
    );
    walkDependencies(ref, dependency.dependencies ?? {});
  }
}

function addComponent(name, version, type, ref) {
  if (components.has(ref)) return;
  const component = {
    type,
    name,
    version,
    "bom-ref": ref,
  };
  if (!version.startsWith("link:") && version !== "unknown") {
    component.purl = ref;
  }
  components.set(ref, component);
}

function componentRef(name, version) {
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}
