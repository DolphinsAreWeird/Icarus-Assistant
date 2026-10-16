# Demo audio

Pre-generated speech for the demo lines. Made by `npm run pregenerate` (see `../src/config/demo-lines.ts`).

- `<hash>.pcm` and `<hash>.json`: what the server's audio cache reads. The hash covers the voice, the model, the speed, the format and the exact text.
- `<id>.<lang>.wav`: the same audio as a normal file. Open these to listen.
- `manifest.json`: which line is which file.

**Commit this folder** once the lines sound right, so the whole team has the audio and nobody pays credits twice. If you change a voice or a model, run `npm run pregenerate -- --clean` and commit the new files.

With these files in place the server plays the demo lines even when the network is down.

**Current audio:** the 8 lines in `manifest.json`, each with a named `.wav`, are English: voice Brittney (`XiPS9cXxAVbaIWtGDHDh`), model `eleven_flash_v2_5`, made on 15 Oct. Checked with `npm run pregenerate -- --verify`: the live Scribe understood every line, and every amount in the read-back came back right. The cache also holds 7 more hashed `.pcm`/`.json` clips from 16 Oct that have no `.wav` and are not in `manifest.json` (so `--verify` did not check them): 6 English lines (Brittney, `eleven_flash_v2_5`) and 1 Thai line, the tour's gold-price answer (voice Malee `mYcpTKg1oj1H5CtzUZNO`, model `eleven_v4_turbo`). **No Thai audio has been reviewed by a Thai speaker.** Do not treat the Thai clip as approved. See `../../model/evaluation/HUMAN_REVIEW.md`.
