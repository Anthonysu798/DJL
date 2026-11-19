// Owns a disposable repository and the local native acceptance bridge. No user desktop state.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'djl-native-desktop-'));
const workspace=path.join(root,'workspace');await fs.mkdir(workspace);
async function git(...args:string[]){const process=Bun.spawn(['git','-C',workspace,...args],{stdout:'pipe',stderr:'pipe'});if(await process.exited!==0)throw new Error(await new Response(process.stderr).text());}
await git('init','--initial-branch=main');await git('config','user.name','Mobile QA');await git('config','user.email','mobile-qa@test.invalid');
await fs.writeFile(path.join(workspace,'hello.txt'),'native-baseline\n');
await fs.writeFile(path.join(workspace,'preview.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" rx="12" fill="#e4e8e3"/><text x="24" y="96" font-size="28" fill="#18231b">DJL workspace QA</text></svg>');
await fs.mkdir(path.join(workspace,'fork-target'));await fs.writeFile(path.join(workspace,'fork-target','README.txt'),'Disposable fork target\n');
await git('add','.');await git('commit','-m','Native acceptance fixture');
const child=spawn('bun',['integration_test/support/desktop_gateway.ts',root],{env:{...process.env,DJL_QA_RUNTIME:'1',DJL_QA_BRIDGE_PORT:'8852'},stdio:['ignore','pipe','pipe']});
child.stderr.pipe(process.stderr);
let ready=false;
createInterface({input:child.stdout}).on('line',async line=>{
  if(ready||!line.startsWith('{"pairing":'))return;
  const value=JSON.parse(line);await fs.mkdir('/tmp/djl-mobile-qa',{recursive:true,mode:0o700});
  await fs.writeFile('/tmp/djl-mobile-qa/desktop-native-config.json',JSON.stringify({DJL_QA_PAIRING_BASE64:Buffer.from(JSON.stringify(value.pairing)).toString('base64'),DJL_QA_DESKTOP_CWD:value.cwd,DJL_CLOUD_API_URL:'http://127.0.0.1:8851'}),{mode:0o600});
  ready=true;console.log('Local native desktop bridge ready on loopback8852; pairing saved privately.');
});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;child.kill('SIGTERM');}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('exit',async code=>{await fs.rm(root,{recursive:true,force:true});process.exit(code??0);});
