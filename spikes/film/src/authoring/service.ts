// The one typed authoring service. The CLI and the Tool Calling adapter call only this module.
// Mutating operations default to dry run and require a matching operator approval to write.
import { resolveChapterCache } from "../render/cache.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { digestOf } from "../contracts/canonical.js";
import { envelope, envelopeAsync, type Mutation, type ResultEnvelope } from "../contracts/envelope.js";
import { fail, filmError, FilmFailure } from "../contracts/errors.js";
import { validateSchema, type SchemaKind } from "../contracts/schemas.js";
import { validateDocument, type SemanticContext } from "../contracts/semantic.js";
import type {
  CapabilityManifest,
  ChapterArtifact,
  ConcatPlan,
  Cut,
  ExactRef,
  FilmChapters,
  FilmStyleRecipe,
  FilmTreatment,
  FontAssetManifest,
  RequiredSlot,
  ResolvedRenderPlan,
  StoryGraph,
  VersionRef,
} from "../contracts/types.js";
import { planPromotion, promoteCandidate, quarantinedEntry, runCandidate, scaffold, staticCheck } from "../candidates/candidate.js";
import { candidateEvidence } from "../candidates/evidence.js";
import type { CapabilityRequest } from "../contracts/types.js";
import { loadImplementation } from "../capabilities/loader.js";
import { compileChapters, preflightChapters, type CompileInput, type FontCatalog, type FontEntry } from "../compiler/compile.js";
import { buildConcatPlan, CONNECTION } from "../compiler/concat.js";
import { planDigest, renderDigest } from "../compiler/fingerprint.js";
import { frameCount } from "../compiler/timing.js";
import { resolveRecipe, type Catalog, type CatalogEntry } from "../compiler/resolve.js";
import { readFingerprint, type EnvFingerprint } from "../env/fingerprint.js";
import { grammarMetrics } from "../evaluation/grammar.js";
import { writeFixtureFonts } from "../fonts/fixtures.js";
import { inspectFont, planFontPromotion, promoteFont, quarantineFont, type FontDraft } from "../fonts/fonts.js";
import { glyphChars, JA_SAMPLE_SET, LATIN_SAMPLE_SET } from "../fonts/samples.js";
import { readMediaLock } from "../media/lock.js";
import { writeJson, type SpikePaths } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import { bootstrapBuiltins } from "../registry/bootstrap.js";
import { Registry } from "../registry/registry.js";
import { prepareReview, type ReviewInput } from "../registry/reviews.js";
import { renderConcat, requireConcatPlan } from "../render/concat.js";
import { contactSheet } from "../render/contact-sheet.js";
import { verifyAudio } from "../render/inputs.js";
import { loadChapterPlan, renderChapter, type RenderChapterInput, type RenderDeps } from "../render/render-chapter.js";
import { compilerIdentity, painterIdentity } from "./identity.js";

export interface ServiceDeps {
  paths: SpikePaths;
  /** The pinned environment fingerprint; defaults to out/env.json written by `doctor`. */
  environment?: () => EnvFingerprint;
  /** The environment rendering runs in now; defaults to a fresh `readFingerprint()`. */
  liveEnvironment?: () => EnvFingerprint;
}

export interface CompileOptions {
  forceLevel0?: boolean;
  reducedMotion?: boolean;
}

/** A Recipe fork: replacements are exact versions, pinned to their registry digests at fork time. */
export interface RecipeForkInput {
  source: { id: string; revision: string };
  id: string;
  revision?: string;
  title?: string;
  description?: string;
  slots?: Partial<Record<RequiredSlot, VersionRef>>;
  fonts?: Partial<Record<"caption" | "title", VersionRef>>;
  effects?: VersionRef[];
  dryRun?: boolean;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => `${e.parentPath}/${e.name}`)
    .sort();
}

