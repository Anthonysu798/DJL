// Deterministic public test keys only. Uses the production TypeScript transcript and Node crypto.
import {buildHandshakeTranscript, buildPairingProofInput, buildRelayMacRegistrationTranscript, buildRelayPhoneConnectTranscript, secureNonce, splitPairingCodeKeyMaterial, DJL_PAIRING_CODE_KDF_BYTES, DJL_PAIRING_CODE_KDF_ITERATIONS, DJL_PAIRING_CODE_KDF_SALT, DJL_PAIRING_PROOF_MAC_LABEL, DJL_PAIRING_PROOF_PHONE_LABEL} from '../../../packages/remote-protocol/src/index';
import {createPrivateKey,createPublicKey,diffieHellman,sign,createHash,createHmac,hkdfSync,pbkdf2Sync,createCipheriv} from 'node:crypto';
const b64=(v:Uint8Array)=>Buffer.from(v).toString('base64');
function key(kind:'ed25519'|'x25519',seed:number){
 const raw=Buffer.alloc(32,seed);
 const prefix=Buffer.from(kind==='ed25519'?'302e020100300506032b657004220420':'302e020100300506032b656e04220420','hex');
 const privateKey=createPrivateKey({key:Buffer.concat([prefix,raw]),format:'der',type:'pkcs8'});
 const publicKey=createPublicKey(privateKey);
 const jwk=publicKey.export({format:'jwk'});
 return {privateKey,publicKey,raw: b64(raw),pub:b64(Buffer.from(jwk.x!,'base64url'))};
}
const mac=key('ed25519',1),phone=key('ed25519',2),macEph=key('x25519',3),phoneEph=key('x25519',4);
const input={sessionId:'fixture-session',protocolVersion:2,handshakeMode:'qr_bootstrap' as const,keyEpoch:7,macDeviceId:'fixture-mac',phoneDeviceId:'fixture-phone',macIdentityPublicKey:Buffer.from(mac.pub,'base64'),phoneIdentityPublicKey:Buffer.from(phone.pub,'base64'),macEphemeralPublicKey:Buffer.from(macEph.pub,'base64'),phoneEphemeralPublicKey:Buffer.from(phoneEph.pub,'base64'),clientNonce:Buffer.alloc(32,5),serverNonce:Buffer.alloc(32,6),expiresAtForTranscript:1793161200000};
const transcript=buildHandshakeTranscript(input);
const salt=createHash('sha256').update(transcript).digest();
const shared=diffieHellman({privateKey:phoneEph.privateKey,publicKey:macEph.publicKey});
const prefix='djl-e2ee-v1|fixture-session|fixture-mac|fixture-phone|7';
const derive=(direction:string)=>Buffer.from(hkdfSync('sha256',shared,salt,`${prefix}|${direction}`,32));
const label=Buffer.from('client-auth');const length=Buffer.alloc(4);length.writeUInt32BE(label.length);
const payload={bridgeOutboundSeq:1,payloadText:JSON.stringify({id:'rpc-1',result:{ok:true}})};
const cipher=createCipheriv('aes-256-gcm',derive('macToPhone'),secureNonce('mac',0));
const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);
const pairingCode='ABCDEFGHJK';
const pairingKeys=splitPairingCodeKeyMaterial(pbkdf2Sync(pairingCode,DJL_PAIRING_CODE_KDF_SALT,DJL_PAIRING_CODE_KDF_ITERATIONS,DJL_PAIRING_CODE_KDF_BYTES,'sha256'));
const proof=(proofLabel:typeof DJL_PAIRING_PROOF_MAC_LABEL|typeof DJL_PAIRING_PROOF_PHONE_LABEL)=>createHmac('sha256',pairingKeys.pairingSecret).update(buildPairingProofInput(transcript,proofLabel)).digest('base64');
const pairing={code:pairingCode,lookupCode:pairingKeys.lookupCode,pairingSecret:b64(pairingKeys.pairingSecret),macPairingProof:proof(DJL_PAIRING_PROOF_MAC_LABEL),phonePairingProof:proof(DJL_PAIRING_PROOF_PHONE_LABEL)};
const macRegistrationTranscript=buildRelayMacRegistrationTranscript({sessionId:input.sessionId,macDeviceId:input.macDeviceId,macIdentityPublicKey:input.macIdentityPublicKey});
const phoneConnectTranscript=buildRelayPhoneConnectTranscript({sessionId:input.sessionId,phoneDeviceId:input.phoneDeviceId,phoneIdentityPublicKey:input.phoneIdentityPublicKey});
const relayAuth={macRegistrationTranscript:b64(macRegistrationTranscript),macRegistrationSignature:b64(sign(null,macRegistrationTranscript,mac.privateKey)),phoneConnectTranscript:b64(phoneConnectTranscript),phoneConnectSignature:b64(sign(null,phoneConnectTranscript,phone.privateKey))};
const result={pairing,relayAuth,input:Object.fromEntries(Object.entries(input).map(([k,v])=>[k,v instanceof Uint8Array?b64(v):v])),transcript:b64(transcript),macSignature:b64(sign(null,transcript,mac.privateKey)),phoneSignature:b64(sign(null,Buffer.concat([transcript,length,label]),phone.privateKey)),phoneSeed:phone.raw,phoneEphemeralSeed:phoneEph.raw,sharedSecret:b64(shared),phoneToMacKey:b64(derive('phoneToMac')),macToPhoneKey:b64(derive('macToPhone')),envelope:{kind:'encryptedEnvelope',v:2,sessionId:'fixture-session',keyEpoch:7,sender:'mac',counter:0,ciphertext:b64(ciphertext),tag:b64(cipher.getAuthTag())},payload};
await Bun.write(new URL('../test/fixtures/remote-v2.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
