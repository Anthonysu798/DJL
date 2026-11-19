import {test,expect,beforeEach,afterEach} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareNativeFixtureRoot,fixtureIdentityEnvironment} from './fixture_resume';

let parent:string;
beforeEach(()=>{parent=fs.mkdtempSync(path.join(os.tmpdir(),'djl-resume141-'));});
afterEach(()=>fs.rmSync(parent,{recursive:true,force:true}));
const pointer=(root:string)=>fs.writeFileSync(path.join(parent,'settings-ios-resume.json'),JSON.stringify({version:1,platform:'ios',root}));
const git=(root:string,...args:string[])=>{
 const p=Bun.spawnSync(['git','-C',root,...args],{stdout:'pipe',stderr:'pipe'});
 expect(p.exitCode).toBe(0);return p.stdout.toString().trim();
};

test('default fixture still creates and cleans its own disposable checkout',async()=>{
 const scope=await prepareNativeFixtureRoot(parent,'settings','ios');
 expect(scope.resumed).toBe(false);expect(fs.readFileSync(path.join(scope.workspace,'hello.txt'),'utf8')).toBe('native-baseline\n');
 expect(git(scope.workspace,'status','--porcelain')).toBe('');await scope.cleanup();expect(fs.existsSync(scope.root)).toBe(false);
});
test('explicit resume preserves existing HEAD,dirty data and untracked files on exit',async()=>{
 const original=await prepareNativeFixtureRoot(parent,'settings','ios');
 const head=git(original.workspace,'rev-parse','HEAD');
 fs.writeFileSync(path.join(original.workspace,'hello.txt'),'retained dirty text\n');fs.writeFileSync(path.join(original.workspace,'unsent.txt'),'retained unsent work\n');
 const status=git(original.workspace,'status','--porcelain');pointer(original.root);
 const resumed=await prepareNativeFixtureRoot(parent,'settings','ios');
 expect(resumed.root).toBe(original.root);expect(resumed.resumed).toBe(true);
 expect(git(resumed.workspace,'rev-parse','HEAD')).toBe(head);expect(git(resumed.workspace,'status','--porcelain')).toBe(status);
 await resumed.cleanup();expect(fs.readFileSync(path.join(original.workspace,'hello.txt'),'utf8')).toBe('retained dirty text\n');expect(fs.existsSync(path.join(original.workspace,'unsent.txt'))).toBe(true);
});
test('corrupt resume pointer fails rather than allocating another checkout',async()=>{
 fs.writeFileSync(path.join(parent,'settings-ios-resume.json'),'{broken');const before=fs.readdirSync(parent);
 await expect(prepareNativeFixtureRoot(parent,'settings','ios')).rejects.toThrow();expect(fs.readdirSync(parent)).toEqual(before);
});
test('resume cannot point outside the owned parent',async()=>{
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'djl-outside141-'));
 try {pointer(outside);await expect(prepareNativeFixtureRoot(parent,'settings','ios')).rejects.toThrow();expect(fs.readdirSync(outside)).toEqual([]);}finally{fs.rmSync(outside,{recursive:true,force:true});}
});
test('resume refuses a symlink root even when its target is inside the parent',async()=>{
 const original=await prepareNativeFixtureRoot(parent,'settings','ios');const link=path.join(parent,'settings-ios-link');fs.symlinkSync(original.root,link);pointer(link);
 await expect(prepareNativeFixtureRoot(parent,'settings','ios')).rejects.toThrow();expect(fs.existsSync(original.workspace)).toBe(true);
});

const probe=path.resolve(import.meta.dir,'../../test/integration_support/fixture_identity_probe.ts');
async function run(root:string,trust=false){
 const result=path.join(root,`probe-${randomUUID()}.json`);expect(fs.existsSync(result)).toBe(false);
 const child=Bun.spawn([process.execPath,probe],{env:{...process.env,...fixtureIdentityEnvironment(root),DJL_QA_RUNTIME:'1',DJL_FIXTURE_TEST_ROOT:root,DJL_FIXTURE_TEST_RESULT:result,DJL_FIXTURE_TEST_TRUST:trust?'1':'0'},stdout:'pipe',stderr:'pipe'});
 const [exitCode]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 return {exitCode,result};
}
async function successful(root:string,trust=false){const p=await run(root,trust);expect(p.exitCode).toBe(0);expect(fs.existsSync(p.result)).toBe(true);return JSON.parse(fs.readFileSync(p.result,'utf8'));}
function identityRoot(){const root=path.join(parent,'settings-ios-owned');fs.mkdirSync(root);return root;}

