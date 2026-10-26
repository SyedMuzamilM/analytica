import type { AnalyticsReport, BreakdownRow, MetricSet, Site } from '../../packages/contracts';

// Synthetic, deterministic daily slices. Never persisted or mixed into live reports.
export const demoSites: Site[] = [
  { id: 'demo-orbit', workspaceId: 'demo', name: 'Orbit', domain: 'orbit.example', timezone: 'UTC', privacyMode: 'attribution', status: 'active', createdAt: 0, dailyLimit: 10000 },
  { id: 'demo-fieldnotes', workspaceId: 'demo', name: 'Fieldnotes', domain: 'fieldnotes.example', timezone: 'UTC', privacyMode: 'attribution', status: 'active', createdAt: 0, dailyLimit: 10000 },
];

const sources = ['Google', 'Direct', 'Twitter / X', 'GitHub', 'ChatGPT', 'Newsletter', 'Reddit'];
const paths = ['/', '/pricing', '/blog/a-better-workflow', '/features', '/docs', '/about'];
const countries = ['United States', 'United Kingdom', 'Germany', 'India', 'Canada'];
const devices = ['Desktop', 'Mobile', 'Tablet'];
const events = ['signup', 'start_trial', 'newsletter_subscribe'];
const dayMs = 86_400_000;
type Slice = { day: number; source: string; path: string; country: string; device: string; count: number; sessions: number; goals: number };

function buildSlices(siteId: string, today: number) {
  const slices: Slice[] = [];
  const scale = siteId === 'demo-fieldnotes' ? 0.42 : 1;
  for (let day = 0; day < 181; day++) {
    for (let s = 0; s < sources.length; s++) {
      for (let p = 0; p < paths.length; p++) {
        const wave = 1 + 0.23 * Math.sin((day + 2) * 0.8) + 0.12 * Math.cos(day * 0.3 + p);
        const growth = 1.26 - day * 0.0017;
        const count = Math.max(1, Math.round((57 - s * 6) * (1 - p * 0.115) * wave * growth * scale));
        slices.push({
          day: today - day * dayMs,
          source: sources[s], path: paths[p], country: countries[(s + p + day) % countries.length],
          device: devices[(s + p + day * 2) % devices.length], count,
          sessions: Math.round(count * 0.72), goals: Math.round(count * (p === 1 ? 0.085 : 0.025)),
        });
      }
    }
  }
  return slices;
}

function metrics(rows: Slice[]): MetricSet {
  const pageviews = rows.reduce((sum, row) => sum + row.count, 0);
  const sessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  const goals = rows.reduce((sum, row) => sum + row.goals, 0);
  return { pageviews, sessions, visitors: Math.round(sessions * 0.83), goals, bounceRate: pageviews ? 0.326 : 0, avgDuration: pageviews ? 142_000 : 0 };
}

function breakdown(rows: Slice[], key: 'source' | 'path' | 'country' | 'device'): BreakdownRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + row.count);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function demoReport(params: URLSearchParams, site: Site): AnalyticsReport {
  const today = Math.floor(Date.now() / dayMs) * dayMs;
  const period = params.get('period') ?? '7d';
  const days = period === '90d' ? 90 : period === '30d' ? 30 : 7;
  const from = today - (days - 1) * dayMs;
  const to = today + dayMs;
  const filters = ['source', 'path', 'country', 'device'] as const;
  const all = buildSlices(site.id, today).filter(row => filters.every(key => !params.get(key) || row[key] === params.get(key)));
  let current = all.filter(row => row.day >= from && row.day < to);
  let previous = all.filter(row => row.day >= from - days * dayMs && row.day < from);
  if (params.get('event')) {
    const index = events.indexOf(params.get('event')!);
    current = index < 0 ? [] : current.map(row => ({ ...row, count: Math.round(row.count * (0.45 - index * 0.1)), sessions: Math.round(row.sessions * (0.45 - index * 0.1)), goals: Math.round(row.goals * (0.65 - index * 0.15)) }));
    previous = index < 0 ? [] : previous.map(row => ({ ...row, count: Math.round(row.count * (0.45 - index * 0.1)), sessions: Math.round(row.sessions * (0.45 - index * 0.1)), goals: Math.round(row.goals * (0.65 - index * 0.15)) }));
  }
  const totals = metrics(current);
  return {
    range: { from, to, timezone: 'UTC', label: `Last ${days} days` },
    current: totals, previous: metrics(previous), online: Math.max(0, Math.round(totals.pageviews / days / 160)),
    series: Array.from({ length: days }, (_, index) => {
      const date = from + index * dayMs;
      const value = metrics(current.filter(row => row.day === date));
      return { date: new Date(date).toISOString().slice(0, 10), pageviews: value.pageviews, sessions: value.sessions, goals: value.goals };
    }),
    sources: breakdown(current, 'source'), pages: breakdown(current, 'path'), countries: breakdown(current, 'country'), devices: breakdown(current, 'device'),
    events: events.filter(name => !params.get('event') || params.get('event') === name).map((name, index) => ({ name, count: Math.round(totals.goals * [0.57, 0.29, 0.14][index]) })),
    lastEventAt: Date.now() - 39_000, privacyMode: 'attribution', coverage: 'Synthetic demonstration data',
  };
}
