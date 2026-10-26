import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { analyticsRoutes, collectRoutes, type SiteRecord } from '../apps/worker/analytics';
import { buildReport, localMidnight, resolveReportRange } from '../apps/worker/reports';
import { runMaintenance } from '../apps/worker/maintenance';
import type { CollectEvent } from '../packages/contracts';

const NOW = Date.now();
async function setup(overrides: Partial<SiteRecord> = {}) {
  await env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind('workspace_test', 'Test', NOW).run();
  const site: SiteRecord = { id: 'site_test_123', workspace_id: 'workspace_test', name: 'Example', domain: 'example.com', timezone: 'UTC', privacy_mode: 'aggregate', status: 'active', created_at: NOW, daily_limit: 5000, ...overrides };
  await env.DB.prepare('INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at,daily_limit) VALUES(?,?,?,?,?,?,?,?,?)').bind(site.id, site.workspace_id, site.name, site.domain, site.timezone, site.privacy_mode, site.status, site.created_at, site.daily_limit).run();
  return site;
}
function event(overrides: Partial<CollectEvent> = {}): CollectEvent { return { version: 1, id: crypto.randomUUID(), siteId: 'site_test_123', type: 'pageview', timestamp: NOW, sequence: 0, visitorId: 'visitor_test', sessionId: 'session_test', mode: 'aggregate', hostname: 'example.com', path: '/pricing', ...overrides }; }
async function send(body: CollectEvent, headers: Record<string, string> = {}) {
  return collectRoutes.request('https://analytics.example/collect', { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://example.com', 'user-agent': 'Mozilla/5.0 Chrome/130', ...headers }, body: JSON.stringify(body) }, env);
}
async function count(table: string) { return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n; }

describe('atomic collection on real D1', () => {
  it('accepts concurrent duplicate delivery exactly once including quota and session counters', async () => {
    await setup();
    const payload = event();
    const responses = await Promise.all(Array.from({ length: 8 }, () => send(payload)));
    expect(responses.every(r => r.status === 200 || r.status === 202)).toBe(true);
    expect(await count('analytics_events')).toBe(1);
    expect(await env.DB.prepare('SELECT pageviews,goals FROM analytics_sessions').first()).toEqual({ pageviews: 1, goals: 0 });
    expect(await env.DB.prepare('SELECT events FROM daily_usage').first('events')).toBe(1);
    expect(await env.DB.prepare('SELECT events FROM installation_usage').first('events')).toBe(1);
  });
  it('rejects changed-content duplicate and forged visitor/session association without mutation', async () => {
    await setup();
    const payload = event();
    expect((await send(payload)).status).toBe(202);
    expect((await send({ ...payload, path: '/changed' })).status).toBe(409);
    expect((await send(event({ visitorId: 'attacker_123' }))).status).toBe(409);
    expect(await count('analytics_events')).toBe(1);
    expect(await env.DB.prepare('SELECT pageviews FROM analytics_sessions').first('pageviews')).toBe(1);
  });
  it('atomically freezes concurrent first-event attribution while preserving each client digest', async () => {
    const site = await setup();
    const page = event({ campaign: { source: 'newsletter', medium: 'email', name: 'launch' } });
    const goal = event({ type: 'goal', name: 'signup', sequence: 1, campaign: { source: 'search-ad', medium: 'cpc', name: 'paid' } });
    const responses = await Promise.all([send(page), send(goal)]);
    expect(responses.map(r => r.status)).toEqual([202, 202]);
    const session = await env.DB.prepare('SELECT source,channel,campaign FROM analytics_sessions').first();
    const rows = await env.DB.prepare('SELECT source,channel,campaign,digest FROM analytics_events').all();
    for (const row of rows.results) expect({ source: row.source, channel: row.channel, campaign: row.campaign }).toEqual(session);
    expect(new Set(rows.results.map(row => row.digest)).size).toBe(2);
    expect((await send(page)).status).toBe(200);
    expect((await send(goal)).status).toBe(200);
    const report = await buildReport(env.DB, site, { period: '7d' });
    expect(report.sources).toEqual([{ name: session?.source, count: 1 }]);
  });
  it('hides suppressed visitors immediately while chunked deletion is still pending', async () => {
    const site = await setup({ privacy_mode: 'attribution' });
    const accepted = event({ mode: 'attribution' });
    await send(accepted);
    await send(event({ mode: 'attribution', type: 'goal', name: 'signup', sequence: 1 }));
    expect((await buildReport(env.DB, site, { period: '7d' })).online).toBe(1);
    await env.DB.prepare('INSERT INTO visitor_suppressions(workspace_id,site_id,visitor_id,created_at) VALUES(?,?,?,?)').bind(site.workspace_id, site.id, accepted.visitorId, NOW).run();
    expect(await count('analytics_events')).toBe(2); // no cleanup has run yet
    const hidden = await buildReport(env.DB, site, { period: '7d' });
    expect(hidden.current).toMatchObject({ pageviews: 0, sessions: 0, visitors: 0, goals: 0 });
    expect(hidden.online).toBe(0);
    expect(hidden.lastEventAt).toBeNull();
    expect(hidden.sources).toEqual([]);
    expect(hidden.series.every(point => point.pageviews === 0 && point.goals === 0)).toBe(true);
    const replay = await send(accepted);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ accepted: false, error: 'visitor_suppressed' });
    expect((await send(event({ mode: 'attribution', id: 'suppressed_new_event' }))).status).toBe(409);
    expect(await count('analytics_events')).toBe(2);
    expect(await env.DB.prepare('SELECT events FROM daily_usage').first('events')).toBe(2);
  });
  it('enforces concurrent site quota without charging rejected events or duplicates', async () => {
    await setup({ daily_limit: 2 });
    const first = event();
    expect((await send(first)).status).toBe(202);
    const results = await Promise.all(Array.from({ length: 5 }, () => send(event())));
    expect(results.filter(r => r.status === 202)).toHaveLength(1);
    expect(results.filter(r => r.status === 429)).toHaveLength(4);
    expect((await send(first)).status).toBe(200);
    expect(await count('analytics_events')).toBe(2);
    expect(await env.DB.prepare('SELECT events FROM daily_usage').first('events')).toBe(2);
  });
  it('does not let engagement create a session or keep an idle session alive', async () => {
    await setup();
    expect((await send(event({ type: 'engagement', duration: 1000 }))).status).toBe(409);
    expect((await send(event())).status).toBe(202);
    await env.DB.prepare('UPDATE analytics_sessions SET last_interaction_at=?').bind(Date.now() - 1_800_001).run();
    expect((await send(event({ type: 'engagement', duration: 1000 }))).status).toBe(409);
    expect((await send(event({ type: 'goal', name: 'signup' }))).status).toBe(409);
    expect(await count('analytics_events')).toBe(1);
    expect(await env.DB.prepare('SELECT duration FROM analytics_sessions').first('duration')).toBe(0);
  });
  it('rejects mismatched host, origin, privacy mode, stale time and oversized body', async () => {
    await setup();
    expect((await send(event({ hostname: 'evil.example' }))).status).toBe(403);
    expect((await send(event(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send(event({ mode: 'attribution' }))).status).toBe(409);
    expect((await send(event({ timestamp: NOW - 86_500_000 }))).status).toBe(400);
    const response = await collectRoutes.request('/collect', { method: 'POST', body: 'x'.repeat(9000) }, env);
    expect(response.status).toBe(413);
    expect(await count('analytics_events')).toBe(0);
  });
  it('strips URL query/fragment, redacts sensitive path IDs and ignores arbitrary extra fields', async () => {
    await setup();
    const payload = { ...event({ path: '/users/test@example.com/123456?token=secret#private', referrer: 'https://google.com/search?q=secret' }), email: 'private@example.com' };
    expect((await send(payload)).status).toBe(202);
    const row = await env.DB.prepare('SELECT path,source FROM analytics_events').first();
    expect(row).toEqual({ path: '/users/:redacted/:redacted', source: 'Google' });
    expect(JSON.stringify(await env.DB.prepare('SELECT * FROM analytics_events').first())).not.toContain('private@example.com');
  });
  it('blocks new writes after deletion starts and purges in resumable batches', async () => {
    await setup();
    await send(event());
    await env.DB.prepare("UPDATE sites SET status='deleting'").run();
    expect((await send(event())).status).toBe(404);
    await runMaintenance(env);
    expect(await count('analytics_events')).toBe(0);
    expect(await count('analytics_sessions')).toBe(0);
    expect(await count('sites')).toBe(1);
    expect(await env.DB.prepare('SELECT status FROM sites').first('status')).toBe('deleting');
  });
});

describe('scoped analytics authorization', () => {
  it('does not expose other workspaces or allow viewers to mutate sites', async () => {
    const site = await setup();
    const token = 'a'.repeat(43);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hash = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('session:' + token))).toString('base64url');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?)').bind('test_viewer', 'Viewer', NOW),
      env.DB.prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES(?,?,?)').bind('test_viewer', site.workspace_id, 'viewer'),
      env.DB.prepare('INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?,?)').bind('auth_session_test', hash, 'test_viewer', NOW, NOW + 60_000),
      env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind('other_workspace', 'Other', NOW),
    ]);
    const request = (path: string, method = 'GET', body?: string) => analyticsRoutes.request('https://analytica.test' + path, { method, headers: { cookie: 'analytica_session=' + token, 'content-type': 'application/json' }, body }, env);
    expect((await analyticsRoutes.request('https://analytica.test/workspaces/workspace_test/sites', {}, env)).status).toBe(401);
    const allowed = await request('/workspaces/workspace_test/sites');
    expect(allowed.status).toBe(200);
    expect((await allowed.json() as { id: string }[])[0].id).toBe(site.id);
    expect((await request('/workspaces/other_workspace/sites')).status).toBe(403);
    expect((await request('/workspaces/workspace_test/sites/' + site.id, 'PATCH', JSON.stringify({ name: 'changed' }))).status).toBe(403);
    expect((await request('/workspaces/workspace_test/sites/' + site.id, 'DELETE')).status).toBe(403);
    expect((await request('/workspaces/workspace_test/sites/' + site.id + '/export')).status).toBe(403);
    await env.DB.prepare('DELETE FROM memberships WHERE user_id=?').bind('test_viewer').run();
    expect((await request('/workspaces/workspace_test/sites')).status).toBe(403);
  });
});