test('separate processes reuse the same cryptographically valid private identity',async()=>{
 const root=identityRoot();const first=await successful(root),second=await successful(root);expect(first.pairValid).toBe(true);expect(second.pairValid).toBe(true);expect(second.id).toBe(first.id);expect(second.publicKey).toBe(first.publicKey);
 const directory=path.join(root,'qa-device-state');expect(fs.existsSync(directory)).toBe(true);
 expect(fs.statSync(directory).mode&0o777).toBe(0o700);
 for(const file of ['device-state.json','keychain-mirror.json'])expect(fs.statSync(path.join(directory,file)).mode&0o777).toBe(0o600);
});
test('trusted phone survives a process restart without accessing host Keychain',async()=>{
 const root=identityRoot();const first=await successful(root,true),second=await successful(root);expect(second.id).toBe(first.id);expect(second.publicKey).toBe(first.publicKey);expect(second.trusted).toEqual({'qa-phone-141':Buffer.alloc(32,7).toString('base64')});
});
test('corrupt persisted identity cannot silently rotate or overwrite files',async()=>{
 const root=identityRoot();await successful(root);const directory=path.join(root,'qa-device-state');fs.mkdirSync(directory,{recursive:true});
 for(const name of ['device-state.json','keychain-mirror.json'])fs.writeFileSync(path.join(directory,name),'{broken');
 const p=await run(root);expect(p.exitCode).toBe(1);for(const name of ['device-state.json','keychain-mirror.json'])expect(fs.readFileSync(path.join(directory,name),'utf8')).toBe('{broken');
});
test('a pinned identity cannot be recreated when both private records are lost',async()=>{
 const root=identityRoot();const first=await successful(root);const directory=path.join(root,'qa-device-state');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(root,'qa-peer.json'),JSON.stringify({macDeviceId:first.id,macIdentityPublicKey:first.publicKey}));
 for(const name of ['device-state.json','keychain-mirror.json'])fs.rmSync(path.join(directory,name),{force:true});
 expect((await run(root)).exitCode).toBe(1);expect(fs.existsSync(path.join(directory,'device-state.json'))).toBe(false);
});
test('identity paths cannot follow a symlink outside the owned root',async()=>{
 const root=identityRoot(),outside=path.join(parent,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(root,'qa-device-state'));
 expect((await run(root)).exitCode).toBe(1);expect(fs.readdirSync(outside)).toEqual([]);
});

test('a dangling identity-file symlink cannot create material outside its root',async()=>{
 const root=identityRoot(),directory=path.join(root,'qa-device-state'),outside=path.join(parent,'outside-secret.json');fs.mkdirSync(directory);fs.symlinkSync(outside,path.join(directory,'device-state.json'));
 expect((await run(root)).exitCode).toBe(1);expect(fs.existsSync(outside)).toBe(false);
});
test('a private/public key mismatch is rejected without replacing the valid mirror',async()=>{
 const root=identityRoot();await successful(root);const directory=path.join(root,'qa-device-state'),canonical=path.join(directory,'device-state.json'),mirror=path.join(directory,'keychain-mirror.json');
 const state=JSON.parse(fs.readFileSync(canonical,'utf8'));state.macIdentityPrivateKey=Buffer.alloc(32,19).toString('base64');fs.writeFileSync(canonical,JSON.stringify(state));
 const beforeCanonical=fs.readFileSync(canonical),beforeMirror=fs.readFileSync(mirror);
 expect((await run(root)).exitCode).toBe(1);
 expect(Buffer.compare(fs.readFileSync(canonical),beforeCanonical)).toBe(0);expect(Buffer.compare(fs.readFileSync(mirror),beforeMirror)).toBe(0);
});

test('loss of the entire private-state directory cannot silently rotate the peer',async()=>{
 const root=identityRoot();await successful(root);const directory=path.join(root,'qa-device-state');fs.rmSync(directory,{recursive:true});
 expect((await run(root)).exitCode).toBe(1);expect(fs.existsSync(path.join(directory,'device-state.json'))).toBe(false);
});
