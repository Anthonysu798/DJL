// Test-only loopback bridge. Crypto, terminal manager/mirror, Git and filesystem handlers are production code.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {Effect}=createRequire(new URL('../../../server/package.json',import.meta.url))('effect');
import secure from '../../../remote-gateway/src/secure-transport.js';
import git from '../../../remote-gateway/src/git-handler.js';
import project from '../../../remote-gateway/src/project-handler.js';
import workspace from '../../../remote-gateway/src/workspace-handler.js';
import terminalBridge from '../../../remote-gateway/src/desktop-terminal-mirror.js';
import {TerminalManagerRuntime} from '../../../server/src/terminal/Layers/Manager.ts';
import {PtyAdapter} from '../../../server/src/terminal/Services/PTY.ts';
import {layer as PtyLayer} from '../../../server/src/terminal/Layers/BunPTY.ts';
import {verifyTrustedResolveRequest} from '../../../remote-relay/src/registryAuth.ts';
import {createRuntimeFixture} from './desktop_runtime_fixture.ts';
import {createPairingCodeFixture} from './pairing_code_fixture.ts';
import {createGroupsFixture} from './groups_fixture.ts';
import {fixtureGitScope} from './fixture_git_scope.ts';
import {loadFixtureDeviceState} from './fixture_resume.ts';

