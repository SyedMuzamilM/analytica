import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { AppEnv } from '../apps/worker/env';
import { funnelRoutes, buildFunnelReport, countFunnel, cleanupFunnels, type FunnelStep } from '../apps/worker/funnels';
import { localDate } from '../apps/worker/reports';
import type { SiteRecord } from '../apps/worker/analytics';

const now = Date.now();
const token = btoa(String.fromCharCode(...new Uint8Array(32))).replace(/=/g, '');
const app = new Hono<AppEnv>().route('/api', funnelRoutes);
async function setup(mode: 'attribution' | 'aggregate' = 'attribution', role: 'owner' | 'viewer' = 'owner') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.APP_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${token}`))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?)').bind('funnel_user','Owner',now),
    env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind('funnel_workspace','Workspace',now),
    env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind('other_workspace','Other',now),
    env.DB.prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES(?,?,?)').bind('funnel_user','funnel_workspace',role),
    env.DB.prepare('INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?,?)').bind('funnel_auth',hash,'funnel_user',now,now+86400000),
    env.DB.prepare('INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at,daily_limit) VALUES(?,?,?,?,?,?,?,?,?)').bind('funnel_site','funnel_workspace','Site','example.com','UTC',mode,'active',now,1000),
  ]);
  return { id:'funnel_site',workspace_id:'funnel_workspace',name:'Site',domain:'example.com',timezone:'UTC',privacy_mode:mode,status:'active',created_at:now,daily_limit:1000 } satisfies SiteRecord;
}
async function request(suffix: string, method='GET', data?: unknown, workspace='funnel_workspace') {
  return app.request(`https://analytica.test/api/workspaces/${workspace}/sites/funnel_site${suffix}`, {
    method, headers:{ cookie:`analytica_session=${token}`,Origin:'https://analytica.test','Content-Type':'application/json' },
    ...(data === undefined ? {} : {body:JSON.stringify(data)}),
  },env);
}
async function event(site: SiteRecord, options: {id?:string;type?:string;name?:string;path?:string;session?:string;visitor?:string;ts?:number;sequence?:number}={}) {
  const ts=options.ts ?? now;
  await env.DB.prepare(`INSERT INTO analytics_events(workspace_id,site_id,id,digest,visitor_id,session_id,privacy_mode,type,ts,received_at,sequence,hostname,path,name,duration,source,channel,campaign,country,device,local_day,timezone)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'Google','Search',NULL,'US','Desktop',?,'UTC')`)
    .bind(site.workspace_id,site.id,options.id??crypto.randomUUID(),'digest',options.visitor??'visitor_one',options.session??'session_one',site.privacy_mode,options.type??'pageview',ts,ts,options.sequence??0,'example.com',options.path??'/pricing',options.name??null,localDate(ts,'UTC')).run();
}
const steps:FunnelStep[]=[{type:'pageview',value:'/pricing'},{type:'goal',value:'signup'}];

