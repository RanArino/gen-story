import { FilmFailure, fail } from "../contracts/errors.js";
import { validateSchema } from "../contracts/schemas.js";
import type { CinematicDirection, CurvePoint } from "./types.js";

export function validateDirection(
  input: unknown,
): asserts input is CinematicDirection {
  const errors = validateSchema("urn:gen-story:cinematic-direction", input);
  if (errors.length) throw new FilmFailure(errors);
  const d = input as CinematicDirection;
  const invalid = (message: string): never =>
    fail("FS_SEMANTIC_INVALID", "/direction", message);
  if (d.score.duration !== d.duration || d.score.seed !== d.seed)
    invalid("Score and visual timeline must share duration and seed");
  const ordered = (points: CurvePoint[], name: string) => {
    if (
      points.some(
        ([time], i) =>
          time > d.duration || (i > 0 && time <= points[i - 1]![0]),
      )
    )
      invalid(`Unordered or out-of-range ${name} curve`);
  };
  Object.entries(d.params).forEach(([name, points]) => {
    ordered(points, name);
    if (
      points.some(
        ([, value]) => value < 0 || value > (name === "speed" ? 2 : 1),
      )
    )
      invalid(`Out-of-range ${name} value`);
  });
  ordered(d.score.master, "master");
  if (d.score.master.some(([, v]) => v < 0 || v > 2))
    invalid("Invalid master gain");
  for (const bed of d.score.beds) ordered(bed.curve, `bed ${bed.name}`);
  const ids = new Set<string>();
  for (const scene of d.scenes) {
    if (
      ids.has(scene.id) ||
      !Object.hasOwn(d.assets, scene.image) ||
      scene.t1 <= scene.t0 ||
      scene.t1 > d.duration
    )
      invalid("Invalid scene identity, media reference or window");
    if (scene.fadeIn + scene.fadeOut > scene.t1 - scene.t0)
      invalid("Scene fades exceed its window");
    if (
      scene.camera[0]!.p !== 0 ||
      scene.camera.at(-1)!.p !== 1 ||
      scene.camera.some((key, i) => i > 0 && key.p <= scene.camera[i - 1]!.p)
    )
      invalid("Camera keys must increase strictly from 0 to 1");
    ids.add(scene.id);
  }
  if (d.scenes.some((s, i) => i > 0 && s.t0 < d.scenes[i - 1]!.t0))
    invalid("Scenes must remain in timeline order");
  if (
    d.steps.some(
      (step, i) =>
        step.t >= d.duration || (i > 0 && step.t <= d.steps[i - 1]!.t),
    )
  )
    invalid("Invalid footstep order or window");
  for (const caption of d.captions)
    if (caption.t0 >= caption.t1 || caption.t1 > d.duration)
      invalid("Invalid caption window");
  for (const [i, event] of d.score.events.entries()) {
    if (
      event.t >= d.duration ||
      event.i !== i ||
      (i > 0 && event.t < d.score.events[i - 1]!.t)
    )
      invalid("Audio event identity/order is invalid");
    if (["wind", "stream"].includes(event.sound))
      invalid("Bed instruments cannot be scheduled as one-shots");
  }
  for (const card of [d.titleCard, d.credits, ...d.slates])
    if (
      card &&
      (card.show.in >= d.duration ||
        (card.show.out !== null &&
          (card.show.out > d.duration || card.show.out < card.show.in)))
    )
      invalid("Invalid title or slate window");
}
