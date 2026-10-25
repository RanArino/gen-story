export default (input) => {
  const media = input.scene.media.at(0);
  if (media.heightPx > media.widthPx) throw new Error("portrait sources are not supported");
  return { layers: [], audio: [] };
};