const root=fs.realpathSync(process.argv[2]!);
const cwd=path.join(root,'workspace');
if(!fs.statSync(cwd).isDirectory())throw new Error('Disposable workspace is required.');
const scoped=fixtureGitScope(cwd,{requested:process.env.DJL_QA_CONTAINER_GIT==='1',inContainer:fs.existsSync('/.dockerenv'),codexHomeOverridden:process.env.CODEX_HOME!==undefined,managedRoot:path.join(os.homedir(),'.codex','worktrees')});
const adapter=await Effect.runPromise(Effect.gen(function*(){return yield* PtyAdapter;}).pipe(Effect.provide(PtyLayer)));
const terminals=new TerminalManagerRuntime({logsDir:path.join(root,'runtime'),ptyAdapter:adapter,shellResolver:()=>'/bin/sh'});
const persistentIdentity=process.env.DJL_QA_PERSIST_IDENTITY==='1';
const keys=persistentIdentity?null:generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});
const b64=(s:string)=>Buffer.from(s,'base64url').toString('base64');
const deviceState=persistentIdentity?loadFixtureDeviceState(root):{macDeviceId:`desktop-qa-${randomUUID()}`,macIdentityPrivateKey:b64(keys!.d!),macIdentityPublicKey:b64(keys!.x!),trustedPhones:{}};
let wire:any;
function trace(stage:string,value:any){fs.appendFileSync(path.join(root,'trace.jsonl'),JSON.stringify({stage,method:value?.method,type:value?.type??value?.params?.type,threadId:value?.threadId??value?.params?.threadId,terminalId:value?.terminalId??value?.params?.terminalId,at:value?.createdAt??value?.params?.createdAt,hasMarker:String(value?.data??value?.params?.data??'').includes('DJL_REAL_PTY_OK')})+'\n');}
const send=(rpc:unknown)=>{trace('wire',rpc);wire.queueOutboundApplicationMessage(JSON.stringify(rpc));};
const runtime=process.env.DJL_QA_RUNTIME==='1'?createRuntimeFixture(cwd,send,{presentationScreenshotPath:process.env.DJL_QA_PRESENTATION_SCREENSHOT,legacyTurnRecovery:process.env.DJL_QA_LEGACY_TURN_RECOVERY==='1',groups:process.env.DJL_QA_GROUPS==='1',rejectCollaborationMode:process.env.DJL_QA_REJECT_COLLABORATION==='1',workingDirectoryScope:process.env.DJL_QA_CONTAINER_GIT==='1'?scoped:undefined}):null;
const groupChats=process.env.DJL_QA_GROUPS==='1'?createGroupsFixture(send):null;
let pairingCodes:ReturnType<typeof createPairingCodeFixture>|null=null;
const savedPhone=Object.entries(deviceState.trustedPhones??{})[0];
let trustedPhone:{phoneDeviceId:string,phoneIdentityPublicKey:string}|null=savedPhone?{phoneDeviceId:savedPhone[0],phoneIdentityPublicKey:String(savedPhone[1])}:null;
const usedNonces=new Set<string>();
let activeSocket:any;
let applicationMessageCount=0;
const mirror=terminalBridge.createDesktopTerminalMirror({request:async(method:string,params:any)=>{
  if(method==='terminal.open')return terminals.open({...params,cwd},{executable:'/bin/sh',args:[],persistentShell:true});
  if(method==='terminal.write'){await terminals.write(params);return {};}
  if(method==='terminal.ackOutput'){await terminals.ackOutput(params);return {};}
  if(method==='terminal.resize'){await terminals.resize(params);return {};}
  if(method==='terminal.list')return terminals.listSessions();
  throw new Error('Unsupported terminal test method.');
},emit:(method:string,params:unknown)=>send({method,params}),resolveCwd:()=>cwd});
terminals.on('event',(event)=>{trace('manager',event);mirror.handleEvent(event);});
async function handle(rpc:any){
  applicationMessageCount++;
  try{
    if(groupChats?.handle(rpc))return;
    if(runtime?.handle(rpc))return;
    if(rpc.id==null)return;
    const p=rpc.params??{};
    if(rpc.method==='thread/name/set'){git.handleGitRequest(JSON.stringify(rpc),(text:string)=>send(JSON.parse(text)),{onThreadNameSet:(value:any)=>runtime?.renameFromBridge(value)});return;}
    if(rpc.method.startsWith('git/')){scoped(p.cwd);git.handleGitRequest(JSON.stringify(rpc),(text:string)=>send(JSON.parse(text)));return;}
    if(rpc.method.startsWith('project/')){if(p.path)scoped(p.path);const value=await project.handleProjectMethod(rpc.method,p,{homeDir:cwd,allowedRoots:[cwd],codexHome:path.join(root,'codex-test-state')});send({id:rpc.id,result:value});return;}
    if(rpc.method.startsWith('workspace/')){scoped(p.cwd);send({id:rpc.id,result:await workspace.handleWorkspaceMethod(rpc.method,p)});return;}
    const terminalMethod=rpc.method.replace('djl/terminal/','');
    if(rpc.method.startsWith('djl/terminal/')&&typeof (mirror as any)[terminalMethod]==='function'){send({id:rpc.id,result:await (mirror as any)[terminalMethod](p)});return;}
    if(rpc.method==='djl/workspaces/terminals'){send({id:rpc.id,result:await mirror.listWorkspaces()});return;}
    if(runtime){send({id:rpc.id,error:{code:-32601,message:'Method is not implemented by the native acceptance fixture.'}});return;}
    send({id:rpc.id,result:{method:rpc.method,params:p}});
  }catch(error){send({id:rpc.id,error:{code:-32000,message:error instanceof Error?error.message:'QA handler failed.'}});}
}
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.DJL_QA_BRIDGE_PORT??0),async fetch(request,server){
  const url=new URL(request.url);
  const codeResponse=await pairingCodes?.handle(request);if(codeResponse)return codeResponse;
  if(runtime&&url.pathname==='/qa/pairing')return Response.json(wire.createPairingPayload());
  if(runtime&&request.method==='POST'&&url.pathname==='/qa/drop'){setTimeout(()=>activeSocket?.close(1012,'QA reconnect'),50);return Response.json({ok:true});}
  if(runtime&&url.pathname==='/qa/state')return Response.json({...runtime.state(),applicationMessageCount});
  if(groupChats&&url.pathname==='/qa/groups')return Response.json(groupChats.state());
  if(runtime&&['/qa/thread-start/arm','/qa/thread-start/release'].includes(url.pathname)){
    if(request.method!=='POST')return new Response('POST required',{status:405});
    try{if(url.pathname.endsWith('/arm'))runtime.armThreadStartReply();else runtime.releaseThreadStartReply();return Response.json({ok:true});}catch{return Response.json({ok:false},{status:409});}
  }
  if(runtime&&url.pathname==='/qa/reasoning/advance'){
    if(request.method!=='POST')return new Response('POST required',{status:405});
    try{runtime.advanceReasoning(await request.json());return Response.json({ok:true});}catch{return Response.json({ok:false},{status:409});}
  }
  if(runtime&&url.pathname==='/qa/presentation/advance'){
    if(request.method!=='POST')return new Response('POST required',{status:405});
    try{runtime.advancePresentation(await request.json());return Response.json({ok:true});}catch{return Response.json({ok:false},{status:409});}
  }
  if(runtime&&url.pathname==='/qa/restore-fixture'){if(request.method==='POST'){const body=await request.json();runtime.saveRestoreFixture(body.platform,body.expected);return Response.json({ok:true});}return Response.json(runtime.restoreFixture(url.searchParams.get('platform')??''));}
  if(runtime&&request.method==='POST'&&url.pathname.endsWith('/trusted/session/resolve')){
    const body=await request.json();const pairing=wire.createPairingPayload();
    const check=await verifyTrustedResolveRequest({request:body,registration:{...pairing,trustedPhoneDeviceId:trustedPhone?.phoneDeviceId??null,trustedPhonePublicKey:trustedPhone?.phoneIdentityPublicKey??null,pairingCode:'',pairingVersion:2,pairingExpiresAt:pairing.expiresAt},nonceAlreadyUsed:usedNonces.has(body.nonce)});
    if(!check.ok)return Response.json({ok:false,code:check.code,error:'QA trusted resolution refused.'},{status:403});
    usedNonces.add(body.nonce);return Response.json({ok:true,...pairing});
  }
  if(server.upgrade(request))return;return new Response('QA only',{status:404});
},websocket:{open(socket){activeSocket=socket;wire.bindLiveSendWireMessage((text:string)=>{socket.send(text);return true;});},message(socket,text){wire.handleIncomingWireMessage(String(text),{sendControlMessage:(message:unknown)=>socket.send(JSON.stringify(message)),onApplicationMessage:(raw:string)=>void handle(JSON.parse(raw))});},close(){mirror.reset();}}});
wire=secure.createBridgeSecureTransport({sessionId:'desktop-qa-session',relayUrl:`ws://127.0.0.1:${server.port}/relay`,persistTrustedPhone:persistentIdentity,onTrustedPhoneUpdate:(_state:any,phone:any)=>{trustedPhone=phone;},deviceState});
if(runtime)pairingCodes=createPairingCodeFixture({createPairingPayload:()=>wire.createPairingPayload(),relayUrl:`ws://127.0.0.1:${server.port}/relay`});
console.log(JSON.stringify({pairing:wire.createPairingPayload(),cwd}));
process.on('SIGTERM',async()=>{server.stop(true);await terminals.disposeForShutdown();process.exit(0);});
