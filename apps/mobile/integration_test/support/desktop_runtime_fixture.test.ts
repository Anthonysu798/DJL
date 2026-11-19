import {describe,expect,test} from 'bun:test';
import {createRuntimeFixture} from './desktop_runtime_fixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('settings usage fixture exercises null compatibility without starting a turn',()=>{
 const messages:any[]=[];
 const fixture=createRuntimeFixture('/tmp/disposable-mobile-usage',m=>messages.push(structuredClone(m)));
 expect(fixture.handle({id:1,method:'account/rateLimits/read',params:null})).toBe(true);
 expect(messages.at(-1)).toMatchObject({id:1,error:{code:-32602,message:'invalid type: null, expected map'}});
 expect(fixture.handle({id:2,method:'account/rateLimits/read',params:{}})).toBe(true);
 const result=messages.at(-1).result.rateLimitsByLimitId.codex;
 expect(result.primary).toMatchObject({usedPercent:25,windowDurationMins:300});
 expect(result.secondary).toMatchObject({usedPercent:60,windowDurationMins:10080});
 expect(result.primary.resetsAt).toBeGreaterThan(Math.floor(Date.now()/1000));
 expect(fixture.state()).toMatchObject({usageReadCount:2,usageNullCount:1,turnStartCount:0,turnCount:0,pendingCount:0});
 expect(fixture.state().requests.filter((r:any)=>r.method==='account/rateLimits/read').map((r:any)=>r.paramsShape)).toEqual(['null','object']);
 expect(fixture.handle({id:3,method:'account/rateLimits/read',params:{unexpected:true}})).toBe(true);
 expect(messages.at(-1).error.code).toBe(-32602);
 expect(fixture.state().turnStartCount).toBe(0);
});

