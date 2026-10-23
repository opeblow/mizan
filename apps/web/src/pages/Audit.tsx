import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useResource } from "../lib/api";
import { dateTime, fmt } from "../lib/format";
import { Badge, Card, Hash, Loading, PageHead, Spinner } from "../components/ui";
import { IconAlert, IconCheck, IconShield } from "../components/icons";

export function Audit() {
  const { data, error } = useResource<any>("/api/audit?limit=150", ["batch", "certificate", "incident"], 2500);
  const [sweep, setSweep] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const runSweep = async () => {
    setRunning(true);
    try {
      setSweep(await api("/api/integrity/sweep"));
    } catch (e) {
      setSweep({ error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow="Tamper evidence"
        title="Audit trail"
        lede="Every action, by every role, is appended to a hash-chained log: each entry commits to the one before it. The current head is written into every batch manifest, whose hash is anchored on-chain, so the log is notarised every six hours of plant time."
        actions={
          <button className="btn primary" onClick={runSweep} disabled={running}>
            {running ? <Spinner /> : <IconShield size={14} />} Run full integrity sweep
          </button>
        }
      />

      <div className="grid g2">
        <Card title="Audit chain">
          {!data ? (
            <Loading error={error} />
          ) : data.chain.ok ? (
            <div className="callout good">
              <IconCheck size={16} style={{ color: "var(--good-text)" }} />
              <div>
                <strong>Intact.</strong> All {fmt(data.chain.entries)} entries re-hash to the stored chain.
              </div>
            </div>
          ) : (
            <div className="callout critical">
              <IconAlert size={16} style={{ color: "var(--critical)" }} />
              <div>
                <strong>Broken at entry #{data.chain.brokenAt}.</strong> An entry was edited or removed after it was written.
              </div>
            </div>
          )}
        </Card>
        <Card title="Database against chain">
          {!sweep ? (
            <p className="small ink2" style={{ margin: 0 }}>
              Recomputes the hash of every stored reading from its fields, rebuilds each window's Merkle tree and compares the root with the one anchored on-chain. Try it after running{" "}
              <span className="mono">pnpm tamper</span>, which edits a reading straight in the database the way a malicious insider would.
            </p>
          ) : sweep.error ? (
            <div className="callout critical">{sweep.error}</div>
          ) : sweep.ok ? (
            <div className="callout good">
              <IconCheck size={16} style={{ color: "var(--good-text)" }} />
              <div>
                <strong>No tampering.</strong> {fmt(sweep.readings)} readings in {fmt(sweep.batches)} windows match their on-chain roots.
              </div>
            </div>
          ) : (
            <div className="stack-sm">
              <div className="callout critical">
                <IconAlert size={16} style={{ color: "var(--critical)" }} />
                <div>
                  <strong>{sweep.broken.length} window{sweep.broken.length > 1 ? "s" : ""} no longer match the chain.</strong> Stored data was changed after anchoring.
                </div>
              </div>
              {sweep.broken.map((b: any) => (
                <div key={b.batchId} className="small row wrap">
                  <Link to={`/ledger/${b.batchId}`} className="mono">window {b.batchId}</Link>
                  <span className="ink2">{b.reason}</span>
                  {b.readingIds.map((r: number) => (
                    <Link key={r} to={`/verify/reading/${r}`} className="btn sm danger">Verify reading #{r}</Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Entries" sub="Newest first" pad={false}>
        {!data ? (
          <Loading error={error} />
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Subject</th>
                  <th>Entry hash</th>
                  <th>Previous</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e: any) => (
                  <tr key={e.seq}>
                    <td className="num mono">{e.seq}</td>
                    <td className="small nowrap">{dateTime(e.ts)}</td>
                    <td className="small">{e.actorName ?? e.actor}</td>
                    <td>
                      <Badge tone={/rejected|blocked|failed|confirmed|swap/.test(e.action) ? "critical" : /verified|claimed|issued|anchored/.test(e.action) ? "good" : "neutral"}>{e.action}</Badge>
                    </td>
                    <td className="mono small">{e.subject}</td>
                    <td><Hash value={e.hash} /></td>
                    <td><Hash value={e.prev_hash} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
