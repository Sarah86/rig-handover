import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, RunStatus, StatusCounts } from './types.js';

const NIGHT_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const RUN_STATUSES: readonly unknown[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isRunLine(value: unknown): value is RunLine {
  if (typeof value !== 'object' || value === null) return false;
  const { at, job, status, owner, error } = value as Record<string, unknown>;
  return (
    isNonEmptyString(at) &&
    isNonEmptyString(job) &&
    RUN_STATUSES.includes(status) &&
    (owner === null || typeof owner === 'string') &&
    (error === undefined || error === null || typeof error === 'string')
  );
}

function parseRunLine(line: string): RunLine | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRunLine(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readNightFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function addRunLine(row: DigestRow | undefined, line: RunLine): DigestRow {
  return {
    job: line.job,
    owner: line.owner,
    runs: (row?.runs ?? 0) + 1,
    retries: (row?.retries ?? 0) + (line.status === 'retry' ? 1 : 0),
    fails: (row?.fails ?? 0) + (line.status === 'fail' ? 1 : 0),
    lastStatus: line.status,
    lastError: line.error ?? row?.lastError ?? null,
    firstAt: row?.firstAt ?? line.at,
    lastAt: line.at,
  };
}

function toRows(lines: RunLine[]): DigestRow[] {
  const rowsByJob = new Map<string, DigestRow>();
  for (const line of lines) {
    rowsByJob.set(line.job, addRunLine(rowsByJob.get(line.job), line));
  }
  return [...rowsByJob.values()].sort((a, b) => (a.job < b.job ? -1 : 1));
}

function countStatuses(lines: RunLine[]): StatusCounts {
  const countOf = (status: RunStatus) => lines.filter((line) => line.status === status).length;
  return { ok: countOf('ok'), retry: countOf('retry'), fail: countOf('fail') };
}

export function readNight(runsDir: string, night: string): NightDigest | null {
  if (!NIGHT_FORMAT.test(night)) return null;

  const text = readNightFile(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const filledLines = text.split('\n').filter((line) => line.trim() !== '');
  const runLines = filledLines.map(parseRunLine).filter((line) => line !== null);

  return {
    night,
    rows: toRows(runLines),
    counts: countStatuses(runLines),
    badLines: filledLines.length - runLines.length,
  };
}