test('presentation fixture holds terminal files until an exact one-shot completion',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'djl-presentation-test-'));
 try{
  const messages:any[]=[];
  const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)));
  fixture.handle({id:1,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[presentation] local image and file table'}]}});
  await Bun.sleep(180);
  expect(fixture.state().presentation).toMatchObject({stage:'FILES_READY',revision:1,pending:true});
  expect(messages.filter(m=>m.method==='item/completed'&&m.params.item.type==='fileChange')).toHaveLength(3);
  expect(messages.filter(m=>m.method==='turn/completed')).toHaveLength(0);
  expect(()=>fixture.handle({id:2,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[presentation] duplicate'}]}})).toThrow('Presentation fixture already active');
  expect(fixture.state().turnStartCount).toBe(1);
  const state=fixture.state().presentation!;
  const expected={threadId:state.threadId,turnId:state.turnId,stage:state.stage,revision:state.revision};
  for(const key of ['threadId','turnId','stage','revision'])expect(()=>fixture.advancePresentation({...expected,[key]:'wrong'})).toThrow('No matching active presentation barrier');
  fixture.advancePresentation(expected);
  expect(()=>fixture.advancePresentation(expected)).toThrow('No matching active presentation barrier');
  await Bun.sleep(0);
  expect(fixture.state().presentation).toMatchObject({stage:'COMPLETE',revision:2,pending:false});
  expect(messages.filter(m=>m.method==='turn/completed')).toHaveLength(1);
  fixture.handle({id:3,method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
  const items=messages.at(-1).result.thread.turns[0].items;
  expect(items.filter((i:any)=>i.type==='fileChange')).toHaveLength(3);
  const answer=items.find((i:any)=>i.type==='agentMessage');
  expect(answer.phase).toBe('final_answer');
  expect(answer.text).toContain('Before screenshot.');
  expect(answer.text).toContain('/.codex/generated_images/djl-preview.png');
  expect(fs.readFileSync(path.join(root,'hello.txt'),'utf8')).toBe('native-preview-change\n');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('presentation interruption closes its barrier without another completion',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'djl-presentation-interrupt-'));
 try{
  const messages:any[]=[];const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)));
  fixture.handle({id:1,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[presentation] interrupted'}]}});
  await Bun.sleep(180);
  const state=fixture.state().presentation!;
  fixture.handle({id:2,method:'turn/interrupt',params:{threadId:state.threadId,turnId:state.turnId}});
  expect(fixture.state().presentation).toMatchObject({stage:'INTERRUPTED',pending:false});
  expect(()=>fixture.advancePresentation(state)).toThrow('No matching active presentation barrier');
  await Bun.sleep(0);
  expect(messages.filter(m=>m.method==='turn/completed')).toHaveLength(1);
  expect(messages.find(m=>m.method==='turn/completed').params.turn.status).toBe('interrupted');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

describe('native composer fixture boundaries',()=>{
 test('discovery uses exact existing wire methods and stays within fixture root',()=>{
  const messages:any[]=[];const root='/tmp/disposable-mobile-qa';
  const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)));
  const call=(method:string,params:any={})=>{expect(fixture.handle({id:messages.length+1,method,params})).toBe(true);return messages.at(-1).result;};
  expect(call('skills/list',{cwds:[root]}).data[0].skills[0].name).toBe('qa-review');
  expect(call('plugin/list',{cwds:[root]}).marketplaces[0].plugins[0].installed).toBe(true);
  expect(call('fuzzyFileSearch',{query:'hello',roots:[root],cancellationToken:'qa'}).files).toEqual([{root,path:'hello.txt',file_name:'hello.txt',score:100}]);
  expect(()=>call('fuzzyFileSearch',{query:'hello',roots:['/Users']})).toThrow('Outside QA search root');
  expect(fixture.handle({id:99,method:'invented/method'})).toBe(false);
 });
 test('native input oracle excludes inline image bytes',()=>{
  const messages:any[]=[];const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',m=>messages.push(structuredClone(m)));
  const threadId=messages.length===0?'native-thread-1':'';
  fixture.handle({id:1,method:'turn/start',params:{threadId,input:[{type:'image',url:'data:image/png;base64,aGVsbG8='},{type:'text',text:'[hold] disposable input'},{type:'skill',id:'qa-review',name:'qa-review',path:'/tmp/disposable-mobile-qa/QA-SKILL.md'}]}});
  expect(fixture.state().lastInput).toEqual([{type:'image',inlineImage:true,imageCharacters:30},{type:'text',text:'[hold] disposable input'},{type:'skill',id:'qa-review',name:'qa-review',path:'/tmp/disposable-mobile-qa/QA-SKILL.md'}]);
  expect(JSON.stringify(fixture.state())).not.toContain('aGVsbG8');
 });
});


describe('advanced native runtime fixture',()=>{
 test('advanced turn emits guardian/activity/child history with safe request oracles',async()=>{
  const messages:any[]=[];const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',m=>messages.push(structuredClone(m)));
  fixture.handle({id:1,method:'turn/start',params:{threadId:'native-thread-1',model:'qa-model',djlProvider:'codex',input:[{type:'text',text:'[advanced] local native cards'}]}});
  await Bun.sleep(180);
  expect(messages.filter(m=>m.method==='item/autoApprovalReview/completed')).toHaveLength(1);
  expect(messages.some(m=>m.method==='item/commandExecution/outputDelta')).toBe(true);
  const collab=messages.find(m=>m.method==='item/completed'&&m.params.item.type==='collabAgentToolCall');
  expect(collab.params.item.receiverThreadIds).toHaveLength(1);
  const childId=collab.params.item.receiverThreadIds[0];
  fixture.handle({id:2,method:'thread/read',params:{threadId:childId,includeTurns:true}});
  expect(messages.at(-1).result.thread.agentNickname).toBe('Fixture Scout');
  expect(messages.at(-1).result.thread.model).toBe('qa-child-model');
  expect(fixture.state().threadReadCount).toBe(1);
  expect(fixture.state().threadResumeCount).toBe(0);
  const review=messages.find(m=>m.method==='item/autoApprovalReview/completed').params;
  expect(review.action).toEqual({type:'command',source:'unifiedExec',command:'echo QA_RETRY',cwd:'/tmp/disposable-mobile-qa'});
  const event={id:review.reviewId,turn_id:review.turnId,status:'denied',action:{type:'command',source:'unified_exec',command:'echo QA_RETRY',cwd:'/tmp/disposable-mobile-qa'}};
  fixture.handle({id:3,method:'thread/approveGuardianDeniedAction',params:{threadId:'native-thread-1',event}});
  expect(fixture.state().guardianRetryCount).toBe(1);
  expect(fixture.state().guardianRetryAttemptCount).toBe(1);
  expect(()=>fixture.handle({id:4,method:'thread/approveGuardianDeniedAction',params:{threadId:'native-thread-1',event}})).toThrow('Invalid or consumed QA guardian review');
  expect(fixture.state().guardianRetryAttemptCount).toBe(2);
  expect(fixture.state().requests.filter(r=>r.method==='thread/approveGuardianDeniedAction')).toHaveLength(2);
  expect(fixture.state().guardianRetryCount).toBe(1);
  expect(fixture.state().turnStartCount).toBe(1);
 });
});


describe('advanced acceptance request evidence',()=>{
 test('wire policy oracle retains reviewer and exact selected sandbox',()=>{
  const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',()=>{});
  const policy={threadId:'native-thread-1',model:'qa-model',djlProvider:'codex',approvalsReviewer:'auto_review',approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',networkAccess:true}};
  fixture.handle({id:1,method:'turn/start',params:{...policy,input:[{type:'text',text:'[hold] fixture parent'}]}});
  expect(fixture.state().lastTurn).toEqual(policy);
 });
 test('request oracle is bounded and retains no raw payload or secrets',()=>{
  const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',()=>{});
  fixture.handle({id:1,method:'djl/thread/runtimeMode/set',params:{threadId:'native-thread-1',runtimeMode:'approval-required',token:'DO_NOT_RETAIN_NATIVE_TOKEN',event:{command:'DO_NOT_RETAIN_NATIVE_ACTION'}}});
  fixture.handle({id:2,method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true,token:'DO_NOT_RETAIN_NATIVE_TOKEN'}});
  expect(fixture.state().requests).toEqual([
   {sequence:1,method:'djl/thread/runtimeMode/set',threadId:'native-thread-1'},
   {sequence:2,method:'thread/read',threadId:'native-thread-1',includeTurns:true},
  ]);
  expect(JSON.stringify(fixture.state().requests)).not.toContain('DO_NOT_RETAIN');
  for(let id=3;id<=300;id++)fixture.handle({id,method:'thread/read',params:{threadId:'native-thread-1',includeTurns:false}});
  expect(fixture.state().requests).toHaveLength(256);
  expect(fixture.state().requestSequence).toBe(300);
  expect(fixture.state().requests[0].sequence).toBe(45);
  expect(fixture.state().requests.at(-1)).toEqual({sequence:300,method:'thread/read',threadId:'native-thread-1',includeTurns:false});
 });
});


test('snake-case thread rename is normalized in sanitized request trace before gateway routing',()=>{
 const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',()=>{});
 fixture.handle({id:1,method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
 expect(fixture.handle({id:2,method:'thread/name/set',params:{thread_id:'native-thread-1',name:'DO_NOT_RETAIN_RENAME_PAYLOAD'}})).toBe(false);
 expect(fixture.state().requests).toEqual([
  {sequence:1,method:'thread/read',threadId:'native-thread-1',includeTurns:true},
  {sequence:2,method:'thread/name/set',threadId:'native-thread-1'},
 ]);
 expect(JSON.stringify(fixture.state().requests)).not.toContain('DO_NOT_RETAIN_RENAME_PAYLOAD');
 fixture.handle({id:3,method:'thread/name/set',params:{threadId:'canonical-id',thread_id:'alias-id',name:'not retained'}});
 expect(fixture.state().requests.at(-1).threadId).toBe('canonical-id');
});


test('guardian retry requires the canonical source and exact disposable working directory',async()=>{
 const messages:any[]=[];const root='/tmp/disposable-mobile-qa';
 const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)));
 fixture.handle({id:1,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[advanced] retry context'}]}});
 await Bun.sleep(180);
 const review=messages.find(m=>m.method==='item/autoApprovalReview/completed').params;
 const action={type:'command',source:'unified_exec',command:'echo QA_RETRY',cwd:root};
 for(const invalid of [{...action,source:'other'},{...action,cwd:'/tmp/unrelated'},{type:'command',command:'echo QA_RETRY'}]){
  expect(()=>fixture.handle({id:2,method:'thread/approveGuardianDeniedAction',params:{threadId:'native-thread-1',event:{id:review.reviewId,status:'denied',action:invalid}}})).toThrow('Invalid or consumed QA guardian review');
 }
 expect(fixture.state().guardianRetryCount).toBe(0);
 fixture.handle({id:3,method:'thread/approveGuardianDeniedAction',params:{threadId:'native-thread-1',event:{id:review.reviewId,status:'denied',action}}});
 expect(fixture.state().guardianRetryCount).toBe(1);
 expect(fixture.state().guardianRetryAttemptCount).toBe(4);
});

describe('native draft start evidence',()=>{
 test('counts refused attempts and stores only fixed start shape',()=>{
  const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',()=>{});
  expect(fixture.state().threadStartAttemptCount).toBe(0);
  expect(()=>fixture.handle({id:1,method:'thread/start',params:{cwd:'/private/DO_NOT_RETAIN',djlScope:'secret'}})).toThrow('Outside QA workspace');
  expect(fixture.state().threadStartAttemptCount).toBe(1);
  expect(fixture.state().threadCount).toBe(1);
  expect(fixture.state().lastThreadStartShape).toEqual({cwdPresent:true,cwdIsRoot:false,djlScope:'other'});
  expect(JSON.stringify(fixture.state())).not.toContain('DO_NOT_RETAIN');
  fixture.handle({id:2,method:'thread/start',params:{djlScope:'studio'}});
  expect(fixture.state().lastThreadStartShape).toEqual({cwdPresent:false,cwdIsRoot:false,djlScope:'studio'});
  fixture.handle({id:3,method:'thread/start',params:{cwd:'/tmp/disposable-mobile-qa',djlScope:'project'}});
  expect(fixture.state().lastThreadStartShape).toEqual({cwdPresent:true,cwdIsRoot:true,djlScope:'project'});
  expect(fixture.state().threadStartAttemptCount).toBe(3);
 });
 test('one-shot barrier holds only the actual allocated reply and refuses misuse',()=>{
  const messages:any[]=[];
  const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',m=>messages.push(structuredClone(m)));
  expect(()=>fixture.releaseThreadStartReply()).toThrow();
  fixture.armThreadStartReply();
  expect(()=>fixture.armThreadStartReply()).toThrow();
  fixture.handle({id:'held',method:'thread/start',params:{djlScope:'studio'}});
  expect(messages).toHaveLength(0);
  expect(fixture.state().threadCount).toBe(2);
  expect(fixture.state().threadStartAttemptCount).toBe(1);
  expect(fixture.state().threadStartReplyPending).toBe(true);
  expect(fixture.state().heldThreadStartReplyCount).toBe(1);
  expect(()=>fixture.armThreadStartReply()).toThrow();
  fixture.releaseThreadStartReply();
  expect(messages).toHaveLength(1);
  expect(messages[0].id).toBe('held');
  expect(messages[0].result.thread.id).toBe('native-thread-2');
  expect(fixture.state().threadStartReplyPending).toBe(false);
  expect(()=>fixture.releaseThreadStartReply()).toThrow();
  fixture.handle({id:'normal',method:'thread/start',params:{djlScope:'studio'}});
  expect(messages[1].id).toBe('normal');
  expect(messages[1].result.thread.id).toBe('native-thread-3');
  expect(fixture.state().threadCount).toBe(3);
 });
});

describe('held upstream reasoning lifecycle',()=>{
 test('real turn owns indexed deltas, exact releases and canonical retained history',async()=>{
  const messages:any[]=[];
  const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',m=>messages.push(structuredClone(m)));
  expect(fixture.state().reasoning).toBeNull();
  expect(()=>fixture.advanceReasoning({})).toThrow();
  fixture.handle({id:500,method:'thread/start',params:{djlScope:'studio'}});
  const threadId=messages.at(-1).result.thread.id;
  fixture.handle({id:501,method:'turn/start',params:{threadId,input:[{type:'text',text:'[reasoning] native disclosure'}]}});
  expect(messages.some(m=>m.method==='item/reasoning/summaryTextDelta')).toBe(false);
  await Bun.sleep(180);
  const first=fixture.state().reasoning!;
  expect(first).toMatchObject({threadId,stage:'STREAM_INITIAL',revision:1,pending:true,detailCompletedCount:0,turnCompletedCount:0});
  const rejects=[{}, {...first,threadId:'wrong'}, {...first,turnId:'wrong'}, {...first,itemId:'wrong'}, {...first,revision:0}, {...first,stage:'STREAM_UPDATED'}];
  for(const candidate of rejects){const count=messages.length;expect(()=>fixture.advanceReasoning(candidate)).toThrow();expect(messages.length).toBe(count);}
  const itemStart=messages.find(m=>m.method==='item/started'&&m.params.item.id===first.itemId);
  expect(itemStart.params.item.summary).toEqual([]);
  await Bun.sleep(180);
  expect(fixture.state().reasoning).toEqual(first);
  fixture.advanceReasoning(first);
  expect(()=>fixture.advanceReasoning(first)).toThrow();
  await Bun.sleep(0);
  const second=fixture.state().reasoning!;
  expect(second).toMatchObject({stage:'STREAM_UPDATED',revision:2,pending:true,detailCompletedCount:0,turnCompletedCount:0});
  expect(second.summaryPartAddedCount).toBe(2);
  expect(second.summaryTextDeltaCount).toBe(4);
  expect(second.textDeltaCount).toBe(1);
  const deltas=messages.filter(m=>m.method?.startsWith('item/reasoning/'));
  expect([...new Set(deltas.map(m=>m.method))].toSorted()).toEqual(['item/reasoning/summaryPartAdded','item/reasoning/summaryTextDelta','item/reasoning/textDelta'].toSorted());
  expect(deltas.every(m=>m.params.threadId===threadId&&m.params.turnId===first.turnId&&m.params.itemId===first.itemId)).toBe(true);
  expect(deltas.filter(m=>m.method.endsWith('summaryPartAdded')).map(m=>m.params.summaryIndex)).toEqual([0,1]);
  expect(messages.some(m=>m.method==='turn/completed')).toBe(false);
  fixture.advanceReasoning(second);
  await Bun.sleep(0);
  expect(fixture.state().reasoning).toMatchObject({stage:'COMPLETE',revision:3,pending:false,detailCompletedCount:1,turnCompletedCount:1});
  const count=messages.length;expect(()=>fixture.advanceReasoning(second)).toThrow();expect(messages.length).toBe(count);
  fixture.handle({id:502,method:'thread/read',params:{threadId,includeTurns:true}});
  const turns=messages.at(-1).result.thread.turns;
  expect(turns).toHaveLength(1);expect(turns[0].status).toBe('completed');
  expect(turns[0].items.map((i:any)=>i.type)).toEqual(['userMessage','reasoning','reasoning','agentMessage']);
  expect(turns[0].items[1].summary).toEqual([{type:'summary_text',text:'**Checking request**'}]);
  expect(turns[0].items[2]).toMatchObject({id:first.itemId,summary:[{type:'summary_text',text:'**Reading files**\nCanonical completion detail.'},{type:'summary_text',text:'**Verifying response**\nCanonical verification detail.'}],content:[{type:'reasoning_text',text:'Canonical content detail.'}]});
  expect(JSON.stringify(turns)).not.toContain('Live summary detail.');
  expect(itemStart.params.item.summary).toEqual([]); // immutable send-time snapshot
  expect(fixture.state().requests).toEqual([{sequence:1,method:'thread/start',threadId:null},{sequence:2,method:'turn/start',threadId},{sequence:3,method:'thread/read',threadId,includeTurns:true}]);
 });
});


describe('reasoning does not change existing runtime branches',()=>{
 test('models, hold, echo and decline retain existing behavior',async()=>{
  const messages:any[]=[];const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',m=>messages.push(structuredClone(m)));
  fixture.handle({id:600,method:'model/list'});
  expect(messages.at(-1).result.data.map((m:any)=>m.model)).toEqual(['qa-model','qa-child-model']);
  fixture.handle({id:601,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[hold]'}]}});
  await Bun.sleep(180);expect(fixture.state().reasoning).toBeNull();
  expect(messages.some(m=>m.method==='turn/completed')).toBe(false);
  fixture.handle({id:602,method:'turn/interrupt',params:{threadId:'native-thread-1',turnId:'native-turn-2'}});
  fixture.handle({id:603,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[echo] old behavior'}]}});
  await Bun.sleep(180);
  expect(messages.some(m=>m.method==='item/completed'&&m.params.item.text==='Saved native conversation history. [echo] old behavior')).toBe(true);
  fixture.handle({id:604,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'ordinary approval'}]}});
  await Bun.sleep(180);
  const approval=messages.find(m=>m.method==='item/commandExecution/requestApproval');expect(approval).toBeDefined();
  fixture.handle({id:approval.id,result:{decision:'decline'}});await Bun.sleep(0);
  expect(messages.some(m=>m.method==='item/completed'&&m.params.item.text==='Preparing the local acceptance change. Change declined.')).toBe(true);
  expect(fixture.state().reasoning).toBeNull();
 });
 test('interruption makes the producer barrier inactive with no release emissions',async()=>{
  const messages:any[]=[];const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',m=>messages.push(structuredClone(m)));
  fixture.handle({id:700,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[reasoning]'}]}});
  expect(()=>fixture.advanceReasoning({})).toThrow();
  await Bun.sleep(180);const stage=fixture.state().reasoning!;
  fixture.handle({id:701,method:'turn/interrupt',params:{threadId:stage.threadId,turnId:stage.turnId}});
  const count=messages.length;expect(()=>fixture.advanceReasoning(stage)).toThrow();expect(messages.length).toBe(count);
 });
});


test('existing undo branch still owns its disposable file change and completion',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'djl-task49-undo-'));
 try{
  fs.writeFileSync(path.join(root,'hello.txt'),'original\n');
  const messages:any[]=[];const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)));
  fixture.handle({id:800,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[undo]'}]}});
  await Bun.sleep(180);
  expect(fs.readFileSync(path.join(root,'hello.txt'),'utf8')).toBe('original\nresponse-owned native change\n');
  expect(messages.some(m=>m.method==='item/completed'&&m.params.item.type==='fileChange')).toBe(true);
  expect(messages.some(m=>m.method==='turn/completed'&&m.params.turn.status==='completed')).toBe(true);
  expect(fixture.state().reasoning).toBeNull();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('container runtime accepts only working directories approved by its bounded scope',()=>{
 const root='/tmp/disposable-mobile-container',managed='/root/.codex/worktrees/qa/workspace';
 const messages:any[]=[],checked:string[]=[];
 const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)),{workingDirectoryScope:(cwd:string)=>{
  checked.push(cwd);if(cwd!==managed)throw new Error('Outside container working directory.');
 }});
 fixture.handle({id:'managed-start',method:'thread/start',params:{cwd:managed,djlScope:'project'}});
 expect(messages.at(-1).result.thread.cwd).toBe(managed);
 fixture.handle({id:'managed-resume',method:'thread/resume',params:{threadId:'native-thread-1',cwd:managed}});
 expect(messages.at(-1).result.thread.cwd).toBe(managed);
 expect(checked).toEqual([managed,managed]);
 expect(()=>fixture.handle({id:'outside',method:'thread/start',params:{cwd:'/private/host-project'}})).toThrow('Outside container');
 expect(()=>fixture.handle({id:'outside-resume',method:'thread/resume',params:{threadId:'native-thread-1',cwd:'/private/host-project'}})).toThrow('Outside container');
 const ordinary=createRuntimeFixture(root,()=>{});
 expect(()=>ordinary.handle({id:'ordinary-start',method:'thread/start',params:{cwd:managed}})).toThrow('Outside QA workspace');
 expect(()=>ordinary.handle({id:'ordinary-resume',method:'thread/resume',params:{threadId:'native-thread-1',cwd:managed}})).toThrow('Outside QA workspace');
});
