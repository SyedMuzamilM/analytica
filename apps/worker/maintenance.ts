import type { Bindings } from './env';
import { localMidnight } from './reports';

/** Bounded scheduled work; call again to resume. No request performs an unbounded purge. */
export async function runMaintenance(env: Pick<Bindings, 'DB'>, now = Date.now()) {
  const db = env.DB;
  const dirty = await db.prepare(`SELECT d.* FROM dirty_buckets d JOIN sites s ON s.id=d.site_id AND s.workspace_id=d.workspace_id WHERE s.status!='deleting' ORDER BY d.day LIMIT 20`).all<{ workspace_id: string; site_id: string; day: string; timezone: string }>();
  let rebuilt = 0;
  for (const bucket of dirty.results) {
    const nextDay = new Date(Date.parse(bucket.day + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
    // Wait until no permitted late client event can still modify this local day.
    if (localMidnight(nextDay, bucket.timezone) + 86_400_000 > now) continue;
    if (rebuilt >= 2) break;
    const args = [bucket.workspace_id, bucket.site_id, bucket.day, bucket.timezone];
    await db.batch([
      db.prepare('DELETE FROM daily_summaries WHERE workspace_id=? AND site_id=? AND day=? AND timezone=?').bind(...args),
      ...['total', 'source', 'path', 'country', 'event'].map(dimension => {
        const column = dimension === 'total' ? "''" : dimension === 'event' ? "COALESCE(name,'')" : dimension;
        const typeFilter = dimension === 'event' ? " AND type='goal'" : dimension === 'total' ? '' : " AND type='pageview'";
        return db.prepare(`INSERT INTO daily_summaries(workspace_id,site_id,day,timezone,dimension,name,pageviews,goals,definition_version,updated_at)
          SELECT workspace_id,site_id,local_day,timezone,?,${column},SUM(type='pageview'),SUM(type='goal'),1,?
          FROM analytics_events e WHERE workspace_id=? AND site_id=? AND local_day=? AND timezone=?${typeFilter}
          AND NOT EXISTS(SELECT 1 FROM visitor_suppressions v WHERE v.workspace_id=e.workspace_id AND v.site_id=e.site_id AND v.visitor_id=e.visitor_id) AND EXISTS(SELECT 1 FROM sites s WHERE s.workspace_id=e.workspace_id AND s.id=e.site_id AND s.status!='deleting') GROUP BY ${column}`).bind(dimension, now, ...args);
      }),
      db.prepare('DELETE FROM dirty_buckets WHERE workspace_id=? AND site_id=? AND day=? AND timezone=?').bind(...args),
    ]);
    rebuilt++;
  }
  const deleting = await db.prepare("SELECT workspace_id,id FROM sites WHERE status='deleting' AND deletion_completed_at IS NULL LIMIT 2").all<{ workspace_id: string; id: string }>();
  for (const site of deleting.results) {
    // Keep the site tombstone until payment/identity jobs are also finished.
    await db.batch(['analytics_events', 'analytics_sessions', 'daily_usage', 'daily_summaries', 'dirty_buckets'].map(table => db.prepare(`DELETE FROM ${table} WHERE rowid IN(SELECT rowid FROM ${table} WHERE workspace_id=? AND site_id=? LIMIT 250)`).bind(site.workspace_id, site.id)));
  }
  const cutoff = now - 90 * 86_400_000;
  const results = await db.batch([
    // Only expire an event after its summary bucket was successfully rebuilt.
    db.prepare(`DELETE FROM analytics_events WHERE rowid IN(SELECT e.rowid FROM analytics_events e WHERE e.received_at<? AND NOT EXISTS(SELECT 1 FROM dirty_buckets d WHERE d.workspace_id=e.workspace_id AND d.site_id=e.site_id AND d.day=e.local_day AND d.timezone=e.timezone) LIMIT 250)`).bind(cutoff),
    db.prepare('DELETE FROM analytics_sessions WHERE rowid IN(SELECT s.rowid FROM analytics_sessions s WHERE s.last_received_at<? AND NOT EXISTS(SELECT 1 FROM analytics_events e WHERE e.workspace_id=s.workspace_id AND e.site_id=s.site_id AND e.session_id=s.id) LIMIT 250)').bind(cutoff),
    db.prepare("DELETE FROM daily_usage WHERE rowid IN(SELECT rowid FROM daily_usage WHERE day<? LIMIT 250)").bind(new Date(now - 100 * 86_400_000).toISOString().slice(0, 10)),
    db.prepare('DELETE FROM installation_usage WHERE day<?').bind(new Date(now - 100 * 86_400_000).toISOString().slice(0, 10)),
    db.prepare('DELETE FROM daily_summaries WHERE rowid IN(SELECT rowid FROM daily_summaries WHERE day<? LIMIT 250)').bind(new Date(now - 396 * 86_400_000).toISOString().slice(0, 10)),
  ]);
  return { rebuilt, deletingSites: deleting.results.length, expiredRows: results.reduce((n, r) => n + r.meta.changes, 0) };
}
