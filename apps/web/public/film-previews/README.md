# Film template examples

These examples use the production Film runtime with default template settings, automatic scene durations, normal motion, the same three sample photos, and the same Japanese captions. They are examples of presentation; the sample content is not added to projects. The initial runtime uses silent shared BGM and bundled template sound effects.

Play the committed MP4s directly at `/film-previews/quiet-cinema.mp4`, `/film-previews/memory-board.mp4`, and `/film-previews/pulse-cut.mp4`. Browsers need no API connection or render configuration to play them.

The three photographs were created specifically for this demo with the built-in imagegen tool on 2026-10-31. No real project media or external stock photos are included. Final inputs are `photos/coastal-train.jpg`, `photos/harbor-cafe.jpg`, and `photos/sunset-walk.jpg`. Generated PNGs were converted to JPEG with FFmpeg. The final prompt set was:

1. Create one cinematic natural travel photograph, landscape 16:9. A quiet Japanese coastal train platform in early morning, small red local train beside the sea, crisp foreground railing and warm sun on weathered wood, distant blue hills, believable photographic texture, tasteful composition with clear foreground/midground/background for slow camera movement. No people, text, logos, collage, borders or watermark. This is an original synthetic sample photo for a film-template demo.
2. Create one cinematic natural travel photograph, landscape 16:9. A quiet little Japanese seaside cafe table by an open window at midday. A white ceramic coffee cup and small plate with a croissant on warm wooden table in foreground, leafy plant to the side, sparkling blue sea and an old harbor visible through the window. Believable photographic textures, soft light, clear depth and coherent warm blue/gold palette. No people, text, logos, collage, borders or watermark. This is an original synthetic sample photo for a film-template demo.
3. Create one cinematic natural travel photograph, landscape 16:9. End of a quiet Japanese seaside day, a narrow coastal path with grasses and a weathered wooden bench in foreground, tranquil blue water leading toward hazy islands, beautiful soft peach golden sunset sky. Believable photographic textures and clear foreground/midground/background, restrained blue and warm gold palette consistent with a coastal travel diary. No people, text, logos, collage, borders or watermark. This is an original synthetic sample photo for a film-template demo.

Regenerate locally from the repository root:

    pnpm tsx packages/infrastructure/scripts/generate-film-previews.ts

Requires local Chrome and FFmpeg/ffprobe. CHROME_PATH is optional for standard installations. Generation uses disposable temporary state; it never opens the application database. The script renders actual 1080p30 default outputs, downscales the verified videos to 720p fast-start MP4s for gallery delivery while retaining timing and audio, extracts posters, and records verified runtime artifacts and source hashes in `manifest.json`.