export function createService(deps: ServiceDeps) {
  const { paths } = deps;
  const registry = new Registry(paths.state);
  const renderDeps: RenderDeps = { paths, liveEnvironment: deps.liveEnvironment ?? (() => readFingerprint()) };

  const environment = (): EnvFingerprint => {
    if (deps.environment) return deps.environment();
    const path = `${paths.out}env.json`;
    if (!existsSync(path)) fail("FS_ENV_MISMATCH", "", "no pinned environment fingerprint; run `film-spike doctor` first");
    return readJson<EnvFingerprint>(path);
  };

  // --- lookups ---------------------------------------------------------------------------------

  const findStoryGraph = (ref: { id: string; revision: number }): StoryGraph => {
    for (const file of jsonFiles(`${paths.fixtures}project`)) {
      const doc = readJson<Partial<StoryGraph>>(file);
      if (doc.schema === "film.story-graph@1" && doc.id === ref.id && doc.revision === ref.revision) return doc as StoryGraph;
    }
    return fail("FS_SEMANTIC_INVALID", "/storyGraph", `Story Graph ${ref.id} revision ${ref.revision} was not found`);
  };

  const findRecipe = (ref: { id: string; revision: string; digest?: string }, path = "/recipe"): FilmStyleRecipe => {
    for (const file of [...jsonFiles(`${paths.fixtures}recipes`), ...jsonFiles(`${paths.state}recipes`)]) {
      const doc = readJson<Partial<FilmStyleRecipe>>(file);
      if (doc.schema !== "film.film-style-recipe@1" || doc.id !== ref.id || doc.revision !== ref.revision) continue;
      if (ref.digest && digestOf(doc) !== ref.digest) fail("FS_DIGEST_MISMATCH", `${path}/digest`, `${ref.id}@${ref.revision} is ${digestOf(doc)}, not ${ref.digest}`);
      return doc as FilmStyleRecipe;
    }
    return fail("FS_NOT_PROMOTED", path, `Recipe ${ref.id}@${ref.revision} was not found`);
  };

  const findTreatment = (ref: { id: string; revision: number }): FilmTreatment => {
    for (const file of jsonFiles(`${paths.fixtures}project/treatments`)) {
      const doc = readJson<Partial<FilmTreatment>>(file);
      if (doc.schema === "film.film-treatment@1" && doc.id === ref.id && doc.revision === ref.revision) return doc as FilmTreatment;
    }
    return fail("FS_SEMANTIC_INVALID", "/treatment", `Treatment ${ref.id} revision ${ref.revision} was not found`);
  };

  const fontLookup = (ref: VersionRef): FontAssetManifest | undefined => {
    const record = registry.record(ref.id, ref.version);
    return record?.entity === "font" ? registry.manifest<FontAssetManifest>(record) : undefined;
  };

  const capabilityCatalog = (refs: ExactRef[], candidate?: CatalogEntry): Catalog => {
    const entries = new Map<string, CatalogEntry>();
    const follow = (manifest: CapabilityManifest) => {
      // Follow declared safety-fallback edges by exact version; missing edges are reported by the resolver.
      if (!manifest.fallback) return;
      const next = registry.record(manifest.fallback.id, manifest.fallback.version);
      if (next?.entity === "capability") add(next);
    };
    const add = (record: NonNullable<ReturnType<Registry["record"]>>) => {
      const key = `${record.id}@${record.version}`;
      if (entries.has(key)) return;
      const manifest = registry.manifest<CapabilityManifest>(record);
      entries.set(key, { record, manifest, run: loadImplementation(record, { registry, scratchDir: `${paths.state}cache/capabilities/` }) });
      follow(manifest);
    };
    if (candidate) {
      entries.set(`${candidate.manifest.id}@${candidate.manifest.version}`, candidate);
      follow(candidate.manifest);
    }
    const errors = [];
    for (const ref of refs) {
      try {
        add(registry.resolve(ref).record);
      } catch (error) {
        if (error instanceof FilmFailure) errors.push(...error.errors);
        else throw error;
      }
    }
    if (errors.length) throw new FilmFailure(errors);
    return { get: (id, version) => entries.get(`${id}@${version}`) };
  };

  const fontCatalog = (refs: { ref: ExactRef; path: string }[]): FontCatalog => {
    const entries = new Map<string, FontEntry>();
    const add = (ref: ExactRef, path: string) => {
      const key = `${ref.id}@${ref.version}`;
      if (entries.has(key)) return;
      const { record, manifest } = registry.resolve<FontAssetManifest>(ref, "compile", path);
      if (record.entity !== "font") fail("FS_FONT_MISSING", path, `${key} is not a font`);
      entries.set(key, { record, manifest });
      manifest.fallback.forEach((f, i) => add(f, `${path}/fallback/${i}`));
    };
    refs.forEach(({ ref, path }) => add(ref, path));
    return { get: (id, version) => entries.get(`${id}@${version}`) };
  };

  const samples = (): Record<string, readonly string[]> => {
    const graph = readJson<StoryGraph>(`${paths.fixtures}project/story-graph.json`);
    const chapters = readJson<FilmChapters>(`${paths.fixtures}project/chapters.json`);
    const ja = graph.scenes.map((s) => s.caption.ja).join("") + chapters.chapters.map((c) => c.title).join("");
    const en = graph.scenes.map((s) => s.caption.en).join("");
    return {
      Latn: [...new Set([...LATIN_SAMPLE_SET, ...glyphChars(en)])],
      Jpan: [...new Set([...JA_SAMPLE_SET, ...glyphChars(ja)])],
    };
  };

  // --- compile inputs ----------------------------------------------------------------------------

  /** With a quarantined candidate, its kind's slot in the Treatment's Recipe is replaced in memory only. */
  const compileInput = (treatment: FilmTreatment, chapters: FilmChapters, options: CompileOptions, candidate?: CatalogEntry): CompileInput => {
    const errors = [
      ...validateDocument("film-treatment", treatment),
      ...validateDocument("chapters", chapters),
    ];
    if (errors.length) throw new FilmFailure(errors);
    const storyGraph = findStoryGraph(treatment.storyGraph);
    const found = findRecipe(treatment.recipe);
    if (candidate && !found.capabilities.some((c) => c.slot === candidate.manifest.kind)) fail("FS_SEMANTIC_INVALID", "/candidate", `the Recipe has no ${candidate.manifest.kind} slot`);
    const recipe: FilmStyleRecipe = candidate
      ? { ...found, capabilities: found.capabilities.map((c) => (c.slot === candidate.manifest.kind ? { slot: c.slot, ref: { id: candidate.manifest.id, version: candidate.manifest.version, digest: candidate.record.manifestDigest } } : c)) }
      : found;
    const ctx: SemanticContext = { storyGraph, recipe, font: fontLookup };
    const semantic = [
      ...validateDocument("story-graph", storyGraph),
      ...validateDocument("film-style-recipe", recipe, ctx),
      ...validateDocument("film-treatment", treatment, ctx),
      ...validateDocument("chapters", chapters, ctx),
    ];
    if (semantic.length) throw new FilmFailure(semantic);
    if (chapters.storyGraph.id !== treatment.storyGraph.id || chapters.storyGraph.revision !== treatment.storyGraph.revision) {
      fail("FS_SEMANTIC_INVALID", "/storyGraph", "chapters and Treatment reference different Story Graph revisions");
    }
    const refs = [...recipe.capabilities.map((c) => c.ref), ...recipe.effects].filter((r) => !candidate || r.id !== candidate.manifest.id || r.version !== candidate.manifest.version);
    const fontRefs = [
      { ref: treatment.shared.typography, path: "/shared/typography" },
      ...recipe.fonts.map((f, i) => ({ ref: f.ref, path: `/fonts/${i}/ref` })),
      ...treatment.projectFonts.map((ref, i) => ({ ref, path: `/projectFonts/${i}` })),
    ];
    return {
      storyGraph,
      chapters,
      treatment,
      recipe,
      recipeDigest: digestOf(recipe),
      catalog: capabilityCatalog(refs, candidate),
      fonts: fontCatalog(fontRefs),
      media: readMediaLock(paths.media),
      environmentDigest: digestOf(environment()),
      compiler: compilerIdentity(),
      painter: painterIdentity(),
      options: { forceLevel0: options.forceLevel0 ?? false, reducedMotion: options.reducedMotion ?? false },
    };
  };

  const checkPlan = (kind: "resolved-render-plan" | "concat-plan", plan: unknown) => {
    const errors = validateSchema(`urn:film-spike:${kind}`, plan);
    if (errors.length) throw new FilmFailure(errors.map((e) => ({ ...e, owner: "system" as const, message: `compiled ${kind} is invalid: ${e.message}` })));
  };

  const activationOp = (operation: string, act: () => boolean | object, target: string, digest: string, approvalId: string | undefined, dryRun: boolean) =>
    envelope(operation, dryRun, () => {
      requireApproval(paths.state, approvalId, "promotion", digest);
      if (dryRun) return { hashes: { target: digest } };
      const changed = act();
      return { result: changed, mutations: changed ? [{ kind: operation, target, beforeDigest: digest, afterDigest: digest }] : [] };
    });

  const exactRecord = (id: string, version: string) => {
    const record = registry.record(id, version);
    if (!record) fail("FS_NOT_PROMOTED", "", `${id}@${version} is not a promoted registry entry`);
    return record;
  };

  /** Media is looked up through `artifactOf` only after every selected Plan is known to be current. */
  const buildConcat = <T extends { plan: ResolvedRenderPlan }>(treatment: FilmTreatment, chapters: FilmChapters, supplied: T[], artifactOf: (selected: T) => Pick<ChapterArtifact, "files">): ConcatPlan => {
    const expected = compileChapters(compileInput(treatment, chapters, supplied.find(a => chapters.chapters.some(c => c.id === a.plan.chapter.id))?.plan.options ?? {}));
    const current = expected.map(({ plan }) => {
      const matches = supplied.filter(a => a.plan.chapter.id === plan.chapter.id);
      if (matches.length !== 1) fail("FS_SEMANTIC_INVALID", "/chapters", `${plan.chapter.id} needs exactly one selected Plan; found ${matches.length}`);
      const selected = matches[0]!;
      if (renderDigest(selected.plan) !== renderDigest(plan)) fail("FS_SEMANTIC_INVALID", "/chapters", `${plan.chapter.id} has stale scene membership, title, settings, dependencies, or profile; recompile it`);
      return { selected, plan };
    });
    const artifacts = current.map(({ selected, plan }) => ({ plan, artifact: artifactOf(selected) }));
    const recipe = findRecipe(treatment.recipe);
    const typography = artifacts[0]?.plan.capabilities.find((c) => c.slot === "typography")?.active;
    const refs: ExactRef[] = [CONNECTION, ...(typography ? [typography] : [])].map((r) => ({ ...r, digest: exactRecord(r.id, r.version).manifestDigest }));
    const plan = buildConcatPlan({
      chapters: artifacts.map((a) => ({ plan: a.plan, planDigest: planDigest(a.plan), artifactSha256: a.artifact.files.mp4.sha256, stemSha256: a.artifact.files.stem.sha256, frames: frameCount(a.plan.timing.proposal.runtimeMs, a.plan.profile.fps) })),
      treatment,
      recipe,
      catalog: capabilityCatalog(refs),
      fonts: fontCatalog(artifacts[0]!.plan.lock.fonts.map((f, i) => ({ ref: { id: f.id, version: f.version, digest: f.manifestDigest }, path: `/lock/fonts/${i}` }))),
      media: readMediaLock(paths.media),
      environmentDigest: digestOf(environment()),
      compiler: compilerIdentity(),
      painter: painterIdentity(),
    });
    checkPlan("concat-plan", plan);
    return plan;
  };

  return {
    registry,

    validate(input: { kind: SchemaKind; document: unknown }): ResultEnvelope<{ valid: boolean }> {
      return envelope("validate", true, () => {
        const schemaErrors = validateSchema(`urn:film-spike:${input.kind}`, input.document);
        if (schemaErrors.length) throw new FilmFailure(schemaErrors);
        const doc = input.document as Record<string, unknown>;
        const ctx: SemanticContext = { font: fontLookup };
        if (input.kind === "chapters" || input.kind === "film-treatment") {
          const ref = doc.storyGraph as { id: string; revision: number } | undefined;
          if (ref) ctx.storyGraph = findStoryGraph(ref);
        }
        if (input.kind === "film-treatment") ctx.recipe = findRecipe(doc.recipe as FilmTreatment["recipe"]);
        if (input.kind === "cut") ctx.recipe = findRecipe(findTreatment((doc as unknown as Cut).treatment).recipe);
        const errors = validateDocument(input.kind, input.document, ctx);
        if (errors.length) throw new FilmFailure(errors);
        return { result: { valid: true }, hashes: { document: digestOf(input.document) } };
      });
    },

    /** CLI only: registers engine-native Capabilities. */
    bootstrap(): ResultEnvelope<{ records: number }> {
      return envelope("bootstrap", false, () => {
        const mutations = bootstrapBuiltins(registry, paths.media);
        return { result: { records: registry.records().length }, mutations };
      });
    },

    candidateScaffold(input: { request: CapabilityRequest; approvalId?: string; dryRun?: boolean }) {
      return envelope("candidate.scaffold", input.dryRun ?? true, () => {
        const result = scaffold(paths, input);
        return {
          result, hashes: { request: result.requestDigest },
          mutations: result.created ? [{ kind: "candidate.scaffold", target: result.candidate, beforeDigest: null, afterDigest: result.requestDigest }] : [],
        };
      });
    },

    candidateStaticCheck(input: { candidate: string; dryRun?: boolean }) {
      const dryRun = input.dryRun ?? false;
      return envelope("candidate.staticCheck", dryRun, () => {
        const result = staticCheck(paths, registry, input.candidate, !dryRun);
        return { result, hashes: { execution: result.executionDigest }, evidence: dryRun ? [] : [`.state/quarantine/capabilities/${input.candidate}/static.json`, `.state/quarantine/capabilities/${input.candidate}/source.diff`] };
      });
    },

    candidateRun(input: { candidate: string; approvalId?: string; dryRun?: boolean }) {
      return envelope("candidate.run", input.dryRun ?? true, () => {
        const result = runCandidate(paths, registry, input);
        return { result, hashes: { execution: result.executionDigest }, evidence: result.report ? [`.state/quarantine/capabilities/${input.candidate}/runtime.json`] : [] };
      });
    },

    /**
     * Compiles a Treatment with the quarantined candidate in its kind's slot, without executing it:
     * resolution (compatibility) under default options, then full Chapter compiles under
     * reducedMotion and forceLevel0 wherever the safety fallback replaces the candidate.
     */
    candidateCompile(input: { candidate: string; treatment: FilmTreatment; chapters: FilmChapters; dryRun?: boolean }) {
      const dryRun = input.dryRun ?? false;
      return envelope("candidate.compile", dryRun, () => {
        const { entry, executionDigest, dir } = quarantinedEntry(paths, registry, input.candidate);
        const key = (m: CapabilityManifest) => `${m.id}@${m.version}`;
        const variants = ([{}, { reducedMotion: true }, { forceLevel0: true }] as CompileOptions[]).map((options) => {
          const ci = compileInput(input.treatment, input.chapters, options, entry);
          const resolved = resolveRecipe(ci.recipe, ci.catalog, { ...ci.options, profile: input.treatment.shared.outputProfile }).slots.find((s) => s.slot === entry.manifest.kind)!;
          const active = resolved.active.manifest;
          const summary = { options: ci.options, requested: key(entry.manifest), active: key(active), activeLevel: active.level, chain: resolved.chain.map((c) => key(c.manifest)) };
          if (key(active) === key(entry.manifest)) return { ...summary, compiled: false, plans: [] };
          const plans = compileChapters(ci).map(({ plan }) => {
            checkPlan("resolved-render-plan", plan);
            const slot = plan.capabilities.find((c) => c.slot === entry.manifest.kind)!;
            if (`${slot.active.id}@${slot.active.version}` !== key(active)) throw new Error("internal: compiled Plan disagrees with resolution");
            return { chapter: plan.chapter.id, planDigest: planDigest(plan) };
          });
          return { ...summary, compiled: true, plans };
        });
        const report = {
          candidate: input.candidate,
          ok: true,
          subject: { id: entry.manifest.id, version: entry.manifest.version, digest: executionDigest },
          treatment: { id: input.treatment.id, revision: input.treatment.revision },
          recipe: input.treatment.recipe,
          variants,
          createdAt: new Date().toISOString(),
        };
        if (!dryRun) writeJson(`${dir}compile.json`, report);
        return { result: report, hashes: { execution: executionDigest, report: digestOf(report) }, evidence: dryRun ? [] : [`.state/quarantine/capabilities/${input.candidate}/compile.json`] };
      });
    },

    candidateEvidence(input: { candidate: string; approvalId?: string; dryRun?: boolean }) {
      return envelopeAsync("candidate.evidence", input.dryRun ?? true, async () => {
        const result = await candidateEvidence(paths, registry, input);
        const files = result.evidence ? [result.evidence.clip.file, result.evidence.contactSheet.file, `.state/quarantine/capabilities/${input.candidate}/evidence.json`] : [];
        return { result, hashes: { execution: result.executionDigest, ...(result.evidence ? { clip: result.evidence.clip.sha256, contactSheet: result.evidence.contactSheet.sha256 } : {}) }, evidence: files };
      });
    },

    /** Read-only: what the independent review and the promotion approval must be bound to. */
    candidatePromotionTarget(input: { candidate: string }) {
      return envelope("registry.promote", true, () => {
        const plan = planPromotion(paths, registry, input.candidate);
        return { result: { subject: plan.target.subject, digest: plan.promotionDigest, target: plan.target }, hashes: { promotion: plan.promotionDigest } };
      });
    },

    registryPromote(input: { candidate: string; approvalId?: string; dryRun?: boolean }) {
      const dryRun = input.dryRun ?? true;
      return envelope("registry.promote", dryRun, () => {
        const { plan, record, created } = promoteCandidate(paths, registry, input);
        return {
          result: { id: plan.manifest.id, version: plan.manifest.version, digest: digestOf(plan.manifest), promotion: plan.promotionDigest },
          hashes: { promotion: plan.promotionDigest, manifest: digestOf(plan.manifest) },
          mutations: record && created ? [{ kind: "registry.promote", target: `${record.id}@${record.version}`, beforeDigest: null, afterDigest: record.manifestDigest }] : [],
        };
      });
    },

    catalogSearch(input: { query: string; kind?: string }) {
      return envelope("catalog.search", true, () => {
        const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
        const hits = registry
          .records()
          .filter((r) => r.entity === "capability" && registry.isOffered(r.id, r.version) && (!input.kind || r.kind === input.kind))
          .map((r) => ({ record: r, manifest: registry.manifest<CapabilityManifest>(r) }))
          .filter(({ manifest }) => {
            const text = [manifest.id, manifest.title, manifest.description, ...manifest.tags].join(" ").toLowerCase();
            return terms.every((t) => text.includes(t));
          })
          .map(({ record, manifest }) => ({ id: record.id, version: record.version, digest: record.manifestDigest, kind: manifest.kind, level: manifest.level, title: manifest.title, tags: manifest.tags }));
        return { result: hits };
      });
    },

    catalogInspect(input: VersionRef) {
      return envelope("catalog.inspect", true, () => {
        const record = exactRecord(input.id, input.version);
        return { result: { record, manifest: registry.manifest(record), offered: registry.isOffered(input.id, input.version) }, hashes: { manifest: record.manifestDigest } };
      });
    },

    /** CLI only: writes the spike-authored fixture fonts into quarantine/incoming. */
    fontFixtures() {
      return envelope("fontFixtures", false, () => ({ result: writeFixtureFonts(paths.state, paths.fixtures) }));
    },

    fontQuarantine(input: { incoming: string; manifest: FontDraft; dryRun?: boolean }) {
      const dryRun = input.dryRun ?? true;
      return envelope("font.quarantine", dryRun, () => {
        const result = quarantineFont(paths, registry, input.incoming, input.manifest, dryRun);
        const mutations: Mutation[] = dryRun ? [] : [{ kind: "font.quarantine", target: result.candidateId, beforeDigest: null, afterDigest: result.digest }];
        return { result, hashes: { manifest: result.digest }, mutations };
      });
    },

    fontInspect(input: { candidate: string; dryRun?: boolean }) {
      return envelope("font.inspect", input.dryRun ?? false, () => {
        if (input.dryRun) {
          const file = `${paths.state}quarantine/fonts/${input.candidate}/manifest.json`;
          if (!existsSync(file)) fail("FS_SCHEMA_INVALID", "/candidate", `${input.candidate} does not exist`);
          const errors = validateSchema("urn:film-spike:font-asset-manifest", readJson(file));
          if (errors.length) throw new FilmFailure(errors);
          return {};
        }
        const result = inspectFont(paths, registry, input.candidate, samples());
        if (result.errors.length) throw new FilmFailure(result.errors);
        return {
          result: { ok: result.report.ok, checks: result.report.checks, subjectDigest: result.report.subject.digest },
          hashes: { manifest: result.report.subject.digest, report: result.reportDigest },
          evidence: [`.state/quarantine/fonts/${input.candidate}/inspection.json`],
        };
      });
    },

    fontPromote(input: { candidate: string; approvalId?: string; dryRun?: boolean }) {
      const dryRun = input.dryRun ?? true;
      return envelope("font.promote", dryRun, () => {
        const { plan, record, created } = promoteFont(paths, registry, input.candidate, input.approvalId, dryRun);
        const target = `${plan.manifest.id}@${plan.manifest.version}`;
        return {
          result: { id: plan.manifest.id, version: plan.manifest.version, digest: plan.manifestDigest },
          hashes: { manifest: plan.manifestDigest, report: plan.reportDigest },
          mutations: record && created ? [{ kind: "registry.promote", target, beforeDigest: null, afterDigest: record.manifestDigest }] : [],
        };
      });
    },

    /** Read-only: what a promotion approval must be bound to. */
    fontPromotionTarget(input: { candidate: string }) {
      return envelope("font.promote", true, () => {
        const plan = planFontPromotion(paths, input.candidate);
        return { result: { subject: `${plan.manifest.id}@${plan.manifest.version}`, digest: plan.manifestDigest }, hashes: { manifest: plan.manifestDigest } };
      });
    },

    fontDeactivate(input: VersionRef & { approvalId?: string; dryRun?: boolean }) {
      const record = registry.record(input.id, input.version);
      const digest = record?.manifestDigest ?? "";
      return activationOp("font.deactivate", () => registry.deactivate(input.id, input.version), `${input.id}@${input.version}`, digest, input.approvalId, input.dryRun ?? true);
    },

    registryActivate(input: VersionRef & { approvalId?: string; dryRun?: boolean }) {
      const digest = registry.record(input.id, input.version)?.manifestDigest ?? "";
      return activationOp("registry.activate", () => registry.activate(input.id, input.version), `${input.id}@${input.version}`, digest, input.approvalId, input.dryRun ?? true);
    },

    registryDeactivate(input: VersionRef & { approvalId?: string; dryRun?: boolean }) {
      const digest = registry.record(input.id, input.version)?.manifestDigest ?? "";
      return activationOp("registry.deactivate", () => registry.deactivate(input.id, input.version), `${input.id}@${input.version}`, digest, input.approvalId, input.dryRun ?? true);
    },

    registryDeprecate(input: VersionRef & { approvalId?: string; dryRun?: boolean }) {
      const digest = registry.record(input.id, input.version)?.manifestDigest ?? "";
      return activationOp("registry.deprecate", () => registry.deprecate(input.id, input.version), `${input.id}@${input.version}`, digest, input.approvalId, input.dryRun ?? true);
    },

    registryRollback(input: { id: string; approvalId?: string; dryRun?: boolean }) {
      return activationOp("registry.rollback", () => registry.rollback(input.id), input.id, digestOf({ rollback: input.id }), input.approvalId, input.dryRun ?? true);
    },

    registryVerify() {
      return envelope("registry.verify", true, () => {
        const errors = registry.verify();
        if (errors.length) throw new FilmFailure(errors);
        return { result: { records: registry.records().length } };
      });
    },

    reviewRecord(input: ReviewInput & { dryRun?: boolean }) {
      const { dryRun = true, ...reviewInput } = input;
      return envelope("review.record", true, () => {
        if (!dryRun) fail("FS_OPERATOR_REQUIRED", "", "review service is preparation-only; use the interactive CLI recorder");
        return { result: prepareReview(paths, registry, reviewInput) };
      });
    },

    /**
     * Forks a Recipe revision into an organization Recipe under .state/recipes/. Replacements name
     * exact versions offered for new work; their digests are pinned from the registry. Saved
     * revisions are immutable: identical bytes are a no-op, different bytes are a collision.
     */
    recipeFork(input: RecipeForkInput) {
      const dryRun = input.dryRun ?? true;
      return envelope("recipe.fork", dryRun, () => {
        if (!input.id.startsWith("org.local.")) fail("FS_SEMANTIC_INVALID", "/id", "a fork is an organization Recipe; use an org.local.* id");
        const source = findRecipe(input.source, "/source");
        const pin = (ref: VersionRef, entity: "capability" | "font", path: string): ExactRef => {
          const record = registry.record(ref.id, ref.version);
          if (!record) return fail("FS_NOT_PROMOTED", path, `${ref.id}@${ref.version} is not a promoted registry entry`);
          if (record.entity !== entity) fail("FS_SEMANTIC_INVALID", path, `${ref.id}@${ref.version} is not a ${entity}`);
          if (!registry.isOffered(ref.id, ref.version)) fail("FS_NOT_PROMOTED", path, `${ref.id}@${ref.version} is not offered for new work`);
          return { id: ref.id, version: ref.version, digest: record.manifestDigest };
        };
        const capabilities = source.capabilities.map((c) => {
          const replacement = input.slots?.[c.slot];
          return replacement ? { slot: c.slot, ref: pin(replacement, "capability", `/slots/${c.slot}`) } : c;
        });
        const effects = input.effects ? input.effects.map((e, i) => pin(e, "capability", `/effects/${i}`)) : source.effects;
        const fonts = source.fonts.map((f) => {
          const replacement = input.fonts?.[f.role];
          return replacement ? { role: f.role, ref: pin(replacement, "font", `/fonts/${f.role}`) } : f;
        });
        const selected = new Set([...capabilities.map((c) => c.ref.id), ...effects.map((e) => e.id)]);
        const recipe: FilmStyleRecipe = {
          ...source,
          id: input.id,
          revision: input.revision ?? "r1",
          title: input.title ?? `${source.title} fork`,
          description: input.description ?? source.description,
          scope: "organization",
          owner: "local",
          lineage: { forkedFrom: { id: source.id, revision: source.revision, digest: digestOf(source) } },
          capabilities,
          effects,
          // Parameters of a replaced Capability no longer apply.
          params: Object.fromEntries(Object.entries(source.params).filter(([id]) => selected.has(id))),
          fonts,
        };
        const errors = validateDocument("film-style-recipe", recipe, { font: fontLookup });
        if (errors.length) throw new FilmFailure(errors);
        const digest = digestOf(recipe);
        const file = `${paths.state}recipes/${recipe.id}.${recipe.revision}.json`;
        const existing = existsSync(file) ? digestOf(readJson(file)) : null;
        if (existing && existing !== digest) {
          throw new FilmFailure([
            { ...filmError("FS_VERSION_COLLISION", "/revision", `${recipe.id}@${recipe.revision} is already saved as ${existing}`), owner: "recipe-author", remediation: "Saved Recipe revisions are immutable; fork under a new revision." },
          ]);
        }
        if (dryRun || existing) return { result: { recipe, digest }, hashes: { recipe: digest } };
        writeJson(file, recipe);
        return {
          result: { recipe, digest },
          hashes: { recipe: digest },
          evidence: [`.state/recipes/${recipe.id}.${recipe.revision}.json`],
          mutations: [{ kind: "recipe.fork", target: `${recipe.id}@${recipe.revision}`, beforeDigest: null, afterDigest: digest }],
        };
      });
    },

    /** Editing-grammar metrics of the Chapter Plans in each directory, one entry per directory. */
    grammar(input: { plansDirs: string[] }) {
      return envelope("grammar", true, () => {
        const result = input.plansDirs.map((given) => {
          const dir = resolve(paths.root, given) + "/";
          if (!existsSync(dir)) fail("FS_SCHEMA_INVALID", "/plans", `${given} does not exist`);
          const plans = readdirSync(dir)
            .filter((f) => f.endsWith(".plan.json") && f !== "concat.plan.json")
            .map((f) => loadChapterPlan(paths, `${dir}${f}`))
            .sort((a, b) => a.chapter.index - b.chapter.index);
          if (!plans.length) fail("FS_SCHEMA_INVALID", "/plans", `${given} holds no Chapter Plans`);
          return { plans: given, planDigests: plans.map((p) => planDigest(p)), metrics: grammarMetrics(plans) };
        });
        return { result };
      });
    },

    preflight(input: { treatment: FilmTreatment; chapters: FilmChapters; options?: CompileOptions }) {
      return envelope("preflight", true, () => {
        const errors = preflightChapters(compileInput(input.treatment, input.chapters, input.options ?? {}));
        if (errors.length) throw new FilmFailure(errors);
        return { result: { ok: true } };
      });
    },

    /**
     * Compiles one Plan per Chapter. With `write`, Plans and timing proposals go to
     * out/plans/<treatment>/; rendering later requires a timing approval bound to each proposal digest.
     */
    compile(input: { treatment: FilmTreatment; chapters: FilmChapters; options?: CompileOptions; write?: boolean; outName?: string }) {
      return envelope("compile", !input.write, () => {
        const compiled = compileChapters(compileInput(input.treatment, input.chapters, input.options ?? {}));
        const hashes: Record<string, string> = {};
        const evidence: string[] = [];
        for (const c of compiled) {
          checkPlan("resolved-render-plan", c.plan);
          hashes[`${c.plan.chapter.id}.plan`] = planDigest(c.plan);
          hashes[`${c.plan.chapter.id}.timing`] = c.proposalDigest;
          hashes[`${c.plan.chapter.id}.fingerprint`] = c.plan.fingerprint;
          if (input.write) {
            const dir = `${paths.out}plans/${input.outName ?? input.treatment.id}/`;
            writeJson(`${dir}${c.plan.chapter.id}.plan.json`, c.plan);
            writeJson(`${dir}${c.plan.chapter.id}.timing.json`, c.proposal);
            evidence.push(`out/plans/${input.outName ?? input.treatment.id}/${c.plan.chapter.id}.plan.json`);
          }
        }
        return { result: compiled.map((c) => ({ plan: c.plan, proposal: c.proposal, proposalDigest: c.proposalDigest })), hashes, evidence };
      });
    },

    /**
     * Replays a pinned Chapter Plan: every locked Capability must still resolve to the exact
     * recorded manifest and implementation (a missing one is FS_REPLAY_MISSING_VERSION), and
     * recompiling the Treatment must reproduce the identical Plan digest.
     */
    replay(input: { planFile: string; treatment: FilmTreatment; chapters: FilmChapters }) {
      return envelope("replay", true, () => {
        const plan = loadChapterPlan(paths, input.planFile);
        plan.lock.capabilities.forEach((locked, i) => {
          const { record } = registry.resolve({ id: locked.id, version: locked.version, digest: locked.manifestDigest }, "replay", `/lock/capabilities/${i}`);
          if (record.implementationDigest !== locked.implementationDigest) fail("FS_DIGEST_MISMATCH", `/lock/capabilities/${i}`, `${locked.id}@${locked.version} implementation differs from the pinned bytes`);
        });
        const recompiled = compileChapters(compileInput(input.treatment, input.chapters, plan.options)).find((c) => c.plan.chapter.id === plan.chapter.id);
        const expected = planDigest(plan);
        const actual = recompiled ? planDigest(recompiled.plan) : null;
        if (actual !== expected) fail("FS_DIGEST_MISMATCH", "/plan", `recompiling ${plan.chapter.id} gives ${actual}, not the pinned ${expected}`);
        return { result: { chapter: plan.chapter.id, planDigest: expected, capabilities: plan.lock.capabilities.length }, hashes: { plan: expected } };
      });
    },

    /**
     * Renders one Chapter Plan into a verified artifact. Requires a timing approval bound to the
     * Plan's proposal digest; reuses immutable render-digest media unless `bypassCache`.
     */
    renderChapter(input: RenderChapterInput & { dryRun?: boolean }) {
      return envelopeAsync("render.chapter", input.dryRun ?? false, async () => {
        if (input.dryRun) {
          const plan = loadChapterPlan(paths, input.planFile);
          requireApproval(paths.state, input.approvalId, "timing", plan.timing.proposalDigest);
          return { hashes: { plan: planDigest(plan) } as Record<string, string> };
        }
        const r = await renderChapter(renderDeps, input);
        return {
          result: { artifact: r.artifact, cache: r.cache, samples: r.samples, blocked: r.blocked, fonts: r.fonts, servedFonts: r.server?.fonts ?? [], renderMs: r.renderMs },
          hashes: { plan: r.artifact.planDigest, fingerprint: r.artifact.fingerprint, mp4: r.artifact.files.mp4.sha256, stem: r.artifact.files.stem.sha256 },
          warnings: r.warnings,
          evidence: r.files,
          mutations: r.cache === "miss" ? [{ kind: "render.chapter", target: r.artifact.chapterId, beforeDigest: null, afterDigest: r.artifact.files.mp4.sha256 }] : [],
        };
      });
    },

    /** Builds the concatenation Plan from compiled Chapter Plans and their verified artifact digests. */
    concatPlan(input: { treatment: FilmTreatment; chapters: FilmChapters; artifacts: { plan: ResolvedRenderPlan; artifact: Pick<ChapterArtifact, "files"> }[] }): ResultEnvelope<ConcatPlan> {
      return envelope("compile", true, () => {
        const plan = buildConcat(input.treatment, input.chapters, input.artifacts, (a) => a.artifact);
        return { result: plan, hashes: { plan: planDigest(plan), fingerprint: plan.fingerprint } };
      });
    },

    /**
     * Builds the concatenation Plan for the Chapter Plans in out/plans/<name>/ from their verified,
     * cached artifacts. With `write`, it goes to concat.plan.json; rendering needs a `concat` approval.
     */
    compileConcat(input: { treatment: FilmTreatment; chapters: FilmChapters; plansDir: string; write?: boolean }): ResultEnvelope<ConcatPlan> {
      return envelope("compile", !input.write, () => {
        const dir = resolve(paths.root, input.plansDir) + "/";
        if (!existsSync(dir)) fail("FS_SCHEMA_INVALID", "/plans", `${input.plansDir} does not exist; compile the Chapters first`);
        const ids = new Set(input.chapters.chapters.map(c => c.id));
        const plans = readdirSync(dir)
          .filter((f) => f.endsWith(".plan.json") && f !== "concat.plan.json")
          .filter((f) => ids.has(readJson<{ chapter?: { id?: string } }>(`${dir}${f}`).chapter?.id ?? ""))
          .map((f) => ({ plan: loadChapterPlan(paths, `${dir}${f}`) }));
        const plan = buildConcat(input.treatment, input.chapters, plans, ({ plan }) => {
          const found = resolveChapterCache(paths.state, plan);
          if (!found) fail("FS_ARTIFACT_VERIFY_FAILED", "/chapters", `${plan.chapter.id} has no verified media; render it first`);
          return found.artifact;
        });
        const evidence: string[] = [];
        if (input.write) {
          writeJson(`${dir}concat.plan.json`, plan);
          evidence.push(`out/${relative(paths.out, `${dir}concat.plan.json`)}`);
        }
        return { result: plan, hashes: { plan: planDigest(plan), fingerprint: plan.fingerprint }, evidence };
      });
    },

    /** Assembles the concatenated film. Requires a `concat` approval bound to the Plan digest. */
    renderConcat(input: { planFile: string; approvalId?: string; outName?: string; dryRun?: boolean }) {
      return envelopeAsync("render.concat", input.dryRun ?? false, async () => {
        if (input.dryRun) {
          const { plan, digest } = requireConcatPlan(renderDeps, input);
          verifyAudio(paths.media, [plan.audio.bgm]);
          return { hashes: { plan: digest } as Record<string, string> };
        }
        const r = await renderConcat(renderDeps, input);
        return {
          result: { artifact: r.artifact, cache: r.cache, blocked: r.blocked, renderMs: r.renderMs },
          hashes: { plan: r.artifact.planDigest, fingerprint: r.artifact.fingerprint, mp4: r.artifact.file.sha256 },
          warnings: r.warnings,
          evidence: r.files,
          mutations: r.cache === "miss" ? [{ kind: "render.concat", target: "concat", beforeDigest: null, afterDigest: r.artifact.file.sha256 }] : [],
        };
      });
    },

    /** Writes a 4x3 grid of the twelve sample frames of a Chapter Plan, drawn by the painter. */
    contactSheet(input: { planFile: string; grayscale?: boolean; dryRun?: boolean }) {
      return envelopeAsync("contactSheet", input.dryRun ?? false, async () => {
        if (input.dryRun) return { hashes: { plan: planDigest(loadChapterPlan(paths, input.planFile)) } as Record<string, string> };
        const r = await contactSheet(renderDeps, input.planFile, { grayscale: input.grayscale ?? false });
        return { result: r, hashes: { plan: r.planDigest, sheet: r.sha256 }, evidence: [r.file] };
      });
    },
  };
}

export type AuthoringService = ReturnType<typeof createService>;
