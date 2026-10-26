import type { AnalyticsReport, BreakdownRow, MetricSet, SeriesPoint } from '../../packages/contracts';
import type { SiteRecord } from './analytics';

const DAY = 86_400_000;
const dateFormats = new Map<string, Intl.DateTimeFormat>();
export function localDate(time: number, timezone: string): string {
  let format = dateFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (dateFormats.size >= 64) dateFormats.clear();
    dateFormats.set(timezone, format);
  }
  const parts = format.formatToParts(time);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDays(day: string, count: number): string { return new Date(Date.parse(day + 'T12:00:00Z') + count * DAY).toISOString().slice(0, 10); }
/** Earliest UTC instant belonging to this site-local date. Handles DST and skipped dates. */
export function localMidnight(day: string, timezone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T00:00:00Z')) || new Date(Date.parse(day + 'T00:00:00Z')).toISOString().slice(0, 10) !== day) throw new Error('invalid_date');
  const approx = Date.parse(day + 'T00:00:00Z');
  let lo = approx - 36 * 3_600_000, hi = approx + 36 * 3_600_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(mid, timezone) < day) lo = mid + 1; else hi = mid;
  }
  if (localDate(lo, timezone) !== day) throw new Error('invalid_local_date');
  return lo;
}
export function resolveReportRange(query: Record<string, string>, timezone: string, now = Date.now()) {
  const today = localDate(now, timezone);
  const period = query.period || '7d';
  let first: string, last: string;
  if (period === 'custom') { first = query.from || ''; last = query.to || ''; }
  else {
    const n = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0;
    if (!n) throw new Error('invalid_period');
    first = addDays(today, -(n - 1)); last = today;
  }
  const from = localMidnight(first, timezone);
  localMidnight(last, timezone); // validate before addDays can throw an unclassified RangeError
  const to = localMidnight(addDays(last, 1), timezone);
  const days = Math.round((Date.parse(last + 'T12:00:00Z') - Date.parse(first + 'T12:00:00Z')) / DAY) + 1;
  if (days < 1 || days > 90 || first > today || last > today) throw new Error('range_out_of_bounds');
  if (from < now - 90 * DAY - DAY) throw new Error('range_detail_expired');
  const previousFirst = addDays(first, -days);
  const previousTo = from;
  return { from, to, first, last, days, previousFrom: localMidnight(previousFirst, timezone), previousTo, timezone, label: period === 'today' ? 'Today' : period === 'custom' ? `${first} to ${last}` : `Last ${days} days` };
}
interface MetricRow { pageviews: number; sessions: number; visitors: number; goals: number; bounces: number; avg_duration: number }
function metrics(row: MetricRow | null, attribution: boolean): MetricSet {
  const r = row || { pageviews: 0, sessions: 0, visitors: 0, goals: 0, bounces: 0, avg_duration: 0 };
  return { pageviews: r.pageviews || 0, sessions: r.sessions || 0, visitors: attribution ? r.visitors || 0 : null, goals: r.goals || 0, bounceRate: r.sessions ? r.bounces / r.sessions : 0, avgDuration: Math.round(r.avg_duration || 0) };
}
const filterCols: Record<string, string> = { source: 'source', path: 'path', country: 'country', device: 'device' };
function filterWhere(query: Record<string, string>, from: number, to: number, alias = 'e') {
  const clauses: string[] = [], params: Array<string | number> = [];
  for (const [key, column] of Object.entries(filterCols)) {
    if (!query[key]) continue;
    if (query[key].length > 500) throw new Error('invalid_filter');
    clauses.push(`${alias}.${column}=?`); params.push(query[key]);
  }
  // Event filters qualify sessions that completed that goal in this period.
  // Their pageviews and acquisition remain visible instead of selecting only
  // goal rows and making every pageview breakdown impossible.
  if (query.event) {
    if (query.event.length > 64) throw new Error('invalid_filter');
    clauses.push(`EXISTS(SELECT 1 FROM analytics_events g WHERE g.workspace_id=${alias}.workspace_id AND g.site_id=${alias}.site_id AND g.session_id=${alias}.session_id AND g.type='goal' AND g.name=? AND g.ts>=? AND g.ts<?)`);
    params.push(query.event, from, to);
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}
const unsuppressed = (alias: string) => `NOT EXISTS(SELECT 1 FROM visitor_suppressions p WHERE p.workspace_id=${alias}.workspace_id AND p.site_id=${alias}.site_id AND p.visitor_id=${alias}.visitor_id)`;
export async function buildReport(db: D1Database, site: SiteRecord, query: Record<string, string>, now = Date.now()): Promise<AnalyticsReport> {
  const range = resolveReportRange(query, site.timezone, now);
  const filter = filterWhere(query, range.from, range.to);
  const prefix = [site.workspace_id, site.id];
  const where = `e.workspace_id=? AND e.site_id=? AND e.ts>=? AND e.ts<? AND e.type!='engagement' AND ${unsuppressed('e')}${filter.sql}`;
  const metricStatement = (from: number, to: number) => {
    const periodFilter = filterWhere(query, from, to);
    const periodWhere = `e.workspace_id=? AND e.site_id=? AND e.ts>=? AND e.ts<? AND e.type!='engagement' AND ${unsuppressed('e')}${periodFilter.sql}`;
    const metricSql = `WITH selected AS (SELECT e.* FROM analytics_events e WHERE ${periodWhere}),
    eligible AS (SELECT s.* FROM analytics_sessions s WHERE s.workspace_id=? AND s.site_id=? AND s.started_at>=? AND s.started_at<?
      AND EXISTS(SELECT 1 FROM selected e WHERE e.session_id=s.id))
    SELECT (SELECT COUNT(*) FROM selected WHERE type='pageview') AS pageviews,
      (SELECT COUNT(*) FROM selected WHERE type='goal') AS goals,
      (SELECT COUNT(DISTINCT visitor_id) FROM selected) AS visitors,
      COUNT(*) AS sessions,
      COALESCE(SUM(CASE WHEN pageviews=1 AND goals=0 THEN 1 ELSE 0 END),0) AS bounces,
      COALESCE(AVG(duration),0) AS avg_duration FROM eligible`;
    return db.prepare(metricSql).bind(...prefix, from, to, ...periodFilter.params, ...prefix, from, to);
  };
  const dimensionStatement = (column: string, type?: string) => db.prepare(`SELECT ${column} AS name,COUNT(*) AS count FROM analytics_events e WHERE ${where}${type ? ' AND e.type=?' : ''} GROUP BY ${column} ORDER BY count DESC,name LIMIT 100`).bind(...prefix, range.from, range.to, ...filter.params, ...(type ? [type] : []));
  const [current, previous, seriesRows, sources, pages, countries, devices, events, online, last] = await db.batch([
    metricStatement(range.from, range.to), metricStatement(range.previousFrom, range.previousTo),
    db.prepare(`SELECT e.local_day AS date,SUM(e.type='pageview') AS pageviews,COUNT(DISTINCT CASE WHEN s.started_at>=? AND s.started_at<? AND s.started_day=e.local_day THEN e.session_id END) AS sessions,SUM(e.type='goal') AS goals FROM analytics_events e JOIN analytics_sessions s ON s.workspace_id=e.workspace_id AND s.site_id=e.site_id AND s.id=e.session_id WHERE ${where} GROUP BY e.local_day ORDER BY date`).bind(range.from, range.to, ...prefix, range.from, range.to, ...filter.params),
    dimensionStatement('source', 'pageview'), dimensionStatement('path', 'pageview'), dimensionStatement('country', 'pageview'), dimensionStatement('device', 'pageview'), dimensionStatement('name', 'goal'),
    db.prepare(`SELECT COUNT(*) AS n FROM analytics_sessions s WHERE workspace_id=? AND site_id=? AND last_received_at>? AND last_interaction_at>? AND ${unsuppressed('s')}`).bind(...prefix, now - 300_000, now - 1_800_000),
    db.prepare(`SELECT MAX(received_at) AS ts FROM analytics_events e WHERE workspace_id=? AND site_id=? AND ${unsuppressed('e')}`).bind(...prefix),
  ]);
  const byDate = new Map((seriesRows.results as unknown as SeriesPoint[]).map(r => [r.date, r]));
  const series: SeriesPoint[] = [];
  for (let i = 0; i < range.days; i++) { const date = addDays(range.first, i); series.push(byDate.get(date) || { date, pageviews: 0, sessions: 0, goals: 0 }); }
  const breakdown = (result: D1Result) => (result.results as unknown as BreakdownRow[]).map(r => ({ name: r.name || 'Unknown', count: r.count }));
  return {
    range: { from: range.from, to: range.to, timezone: site.timezone, label: range.label },
    current: metrics(current.results[0] as unknown as MetricRow, site.privacy_mode === 'attribution'),
    previous: metrics(previous.results[0] as unknown as MetricRow, site.privacy_mode === 'attribution'),
    online: (online.results[0] as { n: number })?.n || 0, series,
    sources: breakdown(sources), pages: breakdown(pages), countries: breakdown(countries), devices: breakdown(devices), events: breakdown(events),
    lastEventAt: (last.results[0] as { ts: number | null })?.ts || null,
    privacyMode: site.privacy_mode,
    coverage: (range.previousFrom < now - 90 * DAY ? 'Previous-period comparison may be incomplete because detail expires after 90 days. ' : '') + (site.privacy_mode === 'aggregate' ? 'Document-session estimates. Full page navigation creates a new document ID; returning people and funnels are unavailable. Detail is retained for 90 days.' : 'Distinct consented browser IDs within retained detail, not verified people. Sessions start after 30 minutes without interaction. Detail is retained for 90 days.'),
  };
}
