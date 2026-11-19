import {describe,expect,test} from 'bun:test';
import {generateKeyPairSync} from 'node:crypto';
import qr from '../../../remote-gateway/src/qr.js';
import secure from '../../../remote-gateway/src/secure-transport.js';
import {createPairingCodeFixture} from './pairing_code_fixture';

const relay='ws://127.0.0.1:8852/relay';
const resolvePaths=['/v1/pairing/code/resolve','/relay/v1/pairing/code/resolve'];
const publicKey=Buffer.alloc(32,7).toString('base64');
const b64=(value:string)=>Buffer.from(value,'base64url').toString('base64');
function setup(supplier?:()=>unknown){
 let time=1000;let calls=0;
 const payload=()=>({v:2,relay,sessionId:'test-session',macDeviceId:'test-mac',macIdentityPublicKey:publicKey,expiresAt:time+300000,displayName:'Test Mac',privateExtra:'NEVER_RETURN'});
 const fixture=createPairingCodeFixture({relayUrl:relay,now:()=>time,createPairingPayload:()=>{calls++;return supplier? supplier():payload();}});
 const request=(path:string,body?:string,method='POST')=>fixture.handle(new Request('http://127.0.0.1:8852'+path,{method,...(body===undefined?{}:{body})}));
 const issue=async()=>{const response=await request('/qa/pairing-code');expect(response?.status).toBe(200);expect(response?.headers.get('cache-control')).toBe('no-store');return await response!.json() as {code:string,expiresAt:number};};
 const resolve=(code:string,path=resolvePaths[0]!)=>request(path,JSON.stringify({code}));
 return {fixture,request,issue,resolve,calls:()=>calls,setTime:(value:number)=>{time=value;}};
}
async function refusal(response:Response|null,status:number,code='pairing_code_unavailable'){
 expect(response?.status).toBe(status);
 expect(await response!.json()).toEqual({ok:false,code,error:code==='pairing_code_expired'?'This pairing code has expired.':'Pairing code is unavailable.'});
}

