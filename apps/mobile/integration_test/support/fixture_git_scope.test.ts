import {test,expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fixtureGitScope} from './fixture_git_scope';

test('ordinary fixture stays workspace-only; container mode is explicitly bounded',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'djl-git-scope-'));
 try{
  const workspace=path.join(root,'workspace'),managed=path.join(root,'managed');
  fs.mkdirSync(workspace);fs.mkdirSync(managed);
  const worktree=path.join(managed,'token','repo');fs.mkdirSync(worktree,{recursive:true});
  const sibling=managed+'-other';fs.mkdirSync(sibling);
  const ordinary=fixtureGitScope(workspace);
  expect(()=>ordinary(workspace)).not.toThrow();
  expect(()=>ordinary(path.join(workspace,'new-folder'))).not.toThrow();
  expect(()=>ordinary(worktree)).toThrow('Outside disposable workspace');
  const isolated=fixtureGitScope(workspace,{requested:true,inContainer:true,codexHomeOverridden:false,managedRoot:managed});
  expect(()=>isolated(worktree)).not.toThrow();
  expect(()=>isolated(managed)).toThrow('Outside disposable workspace');
  expect(()=>isolated(sibling)).toThrow('Outside disposable workspace');
  fs.symlinkSync(sibling,path.join(managed,'escape'));
  expect(()=>isolated(path.join(managed,'escape'))).toThrow('Outside disposable workspace');
  expect(()=>isolated('/Users/real/.codex/worktrees/repo')).toThrow('Outside disposable workspace');
  expect(()=>isolated(undefined)).toThrow('Workspace path required');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('managed scope refuses host execution or a Codex home override',()=>{
 expect(()=>fixtureGitScope('/workspace',{requested:true,inContainer:false,codexHomeOverridden:false,managedRoot:'/root/.codex/worktrees'})).toThrow('Container-only');
 expect(()=>fixtureGitScope('/workspace',{requested:true,inContainer:true,codexHomeOverridden:true,managedRoot:'/root/.codex/worktrees'})).toThrow('Container-only');
});
