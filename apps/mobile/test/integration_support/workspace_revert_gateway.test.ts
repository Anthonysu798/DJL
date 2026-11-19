// Original gateway handlers against disposable Git repositories; no user workspace.
import {afterEach, expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import workspace from '../../../remote-gateway/src/workspace-handler.js';
import {createRuntimeFixture} from '../../integration_test/support/desktop_runtime_fixture.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, {recursive: true, force: true});
});
async function git(root: string, ...args: string[]) {
  const child = Bun.spawn(['git', '-C', root, ...args], {stdout: 'pipe', stderr: 'pipe'});
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(stderr);
  return stdout;
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'djl-mobile-revert-'));
  roots.push(root);
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.name', 'Mobile QA');
  await git(root, 'config', 'user.email', 'mobile-qa@test.invalid');
  for (const [name, value] of Object.entries({
    'response.txt': 'before\n', 'deleted.txt': 'restore me\n', 'unrelated.txt': 'keep baseline\n',
  })) await fs.writeFile(path.join(root, name), value);
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'Disposable baseline');
  return root;
}
const read = (root: string, name: string) => fs.readFile(path.join(root, name), 'utf8');
const write = (root: string, name: string, value: string) => fs.writeFile(path.join(root, name), value);
const rpc = (root: string, method: string, params: Record<string, unknown>) =>
  workspace.handleWorkspaceMethod('workspace/' + method, {cwd: root, ...params});

test('preview is read-only and undo preserves unrelated edits and untracked files', async () => {
  const root = await fixture();
  await write(root, 'response.txt', 'after\n');
  await fs.unlink(path.join(root, 'deleted.txt'));
  await write(root, 'created.txt', 'new response file\n');
  await git(root, 'add', '-N', 'created.txt');
  const forwardPatch = await git(root, 'diff', '--', 'response.txt', 'deleted.txt', 'created.txt');
  await git(root, 'reset', '--', 'created.txt');
  await write(root, 'unrelated.txt', 'keep user edit\n');
  await write(root, 'untracked.txt', 'keep untracked\n');
  const before = await git(root, 'status', '--porcelain');
  const preview = await rpc(root, 'revertPatchPreview', {forwardPatch});
  expect(preview.canRevert).toBe(true);
  expect(preview.affectedFiles.sort()).toEqual(['created.txt', 'deleted.txt', 'response.txt']);
  expect(await git(root, 'status', '--porcelain')).toBe(before);
  expect(await read(root, 'response.txt')).toBe('after\n');
  expect(await read(root, 'created.txt')).toBe('new response file\n');
  const applied = await rpc(root, 'revertPatchApply', {forwardPatch});
  expect(applied.success).toBe(true);
  expect(await read(root, 'response.txt')).toBe('before\n');
  expect(await read(root, 'deleted.txt')).toBe('restore me\n');
  expect(await fs.stat(path.join(root, 'created.txt')).catch(() => null)).toBeNull();
  expect(await read(root, 'unrelated.txt')).toBe('keep user edit\n');
  expect(await read(root, 'untracked.txt')).toBe('keep untracked\n');
});

test('targeted staged changes block undo while unrelated staged content is preserved', async () => {
  const root = await fixture();
  await write(root, 'response.txt', 'after\n');
  const forwardPatch = await git(root, 'diff', '--', 'response.txt');
  await git(root, 'add', 'response.txt');
  const blocked = await rpc(root, 'revertPatchPreview', {forwardPatch});
  expect(blocked.canRevert).toBe(false);
  expect(blocked.stagedFiles).toEqual(['response.txt']);
  expect((await rpc(root, 'revertPatchApply', {forwardPatch})).success).toBe(false);
  expect(await read(root, 'response.txt')).toBe('after\n');
  await git(root, 'reset', '--', 'response.txt');
  await write(root, 'unrelated.txt', 'keep staged user edit\n');
  await git(root, 'add', 'unrelated.txt');
  const index = await git(root, 'diff', '--cached');
  expect((await rpc(root, 'revertPatchPreview', {forwardPatch})).canRevert).toBe(true);
  expect((await rpc(root, 'revertPatchApply', {forwardPatch})).success).toBe(true);
  expect(await git(root, 'diff', '--cached')).toBe(index);
  expect(await read(root, 'unrelated.txt')).toBe('keep staged user edit\n');
});

