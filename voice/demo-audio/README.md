# Demo audio

Pre-generated speech for the demo lines. Made by `npm run pregenerate` (see `../src/config/demo-lines.ts`).

- `<hash>.pcm` and `<hash>.json`: what the server's audio cache reads. The hash covers the voice, the model, the speed, the format and the exact text.
- `<id>.<lang>.wav`: the same audio as a normal file. Open these to listen.
- `manifest.json`: which line is which file.

**Commit this folder** once the lines sound right, so the whole team has the audio and nobody pays credits twice. If you change a voice or a model, run `npm run pregenerate -- --clean` and commit the new files.

With these files in place the server plays the demo lines even when the network is down.
