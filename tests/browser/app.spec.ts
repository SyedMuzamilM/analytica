import { test, expect } from '@playwright/test';

test('demo filters, navigation and mobile layout work without authentication',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/demo');
  await expect(page.getByText('Demo data',{exact:false}).first()).toBeVisible();
  await expect(page.getByRole('heading',{name:/overview/i})).toBeVisible();
  const select=page.getByRole('combobox').filter({has:page.locator('option[value="30d"]')});
  if(await select.count())await select.selectOption('30d');
  await page.getByRole('button',{name:'Acquisition',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:/acquisition/i})).toBeVisible();
  await page.screenshot({path:'output/playwright/desktop-acquisition.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(250);
  await page.screenshot({path:'output/playwright/mobile-acquisition.png',fullPage:true,animations:'disabled'});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('virtual passkey owner setup, create site, collect and view live metrics',async({page,context})=>{
  const token='local-browser-test-setup-token-not-for-production-123456789';
  const cdp=await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await page.goto('/');
  const status=await page.request.get('/api/auth/status').then(r=>r.json());
  if(!status.configured){
    await page.getByLabel('Your name',{exact:true}).fill('Browser owner');
    await page.getByLabel('Workspace name',{exact:true}).fill('Browser workspace');
    await page.getByLabel('Private setup token',{exact:true}).fill(token);
    await page.getByRole('button',{name:'Create your passkey',exact:true}).click();
    await expect(page.getByText(/recovery codes/i).first()).toBeVisible({timeout:15000});
    const acknowledgment=page.getByRole('checkbox');
    if(await acknowledgment.count())await acknowledgment.check();
    const saved=page.getByRole('button',{name:/saved|continue|done/i}).first();
    if(await saved.count()){await saved.click(); const next=page.getByRole('button',{name:'Continue to your workspace',exact:true});if(await next.count())await next.click();}
  } else {
    test.skip(true,'Local instance already configured; fresh-instance auth is covered by Worker crypto fixtures.');
  }
  await expect(page.getByRole('button',{name:/add.*site|add.*website/i}).first()).toBeVisible({timeout:10000});
  await page.getByRole('button',{name:'Add your first website',exact:true}).click();
  await page.getByLabel('Website name',{exact:true}).fill('Browser test');
  await page.getByLabel('Domain',{exact:true}).fill('localhost');
  await page.getByRole('button',{name:'Add website',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'Website settings',exact:true})).toBeVisible();
  const current=await page.request.get('/api/auth/status').then(r=>r.json());
  const workspaceId=current.workspaces[0].id;
  const sites=await page.request.get(`/api/workspaces/${workspaceId}/sites`).then(r=>r.json());
  const siteId=sites[0].id;
  const tracked=await context.newPage();
  const payloads:Record<string,unknown>[]=[];
  await tracked.route('**/v1/collect',async route=>{payloads.push(JSON.parse(route.request().postData()||'{}'));await route.continue();});
  await tracked.route('**/tracked?**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Tracked test</title><h1>Tracked page</h1><button data-analytica-goal="signup">Sign up</button><script defer data-site="${siteId}" data-mode="aggregate" data-allow-localhost data-allow-automation src="/tracker.js"></script>`}));
  await tracked.goto('/tracked?email=private@example.com&token=secret');
  await tracked.getByRole('button',{name:'Sign up',exact:true}).click();
  await expect.poll(async()=>page.request.get(`/api/workspaces/${workspaceId}/sites/${siteId}/report?period=7d`).then(r=>r.json()).then(r=>r.current.goals)).toBe(1);
  expect(JSON.stringify(payloads)).not.toContain('private@example.com');
  expect(JSON.stringify(payloads)).not.toContain('token=secret');
  await tracked.close();
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await page.getByRole('button',{name:'Refresh report',exact:true}).click();
  await expect(page.getByText('signup',{exact:true}).first()).toBeVisible();
  await page.screenshot({path:'output/playwright/live-workspace.png',fullPage:true});
});

test('queued opt-out prevents the first beacon and path redaction preserves SPA pageview counts',async({context})=> {
  const opted=await context.newPage();
  const outbound:string[]=[];
  await opted.route('**/v1/collect',async route=>{outbound.push(route.request().postData()||'');await route.fulfill({status:202,body:'{}'});});
  await opted.route('**/privacy-test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Privacy test</title><script>window.analytica={q:[['optOut',true]]}</script><script defer data-site="privacy_test_1" data-allow-localhost data-allow-automation src="/tracker.js"></script>`}));
  await opted.goto('/privacy-test');
  await expect.poll(()=>opted.evaluate(()=>!!(window as any).analytica?.installed)).toBe(true);
  await opted.evaluate(()=>(window as any).analytica('goal','must_not_send'));
  expect(outbound).toHaveLength(0);
  await opted.close();
  const redacted=await context.newPage();
  const events:Array<{type:string;path:string}>=[];
  await redacted.route('**/v1/collect',async route=>{events.push(JSON.parse(route.request().postData()||'{}'));await route.fulfill({status:202,body:'{}'});});
  await redacted.route('**/redaction-test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Redaction test</title><script defer data-site="privacy_test_2" data-redact-path data-allow-localhost data-allow-automation src="/tracker.js"></script>`}));
  await redacted.goto('/redaction-test');
  await expect.poll(()=>events.filter(e=>e.type==='pageview').length).toBe(1);
  await redacted.evaluate(()=>history.pushState({},'','/another-private-route'));
  await expect.poll(()=>events.filter(e=>e.type==='pageview').length).toBe(2);
  expect(events.every(e=>e.path==='/[redacted]')).toBe(true);
  await redacted.close();
});

test('attribution mode waits for explicit consent and removes cookies on withdrawal',async({page})=> {
  const events:Array<{type:string;mode:string}>=[];
  await page.route('**/v1/collect',async route=>{events.push(JSON.parse(route.request().postData()||'{}'));await route.fulfill({status:202,body:'{}'});});
  await page.route('**/consent-test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Consent test</title><script defer data-site="consent_test_1" data-mode="attribution" data-allow-localhost data-allow-automation src="/tracker.js"></script>`}));
  await page.goto('/consent-test');
  await expect.poll(()=>page.evaluate(()=>!!(window as any).analytica?.installed)).toBe(true);
  expect(events).toHaveLength(0);
  expect(await page.evaluate(()=>document.cookie)).not.toContain('an_consent');
  await page.evaluate(()=>(window as any).analytica('consent',true));
  await expect.poll(()=>events.length).toBe(1);
  expect(events[0].mode).toBe('attribution');
  expect(await page.evaluate(()=>document.cookie)).toContain('an_consent');
  await page.evaluate(()=>(window as any).analytica('consent',false));
  expect(await page.evaluate(()=>document.cookie)).not.toContain('an_consent');
  await page.evaluate(()=>(window as any).analytica('goal','withdrawn'));
  expect(events).toHaveLength(1);
});
