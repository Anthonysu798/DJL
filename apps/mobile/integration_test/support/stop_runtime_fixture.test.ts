import {expect,test} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRuntimeFixture} from './desktop_runtime_fixture';

test('legacy recovery fixture rejects each old shape and stale target before one accepted interrupt',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'djl-legacy-stop-'));
 fs.writeFileSync(path.join(root,'hello.txt'),'unchanged stop fixture\n');
 const messages:any[]=[];
 const fixture=createRuntimeFixture(root,m=>messages.push(structuredClone(m)),{legacyTurnRecovery:true});
 try{
  fixture.handle({id:'init',method:'initialize',params:{}});
  expect(messages.find(m=>m.id==='init').result.userAgent).toBe('codex_cli_rs/0.124.0');
  fixture.handle({id:'bootstrap',method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
  expect(messages.find(m=>m.id==='bootstrap').result.thread.id).toBe('native-thread-1');
  fixture.handle({id:'start',method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[steer] STOP69'}]}});
  const turnId=messages.find(m=>m.id==='start').result.turn.id;
  await Bun.sleep(180);
  expect(fixture.state().steering).toMatchObject({stage:'READY',pending:true});
  fixture.handle({id:'camel',method:'turn/interrupt',params:{threadId:'native-thread-1',turnId:'stale'}});
  expect(messages.find(m=>m.id==='camel').error).toMatchObject({code:-32602});
  fixture.handle({id:'stale',method:'turn/interrupt',params:{thread_id:'native-thread-1',turn_id:'stale'}});
  expect(messages.find(m=>m.id==='stale').error).toMatchObject({code:-32000,message:'turn not found'});
  fixture.handle({id:'read-camel',method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
  expect(messages.find(m=>m.id==='read-camel').error).toMatchObject({code:-32602});
  fixture.handle({id:'read-snake',method:'thread/read',params:{thread_id:'native-thread-1',include_turns:true}});
  expect(messages.find(m=>m.id==='read-snake').result.thread.turns[0].id).toBe(turnId);
  expect(fixture.state()).toMatchObject({turnStartCount:1,turnCount:1,acceptedInterruptCount:0});
  expect(messages.filter(m=>m.method==='turn/completed')).toHaveLength(0);
  fixture.handle({id:'valid-camel',method:'turn/interrupt',params:{threadId:'native-thread-1',turnId}});
  expect(messages.find(m=>m.id==='valid-camel').error).toMatchObject({code:-32602});
  fixture.handle({id:'accepted',method:'turn/interrupt',params:{thread_id:'native-thread-1',turn_id:turnId}});
  expect(messages.find(m=>m.id==='accepted').result).toEqual({});
  expect(fixture.state()).toMatchObject({turnStartCount:1,turnCount:1,acceptedInterruptCount:1,pendingCount:0});
  expect(messages.filter(m=>m.method==='turn/completed')).toHaveLength(1);
  fixture.handle({id:'history',method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
  expect(messages.find(m=>m.id==='history').result.thread.turns[0].status).toBe('interrupted');
  expect(fs.readFileSync(path.join(root,'hello.txt'),'utf8')).toBe('unchanged stop fixture\n');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
