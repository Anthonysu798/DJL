// Test-only loopback routes. Codes never establish trust; the production handshake still does.
import qr from '../../../remote-gateway/src/qr.js';

const resolvePaths=new Set(['/v1/pairing/code/resolve','/relay/v1/pairing/code/resolve']);
const maxBodyBytes=512;
const codeLifetimeMs=300000;
const headers={'cache-control':'no-store'};
function refuse(status:number,expired=false){
 return Response.json({ok:false,code:expired?'pairing_code_expired':'pairing_code_unavailable',error:expired?'This pairing code has expired.':'Pairing code is unavailable.'},{status,headers});
}
async function boundedBody(request:Request){
 if(!request.body)return '';
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBodyBytes){await reader.cancel();throw new Error('Body limit');}chunks.push(value);}
 }finally{reader.releaseLock();}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
function validPayload(value:unknown,relayUrl:string,now:number):value is {v:2,sessionId:string,macDeviceId:string,macIdentityPublicKey:string,expiresAt:number,displayName?:string}{
 if(!value||typeof value!=='object')return false;
 const p=value as Record<string,unknown>;
 const local=new URL(relayUrl);
 if(local.protocol!=='ws:'||local.hostname!=='127.0.0.1'||!local.port||local.pathname!=='/relay'||local.username||local.password||local.search||local.hash)return false;
 if(p.v!==2||p.relay!==relayUrl||typeof p.sessionId!=='string'||!p.sessionId.trim()||typeof p.macDeviceId!=='string'||!p.macDeviceId.trim())return false;
 if(typeof p.expiresAt!=='number'||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now)return false;
 if(p.displayName!==undefined&&typeof p.displayName!=='string')return false;
 return typeof p.macIdentityPublicKey==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(p.macIdentityPublicKey)&&Buffer.from(p.macIdentityPublicKey,'base64').byteLength===32&&Buffer.from(p.macIdentityPublicKey,'base64').toString('base64')===p.macIdentityPublicKey;
}
export function createPairingCodeFixture({relayUrl,now=Date.now,createPairingPayload}:{relayUrl:string,now?:()=>number,createPairingPayload:()=>unknown}){
 let current:{code:string,expiresAt:number}|null=null;
 return {async handle(request:Request):Promise<Response|null>{
  const url=new URL(request.url);const issue=url.pathname==='/qa/pairing-code';
  if(url.search||(!issue&&!resolvePaths.has(url.pathname)))return null;
  if(request.method!=='POST')return refuse(405);
  let body:string;
  try{body=await boundedBody(request);}catch{return refuse(400);}
  if(issue){
   if(body.trim())return refuse(400);
   current={code:qr.createShortPairingCode(),expiresAt:now()+codeLifetimeMs};
   return Response.json(current,{headers});
  }
  let code:string;
  try{
   const parsed=JSON.parse(body);
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length!==1||typeof parsed.code!=='string')return refuse(400);
   code=parsed.code.replace(/[\s-]/g,'').toUpperCase();
   if(!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8,12}$/.test(code))return refuse(400);
  }catch{return refuse(400);}
  if(!current||current.code!==code)return refuse(403);
  if(now()>=current.expiresAt)return refuse(410,true);
  // Consume synchronously before invoking the supplier, including failures and reentrancy.
  current=null;
  try{
   const p=createPairingPayload();
   if(!validPayload(p,relayUrl,now()))return refuse(403);
   return Response.json({ok:true,v:p.v,sessionId:p.sessionId,macDeviceId:p.macDeviceId,macIdentityPublicKey:p.macIdentityPublicKey,expiresAt:p.expiresAt,...(p.displayName===undefined?{}:{displayName:p.displayName})},{headers});
  }catch{return refuse(403);}
 }};
}
