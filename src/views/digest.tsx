import type { DigestRow, NightDigest } from '../digest/types.js';

const retryWarnThreshold = 3;

const orDash = (value: string | null) => value ?? '—';

const needsWarning = (row: DigestRow) => row.retries >= retryWarnThreshold || row.fails > 0;

export function DigestPage({ digest }: { digest: NightDigest }) {
  const nothingRan = digest.rows.length === 0 && digest.badLines === 0;
  return (
    <>
      <h1>digest · {digest.night}</h1>
      {nothingRan ? (
        <p class="mute">nothing ran</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>job</th>
                <th>owner</th>
                <th>runs</th>
                <th>retries</th>
                <th>last status</th>
                <th>last error</th>
                <th>first</th>
                <th>last</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map((row) => (
                <tr class={needsWarning(row) ? 'warn' : undefined}>
                  <td>{row.job}</td>
                  <td>{orDash(row.owner)}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{orDash(row.lastError)}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {digest.badLines > 0 && <p class="mute">{digest.badLines} bad {digest.badLines === 1 ? 'line' : 'lines'} skipped</p>}
        </>
      )}
    </>
  );
}
