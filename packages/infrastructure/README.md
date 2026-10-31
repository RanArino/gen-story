# Film runtime infrastructure

This package contains the local still-image compiler, trusted Canvas painter, Chrome capture, FFmpeg encoding/assembly, and verified media cache used by the API. Application use cases access render submission through `FilmRendererPort`; browser, filesystem, encoder, and registry details stay here.

The runtime was extracted from the completed `spikes/film` research package. Production code imports `@gen-story/infrastructure/film` and never imports the spike, its fixture projects, or its authoring CLI. The only exposed choices are the three system Recipes. Capability and font promotion operations are not exposed by this package's public entry point.

`assets/` contains the already approved system registry/font bundles and their license blobs, the three system Recipes, and source Treatment defaults. Font licenses are retained as content-addressed registry assets. Existing approved ambience and hit sounds are materialized from their registry bytes; the shared BGM defaults to a silent PCM WAV. No reference-project images or user photos are bundled. The original built-in implementation files keep their exact registry-pinned bytes, so formatting deliberately excludes those files. Git attributes preserve the exact registry blob and built-in source bytes across platform line-ending settings.

Each project uses its own application-owned media/snapshot/cache directories. Image inputs are normalized, content-addressed PNGs. Plans pin exact Recipe, Capability, font, compiler, painter, browser, and encoder identities. Production schema version `film-schemas@2` additionally accepts the app's UUID/local IDs. Missing versions, glyphs, bytes, invalid timing, and corrupt outputs fail explicitly. A damaged Chapter cache is rebuilt on retry before publishing a verified artifact.

Rendering needs locally installed Chrome (auto-detected, with optional `CHROME_PATH` override) and local `ffmpeg`/`ffprobe`. The browser preview and final export use the same trusted painter and resolved plan; the Film UI plays the verified final MP4. Render actions bind approval to the immutable saved plan digest; no candidate code or registry promotion is authorized by rendering.

The [creative-quality reference harness](reference/README.md) inventories and captures a separately supplied PoC for development comparison. It does not change production behavior or claim that a creative Agent is connected.

## Authored cinematic runtime (Q2)

`compileCinematicFilm`, `prepareCinematicScore`, and `lockCinematicMedia` expose an authored, data-only cinematic path through the same resolved-plan, painter, Chrome capture, verified MP4 and cache pipeline. `CinematicDirection` describes per-scene focal/zoom paths, walking motion, bounded time-varying color/light/particles/grain, bilingual copy, cards and an explicit procedural score. It cannot supply JavaScript, remote URLs or new sound implementations. Input schemas and semantic checks reject unknown fields, unsupported instruments, invalid source references, unordered timelines and unsupported glyphs.

The shared painter's trusted cinematic/math modules are served from a fixed local allowlist and included in the painter/environment identity (`film-painter@2`). `film-schemas@3` additionally records authored scene windows and ending duration. Existing digest-pinned Capability implementations and promoted font records are unchanged. The new core primitive does not declare the old Recipe motion modules as its implementation and does not promote candidate code. Its compiler/source identities and immutable media references are recorded in the plan.

Ten bundled procedural instruments/beds synthesize locally in native OfflineAudioContext. Music and non-music stems use the existing shared-BGM/stem mixing path, with a measured common gain targeting -18 LUFS subject to -1.5 dBTP headroom. All sound is generated locally without providers, keys or network services. Byte-verified caches bind audio to the score and source kernels. The split-stem compressors differ from the prototype's single combined compressor, so sample-identical prototype audio is not claimed.

This is the Q2 runtime foundation and authored comparison, not an integrated creative Agent or a change to the current Film UI/render routes. User project planning, durable Cut workflows and confirmed UI integration remain subsequent work. The existing three-template UI still uses its previous default audio settings. Canvas typography/radial compositing adapts the reference CSS rather than claiming pixel identity; the replay button is intentionally absent from exported credits. Non-square images keep their aspect ratio, and reduced motion holds camera/effect positions while retaining the look curves.

For the separately supplied private reference and comparison commands, see [the reference audit notes](reference/README.md). Original reference media and generated comparison evidence remain outside the public package.
