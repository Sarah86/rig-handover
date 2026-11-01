import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

const line = (job: string, status: 'ok' | 'retry' | 'fail', at: string) =>
  JSON.stringify({ at, job, status, owner: 'rook', ...(status === 'ok' ? {} : { error: 'upstream 503' }) });

const lines = (...entries: string[]) => entries.join('\n') + '\n';

const nights = {
  '2026-01-01': lines(
    line('zeta/sync', 'ok', '2026-01-01T23:00:00+01:00'),
    line('alpha/refresh', 'retry', '2026-01-01T23:10:00+01:00'),
    line('alpha/refresh', 'retry', '2026-01-01T23:11:00+01:00'),
    line('alpha/refresh', 'retry', '2026-01-01T23:12:00+01:00'),
    line('alpha/refresh', 'ok', '2026-01-01T23:13:00+01:00'),
    line('mid/clean', 'fail', '2026-01-01T23:20:00+01:00'),
    line('mid/clean', 'ok', '2026-01-01T23:21:00+01:00'),
    line('quiet/job', 'retry', '2026-01-01T23:30:00+01:00'),
    line('quiet/job', 'ok', '2026-01-01T23:31:00+01:00'),
  ),
  '2026-01-02': '',
  '2026-01-03': lines(
    line('only/job', 'ok', '2026-01-03T23:00:00+01:00'),
    'this is not json',
  ),
};

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
  await Promise.all(
    Object.entries(nights).map(([night, content]) => writeFile(join(runsDir, `${night}.jsonl`), content)),
  );
  app = createApp({ ...config, runsDir });
});

afterAll(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

const rowHtml = (html: string, job: string) => {
  const row = html.match(/<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*?<\/tr>/g)?.find((candidate) => candidate.includes(job));
  expect(row, `row for ${job}`).toBeDefined();
  return row as string;
};

const jobsInPageOrder = (html: string, jobs: string[]) =>
  [...jobs].sort((a, b) => html.indexOf(a) - html.indexOf(b));

describe('GET /digest/:night', () => {
  it('shows each job sorted by job, with warn on retries of 3 or more or any fail', async () => {
    const res = await app.request('/digest/2026-01-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(jobsInPageOrder(html, ['zeta/sync', 'alpha/refresh', 'mid/clean', 'quiet/job'])).toEqual([
      'alpha/refresh',
      'mid/clean',
      'quiet/job',
      'zeta/sync',
    ]);
    expect(rowHtml(html, 'alpha/refresh')).toContain('warn');
    expect(rowHtml(html, 'mid/clean')).toContain('warn');
    expect(rowHtml(html, 'quiet/job')).not.toContain('warn');
    expect(rowHtml(html, 'zeta/sync')).not.toContain('warn');
  });

  it('gives 404 for a night with no file', async () => {
    const res = await app.request('/digest/2026-01-09');
    expect(res.status).toBe(404);
  });

  it('says "nothing ran" for an empty file', async () => {
    const res = await app.request('/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('gives 200 for a file with a bad line', async () => {
    const res = await app.request('/digest/2026-01-03');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('only/job');
    expect(html).toContain('1 bad line skipped');
  });
});

describe('GET /api/digest/:night', () => {
  it('gives the digest as JSON with rows sorted by job', async () => {
    const res = await app.request('/api/digest/2026-01-01');
    const digest = (await res.json()) as NightDigest;
    expect(res.status).toBe(200);
    expect(digest.night).toBe('2026-01-01');
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha/refresh', 'mid/clean', 'quiet/job', 'zeta/sync']);
    expect(digest.badLines).toBe(0);
  });

  it('gives 404 for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-01-09');
    expect(res.status).toBe(404);
  });

  it('gives 200 with no rows for an empty file', async () => {
    const res = await app.request('/api/digest/2026-01-02');
    const digest = (await res.json()) as NightDigest;
    expect(res.status).toBe(200);
    expect(digest.rows).toEqual([]);
  });

  it('counts a bad line in badLines', async () => {
    const res = await app.request('/api/digest/2026-01-03');
    const digest = (await res.json()) as NightDigest;
    expect(res.status).toBe(200);
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual(['only/job']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app.request('/digest/2026-01-01')).text();
    const digest = (await (await app.request('/api/digest/2026-01-01')).json()) as NightDigest;
    const jobs = digest.rows.map((row) => row.job);
    expect(jobs.every((job) => html.includes(job))).toBe(true);
    expect(jobs.map((job) => html.indexOf(job))).toEqual([...jobs.map((job) => html.indexOf(job))].sort((a, b) => a - b));
  });
});
