// Test-only proof that the unmodified Git handler allocates in the container home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import git from '../../../remote-gateway/src/git-handler.js';
import {fixtureGitScope} from './fixture_git_scope';
import {createRuntimeFixture} from './desktop_runtime_fixture';

if(!fs.existsSync('/.dockerenv')||process.env.CODEX_HOME!==undefined)throw new Error('Disposable container with default Codex home required.');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'djl-native-git-preflight-'));
const cwd=path.join(root,'workspace');fs.mkdirSync(cwd);
const command=(...args:string[])=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
command('init','--initial-branch=main');
command('config','user.name','Mobile QA');command('config','user.email','mobile-qa@test.invalid');
fs.writeFileSync(path.join(cwd,'qa.txt'),'isolated managed worktree\n');
command('add','qa.txt');command('commit','-m','Isolated QA baseline');
const result=await new Promise<Record<string,any>>((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Managed Git preflight timed out.')),30000);
 git.handleGitRequest(JSON.stringify({id:'qa-container-preflight',method:'git/createManagedWorktree',params:{cwd,baseBranch:'main',changeTransfer:'none'}}),(raw:string)=>{
  const response=JSON.parse(raw);if(response.id!=='qa-container-preflight')return;
  clearTimeout(timer);if(response.error)reject(new Error(response.error.message));else resolve(response.result);
 });
});
const managed=path.join(os.homedir(),'.codex','worktrees');
const scope=fixtureGitScope(cwd,{requested:true,inContainer:true,codexHomeOverridden:false,managedRoot:managed});
scope(result.worktreePath);
if(result.headMode!=='detached'||!fs.readFileSync(path.join(result.worktreePath,'qa.txt'),'utf8').includes('isolated managed worktree'))throw new Error('Managed worktree content or HEAD mode mismatch.');
if(result.worktreePath.startsWith('/Users/'))throw new Error('Managed output reached the host-source mount.');
const replies:any[]=[];
const runtime=createRuntimeFixture(cwd,message=>replies.push(message),{workingDirectoryScope:scope});
runtime.handle({id:'start',method:'thread/start',params:{cwd:result.worktreePath}});
runtime.handle({id:'resume',method:'thread/resume',params:{threadId:'native-thread-1',cwd:result.worktreePath}});
if(replies.length!==2||replies.some(reply=>reply.result?.thread.cwd!==result.worktreePath))throw new Error('Container runtime refused the owned managed worktree.');
console.log(JSON.stringify({productionGitHandler:true,containerDefaultHome:os.homedir(),managedWorktree:result.worktreePath,detachedHead:true,contentVerified:true,runtimeScopeVerified:true,sourceMountWritten:false}));
