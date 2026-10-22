// The one typed authoring service. The CLI and the Tool Calling adapter call only this module.
// Mutating operations default to dry run and require a matching operator approval to write.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { digestOf } from "../contracts/canonical.js";
import { envelope, envelopeAsync, type Mutation, type ResultEnvelope } from "../contracts/envelope.js";
import { fail, FilmFailure } from "../contracts/errors.js";
import { validateSchema, type SchemaKind } from "../contracts/schemas.js";
import { validateDocument, type SemanticContext } from "../contracts/semantic.js";
import type {
  CapabilityManifest,
  ChapterArtifact,
  ConcatPlan,
  ExactRef,
  FilmChapters,
  FilmStyleRecipe,
  FilmTreatment,
  FontAssetManifest,
  ResolvedRenderPlan,
  StoryGraph,
  VersionRef,
} from "../contracts/types.js";
import { loadImplementation } from "../capabilities/loader.js";
import { compileChapters, preflightChapters, type CompileInput, type FontCatalog, type FontEntry } from "../compiler/compile.js";
import { buildConcatPlan, CONNECTION } from "../compiler/concat.js";
import { planDigest } from "../compiler/fingerprint.js";
import type { Catalog, CatalogEntry } from "../compiler/resolve.js";
import { readFingerprint, type EnvFingerprint } from "../env/fingerprint.js";
import { writeFixtureFonts } from "../fonts/fixtures.js";
import { inspectFont, planFontPromotion, promoteFont, quarantineFont, type FontDraft } from "../fonts/fonts.js";
import { glyphChars, JA_SAMPLE_SET, LATIN_SAMPLE_SET } from "../fonts/samples.js";
import { readMediaLock } from "../media/lock.js";
import { writeJson, type SpikePaths } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import { bootstrapBuiltins } from "../registry/bootstrap.js";
import { Registry } from "../registry/registry.js";
import { recordReview, type ReviewInput } from "../registry/reviews.js";
import { renderConcat } from "../render/concat.js";
import { contactSheet } from "../render/contact-sheet.js";
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

  const fontLookup = (ref: VersionRef): FontAssetManifest | undefined => {
    const record = registry.record(ref.id, ref.version);
    return record?.entity === "font" ? registry.manifest<FontAssetManifest>(record) : undefined;
  };

  const capabilityCatalog = (refs: ExactRef[]): Catalog => {
    const entries = new Map<string, CatalogEntry>();
    const add = (record: NonNullable<ReturnType<Registry["record"]>>) => {
      const key = `${record.id}@${record.version}`;
      if (entries.has(key)) return;
      const manifest = registry.manifest<CapabilityManifest>(record);
      entries.set(key, { record, manifest, run: loadImplementation(record) });
      // Follow declared safety-fallback edges by exact version; missing edges are reported by the resolver.
      if (manifest.fallback) {
        const next = registry.record(manifest.fallback.id, manifest.fallback.version);
        if (next?.entity === "capability") add(next);
      }
    };
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

  const compileInput = (treatment: FilmTreatment, chapters: FilmChapters, options: CompileOptions): CompileInput => {
    const errors = [
      ...validateDocument("film-treatment", treatment),
      ...validateDocument("chapters", chapters),
    ];
    if (errors.length) throw new FilmFailure(errors);
    const storyGraph = findStoryGraph(treatment.storyGraph);
    const recipe = findRecipe(treatment.recipe);
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
    const refs = [...recipe.capabilities.map((c) => c.ref), ...recipe.effects];
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
      catalog: capabilityCatalog(refs),
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

  const buildConcat = (treatment: FilmTreatment, artifacts: { plan: ResolvedRenderPlan; artifact: Pick<ChapterArtifact, "files"> }[]): ConcatPlan => {
    const recipe = findRecipe(treatment.recipe);
    const typography = artifacts[0]?.plan.capabilities.find((c) => c.slot === "typography")?.active;
    const refs: ExactRef[] = [CONNECTION, ...(typography ? [typography] : [])].map((r) => ({ ...r, digest: exactRecord(r.id, r.version).manifestDigest }));
    const plan = buildConcatPlan({
      chapters: artifacts.map((a) => ({ plan: a.plan, planDigest: planDigest(a.plan), artifactSha256: a.artifact.files.mp4.sha256 })),
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

    fontInspect(input: { candidate: string }) {
      return envelope("font.inspect", true, () => {
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

    reviewRecord(input: ReviewInput) {
      return envelope("review.record", false, () => {
        const review = recordReview(paths.state, input);
        return { result: review, mutations: [{ kind: "review.record", target: review.id, beforeDigest: null, afterDigest: digestOf(review) }] };
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
     * Renders one Chapter Plan into a verified artifact. Requires a timing approval bound to the
     * Plan's proposal digest; reuses the fingerprint cache unless `bypassCache`.
     */
    renderChapter(input: RenderChapterInput) {
      return envelopeAsync("render.chapter", false, async () => {
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
    concatPlan(input: { treatment: FilmTreatment; artifacts: { plan: ResolvedRenderPlan; artifact: Pick<ChapterArtifact, "files"> }[] }): ResultEnvelope<ConcatPlan> {
      return envelope("compile", true, () => {
        const plan = buildConcat(input.treatment, input.artifacts);
        return { result: plan, hashes: { plan: planDigest(plan), fingerprint: plan.fingerprint } };
      });
    },

    /**
     * Builds the concatenation Plan for the Chapter Plans in out/plans/<name>/ from their verified,
     * cached artifacts. With `write`, it goes to concat.plan.json; rendering needs a `concat` approval.
     */
    compileConcat(input: { treatment: FilmTreatment; plansDir: string; write?: boolean }): ResultEnvelope<ConcatPlan> {
      return envelope("compile", !input.write, () => {
        const dir = resolve(paths.root, input.plansDir) + "/";
        if (!existsSync(dir)) fail("FS_SCHEMA_INVALID", "/plans", `${input.plansDir} does not exist; compile the Chapters first`);
        const plans = readdirSync(dir)
          .filter((f) => f.endsWith(".plan.json") && f !== "concat.plan.json")
          .map((f) => loadChapterPlan(paths, `${dir}${f}`))
          .sort((a, b) => a.chapter.index - b.chapter.index);
        if (!plans.length) fail("FS_SCHEMA_INVALID", "/plans", `${input.plansDir} holds no Chapter Plans`);
        const artifacts = plans.map((plan) => {
          const meta = `${paths.state}cache/chapters/${plan.fingerprint.slice("sha256:".length)}/artifact.json`;
          const artifact = existsSync(meta) ? readJson<ChapterArtifact>(meta) : null;
          if (!artifact?.verified || artifact.planDigest !== planDigest(plan)) {
            fail("FS_ARTIFACT_VERIFY_FAILED", `/chapters/${plan.chapter.index}`, `${plan.chapter.id} has no verified artifact for this Plan; render it first`);
          }
          return { plan, artifact };
        });
        const plan = buildConcat(input.treatment, artifacts);
        const evidence: string[] = [];
        if (input.write) {
          writeJson(`${dir}concat.plan.json`, plan);
          evidence.push(`out/${relative(paths.out, `${dir}concat.plan.json`)}`);
        }
        return { result: plan, hashes: { plan: planDigest(plan), fingerprint: plan.fingerprint }, evidence };
      });
    },

    /** Assembles the concatenated film. Requires a `concat` approval bound to the Plan digest. */
    renderConcat(input: { planFile: string; approvalId?: string; outName?: string }) {
      return envelopeAsync("render.concat", false, async () => {
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
    contactSheet(input: { planFile: string }) {
      return envelopeAsync("contactSheet", false, async () => {
        const r = await contactSheet(renderDeps, input.planFile);
        return { result: r, hashes: { plan: r.planDigest, sheet: r.sha256 }, evidence: [r.file] };
      });
    },
  };
}

export type AuthoringService = ReturnType<typeof createService>;