describe('QA-only one-time pairing codes',()=>{
 test('production generator produces the original ten-character alphabet',()=>{
  const code=qr.createShortPairingCode();
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
 });
 test('no outstanding code by default; unknown routes remain outside helper',async()=>{
  const f=setup();for(const code of ['ABCDEFGH','ABCDEFGHJK','ABCDEFGHJKLM'])await refusal(await f.resolve(code),403);
  for(const path of ['/qa/pairing','/v1/pairing/code/resolve/','/prefix/v1/pairing/code/resolve','/qa/pairing-code?command=x'])expect(await f.request(path)).toBeNull();
  expect(f.calls()).toBe(0);
 });
 test('only POST works on all exact routes',async()=>{
  const f=setup();for(const path of ['/qa/pairing-code',...resolvePaths])for(const method of ['GET','PUT','DELETE'])await refusal(await f.request(path,undefined,method),405);
  expect(f.calls()).toBe(0);
 });
 test('issuance is ten characters, bounded expiry, and never calls payload supplier',async()=>{
  const f=setup();const issued=await f.issue();expect(Object.keys(issued).toSorted()).toEqual(['code','expiresAt']);expect(issued.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);expect(issued.expiresAt).toBe(301000);expect(f.calls()).toBe(0);
 });
 test('both aliases normalize whitespace/hyphens and consume exactly once',async()=>{
  for(const path of resolvePaths){const f=setup();const {code}=await f.issue();const normalized=' \n'+code.slice(0,4).toLowerCase()+'-'+code.slice(4).toLowerCase()+'\t';const response=await f.resolve(normalized,path);expect(response?.status).toBe(200);expect(await response!.json()).toEqual({ok:true,v:2,sessionId:'test-session',macDeviceId:'test-mac',macIdentityPublicKey:publicKey,expiresAt:301000,displayName:'Test Mac'});await refusal(await f.resolve(code),403);expect(f.calls()).toBe(1);}
 });
 test('strict typed code-only bodies and malformed codes are refused without consuming',async()=>{
  const f=setup();const {code}=await f.issue();
  for(const body of ['', '{', 'null','[]','42','"ABCDEFGHJK"',JSON.stringify({}),JSON.stringify({code:123}),JSON.stringify({code,extra:true}),JSON.stringify({code:'ABCDEFGIJK'}),JSON.stringify({code:'ABC'}),JSON.stringify({code:'ABCDEFGHJKLMN'})])await refusal(await f.request(resolvePaths[0]!,body),400);
  await refusal(await f.request('/qa/pairing-code','{"length":4}'),400);
  expect(f.calls()).toBe(0);expect((await f.resolve(code))?.status).toBe(200);
 });
 test('bounds UTF-8 and streamed request bodies at 512 bytes',async()=>{
  const f=setup();const {code}=await f.issue();
  const oversized=JSON.stringify({code})+' '.repeat(513);await refusal(await f.request(resolvePaths[0]!,oversized),400);
  await refusal(await f.request('/qa/pairing-code',' '.repeat(513)),400);
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"code":"'));controller.enqueue(new TextEncoder().encode('é'.repeat(260)));controller.close();}});
  const request=new Request('http://127.0.0.1:8852'+resolvePaths[0],{method:'POST',body:stream,duplex:'half'} as RequestInit);
  await refusal(await f.fixture.handle(request),400);expect(f.calls()).toBe(0);
  expect((await f.request(resolvePaths[0]!,JSON.stringify({code})+' '.repeat(512-JSON.stringify({code}).length)))?.status).toBe(200);
 });
 test('wrong codes do not consume the current code',async()=>{
  const f=setup();const {code}=await f.issue();await refusal(await f.resolve(code[0]==='A'?'B'+code.slice(1):'A'+code.slice(1)),403);expect(f.calls()).toBe(0);expect((await f.resolve(code))?.status).toBe(200);
 });
 test('expiry rejects at its exact boundary and never refreshes a payload',async()=>{
  for(const offset of [0,1]){const f=setup();const issued=await f.issue();f.setTime(issued.expiresAt+offset);await refusal(await f.resolve(issued.code),410,'pairing_code_expired');expect(f.calls()).toBe(0);}
  const f=setup();const issued=await f.issue();f.setTime(issued.expiresAt-1);expect((await f.resolve(issued.code))?.status).toBe(200);
 });
 test('explicit new issuance replaces the old outstanding code',async()=>{
  const f=setup();const old=await f.issue();const current=await f.issue();expect(current.code===old.code).toBe(false);await refusal(await f.resolve(old.code),403);expect((await f.resolve(current.code))?.status).toBe(200);expect(f.calls()).toBe(1);
 });
 test('consumes before supplier failure, with no error data or replay',async()=>{
  const f=setup(()=>{throw new Error('DO_NOT_LEAK_SUPPLIER');});const {code}=await f.issue();await refusal(await f.resolve(code),403);await refusal(await f.resolve(code),403);expect(f.calls()).toBe(1);
 });
 test('consumes before supplier reentrancy and simultaneous alias attempts',async()=>{
  let nested:Promise<Response|null>|undefined;let code='';let f:ReturnType<typeof setup>;
  f=setup(()=>{nested=f.resolve(code);return {v:2,relay,sessionId:'s',macDeviceId:'m',macIdentityPublicKey:publicKey,expiresAt:400000};});({code}=await f.issue());expect((await f.resolve(code))?.status).toBe(200);await refusal(await nested!,403);expect(f.calls()).toBe(1);
  const concurrent=setup();const issued=await concurrent.issue();const results=await Promise.all(resolvePaths.map(path=>concurrent.resolve(issued.code,path)));expect(results.map(r=>r!.status).toSorted()).toEqual([200,403]);expect(concurrent.calls()).toBe(1);
 });
 test('invalid payload, expiry, relay, key, or optional name fails closed after consumption',async()=>{
  const base={v:2,relay,sessionId:'s',macDeviceId:'m',macIdentityPublicKey:publicKey,expiresAt:301000};
  const values=[null,{}, {...base,v:1},{...base,sessionId:''},{...base,macDeviceId:4},{...base,expiresAt:1000},{...base,expiresAt:1000.5},{...base,expiresAt:'301000'},{...base,expiresAt:NaN},{...base,expiresAt:Infinity},{...base,relay:'ws://example.com/relay'},{...base,relay:relay+'?x=y'},{...base,macIdentityPublicKey:'DO_NOT_LEAK_KEY'},{...base,macIdentityPublicKey:Buffer.alloc(31).toString('base64')},{...base,macIdentityPublicKey:publicKey.slice(0,-1)+'!'},{...base,displayName:5}];
  for(const value of values){const f=setup(()=>value);const {code}=await f.issue();await refusal(await f.resolve(code),403);await refusal(await f.resolve(code),403);expect(f.calls()).toBe(1);}
 });
 test('success preserves exactly one fresh production wire payload and omits relay/extras',async()=>{
  const jwk=generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});
  const wire=secure.createBridgeSecureTransport({sessionId:'unit-test-session',relayUrl:relay,persistTrustedPhone:false,deviceState:{macDeviceId:'unit-test-mac',macIdentityPrivateKey:b64(jwk.d!),macIdentityPublicKey:b64(jwk.x!),trustedPhones:{}}});
  let actual:Record<string,unknown>|undefined;const f=setup(()=>{actual=wire.createPairingPayload();return actual;});const {code}=await f.issue();expect(actual).toBeUndefined();const response=await f.resolve(code);expect(response?.status).toBe(200);const {relay:omitted,...expected}=actual!;expect(omitted).toBe(relay);expect(await response!.json()).toEqual({ok:true,...expected});expect(f.calls()).toBe(1);
 });
 test('displayName is optional and expected relay must be actual loopback websocket route',async()=>{
  const base={v:2,relay,sessionId:'s',macDeviceId:'m',macIdentityPublicKey:publicKey,expiresAt:301000};const f=setup(()=>base);const {code}=await f.issue();const response=await f.resolve(code);expect(Object.keys(await response!.json())).not.toContain('displayName');
  const invalid=createPairingCodeFixture({relayUrl:'ws://example.com/relay',now:()=>1000,createPairingPayload:()=>({...base,relay:'ws://example.com/relay'})});const issued=await (await invalid.handle(new Request('http://127.0.0.1/qa/pairing-code',{method:'POST'})))!.json();await refusal(await invalid.handle(new Request('http://127.0.0.1/v1/pairing/code/resolve',{method:'POST',body:JSON.stringify({code:issued.code})})),403);
 });
});
