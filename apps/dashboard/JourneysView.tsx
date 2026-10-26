import { useEffect, useState } from "react";
import type { Site, Workspace } from "../../packages/contracts";
import { api, post, friendlyError, formatDuration } from "./api";
interface Session {
  id: string;
  visitorId: string;
  startedAt: number;
  pageviews: number;
  goals: number;
  duration: number;
  entryPage: string;
  exitPage: string;
  source: string;
}
interface Detail {
  visitorId: string;
  events: Array<{
    id: string;
    type: string;
    timestamp: number;
    path: string;
    name: string | null;
  }>;
  truncated: boolean;
}
export function JourneysView({
  site,
  workspace,
  demo,
  notify,
}: {
  site: Site;
  workspace: Workspace;
  demo: boolean;
  notify: (s: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  const base = `/api/workspaces/${workspace.id}/sites/${site.id}`;
  const eligible =
    !demo && site.privacyMode === "attribution" && workspace.role !== "viewer";
  useEffect(() => {
    if (!eligible) return;
    const ac = new AbortController();
    setLoading(true);
    setError("");
    api<{ sessions: Session[] }>(`${base}/journeys?limit=50`, {
      signal: ac.signal,
    })
      .then((r) => setSessions(r.sessions))
      .catch((e) => {
        if (!ac.signal.aborted) setError(friendlyError(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [base, eligible, revision]);
  async function open(visitor: string) {
    setError("");
    try {
      setDetail(await api<Detail>(`${base}/journeys/${visitor}`));
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  if (!eligible)
    return (
      <section className="panel feature-empty">
        <h2>Understand a visit, one step at a time.</h2>
        <p>
          {demo
            ? "Visitor journeys are available for real consent-enabled sites. The demo does not contain individual visitor records."
            : site.privacyMode !== "attribution"
              ? "Aggregate mode does not preserve visitor journeys. Create a separate attribution-mode site when you need consent-controlled journeys."
              : "Visitor detail is available to workspace owners and administrators."}
        </p>
      </section>
    );
  return (
    <div className="analysis-feature">
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Recent sessions</h2>
          <span className="small-pill">Last 90 days</span>
        </div>
        <p className="feature-note">
          Random browser identifiers describe observed activity. They are not
          verified people or identities.
        </p>
        {loading && (
          <p className="feature-note" role="status">
            Loading sessions…
          </p>
        )}
        {!sessions.length && !loading && (
          <div className="feature-empty">
            <h2>No recorded journeys yet.</h2>
            <p>
              Visits appear after your website grants consent and sends its
              first event.
            </p>
          </div>
        )}
        <p className="feature-note mobile-table-note">
          Swipe the table to see all session details.
        </p>
        <div
          className="table-scroll"
          role="region"
          aria-label="Recent session details"
          tabIndex={0}
        >
          <table className="journey-table">
            <thead>
              <tr>
                <th>Entry page</th>
                <th>Source</th>
                <th>Pageviews</th>
                <th>Goals</th>
                <th>Engagement</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button
                      className="text-button"
                      aria-label={`Open activity for browser ${s.visitorId.slice(0, 8)}, entering ${s.entryPage}`}
                      onClick={() => void open(s.visitorId)}
                    >
                      {s.entryPage}
                    </button>
                  </td>
                  <td>{s.source}</td>
                  <td>{s.pageviews}</td>
                  <td>{s.goals}</td>
                  <td>{formatDuration(s.duration)}</td>
                  <td>
                    {new Date(s.startedAt).toLocaleString(undefined, {
                      timeZone: site.timezone,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {detail && (
        <section className="panel feature-form">
          <div className="panel-heading">
            <h2>Visitor activity</h2>
            <button className="text-button" onClick={() => setDetail(null)}>
              Close activity
            </button>
          </div>
          <p className="feature-note">
            Browser ID <code>{detail.visitorId}</code>
          </p>
          <ol className="journey-events">
            {detail.events.map((e) => (
              <li key={e.id}>
                <time>
                  {new Date(e.timestamp).toLocaleString(undefined, {
                    timeZone: site.timezone,
                  })}
                </time>
                <strong>{e.type === "goal" ? e.name : e.path}</strong>
                <span>{e.type}</span>
              </li>
            ))}
          </ol>
          {detail.truncated && (
            <p className="coverage-warning">
              Only the latest retained activity is shown. This timeline is
              truncated.
            </p>
          )}
          <button
            className="button danger small"
            onClick={async () => {
              if (
                !confirm(
                  "Erase this browser identifier and its retained visit details? Future events with the same identifier will be suppressed.",
                )
              )
                return;
              try {
                await post(`${base}/erasure`, { visitorId: detail.visitorId });
                setDetail(null);
                setRevision((x) => x + 1);
                notify(
                  "Visitor erasure scheduled. Activity is now hidden and new events are suppressed.",
                );
              } catch (e) {
                setError(friendlyError(e));
              }
            }}
          >
            Erase visitor activity
          </button>
        </section>
      )}
    </div>
  );
}
