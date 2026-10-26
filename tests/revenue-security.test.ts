import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../apps/worker/index';
import { digest, recordMoney } from '../apps/worker/revenue';

const encoder = new TextEncoder();
const origin = 'https://analytica.test';
const token = `an_${'b'.repeat(64)}`;
const key = { id: 'key_security', workspace_id: 'ws_security', site_id: 'site_security', namespace: 'api:shop', privacy_mode: 'attribution' };
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const url64 = (value: Uint8Array) => b64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(secret: string, value: string) {
  const imported = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return url64(new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value))));
}
async function seed() {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind(key.workspace_id, 'Security', now),
    env.DB.prepare('INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(key.site_id, key.workspace_id, 'Store', 'example.com', 'UTC', 'attribution', 'active', now),
    env.DB.prepare('INSERT INTO site_api_keys(id,workspace_id,site_id,name,token_hash,prefix,namespace,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(key.id, key.workspace_id, key.site_id, 'Merchant API', await digest(token), token.slice(0, 11), key.namespace, now),
  ]);
}
async function claim(id: string, checkoutId: string, source = 'Newsletter') {
  await env.DB.prepare(`INSERT INTO checkout_claims(id,workspace_id,site_id,namespace,checkout_id,visitor_id,session_id,source,channel,campaign,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id, key.workspace_id, key.site_id, key.namespace, checkoutId, 'visitor_test', 'session_test', source, 'Email', 'Launch', Date.now() + 86_400_000).run();
  return `${id}.${await hmac(env.APP_SECRET, id)}`;
}
async function merchant(path: string, body: object) {
  return app.request(`${origin}/v1/server/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env);
}
const paymentBody = (claimToken: string, checkoutId: string) => ({
  transaction_id: 'sale_security', amount_minor: 2500, currency: 'USD', claim_token: claimToken, checkout_id: checkoutId,
});
async function ownerCookie() {
  const raw = url64(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?)').bind('owner_security', 'Owner', now),
    env.DB.prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES(?,?,?)').bind('owner_security', key.workspace_id, 'owner'),
    env.DB.prepare('INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?,?)')
      .bind('session_security', await hmac(env.APP_SECRET, `session:${raw}`), 'owner_security', now, now + 86_400_000),
  ]);
  return `analytica_session=${raw}`;
}

describe('revenue trust boundaries', () => {
  it('atomically rejects different signed webhook bodies sharing one delivery ID', async () => {
    await seed();
    const secretBytes = encoder.encode('test-only-standard-webhook-signing-key');
    const secret = `whsec_${b64(secretBytes)}`;
    const encryptionKey = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(env.APP_SECRET)), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoder.encode(secret));
    await env.DB.prepare(`INSERT INTO payment_integrations(id,workspace_id,site_id,provider,merchant_id,secret_ciphertext,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind('integration_security', key.workspace_id, key.site_id, 'dodo', 'merchant_security', `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`, Date.now()).run();
    const signingKey = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const webhook = async (transactionId: string) => {
      const raw = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: transactionId, total_amount: 2500, currency: 'USD', created_at: new Date().toISOString() } });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = b64(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(`event_shared.${timestamp}.${raw}`))));
      return app.request(`${origin}/v1/webhooks/dodo/integration_security`, {
        method: 'POST', headers: { 'webhook-id': 'event_shared', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}`, 'Content-Type': 'application/json' }, body: raw,
      }, env);
    };
    const responses = await Promise.all([webhook('sale_first'), webhook('sale_second')]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM payment_receipts').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM money_records').first('n')).toBe(1);
  });

  it('accepts the same claimed payment after the original claim expires without consuming a new claim', async () => {
    await seed();
    const issued = await claim('claim_retry', 'checkout_retry');
    const body = paymentBody(issued, 'checkout_retry');
    expect((await merchant('payments', body)).status).toBe(201);
    await env.DB.prepare('UPDATE checkout_claims SET expires_at=? WHERE id=?').bind(Date.now() - 1000, 'claim_retry').run();
    const retry = await merchant('payments', body);
    expect(retry.status, await retry.clone().text()).toBe(201);
    expect((await retry.json() as { attributed: boolean }).attributed).toBe(true);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM money_records').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT consumed_by FROM checkout_claims WHERE id=?').bind('claim_retry').first('consumed_by')).toBe('sale_security');
  });

  it('rejects repointing an existing sale to a different checkout claim', async () => {
    await seed();
    const original = await claim('claim_original', 'checkout_original');
    const changed = await claim('claim_changed', 'checkout_changed', 'Search');
    expect((await merchant('payments', paymentBody(original, 'checkout_original'))).status).toBe(201);
    const conflict = await merchant('payments', paymentBody(changed, 'checkout_changed'));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'idempotency_conflict' });
    expect(await env.DB.prepare('SELECT source FROM money_records').first('source')).toBe('Newsletter');
    expect(await env.DB.prepare('SELECT consumed_by FROM checkout_claims WHERE id=?').bind('claim_changed').first('consumed_by')).toBeNull();
  });

  it('reports a partial refund with its original immutable acquisition snapshot', async () => {
    await seed();
    const issued = await claim('claim_refund', 'checkout_refund');
    await merchant('payments', paymentBody(issued, 'checkout_refund'));
    await recordMoney(env, key, { kind: 'refund', transactionId: 'refund_security', originalId: 'sale_security', amount: 500, currency: 'USD', occurredAt: Date.now() });
    const response = await app.request(`${origin}/api/workspaces/${key.workspace_id}/sites/${key.site_id}/revenue`, {
      headers: { Cookie: await ownerCookie() },
    }, env);
    expect(response.status).toBe(200);
    const report = await response.json() as { records: Array<{ id: string; kind: string; source: string | null; channel: string | null; matchedBy: string | null }> };
    const refund = report.records.find((r) => r.id === 'refund_security');
    expect(refund).toMatchObject({ kind: 'refund', source: 'Newsletter', channel: 'Email', matchedBy: 'verified_checkout' });
  });
});

it('keeps an original acquisition snapshot while a recent refund still depends on it', async () => {
  await seed();
  const issued=await claim('claim_retained','checkout_retained');
  await merchant('payments',paymentBody(issued,'checkout_retained'));
  const now=Date.now(),day=86400000;
  await env.DB.prepare("UPDATE money_records SET received_at=? WHERE kind='payment'").bind(now-397*day).run();
  await recordMoney(env,key,{kind:'refund',transactionId:'late_refund',originalId:'sale_security',amount:500,currency:'USD',occurredAt:now});
  const {cleanupRevenue}=await import('../apps/worker/revenue');
  await cleanupRevenue(env,now);
  expect(await env.DB.prepare("SELECT COUNT(*) FROM money_records WHERE kind='payment'").first('COUNT(*)')).toBe(1);
  const response=await app.request(`${origin}/api/workspaces/${key.workspace_id}/sites/${key.site_id}/revenue`,{headers:{Cookie:await ownerCookie()}},env);
  const report=await response.json() as {records:Array<{id:string;status:string;source:string|null}>};
  expect(report.records.find(r=>r.id==='late_refund')).toMatchObject({status:'confirmed',source:'Newsletter'});
});
