// Scripted Multi agents groups for the native acceptance bridge. No model runs:
// each member "writes" a canned reply word by word, as the desktop streams one.
type Json=Record<string,any>;
const AGENTS:[string,string,boolean][]=[['claudeAgent','Claude',true],['codex','Codex',true],['gemini','Gemini',true],['grok','Grok',true],['qwen','Qwen Code',false]];

export function createGroupsFixture(send:(rpc:unknown)=>void,options:{wordDelayMs?:number}={}){
  const wordDelayMs=options.wordDelayMs??Number(process.env.DJL_QA_GROUP_WORD_MS??70);
  const groups:Json[]=[];
  const replies:Json[]=[];
  const history=new Map<string,Json[]>();
  const states=new Map<string,string>();
  const drafts=new Map<string,string>();
  const writing=new Map<string,ReturnType<typeof setInterval>>();
  const sent:Json[]=[];
  let serial=0;
  const emit=(method:string,params:Json)=>send({method,params});
  const event=(value:Json)=>emit('djl/groups/event',value);

  function addGroup(name:string,providers:string[]){
    const id=`qa-group-${++serial}`;
    const group={id,threadId:`qa-group-thread-${serial}`,projectId:`qa-group-project-${serial}`,name,folder:`/qa/groups/${id}`,folderIsAuto:true,hopLimit:6,skipAllWarning:false,pendingHandoffs:[] as Json[],
      members:providers.map((provider,position)=>({id:`${id}-m${position}`,groupId:id,provider,handle:(AGENTS.find(a=>a[0]===provider)?.[1]??provider).replaceAll(' ',''),role:null,model:null,position})),
      createdAt:Date.now(),updatedAt:Date.now()};
    groups.unshift(group);history.set(group.threadId,[]);
    return group;
  }
  addGroup('Launch plan',['claudeAgent','codex','gemini']);

  function setState(group:Json,memberId:string,state:string){
    if(state==='idle')states.delete(memberId);else states.set(memberId,state);
    event({type:'member.state',groupId:group.id,memberId,state});
  }
  function halt(group:Json,memberId:string){
    const timer=writing.get(memberId);if(!timer)return;
    clearInterval(timer);writing.delete(memberId);drafts.delete(memberId);setState(group,memberId,'idle');
  }
  // "reply only: X" makes every member answer exactly X, as in the product demo.
  function scripted(member:Json,text:string){
    const only=/reply only:?\s*(.+)$/i.exec(text);
    if(only)return only[1]!.trim();
    return `${member.handle} here. I read your message and this is my answer, written one word at a time so the phone can show it arriving.`;
  }
  function write(group:Json,member:Json,text:string){
    const words=text.split(' ');let index=0;
    setState(group,member.id,'working');
    writing.set(member.id,setInterval(()=>{
      if(index<words.length){
        const delta=`${index===0?'':' '}${words[index]}`;
        drafts.set(member.id,(index===0?'':drafts.get(member.id)??'')+delta);
        emit('djl/groups/draft',{groupId:group.id,memberId:member.id,delta,restart:index===0});
        index++;return;
      }
      clearInterval(writing.get(member.id)!);writing.delete(member.id);drafts.delete(member.id);
      const replyId=`r${++serial}`;
      const item={id:`assistant:qa-turn-${serial}:gm.${member.id}.${replyId}`,type:'agentMessage',role:'assistant',content:[{type:'outputText',text}]};
      const record={groupId:group.id,replyId,memberId:member.id,status:'ok',error:null,files:[],commands:[]};
      history.get(group.threadId)!.push(item);replies.push(record);
      setState(group,member.id,'idle');
      event({type:'reply.recorded',reply:record});
      emit('item/completed',{threadId:group.threadId,turnId:`qa-turn-${serial}`,item});
    },wordDelayMs));
  }
  function answer(group:Json,text:string){
    const lower=text.toLowerCase();
    const named=group.members.filter((member:Json)=>lower.includes(`@${member.handle.toLowerCase()}`));
    const targets=named.length>0&&!/@(all|所有人)/i.test(text)?named:group.members;
    targets.forEach((member:Json,index:number)=>setTimeout(()=>write(group,member,scripted(member,text)),200+index*250));
  }
  const find=(groupId:unknown)=>{const group=groups.find(entry=>entry.id===groupId);if(!group)throw new Error('Group not found');return group;};

  return {
    state:()=>({groups,replies,sent}),
    handle(rpc:Json):boolean{
      if(rpc.id==null||typeof rpc.method!=='string')return false;
      const p=rpc.params??{};
      const ok=(result:unknown)=>{send({id:rpc.id,result});return true;};
      try{
        switch(rpc.method){
          case 'djl/groups/list':return ok({groups,replies,live:{memberStates:Object.fromEntries(states),drafts:Object.fromEntries(drafts)}});
          case 'djl/groups/agents':return ok({agents:AGENTS.map(([provider,displayName,ready])=>({provider,displayName,ready}))});
          case 'djl/groups/create':{const group=addGroup(String(p.name),p.members.map((member:Json)=>member.provider));event({type:'group.upserted',group});return ok(group);}
          case 'djl/groups/send':{
            const group=find(p.groupId);const text=String(p.text??'').trim();
            if(!text)throw new Error('A message is required.');
            const item={id:`djl-message-${++serial}`,type:'userMessage',role:'user',content:[{type:'inputText',text}]};
            history.get(group.threadId)!.push(item);sent.push({groupId:group.id,text});
            emit('codex/event/user_message',{threadId:group.threadId,turnId:null,itemId:item.id,message:text});
            answer(group,text);
            return ok({});
          }
          case 'djl/groups/stop':{const group=find(p.groupId);for(const member of group.members)halt(group,member.id);return ok({});}
          case 'djl/groups/stopMember':halt(find(p.groupId),String(p.memberId));return ok({});
          case 'djl/groups/resolvePause':{const group=find(p.groupId);group.pendingHandoffs=[];event({type:'group.upserted',group});return ok({});}
          case 'djl/groups/setSkipAllWarning':{const group=find(p.groupId);group.skipAllWarning=p.skipAllWarning===true;event({type:'group.upserted',group});return ok(group);}
          case 'thread/read':{
            const items=history.get(p.threadId);if(!items)return false;
            return ok({thread:{id:p.threadId,turns:[{id:'qa-group-history',status:'completed',items}]}});
          }
        }
      }catch(error){send({id:rpc.id,error:{code:-32000,message:error instanceof Error?error.message:'QA groups failed.'}});return true;}
      return false;
    },
  };
}
