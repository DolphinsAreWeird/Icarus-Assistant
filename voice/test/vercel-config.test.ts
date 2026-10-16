// I17: vercel.json is well formed, every same-origin path the app requests is covered by a rewrite or a static
// file, and the static build produces the files the app loads. No Vercel deploy is performed or simulated here
// beyond a local matcher for the rewrite sources.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const config = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
type Rewrite = { source: string; destination: string };
const rewrites: Rewrite[] = config.rewrites;

// Vercel source syntax subset used here: literal segments, ":name" and ":name*".
function sourceToRegExp(source: string): RegExp {
  const body = source.split('/').map(seg => (/^:\w+\*$/.test(seg) ? '.*' : /^:\w+$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/');
  return new RegExp(`^${body}$`);
}
const rewriteHit = (p: string) => rewrites.find(r => sourceToRegExp(r.source).test(p));
const originOf = (r: Rewrite) => new URL(r.destination.replace(':path*', 'x')).origin;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const full = path.join(dir, f);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('vercel.json', () => {
  it('has the shape Vercel expects', () => {
    expect(config.outputDirectory).toBe('vercel-dist');
    expect(config.buildCommand).toBe('node scripts/build-vercel.mjs');
    expect(rewrites.length).toBeGreaterThan(0);
    for (const r of rewrites) {
      expect(r.source).toMatch(/^\/[\w-]+\/:path\*$/);
      const dest = new URL(r.destination.replace(':path*', 'x'));
      expect(dest.protocol).toBe('https:');
      // Same prefix on the other side: /brain/x on Vercel is /brain/x on the service.
      expect(dest.pathname).toBe(r.source.replace(':path*', 'x'));
    }
    expect(new Set(rewrites.map(originOf)).size).toBe(1); // a single stateful service
  });

  it('uses only the documented placeholder origin (no invented deployed URL)', () => {
    expect(rewrites.every(r => r.destination.startsWith('https://YOUR-ICARUS-SERVICE.onrender.com/'))).toBe(true);
  });

  it('redirects / and /app to /app/ so the relative asset URLs resolve', () => {
    const dest = (s: string) => config.redirects.find((r: { source: string }) => r.source === s)?.destination;
    expect(dest('/')).toBe('/app/');
    expect(dest('/app')).toBe('/app/');
  });

  it('covers every same-origin service path the app requests', () => {
    const files = [
      ...walk(path.join(ROOT, 'frontend', 'src')),
      ...walk(path.join(ROOT, 'voice', 'src', 'client')),
    ].filter(f => /\.tsx?$/.test(f));
    const found = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](\/(?:api|brain|mock)\/[^'"`?$]*)/g)) found.add(m[1]!);
    }
    expect(found.size).toBeGreaterThan(5); // the scan itself works
    expect(found).toContain('/api/scribe-token');
    expect(found).toContain('/api/health');
    expect([...found].some(p => p.startsWith('/mock/ubot/'))).toBe(true);
    for (const p of found) expect(rewriteHit(p), `no rewrite covers ${p}`).toBeTruthy();
    // /api/health tells the app its backend is at /brain.
    expect(rewriteHit('/brain/health')).toBeTruthy();
    expect(rewriteHit('/api/utopia/route')).toBeTruthy();
  });

  it('does not shadow the static app with a rewrite', () => {
    expect(rewriteHit('/app/app.js')).toBeUndefined();
    expect(rewriteHit('/app/')).toBeUndefined();
  });
});

describe('static build for Vercel', () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'icarus-vercel-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('builds the app under /app/ with everything it loads', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-vercel.mjs'), '--out', out], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, VERCEL: '' },
    });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    for (const f of ['app/index.html', 'app/app.js', 'app/prototype/Icarus Prototype.dc.html', 'app/prototype/Icarus Business Dashboard.dc.html']) {
      expect(existsSync(path.join(out, f)), f).toBe(true);
    }
    // Relative URLs the app uses resolve under /app/.
    expect(readFileSync(path.join(out, 'app', 'index.html'), 'utf8')).toContain('src="app.js"');
    if (existsSync(path.join(ROOT, 'frontend', 'public', 'mascot'))) expect(existsSync(path.join(out, 'app', 'mascot'))).toBe(true);
  }, 120_000);

  it('refuses to build on Vercel while the placeholder origin is still in vercel.json', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-vercel.mjs'), '--out', out], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, VERCEL: '1', ICARUS_ALLOW_PLACEHOLDER_ORIGIN: '' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('YOUR-ICARUS-SERVICE');
  });
});
