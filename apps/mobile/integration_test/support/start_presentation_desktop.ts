// Disposable native presentation and Settings fixture. No production runtime imports it.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {prepareNativeFixtureRoot,fixtureIdentityEnvironment} from './fixture_resume';

const mode=process.argv[2]??'';
if(!['android','ios','settings-android','settings-ios'].includes(mode))throw new Error('Choose android, ios, settings-android, or settings-ios.');
const settings=mode.startsWith('settings-');
const platform=(settings?mode.slice('settings-'.length):mode) as 'android'|'ios';
const label=settings?'settings':'presentation';
const port=settings?(platform==='android'?8894:8896):(platform==='android'?8884:8886);
const mobile=path.resolve(import.meta.dir,'../..');
const parent=path.join(mobile,'build','qa-fixtures');
const scope=await prepareNativeFixtureRoot(parent,label,platform);
const {root,workspace}=scope;
const screenshots=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),`djl-${label}-screen-`)));
const screenshot=path.join(screenshots,'screenshot.png');
await fs.copyFile(path.join(mobile,'assets','djl-logo.png'),screenshot);
const configRoot=await fs.mkdtemp(path.join(os.tmpdir(),`djl-mobile-${label}-${platform}-`));
const config=path.join(configRoot,'desktop-native-config.json');
const child=spawn('bun',['integration_test/support/desktop_gateway.ts',root],{
 cwd:mobile,
 env:{...process.env,DJL_QA_RUNTIME:'1',DJL_QA_BRIDGE_PORT:String(port),DJL_QA_PRESENTATION_SCREENSHOT:screenshot,...(scope.resumed?fixtureIdentityEnvironment(root):{DJL_QA_PERSIST_IDENTITY:'0'})},
 stdio:['ignore','pipe','pipe'],
});
child.stderr.pipe(process.stderr);
let ready=false,stopping=false;
function stop(){if(stopping)return;stopping=true;child.kill('SIGTERM');}
createInterface({input:child.stdout}).on('line',line=>{
 if(ready||!line.startsWith('{"pairing":'))return;
 ready=true;
 void(async()=>{
  const value=JSON.parse(line);
  await fs.writeFile(config,JSON.stringify({
   DJL_QA_PAIRING_BASE64:Buffer.from(JSON.stringify(value.pairing)).toString('base64'),
   DJL_QA_DESKTOP_CWD:value.cwd,
   DJL_CLOUD_API_URL:'http://127.0.0.1:8851',
  }),{mode:0o600,flag:'wx'});
  await fs.writeFile(path.join(configRoot,'owned-scope.json'),JSON.stringify({platform,port,root,workspace,screenshots,screenshot}),{mode:0o600,flag:'wx'});
  console.log(`Local ${platform} ${label} QA ready on loopback${port}; private config: ${config}`);
 })().catch(()=>{console.error('Could not prepare private presentation configuration.');stop();});
});
process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('exit',async code=>{
 await Promise.all([scope.cleanup(),fs.rm(screenshots,{recursive:true,force:true})]);
 process.exit(code??1);
});
