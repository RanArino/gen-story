// Synthetic ABI inputs exercise dimensions and parameter boundaries without loading media.
import type { CapabilityInput } from "../capability-sdk/abi.js";
import type { CapabilityManifest, ParamValue } from "../contracts/types.js";

export function candidateInputs(manifest: CapabilityManifest): { name: string; input: CapabilityInput }[] {
  const defaults = Object.fromEntries(Object.entries(manifest.params).map(([name, spec]) => [name, spec.default]));
  const variants: { name: string; params: Record<string, ParamValue> }[] = [{ name: "defaults", params: defaults }];
  for (const [name, spec] of Object.entries(manifest.params)) {
    const bounds = spec.type === "boolean" ? [false, true] : spec.type === "enum" ? spec.values ?? [] : [spec.min, spec.max].filter((v): v is number => v !== undefined);
    bounds.forEach((value, index) => variants.push({ name: `${name}-${index}`, params: { ...defaults, [name]: value } }));
  }
  return manifest.fixtures.flatMap((fixture) => variants.map((variant) => {
    const [w, h] = fixture.sourceAspect.split(":").map(Number);
    return {
      name: `${fixture.name}-${variant.name}`,
      input: {
        abi: "film-capability@1", kind: manifest.kind, segment: "transition",
        profile: { id: "landscape-1080p30@1", widthPx: 1920, heightPx: 1080, fps: 30 },
        window: { startMs: 0, endMs: manifest.timing.overlapMs ?? 700, inOverlapMs: 0, outOverlapMs: 0 },
        scene: {
          id: fixture.name,
          media: [{ asset: `synthetic/${fixture.name}.png`, sha256: `sha256:${"0".repeat(64)}`, widthPx: w! * 100, heightPx: h! * 100 }],
          analysis: { subject: { x: 0.3, y: 0.2, w: 0.4, h: 0.6 } },
          caption: { ja: fixture.caption === "ja" ? "思い出の散歩道。" : "", en: fixture.caption === "en" ? "A remembered walk." : "" },
        },
        chapter: { id: "fixture", title: "思い出", index: 0, sceneIndex: 1, sceneCount: 2 },
        curves: { energy: 0.45, intimacy: 0.7, openness: 0.55, warmth: 0.7, stillness: 0.5 },
        params: variant.params, options: { reducedMotion: false, seed: 17 },
        theme: { palette: { family: "paper-warm", background: "#16130f", text: "#f6f1e7", accent: "#d9a35f", scrim: "#000000" }, fonts: { caption: [], title: [] } },
        assets: {},
      } satisfies CapabilityInput,
    };
  }));
}
