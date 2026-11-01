import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight, type DigestRow, type NightDigest } from '../src/digest/types.js';

const NIGHT = '2026-11-01';

function runLine(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ at: '2026-11-01T01:00:00+01:00', job: 'a/job', status: 'ok', owner: 'rook', ...fields });
}

function rowFor(digest: NightDigest, job: string): DigestRow | undefined {
  return digest.rows.find((row) => row.job === job);
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = readNight('runs', '2026-10-28');

  if (digest === null) throw new Error('runs/2026-10-28.jsonl should be on disk');

  it('finds 5 jobs, sorted by job, and 1 bad line', () => {
    expect(digest.night).toBe('2026-10-28');
    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(digest.badLines).toBe(1);
  });

  it('counts good lines per status', () => {
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps digest/render with its null owner', () => {
    expect(rowFor(digest, 'digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      fails: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('keeps the last error after a later ok, and the offsets as logged', () => {
    expect(rowFor(digest, 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('leaves the truncated line out of lane/sync', () => {
    expect(rowFor(digest, 'lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastError: 'lock held',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('counts a fail on notes/backup', () => {
    expect(rowFor(digest, 'notes/backup')).toMatchObject({ fails: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('survives JSON with every key present', () => {
    expect(JSON.parse(JSON.stringify(digest))).toEqual(digest);
  });
});

describe('readNight on a temp night', () => {
  let tempDir: string;
  let runsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(import.meta.dirname, '.tmp-read-'));
    runsDir = join(tempDir, 'runs');
    mkdirSync(runsDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  function readLines(lines: string[]): NightDigest | null {
    writeFileSync(join(runsDir, `${NIGHT}.jsonl`), lines.join('\n'));
    return readNight(runsDir, NIGHT);
  }

  it('reads an empty file as a night with no rows', () => {
    expect(readLines([])).toEqual({
      night: NIGHT,
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('does not count blank lines as bad', () => {
    expect(readLines(['', '   ', '\t', ''])?.badLines).toBe(0);
    expect(readLines([runLine(), '', runLine(), ''])).toMatchObject({ badLines: 0, counts: { ok: 2 } });
  });

  it('reads a CRLF file line by line', () => {
    expect(readLines([`${runLine()}\r`, '\r', `${runLine()}\r`])).toMatchObject({ badLines: 0, counts: { ok: 2 } });
  });

  it('tells a night of only bad lines from an empty one', () => {
    expect(readLines(['{"at":', 'not json'])).toEqual({
      night: NIGHT,
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 2,
    });
  });

  it.each([
    ['a number', '42'],
    ['null', 'null'],
    ['a string', '"ok"'],
    ['an array', '[]'],
    ['an empty object', '{}'],
    ['no at', '{"job":"a/job","status":"ok","owner":"rook"}'],
    ['no job', '{"at":"2026-11-01T01:00:00+01:00","status":"ok","owner":"rook"}'],
    ['no status', '{"at":"2026-11-01T01:00:00+01:00","job":"a/job","owner":"rook"}'],
    ['no owner key', '{"at":"2026-11-01T01:00:00+01:00","job":"a/job","status":"ok"}'],
    ['an empty job', runLine({ job: '' })],
    ['an empty at', runLine({ at: '' })],
    ['an unknown status', runLine({ status: 'skipped' })],
    ['a number for an owner', runLine({ owner: 7 })],
    ['a number for an error', runLine({ error: 503 })],
  ])('counts %s as a bad line, not a run', (_name, line) => {
    expect(readLines([line])).toMatchObject({ rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 1 });
  });

  it('takes the owner from the last line, even when it is null', () => {
    const digest = readLines([runLine({ owner: 'lane-07' }), runLine({ owner: null })]);
    expect(digest?.rows[0]?.owner).toBeNull();
  });

  it('keeps the fail of a job that later passes', () => {
    const digest = readLines([runLine({ status: 'fail', error: 'quota exceeded' }), runLine()]);
    expect(digest?.rows[0]).toMatchObject({ fails: 1, lastStatus: 'ok', lastError: 'quota exceeded' });
  });

  it('takes first and last time from file order', () => {
    const digest = readLines([
      runLine({ at: '2026-11-01T02:00:00+01:00' }),
      runLine({ at: '2026-11-01T01:00:00+01:00' }),
    ]);
    expect(digest?.rows[0]).toMatchObject({
      firstAt: '2026-11-01T02:00:00+01:00',
      lastAt: '2026-11-01T01:00:00+01:00',
    });
  });

  it('handles a job named after an object property', () => {
    expect(readLines([runLine({ job: '__proto__' }), runLine({ job: 'constructor' })])?.rows).toHaveLength(2);
  });

  it('returns null for a night with no file', () => {
    expect(readNight(runsDir, NIGHT)).toBeNull();
  });

  it('returns null when the runs dir is missing', () => {
    expect(readNight(join(tempDir, 'nowhere'), NIGHT)).toBeNull();
  });

  it.each(['../secret', '../../secret', `../runs/${NIGHT}`, `${NIGHT}/../../secret`, `${NIGHT}.jsonl`, `${NIGHT}\n`, ''])(
    'never reaches the path with the night %j',
    (night) => {
      writeFileSync(join(tempDir, 'secret.jsonl'), `${runLine()}\n`);
      writeFileSync(join(runsDir, `${NIGHT}.jsonl`), `${runLine()}\n`);
      expect(readNight(runsDir, night)).toBeNull();
    },
  );
});
