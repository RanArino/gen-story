// Declares at most 8 primitives and emits 64.
export default () => ({
  layers: Array.from({ length: 64 }, (_, i) => ({ type: "rect", startMs: 0, endMs: 700, x: i * 30, y: 0, w: 30, h: 1080, color: "#ffffff" })),
  audio: [],
});
