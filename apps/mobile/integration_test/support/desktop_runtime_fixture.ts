// Test-only upstream runtime: the bridge, crypto, filesystem, Git and PTY remain real.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
type Json=Record<string,any>;
export function createRuntimeFixture(root:string,send:(rpc:Json)=>void,options:{presentationScreenshotPath?:string,workingDirectoryScope?:(cwd:string)=>void,legacyTurnRecovery?:boolean,rejectCollaborationMode?:boolean,groups?:boolean}={}){
  const threads=new Map<string,Json>();
  const goals=new Map<string,Json>();
  let renameCount=0,archiveCount=0,forkCount=0,turnStartCount=0,acceptedInterruptCount=0;
  let usageReadCount=0,usageNullCount=0;
  let threadReadCount=0,threadResumeCount=0,guardianRetryCount=0,guardianRetryAttemptCount=0;
  let requestSequence=0,threadStartAttemptCount=0,heldThreadStartReplyCount=0;
  let lastThreadStartShape:Json|null=null;
  let holdNextThreadStartReply=false,heldThreadStartReply:Json|null=null;
  const requests:Json[]=[];
  const collaborationModes:Json[]=[];
  const guardianGrants=new Map<string,string>();
  let lastTurn:Json|null=null;
  let planImplementation:Json|null=null;
  let lastInput:Json[]=[];
  const restoreFixtures=new Map<string,Json>();
  const pending=new Map<string,{turnId:string,resolve:(value:Json)=>void}>();
  let next=0;
  let reasoning:Json|null=null;
  let releaseReasoning:(()=>void)|null=null;
  let presentation:Json|null=null;
  let steering:Json|null=null;
  let releasePresentation:(()=>void)|null=null;
  const reply=(rpc:Json,result:Json)=>send({id:rpc.id,result});
  const emit=(method:string,params:Json)=>send({method,params});
  const applied=(p:Json)=>({approvalsReviewer:p.approvalsReviewer??'user',approvalPolicy:p.approvalPolicy??'on-request',sandbox:p.sandboxPolicy??{type:'workspaceWrite',networkAccess:true}});
  const inputSummary=(input:Json[])=>input.map((item:Json)=>{const url=item.url??item.image_url;return {type:item.type,...(item.type==='image'?{inlineImage:typeof url==='string'&&url.startsWith('data:image/'),imageCharacters:typeof url==='string'?url.length:0}:{text:item.text,name:item.name,path:item.path,id:item.id})};});
  function checkWorkingDirectory(cwd:string){
    if(cwd===root||cwd.startsWith(root+path.sep))return;
    if(options.workingDirectoryScope){options.workingDirectoryScope(cwd);return;}
    throw new Error('Outside QA workspace');
  }
  function makeThread(cwd=root){const thread={id:`native-thread-${++next}`,name:'Mobile workspace QA',cwd,model:'qa-model',modelProvider:'codex',turns:[] as Json[]};threads.set(thread.id,thread);return thread;}
  makeThread();
  function ask(method:string,params:Json,turnId:string){
    return new Promise<Json>(resolve=>{const id=`fixture-request-${++next}`;pending.set(id,{turnId,resolve});send({id,method,params});});
  }
  async function run(thread:Json,turn:Json,input:Json[]){
    await Bun.sleep(120);
    if(turn.status!=='inProgress')return;
    const params={threadId:thread.id,turnId:turn.id};
    emit('turn/started',{threadId:thread.id,turn:{id:turn.id,status:turn.status}});
    emit('item/started',{...params,item:turn.items[0]});
    if(input.some(i=>String(i.text).includes('[reasoning]'))){
      const summary={id:`reasoning-summary-${turn.id}`,type:'reasoning',summary:[{type:'summary_text',text:'**Checking request**'}],content:[]};
      const detail:Json={id:`reasoning-detail-${turn.id}`,type:'reasoning',summary:[],content:[]};
      turn.items.push(summary,detail);
      emit('item/started',{...params,item:structuredClone(summary)});
      emit('item/completed',{...params,item:structuredClone(summary)});
      emit('item/started',{...params,item:structuredClone(detail)});
      reasoning={...params,itemId:detail.id,stage:'STARTED',revision:0,pending:false,summaryPartAddedCount:0,summaryTextDeltaCount:0,textDeltaCount:0,detailCompletedCount:0,turnCompletedCount:0};
      const delta=(method:string,extra:Json)=>{
        reasoning![method.endsWith('summaryPartAdded')?'summaryPartAddedCount':method.endsWith('summaryTextDelta')?'summaryTextDeltaCount':'textDeltaCount']++;
        emit(method,{...params,itemId:detail.id,...extra});
      };
      const hold=(stage:string)=>new Promise<void>(resolve=>{
        Object.assign(reasoning!,{stage,revision:reasoning!.revision+1,pending:true});releaseReasoning=resolve;
      });
      delta('item/reasoning/summaryPartAdded',{summaryIndex:0});
      for(const text of ['**Read','ing files**\n','Live summary detail.'])delta('item/reasoning/summaryTextDelta',{summaryIndex:0,delta:text});
      detail.summary=[{type:'summary_text',text:'**Reading files**\nLive summary detail.'}];
      await hold('STREAM_INITIAL');
      if(turn.status!=='inProgress')return;
      delta('item/reasoning/summaryPartAdded',{summaryIndex:1});
      delta('item/reasoning/summaryTextDelta',{summaryIndex:1,delta:'**Verifying response**\nSecond summary detail.'});
      delta('item/reasoning/textDelta',{contentIndex:0,delta:'Content stream detail.'});
      detail.summary.push({type:'summary_text',text:'**Verifying response**\nSecond summary detail.'});
      detail.content=[{type:'reasoning_text',text:'Content stream detail.'}];
      await hold('STREAM_UPDATED');
      if(turn.status!=='inProgress')return;
      detail.summary=[{type:'summary_text',text:'**Reading files**\nCanonical completion detail.'},{type:'summary_text',text:'**Verifying response**\nCanonical verification detail.'}];
      detail.content=[{type:'reasoning_text',text:'Canonical content detail.'}];
      emit('item/completed',{...params,item:structuredClone(detail)});reasoning!.detailCompletedCount++;
      const answer={id:`assistant-${turn.id}`,type:'agentMessage',text:'Reasoning native fixture complete.'};
      turn.items.push(answer);emit('item/started',{...params,item:{...answer}});emit('item/completed',{...params,item:{...answer}});
      turn.status='completed';emit('turn/completed',{threadId:thread.id,turn:structuredClone(turn)});
      Object.assign(reasoning!,{stage:'COMPLETE',revision:reasoning!.revision+1,pending:false,turnCompletedCount:1});return;
    }
    const assistant={id:`assistant-${turn.id}`,type:'agentMessage',text:'Preparing the local acceptance change. '};
    turn.items.push(assistant);emit('item/started',{...params,item:{...assistant}});
    if(input.some(i=>String(i.text).includes('[presentation]'))){
      const generated=path.join(root,'.codex','generated_images','djl-preview.png');
      const screenshot=options.presentationScreenshotPath??path.join(root,'screenshot.png');
      const asset=new URL('../../assets/djl-logo.png',import.meta.url);
      fs.mkdirSync(path.dirname(generated),{recursive:true});
      fs.copyFileSync(asset,generated);
      if(!options.presentationScreenshotPath)fs.copyFileSync(asset,screenshot);
      if(!fs.statSync(screenshot).isFile())throw new Error('Owned presentation screenshot is required.');
      fs.writeFileSync(path.join(root,'hello.txt'),'native-preview-change\n');
      fs.writeFileSync(path.join(root,'notes.txt'),'image-preview-fixture\n');
      const patch='@@ -1 +1 @@\n-native-baseline\n+native-preview-change';
      for(const [suffix,file,kind,diff]of[
        ['one','hello.txt','update',patch],
        ['repeat',path.join(root,'hello.txt'),'update',patch],
        ['two','notes.txt','add','@@ -0,0 +1 @@\n+image-preview-fixture'],
      ]){
        const item={id:`presentation-${suffix}-${turn.id}`,type:'fileChange',status:'completed',changes:[{path:file,kind:{type:kind},diff}]};
        turn.items.push(item);emit('item/completed',{...params,item});
      }
      Object.assign(assistant,{phase:'final_answer',text:`Before screenshot.\n\n![Screenshot](${screenshot})\n\nAfter screenshot.\n\n![Generated DJL image](${generated})\n\nLast prose.`});
      emit('item/completed',{...params,item:{...assistant}});
      presentation={...params,stage:'FILES_READY',revision:1,pending:true,screenshotPath:screenshot,generatedPath:generated};
      await new Promise<void>(resolve=>{releasePresentation=resolve;});
      if(turn.status!=='inProgress')return;
      turn.status='completed';emit('turn/completed',{threadId:thread.id,turn:structuredClone(turn)});
      Object.assign(presentation!,{stage:'COMPLETE',revision:2,pending:false});return;
    }
    if(input.some(i=>String(i.text).includes('[undo]'))){
      if(thread.cwd!==root)throw new Error('Undo fixture requires its disposable root.');
      const target=path.join(root,'hello.txt');
      const before=fs.readFileSync(target,'utf8');
      const after=before+'response-owned native change\n';
      const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'djl-native-patch-'));
      let patch:string;
      try{
        const old=path.join(temporary,'before'),current=path.join(temporary,'after');
        fs.writeFileSync(old,before);fs.writeFileSync(current,after);
        const diff=Bun.spawnSync(['git','diff','--no-index','--no-ext-diff','--no-color','--',old,current]);
        if(diff.exitCode!==1)throw new Error('Could not capture the exact native fixture patch.');
        let hunk=false;
        patch=diff.stdout.toString().split('\n').map(line=>{
          if(line.startsWith('@@'))hunk=true;
          if(!hunk&&line.startsWith('diff --git '))return 'diff --git a/hello.txt b/hello.txt';
          if(!hunk&&line.startsWith('--- '))return '--- a/hello.txt';
          if(!hunk&&line.startsWith('+++ '))return '+++ b/hello.txt';
          return line;
        }).join('\n');
      }finally{fs.rmSync(temporary,{recursive:true,force:true});}
      fs.writeFileSync(target,after);
      const change={id:`change-${turn.id}`,type:'fileChange',status:'completed',changes:[{path:'hello.txt',kind:{type:'update'},diff:patch}]};
      turn.items.push(change);emit('item/completed',{...params,item:change});
      emit('turn/diff/updated',{...params,diff:patch});
      assistant.text='Response-owned native change applied.';emit('item/completed',{...params,item:{...assistant}});
      turn.status='completed';emit('turn/completed',{threadId:thread.id,turn});return;
    }
    if(input.some(i=>String(i.text).includes('[advanced]'))){
      const review={...params,reviewId:`review-${turn.id}`,action:{type:'command',source:'unifiedExec',command:'echo QA_RETRY',cwd:root},review:{status:'denied',riskLevel:'low',userAuthorization:'notGranted',rationale:'Disposable native review fixture.'},djlGuardianRetrySupported:true};
      emit('item/autoApprovalReview/started',{...review,review:{status:'inProgress'}});
      emit('item/autoApprovalReview/completed',review);
      guardianGrants.set(review.reviewId,thread.id);
      turn.items.push({id:`auto-approval-review:${review.reviewId}`,type:'automaticApprovalReview',...review});
      emit('item/autoApprovalReview/started',{...review,review:{status:'inProgress'}});
      const command={id:`command-${turn.id}`,type:'commandExecution',command:'cat hello.txt',cwd:root,status:'inProgress'};
      emit('item/started',{...params,item:command});
      emit('item/commandExecution/outputDelta',{...params,itemId:command.id,delta:'QA command output\n'});
      const completed={...command,status:'completed',aggregatedOutput:'QA command output\n',exitCode:0,durationMs:12};
      turn.items.push(completed);emit('item/completed',{...params,item:completed});
      const tool={id:`tool-${turn.id}`,type:'mcpToolCall',server:'qa',tool:'inspect_fixture',status:'completed',result:{content:[{type:'text',text:'Structured QA tool output'}]}};
      turn.items.push(tool);emit('item/completed',{...params,item:tool});
      const child=makeThread(root);Object.assign(child,{name:'Native child QA',agentNickname:'Fixture Scout',agentRole:'explorer',model:'qa-child-model',runtimeMode:'approval-required'});
      child.turns.push({id:`child-turn-${++next}`,status:'completed',items:[{id:`child-answer-${next}`,type:'agentMessage',text:'Read-only child history loaded.'}]});
      const collab={id:`spawn-${turn.id}`,type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',prompt:'Inspect the disposable native fixture.',receiverThreadIds:[child.id],agentsStates:{[child.id]:{status:'completed',message:'Child fixture ready.'}}};
      turn.items.push(collab);emit('item/completed',{...params,item:collab});
      assistant.text='Advanced native fixture prepared.';emit('item/completed',{...params,item:{...assistant}});
      turn.status='completed';emit('turn/completed',{threadId:thread.id,turn});return;
    }
    if(input.some(i=>String(i.text).includes('[steer]'))){
      Object.assign(steering!,{stage:'READY',revision:2,pending:true});return;
    }
    if(input.some(i=>String(i.text).includes('[hold]')))return;
    if(input.some(i=>String(i.text).includes('[echo]'))){assistant.text='Saved native conversation history. '+input.map(i=>i.text??'').join(' ');emit('item/completed',{...params,item:{...assistant}});turn.status='completed';emit('turn/completed',{threadId:thread.id,turn});return;}
    const approval=await ask('item/commandExecution/requestApproval',{...params,command:'Update the disposable QA workspace file',reason:'Apply the native acceptance fixture change?'},turn.id);
    if(turn.status!=='inProgress')return;
    if(approval.decision!=='accept'&&approval.decision!=='acceptForSession'){
      assistant.text+='Change declined.';
    }else{
      const answer=await ask('item/tool/requestUserInput',{...params,questions:[{id:'choice',header:'Local acceptance',question:'Continue the fixture workflow?',selectionLimit:1,options:[{label:'Continue',description:'Apply the disposable change.'},{label:'Stop',description:'Skip it.'}]},{id:'secret',header:'Secret field',question:'Enter a disposable test value.',isSecret:true,options:[]}]},turn.id);
      if(turn.status!=='inProgress')return;
      if(answer.answers?.choice?.answers?.includes('Continue')){
        fs.appendFileSync(path.join(thread.cwd,'hello.txt'),'native-fixture-change\n');
        const change={id:`change-${turn.id}`,type:'fileChange',changes:[{path:'hello.txt',kind:{type:'update'},diff:'+native-fixture-change'}]};
        turn.items.push(change);emit('item/completed',{...params,item:change});
      }
      assistant.text+='Approved workflow complete. [Open hello.txt](hello.txt).';
    }
    emit('item/agentMessage/delta',{...params,itemId:assistant.id,delta:assistant.text.replace('Preparing the local acceptance change. ','')});
    emit('item/completed',{...params,item:{...assistant}});
    turn.status='completed';emit('turn/completed',{threadId:thread.id,turn:{...turn}});
  }
  return {
    advancePresentation(expected:Json){
      if(!presentation?.pending||!releasePresentation||threads.get(presentation.threadId)?.turns.find((turn:Json)=>turn.id===presentation!.turnId)?.status!=='inProgress'||!['threadId','turnId','stage','revision'].every(key=>Object.hasOwn(expected,key)&&expected[key]===presentation![key]))throw new Error('No matching active presentation barrier.');
      const release=releasePresentation;releasePresentation=null;presentation.pending=false;release();
    },
    advanceReasoning(expected:Json){
      if(!reasoning?.pending||!releaseReasoning||threads.get(reasoning.threadId)?.turns.find((turn:Json)=>turn.id===reasoning!.turnId)?.status!=='inProgress'||!['threadId','turnId','itemId','stage','revision'].every(key=>Object.hasOwn(expected,key)&&expected[key]===reasoning![key]))throw new Error('No matching active reasoning barrier.');
      const release=releaseReasoning;releaseReasoning=null;reasoning.pending=false;release();
    },
    armThreadStartReply(){if(holdNextThreadStartReply||heldThreadStartReply)throw new Error('Thread start reply already armed or pending.');holdNextThreadStartReply=true;},
    releaseThreadStartReply(){if(!heldThreadStartReply)throw new Error('No held thread start reply.');const message=heldThreadStartReply;heldThreadStartReply=null;send(message);},
    state:()=>({...(collaborationModes.length?{collaborationModes:collaborationModes.map(r=>({...r}))}:{}),...(planImplementation?{planImplementation}:{}),usageReadCount,usageNullCount,presentation:presentation?structuredClone(presentation):null,reasoning:reasoning?structuredClone(reasoning):null,steering:steering?structuredClone(steering):null,threadStartAttemptCount,lastThreadStartShape,threadStartReplyPending:heldThreadStartReply!==null,heldThreadStartReplyCount,threadCount:threads.size,turnCount:[...threads.values()].reduce((n,t)=>n+t.turns.length,0),pendingCount:pending.size,goalCount:goals.size,renameCount,archiveCount,forkCount,turnStartCount,acceptedInterruptCount,threadReadCount,threadResumeCount,guardianRetryCount,guardianRetryAttemptCount,requestSequence,requests:requests.map(r=>({...r})),lastTurn,lastInput}),
    saveRestoreFixture(platform:string,value:Json){if(!['ios','android'].includes(platform)||!threads.has(value.threadId))throw new Error('Invalid native restore fixture');restoreFixtures.set(platform,value);},
    restoreFixture(platform:string){return restoreFixtures.get(platform)??null;},
    renameFromBridge(value:Json){const thread=threads.get(value.threadId??value.thread_id);if(!thread)return;thread.name=value.name;thread.title=value.title;renameCount++;emit('thread/name/updated',{threadId:thread.id,name:thread.name});},
    handle(rpc:Json):boolean{
      if(rpc.method==null&&rpc.id!=null){const waiting=pending.get(String(rpc.id));if(waiting){pending.delete(String(rpc.id));waiting.resolve(rpc.result??{});emit('serverRequest/resolved',{requestId:rpc.id});return true;}return false;}
      if(rpc.id==null)return false;
      let p=rpc.params??{};
      if(typeof rpc.method==='string'){
        const traceThreadId=p.threadId??p.thread_id;
        requests.push({sequence:++requestSequence,method:rpc.method,threadId:typeof traceThreadId==='string'?traceThreadId:null,...(rpc.method==='thread/read'&&typeof p.includeTurns==='boolean'?{includeTurns:p.includeTurns}:{}),...(rpc.method==='account/rateLimits/read'?{paramsShape:rpc.params===null?'null':Array.isArray(rpc.params)?'array':typeof rpc.params}:{})});
        if(requests.length>256)requests.shift();
        const mode=p.collaborationMode;
        if(['turn/start','turn/steer'].includes(rpc.method)&&typeof mode?.mode==='string'){
          collaborationModes.push({method:rpc.method,threadId:traceThreadId,mode:mode.mode,model:mode.settings?.model??null,effort:mode.settings?.reasoning_effort??null,nullInstructions:Object.hasOwn(mode.settings??{},'developer_instructions')&&mode.settings.developer_instructions===null,inputCount:Array.isArray(p.input)?p.input.length:0});
          if(collaborationModes.length>256)collaborationModes.shift();
        }
      }
      if(options.rejectCollaborationMode&&['turn/start','turn/steer'].includes(rpc.method)&&Object.hasOwn(p,'collaborationMode')){
        send({id:rpc.id,error:{code:-32602,message:'Unknown field collaborationMode: experimentalApi is unavailable'}});return true;
      }
      if(options.legacyTurnRecovery&&rpc.method==='thread/read'&&steering?.stage==='READY'){
        if(typeof p.thread_id!=='string'||p.include_turns!==true){send({id:rpc.id,error:{code:-32602,message:'missing field thread_id/include_turns'}});return true;}
        p={...p,threadId:p.thread_id,includeTurns:p.include_turns};
      }
      if(options.legacyTurnRecovery&&rpc.method==='turn/interrupt'){
        if(typeof p.thread_id!=='string'||typeof p.turn_id!=='string'){send({id:rpc.id,error:{code:-32602,message:'missing field turn_id/thread_id'}});return true;}
        p={...p,threadId:p.thread_id,turnId:p.turn_id};
        const target=threads.get(p.threadId)?.turns.find((turn:Json)=>turn.id===p.turnId);
        if(!target||target.status!=='inProgress'){send({id:rpc.id,error:{code:-32000,message:'turn not found'}});return true;}
      }
      switch(rpc.method){
        case 'account/rateLimits/read':{
          usageReadCount++;
          if(rpc.params==null){usageNullCount++;send({id:rpc.id,error:{code:-32602,message:'invalid type: null, expected map'}});return true;}
          if(typeof rpc.params!=='object'||Array.isArray(rpc.params)||Object.keys(rpc.params).length!==0){send({id:rpc.id,error:{code:-32602,message:'invalid params: expected empty map'}});return true;}
          const now=Math.floor(Date.now()/1000);
          reply(rpc,{rateLimitsByLimitId:{codex:{limitId:'codex',limitName:'Codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:now+3600},secondary:{usedPercent:60,windowDurationMins:10080,resetsAt:now+6*86400}}}});return true;
        }
        case 'initialize':reply(rpc,{capabilities:{djlThreadRuntimeModeSync:true,...(options.groups?{djlGroups:true}:{})},...(options.legacyTurnRecovery?{userAgent:'codex_cli_rs/0.124.0'}:{})});return true;
        case 'model/list':reply(rpc,{data:[{id:'codex::qa-model',model:'qa-model',djlProvider:'codex',displayName:'Local test runtime',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',supportsFastMode:false},{id:'codex::qa-child-model',model:'qa-child-model',djlProvider:'codex',displayName:'Local child test runtime',supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',supportsFastMode:false}]});return true;
        case 'skills/list':reply(rpc,{data:[{cwd:root,skills:[{name:'qa-review',path:path.join(root,'QA-SKILL.md'),description:'Disposable native context fixture',enabled:true}]}]});return true;
        case 'plugin/list':reply(rpc,{marketplaces:[{name:'qa-local',plugins:[{name:'qa-tools',installed:true,enabled:true,interface:{displayName:'QA tools',shortDescription:'Disposable native plugin fixture'}}]}]});return true;
        case 'fuzzyFileSearch':{if(!Array.isArray(p.roots)||p.roots.some((r:string)=>r!==root))throw new Error('Outside QA search root');const query=String(p.query??'').toLowerCase();reply(rpc,{files:['hello.txt','preview.svg'].filter(name=>name.includes(query)).map(name=>({root,path:name,file_name:name,score:100}))});return true;}
        case 'thread/list':reply(rpc,{data:[...threads.values()].filter(t=>Boolean(t.archived)===Boolean(p.archived)),nextCursor:null});return true;
        case 'thread/start':{threadStartAttemptCount++;lastThreadStartShape={cwdPresent:Object.hasOwn(p,'cwd'),cwdIsRoot:p.cwd===root,djlScope:['studio','project'].includes(p.djlScope)?p.djlScope:'other'};const cwd=p.cwd??root;checkWorkingDirectory(cwd);const result={thread:makeThread(cwd),...applied(p)};if(holdNextThreadStartReply){holdNextThreadStartReply=false;heldThreadStartReply={id:rpc.id,result};heldThreadStartReplyCount++;}else{reply(rpc,result);}return true;}
        case 'thread/fork':{const source=threads.get(p.threadId);if(!source)throw new Error('Unknown QA thread');const thread=makeThread(source.cwd);thread.name=`Fork of ${source.name}`;thread.forkedFromThreadId=source.id;thread.model=source.model;thread.modelProvider=source.modelProvider;thread.turns=JSON.parse(JSON.stringify(source.turns));forkCount++;reply(rpc,{thread:{id:thread.id,name:thread.name},...applied(p)});emit('thread/started',{thread:{...thread,turns:[]}});return true;}
        case 'thread/archive':case 'thread/unarchive':{const thread=threads.get(p.threadId);if(!thread)throw new Error('Unknown QA thread');thread.archived=rpc.method==='thread/archive';archiveCount++;reply(rpc,{});emit(thread.archived?'thread/archived':'thread/unarchived',{threadId:thread.id});return true;}
        case 'thread/resume':case 'thread/read':{const thread=threads.get(p.threadId);if(!thread)throw new Error('Unknown QA thread');if(rpc.method==='thread/read'){threadReadCount++;}else{threadResumeCount++;if(p.cwd){const cwd=path.resolve(p.cwd);checkWorkingDirectory(cwd);thread.cwd=cwd;}if(p.model)thread.model=p.model;if(p.djlProvider)thread.modelProvider=p.djlProvider;}reply(rpc,{thread,...applied(p)});return true;}
        case 'thread/approveGuardianDeniedAction':{guardianRetryAttemptCount++;const id=p.event?.id;if(guardianGrants.get(id)!==p.threadId||p.event?.status!=='denied'||p.event?.action?.type!=='command'||p.event?.action?.command!=='echo QA_RETRY'||p.event?.action?.source!=='unified_exec'||p.event?.action?.cwd!==root)throw new Error('Invalid or consumed QA guardian review');guardianGrants.delete(id);guardianRetryCount++;reply(rpc,{});return true;}
        case 'thread/goal/get':reply(rpc,{goal:goals.get(p.threadId)??null});return true;
        case 'thread/goal/set':{if(!threads.has(p.threadId))throw new Error('Unknown QA thread');const previous=goals.get(p.threadId);if(p.tokenBudget!=null&&(!Number.isSafeInteger(p.tokenBudget)||p.tokenBudget<=0))throw new Error('Token budget must be a positive whole number.');const objective=p.objective??previous?.objective;if(typeof objective!=='string'||!objective.trim())throw new Error('A goal objective is required.');const now=Math.max(Date.now(),(previous?.updatedAt??0)+1),reset=p.status==='active'&&previous?.objective!==objective;const goal={threadId:p.threadId,objective,status:p.status??previous?.status??'active',tokenBudget:Object.hasOwn(p,'tokenBudget')?p.tokenBudget:previous?.tokenBudget??null,tokensUsed:reset?0:previous?.tokensUsed??0,timeUsedSeconds:reset?0:previous?.timeUsedSeconds??0,createdAt:reset?now:previous?.createdAt??now,updatedAt:now};goals.set(p.threadId,goal);reply(rpc,{goal});emit('thread/goal/updated',{goal});return true;}
        case 'thread/goal/clear':{const cleared=goals.delete(p.threadId);reply(rpc,{cleared});if(cleared)emit('thread/goal/cleared',{threadId:p.threadId});return true;}
        case 'djl/thread/runtimeMode/set':reply(rpc,{runtimeMode:p.runtimeMode});return true;
        case 'turn/start':{if((p.input??[]).some((i:Json)=>i.text==='Implement plan.'))planImplementation={threadId:p.threadId,mode:p.collaborationMode?.mode??null,model:p.collaborationMode?.settings?.model??null,inputCount:p.input.length,exactPrompt:p.input.length===1&&p.input[0]?.type==='text'&&p.input[0]?.text==='Implement plan.'};if(steering?.pending&&(p.input??[]).some((i:Json)=>String(i.text).includes('[steer]')))throw new Error('Steering fixture already active');if(presentation?.pending&&(p.input??[]).some((i:Json)=>String(i.text).includes('[presentation]')))throw new Error('Presentation fixture already active');lastInput=inputSummary(p.input??[]);lastTurn={threadId:p.threadId,model:p.model,djlProvider:p.djlProvider,approvalsReviewer:p.approvalsReviewer,approvalPolicy:p.approvalPolicy,sandboxPolicy:p.sandboxPolicy};turnStartCount++;const thread=threads.get(p.threadId);if(!thread)throw new Error('Unknown QA thread');const turn={id:`native-turn-${++next}`,status:'inProgress',items:[{id:`user-${next}`,type:'userMessage',content:p.input}]};thread.turns.push(turn);if((p.input??[]).some((i:Json)=>String(i.text).includes('[steer]')))steering={threadId:thread.id,turnId:turn.id,stage:'STARTING',revision:1,pending:true,acceptedCount:0};reply(rpc,{turn:{id:turn.id},...applied(p)});void run(thread,turn,p.input);return true;}
        case 'turn/steer':{
          const thread=threads.get(p.threadId),turn=thread?.turns.find((t:Json)=>t.id===p.expectedTurnId);
          if(thread&&steering?.pending&&steering.stage==='READY'&&steering.threadId===thread.id&&p.expectedTurnId!==steering.turnId)throw new Error(`expected active turn id ${steering.turnId} but found ${String(p.expectedTurnId)}`);
          if(!thread||!turn||turn.status!=='inProgress'||!steering?.pending||steering.stage!=='READY'||steering.threadId!==thread.id||steering.turnId!==turn.id)throw new Error('No matching active QA steering turn.');
          if(!Array.isArray(p.input)||p.input.length===0)throw new Error('Steer input is required.');
          const user={id:`user-steer-${++next}`,type:'userMessage',content:structuredClone(p.input)};
          const previous=turn.items.find((item:Json)=>item.id===`assistant-${turn.id}`);
          if(previous)emit('item/completed',{threadId:thread.id,turnId:turn.id,item:structuredClone(previous)});
          turn.items.push(user);lastInput=inputSummary(p.input);
          Object.assign(steering,{stage:'COMPLETE',revision:steering.revision+1,pending:false,acceptedCount:steering.acceptedCount+1});
          reply(rpc,{turnId:turn.id});
          const params={threadId:thread.id,turnId:turn.id};
          emit('item/started',{...params,item:structuredClone(user)});emit('item/completed',{...params,item:structuredClone(user)});
          const answer={id:`assistant-steer-${next}`,type:'agentMessage',text:'Steering native fixture complete. '+p.input.filter((i:Json)=>i.type==='text').map((i:Json)=>i.text??'').join(' ')};
          turn.items.push(answer);emit('item/started',{...params,item:structuredClone(answer)});emit('item/completed',{...params,item:structuredClone(answer)});
          turn.status='completed';emit('turn/completed',{threadId:thread.id,turn:structuredClone(turn)});return true;
        }
        case 'turn/interrupt':{const thread=threads.get(p.threadId),turn=thread?.turns.find((t:Json)=>t.id===p.turnId);if(!turn)throw new Error('Unknown QA turn');acceptedInterruptCount++;turn.status='interrupted';if(steering?.turnId===turn.id&&steering.pending)Object.assign(steering,{stage:'INTERRUPTED',revision:steering.revision+1,pending:false});if(presentation?.turnId===turn.id&&presentation.pending){Object.assign(presentation,{stage:'INTERRUPTED',revision:presentation.revision+1,pending:false});const release=releasePresentation;releasePresentation=null;release?.();}for(const [id,request]of pending){if(request.turnId===turn.id){pending.delete(id);request.resolve({});emit('serverRequest/resolved',{requestId:id});}}reply(rpc,{});emit('turn/completed',{threadId:thread.id,turn});return true;}
        default:return false;
      }
    }
  };
}