describe('attribution funnels and bounded journeys',()=>{
  it('counts only ordered steps inside one session and one 30-minute attempt',async()=>{
    const site=await setup();
    const from=now-3600000;
    await event(site,{session:'complete_session',ts:from});
    await event(site,{session:'complete_session',type:'goal',name:'signup',ts:from+1000});
    await event(site,{session:'reverse_session',type:'goal',name:'signup',ts:from});
    await event(site,{session:'reverse_session',ts:from+1000});
    await event(site,{session:'expired_session',ts:from});
    // Keep the session alive through unrelated interaction, while the funnel attempt itself expires.
    await event(site,{session:'expired_session',path:'/other',ts:from+1200000});
    await event(site,{session:'expired_session',type:'goal',name:'signup',ts:from+1800001});
    const report=await buildFunnelReport(env.DB,site,steps,{period:'7d'});
    expect(report?.steps.map(s=>s.sessions)).toEqual([3,1]);
    expect(report?.steps[1].conversionFromPrevious).toBeCloseTo(1/3);
  });
  it('requires distinct ordered events for repeated steps and resolves timestamp ties by sequence',async()=>{
    const site=await setup();
    await event(site,{id:'event_second',sequence:2,type:'goal',name:'signup'});
    await event(site,{id:'event_first',sequence:1,type:'goal',name:'signup'});
    const report=await buildFunnelReport(env.DB,site,[{type:'goal',value:'signup'},{type:'goal',value:'signup'},{type:'goal',value:'signup'}],{period:'7d'});
    expect(report?.steps.map(s=>s.sessions)).toEqual([1,1,0]);
  });
  it('retains midnight-spanning completion in a single selected range',async()=>{
    const site=await setup();
    const midnight=Date.parse(new Date(now-86400000).toISOString().slice(0,10)+'T00:00:00Z');
    await event(site,{ts:midnight-1000});
    await event(site,{type:'goal',name:'signup',ts:midnight+1000});
    const report=await buildFunnelReport(env.DB,site,steps,{period:'7d'});
    expect(report?.steps.map(s=>s.sessions)).toEqual([1,1]);
  });
  it('validates exact steps, scopes definitions and journeys, and stops reading deleted sites',async()=>{
    const site=await setup();
    expect((await request('/funnels','POST',{name:'Invalid',steps:[{type:'pageview',value:'/pricing?token=x'},steps[1]]})).status).toBe(400);
    const created=await request('/funnels','POST',{name:'Pricing to signup',steps});
    expect(created.status).toBe(201);
    const definition=await created.json() as {id:string};
    expect((await request('/funnels')).status).toBe(200);
    expect((await request('/funnels','GET',undefined,'other_workspace')).status).toBe(403);
    await event(site);
    const list=await request('/journeys?limit=1').then(r=>r.json()) as {sessions:unknown[];identity:string};
    expect(list.sessions).toHaveLength(1);expect(list.identity).toContain('not verified people');
    const detail=await request('/journeys/visitor_one').then(r=>r.json()) as {events:unknown[];truncated:boolean};
    expect(detail.events).toHaveLength(1);expect(detail.truncated).toBe(false);
    expect((await request('/journeys?limit=101')).status).toBe(400);
    expect((await request('/journeys/missing_id')).status).toBe(404);
    expect((await request(`/funnels/${definition.id}/report?period=7d`)).status).toBe(200);
    await env.DB.prepare("UPDATE sites SET status='deleting' WHERE id=?").bind(site.id).run();
    expect((await request('/journeys')).status).toBe(404);
    await cleanupFunnels(env);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM funnels').first('n')).toBe(0);
  });
  it('rejects aggregate funnels/journeys and viewer identity inspection or mutations',async()=>{
    await setup('aggregate');
    expect((await request('/funnels')).status).toBe(409);
    expect((await request('/journeys')).status).toBe(409);
    await env.DB.prepare("UPDATE sites SET privacy_mode='attribution'").run();
    await env.DB.prepare("UPDATE memberships SET role='viewer'").run();
    expect((await request('/funnels','POST',{name:'Denied',steps})).status).toBe(403);
    expect((await request('/journeys')).status).toBe(403);
    expect((await request('/funnels')).status).toBe(200);
  });
  it('suppresses erased browser detail and funnel participation before physical cleanup',async()=>{
    const site=await setup();
    await event(site,{ts:now-1000});
    await event(site,{type:'goal',name:'signup',ts:now});
    expect((await buildFunnelReport(env.DB,site,steps,{period:'7d'}))?.steps[1].sessions).toBe(1);
    await env.DB.prepare('INSERT INTO visitor_suppressions(workspace_id,site_id,visitor_id,created_at) VALUES(?,?,?,?)').bind(site.workspace_id,site.id,'visitor_one',now).run();
    expect((await buildFunnelReport(env.DB,site,steps,{period:'7d'}))?.steps.map(s=>s.sessions)).toEqual([0,0]);
    const list=await request('/journeys').then(r=>r.json()) as {sessions:unknown[]};
    expect(list.sessions).toEqual([]);
    expect((await request('/journeys/visitor_one')).status).toBe(404);
  });
  it('enforces the definition cap atomically for concurrent requests',async()=>{
    await setup();
    const result=await Promise.all(Array.from({length:22},(_,i)=>request('/funnels','POST',{name:`Funnel ${i}`,steps})));
    expect(result.filter(r=>r.status===201)).toHaveLength(20);
    expect(result.filter(r=>r.status===409)).toHaveLength(2);
  });
  it('refuses a partial report when matching retained detail exceeds 20,000 events',async()=>{
    const site=await setup();
    const base=now-22*86400000;
    await env.DB.prepare(`WITH RECURSIVE numbers(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<20001)
      INSERT INTO analytics_events(workspace_id,site_id,id,digest,visitor_id,session_id,privacy_mode,type,ts,received_at,sequence,hostname,path,name,duration,source,channel,campaign,country,device,local_day,timezone)
      SELECT ?,?,'cap_event_'||n,'digest','cap_visitor_'||n,'cap_session_'||n,'attribution','pageview',?+CAST((n-1)/1000 AS INTEGER)*86400000,?+CAST((n-1)/1000 AS INTEGER)*86400000,0,'example.com','/pricing',NULL,0,'Direct','Direct',NULL,'US','Desktop',strftime('%Y-%m-%d',(?+CAST((n-1)/1000 AS INTEGER)*86400000)/1000,'unixepoch'),'UTC' FROM numbers`)
      .bind(site.workspace_id,site.id,base,base,base).run();
    expect(await buildFunnelReport(env.DB,site,steps,{period:'30d'})).toBeNull();
    const definition=await request('/funnels','POST',{name:'Large funnel',steps}).then(r=>r.json()) as {id:string};
    const response=await request(`/funnels/${definition.id}/report?period=30d`);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({error:'funnel_range_too_large'});
  });
});
