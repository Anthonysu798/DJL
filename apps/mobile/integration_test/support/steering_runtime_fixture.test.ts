import {expect,test} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRuntimeFixture} from './desktop_runtime_fixture';

function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'djl-steering-fixture-'));
 fs.writeFileSync(path.join(root,'hello.txt'),'unchanged steering fixture\n');
 const messages:any[]=[];
 const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)));
 fixture.handle({id:'start',method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[steer] START65'}]}});
 const turnId=messages.find(m=>m.id==='start').result.turn.id;
 return {root,messages,fixture,turnId,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('held steering completes the same turn with canonical acknowledgement and history',async()=>{
 const q=setup();
 try{
  expect((q.fixture.state() as any).steering).toMatchObject({stage:'STARTING',pending:true});
  expect(()=>q.fixture.handle({id:'early-overlap',method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[steer] overlap'}]}})).toThrow('Steering fixture already active');
  await Bun.sleep(180);
  expect((q.fixture.state() as any).steering).toMatchObject({threadId:'native-thread-1',turnId:q.turnId,stage:'READY',pending:true,acceptedCount:0});
  expect(q.fixture.state()).toMatchObject({turnStartCount:1,turnCount:1,pendingCount:0});
  expect(q.fixture.handle({id:'steer',method:'turn/steer',params:{threadId:'native-thread-1',expectedTurnId:q.turnId,input:[{type:'text',text:'STEER65'}]}})).toBe(true);
  expect(q.messages.find(m=>m.id==='steer').result).toEqual({turnId:q.turnId});
  expect(q.messages.filter(m=>m.method==='turn/completed')).toHaveLength(1);
  expect((q.fixture.state() as any).steering).toMatchObject({stage:'COMPLETE',pending:false,acceptedCount:1});
  q.fixture.handle({id:'history',method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
  const turns=q.messages.find(m=>m.id==='history').result.thread.turns;
  expect(turns).toHaveLength(1);
  expect(turns[0].status).toBe('completed');
  expect(turns[0].items.filter((i:any)=>i.type==='userMessage').map((i:any)=>i.content)).toEqual([[{type:'text',text:'[steer] START65'}],[{type:'text',text:'STEER65'}]]);
  expect(turns[0].items.at(-1)).toMatchObject({type:'agentMessage',text:'Steering native fixture complete. STEER65'});
  expect(q.fixture.state()).toMatchObject({turnStartCount:1,turnCount:1,threadCount:1,pendingCount:0});
  expect(fs.readFileSync(path.join(q.root,'hello.txt'),'utf8')).toBe('unchanged steering fixture\n');
 }finally{q.close();}
});

test('steering validates exact live owner and rejects stale or empty inputs without mutation',async()=>{
 const q=setup();
 try{
  await Bun.sleep(180);
  const base={threadId:'native-thread-1',expectedTurnId:q.turnId,input:[{type:'text',text:'public follow-up'}]};
  for(const params of [{...base,threadId:'unknown'},{...base,expectedTurnId:'stale'},{threadId:'native-thread-1',input:base.input},{...base,input:[]}]){
   expect(()=>q.fixture.handle({id:'invalid',method:'turn/steer',params})).toThrow();
  }
  expect((q.fixture.state() as any).steering).toMatchObject({stage:'READY',pending:true,acceptedCount:0});
  expect(q.messages.filter(m=>m.method==='turn/completed')).toHaveLength(0);
  q.fixture.handle({id:'good',method:'turn/steer',params:base});
  expect(()=>q.fixture.handle({id:'repeat',method:'turn/steer',params:base})).toThrow();
  expect(q.messages.filter(m=>m.method==='turn/completed')).toHaveLength(1);
  expect((q.fixture.state() as any).steering.acceptedCount).toBe(1);
  expect(q.fixture.state()).toMatchObject({turnStartCount:1,turnCount:1});
 }finally{q.close();}
});

test('stale expected ID reports the explicit active-turn precondition before mutation',async()=>{
 const q=setup();
 try{
  await Bun.sleep(180);
  expect(()=>q.fixture.handle({id:'stale-id',method:'turn/steer',params:{threadId:'native-thread-1',expectedTurnId:'stale',input:[{type:'text',text:'retry only after rejection'}]}})).toThrow(`expected active turn id ${q.turnId} but found stale`);
  expect((q.fixture.state() as any).steering).toMatchObject({stage:'READY',pending:true,acceptedCount:0});
  expect(q.messages.filter(m=>m.method==='turn/completed')).toHaveLength(0);
  expect(q.fixture.state()).toMatchObject({turnStartCount:1,turnCount:1,pendingCount:0});
 }finally{q.close();}
});

test('interrupt retires steering readiness and a late steer cannot complete again',async()=>{
 const q=setup();
 try{
  await Bun.sleep(180);
  q.fixture.handle({id:'stop',method:'turn/interrupt',params:{threadId:'native-thread-1',turnId:q.turnId}});
  expect((q.fixture.state() as any).steering).toMatchObject({stage:'INTERRUPTED',pending:false,acceptedCount:0});
  expect(()=>q.fixture.handle({id:'late',method:'turn/steer',params:{threadId:'native-thread-1',expectedTurnId:q.turnId,input:[{type:'text',text:'late'}]}})).toThrow();
  expect(q.messages.filter(m=>m.method==='turn/completed')).toHaveLength(1);
  expect(q.fixture.state()).toMatchObject({pendingCount:0,turnStartCount:1,turnCount:1});
 }finally{q.close();}
});

test('steering oracle excludes inline image bytes and rejects an overlapping staged start',async()=>{
 const q=setup();
 try{
  await Bun.sleep(180);
  expect(()=>q.fixture.handle({id:'overlap',method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[steer] overlap'}]}})).toThrow('Steering fixture already active');
  q.fixture.handle({id:'mixed',method:'turn/steer',params:{threadId:'native-thread-1',expectedTurnId:q.turnId,input:[{type:'image',url:'data:image/png;base64,cHJpdmF0ZS1xdWEtYnl0ZXM='},{type:'text',text:'image-only marker'}]}});
  expect(q.fixture.state().lastInput).toEqual([{type:'image',inlineImage:true,imageCharacters:46},{type:'text',text:'image-only marker'}]);
  expect(JSON.stringify(q.fixture.state())).not.toContain('cHJpdmF0ZS1xdWEtYnl0ZXM=');
  expect(q.fixture.state()).toMatchObject({turnStartCount:1,turnCount:1,pendingCount:0});
 }finally{q.close();}
});
