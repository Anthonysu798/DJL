// Test-only adapter around the actual gateway secure transport. No production credentials.
const {generateKeyPairSync}=require('node:crypto');
const {createBridgeSecureTransport}=require('../../remote-gateway/src/secure-transport.js');
const keys=generateKeyPairSync('ed25519');
const jwk=keys.privateKey.export({format:'jwk'});
const b64=s=>Buffer.from(s,'base64url').toString('base64');
let transport;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request,server){if(server.upgrade(request))return;return new Response('test-only',{status:400});},websocket:{open(ws){transport.bindLiveSendWireMessage(text=>{ws.send(text);return true;});},message(ws,text){transport.handleIncomingWireMessage(String(text),{sendControlMessage:message=>ws.send(JSON.stringify(message)),onApplicationMessage:text=>{const rpc=JSON.parse(text);if(rpc.id)transport.queueOutboundApplicationMessage(JSON.stringify({id:rpc.id,result:{requestId:rpc.id,method:rpc.method,params:rpc.params}}),{sendWireMessage:wire=>{ws.send(wire);return true;}});}});},close(){}}});
transport=createBridgeSecureTransport({sessionId:'test-session',relayUrl:`ws://127.0.0.1:${server.port}/relay`,persistTrustedPhone:false,deviceState:{macDeviceId:'test-mac',macIdentityPrivateKey:b64(jwk.d),macIdentityPublicKey:b64(jwk.x),trustedPhones:{}}});
console.log(JSON.stringify(transport.createPairingPayload()));
process.on('SIGTERM',()=>{server.stop(true);process.exit(0);});
