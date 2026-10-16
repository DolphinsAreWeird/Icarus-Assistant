// P1. First visit: the "Meet Icarus" card, the one-minute tour to the end, then the chat with starter questions.

const app = require('../lib/app.cjs');
const { installTtsProbe, readTtsProbe } = require('../lib/instrument.cjs');

const TOUR_LIMIT_MS = 180_000; // the tour is about 55 s; three times that is a hang

/** Keep the longest version of each line: captions and questions are typed out a few letters at a time. */
function keepLongest(list, s) {
  if (!s) return;
  const i = list.findIndex((l) => s.startsWith(l) || l.startsWith(s));
  if (i < 0) list.push(s);
  else if (s.length > list[i].length) list[i] = s;
}

module.exports = {
  id: 'tour',
  grid: 'P1',
  title: 'First visit: Meet Icarus card, 1-minute tour, chat with starter chips',
  envs: ['chromium-laptop', 'chromium-phone', 'webkit-laptop', 'webkit-phone'],
  async run({ page, run, base }) {
    await run.step(page, 'Open the app as a first-time visitor', async () => {
      await installTtsProbe(page);
      run.timing('app_ready_ms', await app.gotoApp(page, base));
      await app.sleep(1200);
    });

    await run.step(page, '"Meet Icarus" card appears', async () => {
      const card = app.introCard(page);
      await card.waitFor({ state: 'visible', timeout: 8000 });
      run.check('"Meet Icarus" card visible on first visit', true);
      const box = await card.boundingBox();
      const vp = page.viewportSize();
      run.check('"Meet Icarus" card fits the screen', box && box.y >= 0 && box.y + box.height <= vp.height + 1 && box.x >= 0 && box.x + box.width <= vp.width + 1, box ? `card ${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.y)}, viewport ${vp.width}x${vp.height}` : 'no box', 'soft');
      run.check('"Watch the 1-minute tour" button present', await page.getByRole('button', { name: /Watch the 1-minute tour/ }).isVisible());
    });

    let t0 = 0;
    await run.step(page, 'Click "Watch the 1-minute tour"', async () => {
      await page.getByRole('button', { name: /Watch the 1-minute tour/ }).click();
      t0 = Date.now();
      await page.waitForFunction(() => document.body.classList.contains('ic-touring'), null, { timeout: 6000 });
      run.timing('tour_start_ms', Date.now() - t0);
      run.check('Tour starts (mascot out, "Skip tour" bar shown)', (await app.tourState(page)).barVisible);
    });

    await run.step(page, 'Tour plays to the end ("Tour" pill comes back)', async () => {
      const lines = [];
      const asks = [];
      let maxDone = 0;
      let total = 0;
      let nextShot = 4000;
      let ended = false;
      let stalledSince = null;
      let lastSig = '';
      while (Date.now() - t0 < TOUR_LIMIT_MS) {
        const s = await app.tourState(page);
        maxDone = Math.max(maxDone, s.done);
        total = Math.max(total, s.total);
        keepLongest(lines, s.bubble);
        keepLongest(asks, s.ask);
        const elapsed = Date.now() - t0;
        if (elapsed >= nextShot) {
          await run.look(page, `tour at ${Math.round(elapsed / 1000)}s (step ${s.done} of ${s.total}, ${s.screen})`);
          nextShot += 8000;
        }
        // a tour that sits on the same caption for 40 s is stuck
        const sig = `${s.done}|${s.bubble}|${s.screen}`;
        if (sig !== lastSig) {
          lastSig = sig;
          stalledSince = Date.now();
        } else if (s.touring && Date.now() - stalledSince > 40_000) {
          run.note(`tour looked stuck for 40 s at step ${s.done} of ${s.total} on ${s.screen}: "${s.bubble.slice(0, 80)}"`);
          stalledSince = Date.now();
        }
        if (elapsed > 4000 && !s.touring && s.pillVisible && !s.barVisible) {
          ended = true;
          break;
        }
        await app.sleep(250);
      }
      const ms = Date.now() - t0;
      run.timing('tour_ms', ms);
      run.data.tour = { endedMs: ended ? ms : null, progress: `${maxDone}/${total}`, captions: lines, questions: asks };
      run.check('Tour finished and the "Tour" pill came back', ended, ended ? `${(ms / 1000).toFixed(1)} s` : `still running after ${(TOUR_LIMIT_MS / 1000)} s (progress ${maxDone}/${total})`);
      if (ended) run.check('Tour length close to the promised minute (40-90 s)', ms >= 40_000 && ms <= 90_000, `${(ms / 1000).toFixed(1)} s`, 'soft');
      run.check('Tour went through every step', total > 0 && maxDone >= total, `progress dots ${maxDone}/${total}`, 'soft');
      // The voice: every line's audio arrived in full? (Browsers report some of these requests as aborted anyway.)
      const tts = await readTtsProbe(page);
      const full = tts.filter((e) => e.status === 200 && e.ended && !e.cancelled);
      run.data.tourTts = {
        lines: tts.length,
        complete: full.length,
        seconds: +full.reduce((s, e) => s + (e.seconds ?? 0), 0).toFixed(1),
        problems: tts.filter((e) => !(e.status === 200 && e.ended && !e.cancelled)).map((e) => `"${e.text.slice(0, 40)}": status ${e.status}${e.cancelled ? ', cut off' : ''}${e.error ? `, ${e.error}` : ''}`),
        reportedAborted: run.events.filter((e) => e.kind === 'request.aborted' && /\/api\/tts/.test(e.text)).length,
      };
      run.check('Voice lines were fetched for the tour', tts.length > 0, `${tts.length} lines`, 'soft');
      run.check('Every voice line arrived in full', tts.length > 0 && full.length === tts.length, `${full.length}/${tts.length} complete, ${run.data.tourTts.seconds} s of audio${run.data.tourTts.problems.length ? `; ${run.data.tourTts.problems.join('; ')}` : ''}`, 'soft');
    });

    await run.step(page, 'After the tour: chat open with starter chips', async () => {
      await page.getByPlaceholder(app.INPUT_PLACEHOLDER).waitFor({ state: 'visible', timeout: 5000 });
      await app.sleep(900); // the chat slides up
      const st = await app.chatState(page);
      const first = st.messages.find((m) => m.role === 'icarus');
      const chips = first?.chips ?? [];
      const found = app.STARTER_CHIPS.filter((c) => chips.includes(c));
      run.data.afterTour = { welcome: first?.text ?? '', chips };
      run.check('Chat panel open after the tour', st.open);
      run.check('Starter chips shown', found.length >= 2, `chips: ${chips.join(' | ') || 'none'}`);
      const input = await page.getByPlaceholder(app.INPUT_PLACEHOLDER).boundingBox();
      const vp = page.viewportSize();
      run.check('Chat input visible without scrolling', input && input.y >= 0 && input.y + input.height <= vp.height, input ? `input at y=${Math.round(input.y)} of ${vp.height}` : 'no input', 'soft');
    });
  },
};
