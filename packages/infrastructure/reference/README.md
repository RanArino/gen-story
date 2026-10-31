# Creative-quality reference audit

This is development evidence for the Film quality recovery. It is not a second production rendering engine and does not imply Agent-driven creation has been integrated.

The reference project is supplied separately in the ignored `film-making-idea/film-studio/` directory. No reference images, story content, source code, or generated reference exports are included in the public package. The harness fails clearly if the supplied project is absent. It uses the original browser player and procedural audio modules unchanged, and does not require installing the prototype's optional Node Web Audio implementation.

From the repository root:

    pnpm tsx packages/infrastructure/scripts/render-film-reference.ts

This writes a fresh timestamped directory under ignored `data/film/reference/` containing `reference.mp4`, the original offline `reference.wav`, a contact sheet and sampled frames, loudness measurements, and a provenance/inventory manifest. Chrome is discovered locally; a valid explicit CHROME_PATH remains supported. FFmpeg and ffprobe must be on PATH. An existing nonempty output directory is rejected to prevent stale evidence from appearing successful.

Verify encoded integrity and full browser playback with sound enabled after a click:

    pnpm tsx packages/infrastructure/scripts/verify-film-reference.ts data/film/reference/<generated-directory>

This verifies the recorded MP4 digest, duration, frame count, audio profile and measured headroom before playing the complete file. It writes `playback.json`; human listening/creative acceptance remains explicitly unreviewed.

For a short diagnostic, without claiming full-reference completion:

    pnpm tsx packages/infrastructure/scripts/render-film-reference.ts /tmp/film-reference-check --seconds 2

The diagnostic manifest is explicitly marked `complete: false`. The default captures the full reference at 1280×720, 30 fps. Offline Web Audio runs the original instruments, score, ambience and events at 48 kHz; final H.264/AAC delivery follows the prototype's -18 LUFS / -1.5 dBTP loudnorm settings. The original source WAV retains the synthesis tail; MP4 audio is trimmed to film duration.

External network requests are blocked. The harness uses approved bundled Noto Serif JP in place of the original remote Shippori Mincho, and bundled Cormorant Garamond in place of remote Cormorant. This substitution, exact font hashes, source hashes, browser/encoder environment, output hashes and metadata are recorded. This is an explicit typography difference; no pixel-identical original-font claim is made.

`src/reference/inventory.ts` reports every scalar field path, scene-specific camera/look/music/sound features, and the current production support mapping. It never executes supplied code. The script separately executes only the supplied local reference modules in an isolated browser for comparison. Missing camera trajectories, effects, music and audio mix support remain marked missing or partial. A successful MP4 or passing unit test is not evidence that these features are in production.

Completion evidence must distinguish full capture and playback from human creative acceptance. A human must listen and view the reference/production comparison and a fresh Agent-directed film before creative delivery is accepted. Neither a nonzero audio track nor a hand-authored reference passes the real-Agent integration gate.

## Production cinematic comparison

Q2 uses the supplied reference only to author a typed input snapshot, then synthesizes audio and renders through production code:

    pnpm tsx packages/infrastructure/scripts/render-cinematic-comparison.ts
    pnpm tsx packages/infrastructure/scripts/verify-cinematic-comparison.ts

Pass an explicit output directory to both commands to keep comparison versions separate. The default is ignored `data/film/q2-cinematic-comparison/`; `--frames-only` skips the full export. The output includes `out/direction.json`, `out/plan.json`, sampled frames/contact sheet, backwards-seek hashes, a reduced-motion static-position check, verified artifacts, and `out/acceptance.json` after full browser playback. Verification checks byte-identical cache reuse, 1080p30 H.264/stereo AAC, loudness/headroom, and unmuted playback to the end. The convenience `production.mp4` is copied after verification. None of these records represents human artistic acceptance.

The production package does not import the supplied project's player, compiler, style or sounds. Its static trusted cinematic primitive restores authored camera/look/copy and procedural sound support inside the existing painter/capture pipeline. The development authoring script may import the original compiler to make the comparison input. The Q1 support mapping is a baseline audit; it does not claim that the Q2 runtime is already connected to user project Agent planning.

Comparison differences must stay visible: source fonts use the Q1 pinned substitution; Canvas text/layout and radial gradients adapt the original CSS; title glow and slate borders are implemented; exported credits exclude the prototype's replay control. Music and non-music are split before compression and then share one measured linear delivery gain, unlike the original combined compressor/dynamic normalization. The first comparison is a single authored Chapter. Multi-Chapter project direction and application integration remain later work.
