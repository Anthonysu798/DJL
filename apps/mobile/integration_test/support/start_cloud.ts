// Test-only, disposable local Cloud API. Upstream providers and outbound mail are mocked by existing test facilities.
import {mkdir,writeFile} from 'node:fs/promises';
import {startApi} from '../../../../cloud/apps/api/src/server.ts';
import {loadApiEnv} from '../../../../cloud/apps/api/src/config/env.ts';
import {TestClient} from '../../../../cloud/apps/api/src/testing/client.ts';
import {schema} from '../../../../cloud/packages/db/src/index.ts';
import {creditsToMicro} from '../../../../cloud/packages/domain/src/index.ts';

Object.assign(process.env,{STORAGE_S3_ENDPOINT:'http://127.0.0.1:8334',STORAGE_BUCKET:'djl-mobile-qa',STORAGE_ACCESS_KEY_ID:'djl-local',STORAGE_SECRET_ACCESS_KEY:'djl-local-secret'});
const env=loadApiEnv({...process.env,DJL_ENV:'test',DJL_MOCK_EXTERNALS:'true',DATABASE_URL:'postgres://djl:djl@127.0.0.1:54329/djl_flutter_qa_20261028',REDIS_URL:'redis://127.0.0.1:63807/14',API_PUBLIC_URL:'http://127.0.0.1:8851',API_PORT:'8851'});
const api=await startApi({env,port:8851,host:'127.0.0.1'});
const user=await TestClient.for(api).signUp(api,'flutter-mobile-qa');
await api.ledger.grant({orgId:user.orgId,bucket:'topup',type:'topup',amount:creditsToMicro(1000),idempotencyKey:`flutter-qa:${user.orgId}`,actor:'test'});
// Paid-plan and reset-bank fixtures prevent unrelated repeated QA runs exhausting a shared free window.
// This is isolated test data, not a production subscription or a limit override.
const now=new Date(),end=new Date(now.getTime()+30*24*60*60*1000);
await api.db.insert(schema.subscriptions).values({orgId:user.orgId,planId:'starter',stripeSubscriptionId:`fixture-mobile-${user.orgId}`,status:'active',interval:'month',currentPeriodStart:now,currentPeriodEnd:end});
await api.db.insert(schema.resetBanks).values(Array.from({length:5},(_,i)=>({userId:user.userId,source:'admin' as const,grantedBy:'test-fixture',reason:'Disposable mobile acceptance',grantedAt:now,expiresAt:end,idempotencyKey:`mobile-qa:${user.userId}:${i}`})));
await mkdir('/tmp/djl-mobile-qa',{recursive:true,mode:0o700});
await writeFile('/tmp/djl-mobile-qa/credentials.json',JSON.stringify({email:user.email,password:user.password,endpoint:'http://127.0.0.1:8851'}),{mode:0o600});
await writeFile('/tmp/djl-mobile-qa/native-config.json',JSON.stringify({DJL_E2E_EMAIL:user.email,DJL_E2E_PASSWORD:user.password,DJL_CLOUD_API_URL:'http://127.0.0.1:8851'}),{mode:0o600});
console.log('Mobile QA API ready on loopback port 8851. Disposable credentials saved privately; not logged.');
process.on('SIGTERM',async()=>{await api.close();process.exit(0);});
