// Child-process test utility. Print only public identity data and self-checks.
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import fs from 'node:fs';
import {loadFixtureDeviceState} from '../../integration_test/support/fixture_resume';
import stateStore from '../../../remote-gateway/src/secure-device-state.js';
try {
 let state=loadFixtureDeviceState(process.env.DJL_FIXTURE_TEST_ROOT!);
 if(process.env.DJL_FIXTURE_TEST_TRUST==='1')state=stateStore.rememberTrustedPhone(state,'qa-phone-141',Buffer.alloc(32,7).toString('base64'));
 const x=Buffer.from(state.macIdentityPublicKey,'base64').toString('base64url'),d=Buffer.from(state.macIdentityPrivateKey,'base64').toString('base64url');
 const secret=createPrivateKey({key:{kty:'OKP',crv:'Ed25519',x,d},format:'jwk'}),pub=createPublicKey({key:{kty:'OKP',crv:'Ed25519',x},format:'jwk'});
 const message=Buffer.from('djl-fixture-self-check-v1');const pairValid=verify(null,message,pub,sign(null,message,secret));
 fs.writeFileSync(process.env.DJL_FIXTURE_TEST_RESULT!,JSON.stringify({id:state.macDeviceId,publicKey:state.macIdentityPublicKey,pairValid,trusted:state.trustedPhones}),{flag:'wx',mode:0o600});
}catch{console.error('QA identity unavailable; no replacement permitted');process.exitCode=1;}
