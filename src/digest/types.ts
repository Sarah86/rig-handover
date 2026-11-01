// The contract between the run log reader (#3) and its consumers: page (#4), JSON (#5), board (#6).

export type RunStatus = 'ok' | 'retry' | 'fail';

export type StatusCounts = Record<RunStatus, number>;

// One job's night, built from its good lines in file order. Every key is always present, so the
// JSON never drops one: `null` means the log has no value, and views render it as `—`.
export type DigestRow = {
  job: string;
  // From the job's last line. A row with a null owner is kept.
  owner: string | null;
  // All of the job's lines; `retries` and `fails` are the ones with that status.
  runs: number;
  retries: number;
  // `lastStatus` can't answer "any fail": a job can fail and then pass.
  fails: number;
  lastStatus: RunStatus;
  // The job's most recent `error`, kept even when a later line is ok. Null if it logged none.
  lastError: string | null;
  // `at` exactly as logged, offset included. Never converted.
  firstAt: string;
  lastAt: string;
};

// A whole night, serialisable as is, so the page and the JSON read the same object.
export type NightDigest = {
  night: string;
  // One row per job, sorted by job. Consumers keep this order.
  rows: DigestRow[];
  // Good lines per status across the night, for the board.
  counts: StatusCounts;
  // Lines that are not JSON or not a run line. Blank lines don't count. A night of only bad
  // lines has no rows and `badLines > 0`, which is not the same as an empty night.
  badLines: number;
};

// Null when the night has no file, which includes a `night` that isn't YYYY-MM-DD, because routes
// pass it straight from the URL and it must never reach the path. An empty file is a
// NightDigest with no rows. Bad lines are counted, never thrown.
export { readNight } from './read.js';
