import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const state=mkdtempSync(join(tmpdir(),'analytica-browser-'));
const wrangler=join(process.cwd(),'node_modules/wrangler/bin/wrangler.js');
const migrate=spawnSync(process.execPath,[wrangler,'d1','migrations','apply','DB','--local','--persist-to',state],{stdio:'inherit'});
if(migrate.status!==0){rmSync(state,{recursive:true,force:true});process.exit(migrate.status||1);}
const child=spawn(process.execPath,[wrangler,'dev','--ip','localhost','--port','8790','--persist-to',state,
  '--var','APP_ORIGIN:http://localhost:8790',
  '--var','APP_SECRET:local-browser-test-app-secret-not-for-production-123456789',
  '--var','SETUP_TOKEN:local-browser-test-setup-token-not-for-production-123456789'],{stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{rmSync(state,{recursive:true,force:true});process.exit(code||0);});
