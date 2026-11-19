// Test-only retained Settings fixtures. Never imported by production app/runtime.
import fs from 'node:fs';
import path from 'node:path';
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import deviceStore from '../../../remote-gateway/src/secure-device-state.js';

type Platform='android'|'ios';
function directory(file:string) {
 const stat=fs.lstatSync(file,{throwIfNoEntry:false});
 return stat?.isDirectory() && !stat.isSymbolicLink();
}
function retainedRoot(parent:string,platform:Platform) {
 const file=path.join(parent,`settings-${platform}-resume.json`);
 const stat=fs.lstatSync(file,{throwIfNoEntry:false});
 if(!stat)return null;
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Invalid QA resume pointer.');
 let value:any;
 try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Invalid QA resume pointer.');}
 if(value.version!==1||value.platform!==platform||typeof value.root!=='string'||!path.isAbsolute(value.root)||!directory(value.root))throw new Error('Invalid QA resume scope.');
 const root=fs.realpathSync(value.root),base=fs.realpathSync(parent);
 if(path.dirname(root)!==base||!path.basename(root).startsWith(`settings-${platform}-`)||!directory(path.join(root,'workspace'))||!directory(path.join(root,'workspace','.git')))throw new Error('Outside retained QA workspace.');
 return root;
}

export async function prepareNativeFixtureRoot(parent:string,label:'settings'|'presentation',platform:Platform) {
 fs.mkdirSync(parent,{recursive:true,mode:0o700});
 const existing=label==='settings'?retainedRoot(parent,platform):null;
 const root=existing??fs.realpathSync(fs.mkdtempSync(path.join(parent,`${label}-${platform}-`)));
 const workspace=path.join(root,'workspace');
 if(!existing){
  fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'hello.txt'),'native-baseline\n');
  for(const args of [['init','--initial-branch=main'],['config','user.name','Mobile QA'],['config','user.email','mobile-qa@test.invalid'],['add','.'],['commit','-m','Native presentation baseline']]) {
   const command=Bun.spawn(['git','-C',workspace,...args],{stdout:'pipe',stderr:'pipe'});
   if(await command.exited!==0)throw new Error('Could not initialize disposable Git fixture.');
  }
 }
 return {root,workspace,resumed:existing!==null,cleanup:async()=>{if(!existing)fs.rmSync(root,{recursive:true,force:true});}};
}

export function fixtureIdentityEnvironment(root:string) {
 const directory=path.join(fs.realpathSync(root),'qa-device-state');
 return {DJL_QA_PERSIST_IDENTITY:'1',DJL_DEVICE_STATE_DIR:directory,DJL_DEVICE_STATE_FILE:path.join(directory,'device-state.json'),DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE:path.join(directory,'keychain-mirror.json')};
}
function assertIdentityPair(state:any) {
 try {
  const x=Buffer.from(state.macIdentityPublicKey,'base64').toString('base64url'),d=Buffer.from(state.macIdentityPrivateKey,'base64').toString('base64url');
  const secret=createPrivateKey({key:{kty:'OKP',crv:'Ed25519',x,d},format:'jwk'}),publicKey=createPublicKey({key:{kty:'OKP',crv:'Ed25519',x},format:'jwk'});
  const message=Buffer.from('djl-fixture-self-check-v1');
  if(!verify(null,message,publicKey,sign(null,message,secret)))throw new Error();
 }catch{throw new Error('Persisted QA identity is invalid;refusing replacement.');}
}
export function loadFixtureDeviceState(root:string) {
 const env=fixtureIdentityEnvironment(root);
 if(process.env.DJL_QA_RUNTIME!=='1'||Object.entries(env).some(([key,value])=>process.env[key]!==value))throw new Error('QA identity requires its isolated state paths.');
 const folder=env.DJL_DEVICE_STATE_DIR;
 const folderStat=fs.lstatSync(folder,{throwIfNoEntry:false});
 if(folderStat&&(!folderStat.isDirectory()||folderStat.isSymbolicLink()))throw new Error('Invalid QA identity directory.');
 fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.chmodSync(folder,0o700);
 const canonical=env.DJL_DEVICE_STATE_FILE,mirror=env.DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE,peer=path.join(path.dirname(folder),'qa-peer.json');
 for(const file of [canonical,mirror,peer]){
  const stat=fs.lstatSync(file,{throwIfNoEntry:false});
  if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw new Error('Invalid QA identity file.');
 }
 let expected:any=null;
 if(fs.existsSync(peer)){
  try{expected=JSON.parse(fs.readFileSync(peer,'utf8'));}catch{throw new Error('Invalid pinned QA identity.');}
  if(typeof expected.macDeviceId!=='string'||typeof expected.macIdentityPublicKey!=='string')throw new Error('Invalid pinned QA identity.');
 }
 const previous=deviceStore.readBridgeDeviceState();
 if((expected||fs.existsSync(canonical)||fs.existsSync(mirror))&&!previous)throw new Error('Existing QA identity is unavailable;refusing replacement.');
 if(previous)assertIdentityPair(previous);
 if(expected&&(previous?.macDeviceId!==expected.macDeviceId||previous?.macIdentityPublicKey!==expected.macIdentityPublicKey))throw new Error('Pinned QA identity differs;refusing replacement.');
 const state=deviceStore.loadOrCreateBridgeDeviceState();assertIdentityPair(state);
 if(!expected)fs.writeFileSync(peer,JSON.stringify({macDeviceId:state.macDeviceId,macIdentityPublicKey:state.macIdentityPublicKey}),{mode:0o600,flag:'wx'});
 return state;
}
