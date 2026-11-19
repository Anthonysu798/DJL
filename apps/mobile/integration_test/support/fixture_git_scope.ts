import fs from 'node:fs';
import path from 'node:path';

type ManagedScope = {requested:boolean,inContainer:boolean,codexHomeOverridden:boolean,managedRoot:string};

// Native QA may reach managed worktrees only inside its disposable container.
export function fixtureGitScope(workspace:string, options?:ManagedScope){
 if(options?.requested&&(!options.inContainer||options.codexHomeOverridden))throw new Error('Container-only managed Git scope required.');
 const root=path.resolve(workspace),managed=options?.requested?path.resolve(options.managedRoot):null;
 return(value:unknown)=>{
  if(typeof value!=='string')throw new Error('Workspace path required.');
  const candidate=path.resolve(value);
  if(candidate===root||candidate.startsWith(root+path.sep))return;
  if(managed&&candidate.startsWith(managed+path.sep)){
   try{
    const actual=fs.realpathSync(candidate),base=fs.realpathSync(managed);
    if(actual.startsWith(base+path.sep))return;
   }catch{}
  }
  throw new Error('Outside disposable workspace.');
 };
}