describe('metrics and maintenance', () => {
  it('reports actual event-period totals and null visitors for aggregate mode', async () => {
    const site = await setup();
    await send(event({ campaign: { source: 'newsletter', medium: 'email' } }));
    await send(event({ id: 'goal_event_123', type: 'goal', name: 'signup', sequence: 1 }));
    const report = await buildReport(env.DB, site, { period: '7d' });
    expect(report.current).toMatchObject({ pageviews: 1, goals: 1, sessions: 1, visitors: null, bounceRate: 0 });
    expect(report.sources).toEqual([{ name: 'newsletter', count: 1 }]);
    expect(report.events).toEqual([{ name: 'signup', count: 1 }]);
    const filtered = await buildReport(env.DB, site, { period: '7d', source: 'absent' });
    expect(filtered.current.pageviews).toBe(0);
  });
  it('filters by sessions completing a goal without dropping their pageviews or acquisition', async () => {
    const site = await setup();
    await send(event({ campaign: { source: 'newsletter', medium: 'email' } }));
    await send(event({ type: 'goal', name: 'signup', sequence: 1 }));
    await send(event({ path: '/thanks', sequence: 2 }));
    await send(event({ visitorId: 'other_visitor', sessionId: 'other_session', campaign: { source: 'search', medium: 'organic' } }));
    const report = await buildReport(env.DB, site, { period: '7d', event: 'signup' });
    expect(report.current).toMatchObject({ pageviews: 2, goals: 1, sessions: 1 });
    expect(report.sources).toEqual([{ name: 'newsletter', count: 2 }]);
    expect(report.pages).toEqual([{ name: '/pricing', count: 1 }, { name: '/thanks', count: 1 }]);
    expect(report.countries).toEqual([{ name: 'Unknown', count: 2 }]);
    expect(report.devices).toEqual([{ name: 'Desktop', count: 2 }]);
    expect(report.events).toEqual([{ name: 'signup', count: 1 }]);
    const absent = await buildReport(env.DB, site, { period: '7d', event: 'purchase' });
    expect(absent.current.pageviews).toBe(0);
  });
  it('counts cross-midnight pageviews by event time without moving the session into the new day', async () => {
    const site = await setup();
    const today = new Date(NOW).toISOString().slice(0, 10);
    const midnight = Date.parse(today + 'T00:00:00Z');
    await send(event({ timestamp: midnight - 1000 }));
    await send(event({ timestamp: midnight + 1000, sequence: 1 }));
    const report = await buildReport(env.DB, site, { period: 'today' });
    expect(report.current.pageviews).toBe(1);
    expect(report.current.sessions).toBe(0);
    expect(report.previous.pageviews).toBe(1);
    expect(report.previous.sessions).toBe(1);
    expect(report.series.reduce((n, row) => n + row.sessions, 0)).toBe(0);
  });
  it('replaces dirty summaries exactly once, then includes a newly arrived event', async () => {
    await setup();
    await send(event());
    await runMaintenance(env, NOW + 3 * 86_400_000);
    expect(await env.DB.prepare("SELECT pageviews FROM daily_summaries WHERE dimension='total'").first('pageviews')).toBe(1);
    await runMaintenance(env, NOW + 3 * 86_400_000);
    expect(await env.DB.prepare("SELECT pageviews FROM daily_summaries WHERE dimension='total'").first('pageviews')).toBe(1);
    await send(event({ id: 'second_page_123', sequence: 1 }));
    await runMaintenance(env, NOW + 3 * 86_400_000);
    expect(await env.DB.prepare("SELECT pageviews FROM daily_summaries WHERE dimension='total'").first('pageviews')).toBe(2);
    expect(await count('dirty_buckets')).toBe(0);
  });
  it('preserves additive summaries when expiring detail after 90 days', async () => {
    await setup();
    await send(event());
    await runMaintenance(env, NOW + 3 * 86_400_000);
    await runMaintenance(env, NOW + 91 * 86_400_000);
    expect(await count('analytics_events')).toBe(0);
    expect(await env.DB.prepare("SELECT pageviews FROM daily_summaries WHERE dimension='total'").first('pageviews')).toBe(1);
  });
  it('measures indexed D1 writes for first, subsequent and engagement events including triggers', async () => {
    await setup();
    const first = event({ id: 'measure_original' });
    await send(first);
    const columns = 'workspace_id,site_id,id,digest,visitor_id,session_id,privacy_mode,type,ts,received_at,sequence,hostname,path,name,duration,source,channel,campaign,country,device,local_day,timezone';
    const copy = (id: string, session: string, type: string) => env.DB.prepare(`INSERT INTO analytics_events(${columns}) SELECT workspace_id,site_id,?,digest,visitor_id,?,privacy_mode,?,ts,received_at,sequence,hostname,path,name,duration,source,channel,campaign,country,device,local_day,timezone FROM analytics_events WHERE id=?`).bind(id, session, type, first.id).run();
    const firstSession = await copy('measure_new_session', 'measure_session', 'pageview');
    const subsequent = await copy('measure_next_view', 'measure_session', 'pageview');
    const engagement = await copy('measure_engagement', 'measure_session', 'engagement');
    console.info('D1 indexed writes, existing daily bucket:', JSON.stringify({ firstSession: firstSession.meta.rows_written, subsequent: subsequent.meta.rows_written, engagement: engagement.meta.rows_written }));
    expect(firstSession.meta.rows_written).toBeGreaterThan(subsequent.meta.rows_written);
    expect(subsequent.meta.rows_written).toBeGreaterThan(1);
    expect(engagement.meta.rows_written).toBeGreaterThan(1);
  });
  it('rolls back every derived mutation if a later trigger aborts the insert', async () => {
    await setup();
    await send(event());
    await env.DB.exec("CREATE TRIGGER reject_test_goal AFTER INSERT ON analytics_events WHEN NEW.type='goal' BEGIN SELECT RAISE(ABORT,'deliberate_failure'); END;");
    try {
      const before = await env.DB.prepare('SELECT events FROM daily_usage').first('events');
      const response = await send(event({ type: 'goal', name: 'signup' }));
      expect(response.status).toBe(500);
      expect(await env.DB.prepare('SELECT events FROM daily_usage').first('events')).toBe(before);
      expect(await env.DB.prepare('SELECT goals FROM analytics_sessions').first('goals')).toBe(0);
      expect(await count('analytics_events')).toBe(1);
    } finally { await env.DB.exec('DROP TRIGGER reject_test_goal'); }
  });
  it('resolves DST days with the offset at each midnight, including repeated hours', () => {
    expect(localMidnight('2026-03-08', 'America/New_York')).toBe(Date.parse('2026-03-08T05:00:00Z'));
    expect(localMidnight('2026-03-09', 'America/New_York') - localMidnight('2026-03-08', 'America/New_York')).toBe(23 * 3_600_000);
    expect(localMidnight('2026-11-02', 'America/New_York') - localMidnight('2026-11-01', 'America/New_York')).toBe(25 * 3_600_000);
    expect(localMidnight('2026-10-26', 'Asia/Kolkata')).toBe(Date.parse('2026-10-25T18:30:00Z'));
    const range = resolveReportRange({ period: 'custom', from: '2026-03-07', to: '2026-03-09' }, 'America/New_York', Date.parse('2026-03-10T12:00:00Z'));
    expect(range.days).toBe(3);
    expect(range.to - range.from).toBe(71 * 3_600_000);
  });
});
