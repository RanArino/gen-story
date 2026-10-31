# Film runtime infrastructure

This package contains the local still-image compiler, trusted Canvas painter, Chrome capture, FFmpeg encoding/assembly, and verified media cache used by the API. Application use cases access render submission through `FilmRendererPort`; browser, filesystem, encoder, and registry details stay here.

The runtime was extracted from the completed `spikes/film` research package. Production code imports `@gen-story/infrastructure/film` and never imports the spike, its fixture projects, or its authoring CLI. The only exposed choices are the three system Recipes. Capability and font promotion operations are not exposed by this package's public entry point.

`assets/` contains the already approved system registry/font bundles and their license blobs, the three system Recipes, and source Treatment defaults. Font licenses are retained as content-addressed registry assets. Existing approved ambience and hit sounds are materialized from their registry bytes; the shared BGM defaults to a silent PCM WAV. No reference-project images or user photos are bundled. The original built-in implementation files keep their exact registry-pinned bytes, so formatting deliberately excludes those files. Git attributes preserve the exact registry blob and built-in source bytes across platform line-ending settings.

Each project uses its own application-owned media/snapshot/cache directories. Image inputs are normalized, content-addressed PNGs. Plans pin exact Recipe, Capability, font, compiler, painter, browser, and encoder identities. Production schema version `film-schemas@2` additionally accepts the app's UUID/local IDs. Missing versions, glyphs, bytes, invalid timing, and corrupt outputs fail explicitly. A damaged Chapter cache is rebuilt on retry before publishing a verified artifact.

Rendering needs locally installed Chrome (auto-detected, with optional `CHROME_PATH` override) and local `ffmpeg`/`ffprobe`. The browser preview and final export use the same trusted painter and resolved plan; the Film UI plays the verified final MP4. Render actions bind approval to the immutable saved plan digest; no candidate code or registry promotion is authorized by rendering.

The [creative-quality reference harness](reference/README.md) inventories and captures a separately supplied PoC for development comparison. It does not change production behavior or claim that a creative Agent is connected.
