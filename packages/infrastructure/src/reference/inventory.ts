/** Development-only inventory. Never imports or executes a supplied reference project. */
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function inventoryReference(input: unknown) {
  const spec = object(input);
  if (spec.version !== 2 || !Array.isArray(spec.scenes))
    throw new Error(
      "Reference inventory requires a Film Studio v2 spec with scenes.",
    );
  const segments = [
    { ...object(spec.opening), id: "opening" },
    ...spec.scenes.map(object),
    { ...object(spec.ending), id: "ending" },
  ];
  const paths: string[] = [];
  function visit(value: unknown, path: string) {
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}/${i}`));
    else if (value !== null && typeof value === "object")
      Object.entries(object(value)).forEach(([k, v]) =>
        visit(v, `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`),
      );
    else paths.push(path);
  }
  visit(spec, "");
  return {
    version: 1,
    topLevelFields: Object.keys(spec).sort(),
    scalarPaths: paths.sort(),
    assets: Object.keys(object(spec.assets)).sort(),
    style: object(spec.style).id,
    styleOptions: Object.keys(object(object(spec.style).options)).sort(),
    scoreFields: Object.keys(object(spec.score)).sort(),
    ambienceFields: Object.keys(object(spec.ambience)).sort(),
    mixFields: Object.keys(object(spec.mix)).sort(),
    segments: segments.map((s) => ({
      id: s.id,
      fields: Object.keys(s).sort(),
      cameraKeys: list(s.camera).length,
      lookFields: [
        ...new Set(
          list(s.look).flatMap((k) =>
            Object.keys(object(k)).filter((f) => f !== "at"),
          ),
        ),
      ].sort(),
      captions: list(s.captions).length,
      musicEvents: list(s.music).length,
      soundEvents: list(s.sfx).length,
      ambienceKeys: list(s.ambience).length,
      hasSteps: Boolean(s.steps),
      hasBob: Boolean(s.bob),
    })),
  };
}

/** Every reference feature has an explicit disposition; partial support is not parity. */
export const productionReferenceMapping = [
  {
    feature: "scene membership and duration",
    status: "partial",
    detail:
      "Chapter ordering and timing exist; PoC overlaps and expressive holds need explicit mapping.",
  },
  {
    feature: "camera focal paths, zoom, bob and steps",
    status: "missing",
    detail:
      "Only generic seeded push/pull and card motion exist; authored trajectories and walking synchronization are absent.",
  },
  {
    feature:
      "time-varying color, vignette, rays, motes, leaves, bloom and grain",
    status: "partial",
    detail:
      "Vignette, paper tone and light leak exist; Sando's time-varying style vocabulary is not represented.",
  },
  {
    feature: "title, bilingual captions, slate and ending",
    status: "partial",
    detail:
      "Titles and captions exist; original layout, bilingual treatment and ending composition need adaptation.",
  },
  {
    feature: "score, chord progression and melody",
    status: "missing",
    detail:
      "The integrated compiler forces a silent shared BGM; it has no typed procedural score.",
  },
  {
    feature: "scene ambience, scattered events and footsteps",
    status: "partial",
    detail:
      "Locked ambience/hit playback exists; scene-aware beds, scatters and footstep schedules are absent.",
  },
  {
    feature: "audio buses, reverb and mix automation",
    status: "missing",
    detail:
      "Event gain/fades exist, but not the original bus/reverb/score mix vocabulary.",
  },
  {
    feature: "image analysis and creative direction",
    status: "missing",
    detail:
      "Production inserts fixed subject bounds and emotions; no creative Agent is called.",
  },
  {
    feature: "deterministic playback and MP4 encoding",
    status: "supported",
    detail:
      "Production has immutable plans, exact environment locks and verified H.264/AAC delivery.",
  },
] as const;
