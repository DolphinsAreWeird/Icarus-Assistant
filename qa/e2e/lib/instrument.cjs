// Test-side instruments added to the page before it loads. They watch; they do not change what the app does.

/**
 * Watch the voice lines (/api/tts): how many bytes of audio arrived and whether each stream reached its end.
 * Browsers report many of these requests as "aborted" even when the whole line arrived and played, so this is the
 * reliable way to say whether the voice worked. 16-bit mono PCM: seconds = bytes / 2 / sample rate.
 */
async function installTtsProbe(page) {
  await page.addInitScript(() => {
    const log = [];
    Object.defineProperty(window, '__qaTts', { value: log, enumerable: false });
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (!/\/api\/tts(\?|$)/.test(url)) return orig(input, init);
      const t0 = performance.now();
      let text = '';
      try {
        text = String(JSON.parse(init?.body ?? '{}').text ?? '');
      } catch {
        // not JSON
      }
      const entry = { text: text.slice(0, 80), at: Math.round(t0), status: 0, bytes: 0, rate: 0, ended: false, cancelled: false, error: null };
      log.push(entry);
      let res;
      try {
        res = await orig(input, init);
      } catch (e) {
        entry.error = String(e?.name ?? e);
        throw e;
      }
      entry.status = res.status;
      entry.rate = Number(res.headers.get('x-sample-rate')) || 0;
      if (!res.ok || !res.body) return res;
      const reader = res.body.getReader();
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              entry.ended = true;
              controller.close();
              return;
            }
            entry.bytes += value.byteLength;
            controller.enqueue(value);
          } catch (e) {
            entry.error = String(e?.name ?? e);
            controller.error(e);
          }
        },
        cancel(reason) {
          entry.cancelled = true;
          return reader.cancel(reason);
        },
      });
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    };
  });
}

async function readTtsProbe(page) {
  const log = await page.evaluate(() => window.__qaTts ?? []).catch(() => []);
  return log.map((e) => ({ ...e, seconds: e.rate ? +(e.bytes / 2 / e.rate).toFixed(2) : null }));
}

module.exports = { installTtsProbe, readTtsProbe };