test('later overlapping edits and unsupported metadata remain unchanged', async () => {
  const root = await fixture();
  await write(root, 'response.txt', 'after\n');
  const forwardPatch = await git(root, 'diff', '--', 'response.txt');
  await write(root, 'response.txt', 'later overlapping user edit\n');
  const before = await git(root, 'diff');
  const preview = await rpc(root, 'revertPatchPreview', {forwardPatch});
  expect(preview.canRevert).toBe(false);
  expect(preview.conflicts.length).toBeGreaterThan(0);
  expect((await rpc(root, 'revertPatchApply', {forwardPatch})).success).toBe(false);
  expect(await git(root, 'diff')).toBe(before);
  const unsupported = await rpc(root, 'revertPatchPreview', {
    forwardPatch: 'diff --git a/response.txt b/response.txt\nold mode 100644\nnew mode 100755\n',
  });
  expect(unsupported.canRevert).toBe(false);
  expect(unsupported.unsupportedReasons.length).toBeGreaterThan(0);
  expect(await git(root, 'diff')).toBe(before);
});

test('dependent batches reverse newest-first; a rejected sequence has no workspace writes', async () => {
  const root = await fixture();
  await write(root, 'response.txt', 'first response edit\n');
  const first = await git(root, 'diff', '--', 'response.txt');
  await git(root, 'add', 'response.txt');
  await git(root, 'commit', '-m', 'Disposable intermediate patch base');
  await write(root, 'response.txt', 'second response edit\n');
  const second = await git(root, 'diff', '--', 'response.txt');
  const patches = [{id: 'second', forwardPatch: second}, {id: 'first', forwardPatch: first}];
  const before = await git(root, 'diff');
  expect((await rpc(root, 'revertPatchBatchPreview', {patches})).canRevert).toBe(true);
  expect(await git(root, 'diff')).toBe(before);
  const reversed = await rpc(root, 'revertPatchBatchApply', {patches});
  expect(reversed.success).toBe(true);
  expect(reversed.patchResults).toEqual([{id: 'second', applied: true}, {id: 'first', applied: true}]);
  expect(await read(root, 'response.txt')).toBe('before\n');
  await write(root, 'response.txt', 'second response edit\n');
  const rejected = [{id: 'first', forwardPatch: first}, {id: 'second', forwardPatch: second}];
  const unchanged = await git(root, 'diff');
  expect((await rpc(root, 'revertPatchBatchPreview', {patches: rejected})).canRevert).toBe(false);
  expect((await rpc(root, 'revertPatchBatchApply', {patches: rejected})).success).toBe(false);
  expect(await git(root, 'diff')).toBe(unchanged);
  expect(await read(root, 'response.txt')).toBe('second response edit\n');
});

test('native undo fixture captures only its response patch, preserving earlier same-file edits', async () => {
  const root = await fixture();
  const before = 'baseline\nearlier user edit\n';
  await write(root, 'hello.txt', 'baseline\n');
  await git(root, 'add', 'hello.txt');
  await git(root, 'commit', '-m', 'Disposable native fixture file');
  await write(root, 'hello.txt', before);
  await write(root, 'unrelated.txt', 'keep unrelated user edit\n');
  const events: Record<string, any>[] = [];
  const runtime = createRuntimeFixture(root, value => events.push(value));
  runtime.handle({id: 'start-thread', method: 'thread/start', params: {cwd: root}});
  const threadId = events.find(value => value.id === 'start-thread')!.result.thread.id;
  runtime.handle({id: 'start-turn', method: 'turn/start', params: {threadId, input: [{type: 'text', text: '[undo] response fixture'}]}});
  const deadline = Date.now() + 3000;
  while (!events.some(value => value.method === 'turn/completed') && Date.now() < deadline) await Bun.sleep(20);
  expect(events.some(value => value.method === 'turn/completed')).toBe(true);
  const changed = events.find(value => value.method === 'item/completed' && value.params.item.type === 'fileChange')!.params;
  const aggregate = events.find(value => value.method === 'turn/diff/updated')!.params;
  expect(changed.threadId).toBe(threadId);
  expect(aggregate.threadId).toBe(threadId);
  expect(aggregate.turnId).toBe(changed.turnId);
  expect(changed.item.status).toBe('completed');
  const forwardPatch = changed.item.changes[0].diff;
  expect(aggregate.diff).toBe(forwardPatch);
  expect(forwardPatch).toContain('--- a/hello.txt\n+++ b/hello.txt\n');
  expect(forwardPatch).toContain('@@');
  expect(await read(root, 'hello.txt')).not.toBe(before);
  expect((await rpc(root, 'revertPatchPreview', {forwardPatch})).canRevert).toBe(true);
  expect((await rpc(root, 'revertPatchApply', {forwardPatch})).success).toBe(true);
  expect(await read(root, 'hello.txt')).toBe(before);
  expect(await read(root, 'unrelated.txt')).toBe('keep unrelated user edit\n');
});
