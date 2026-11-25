# Multi agents v2: what other group-agent products do, and what DJL takes

**Date:** 2026-11-23
**Status:** Owner asked to research other products and implement their ideas; feature calls below
were made by the builder (the owner prefers decisions over questions) and can be overturned.
**Builds on:** `docs/superpowers/specs/2026-11-18-multi-agents-design.md` (v1, merged in #45).

## Why

The owner wants the group harness to be "even more useful and extremely powerful", taking ideas
from what other people's agent-group products already do. Three research passes on 2026-11-23
covered:

- **Multi-agent frameworks:** AutoGen / Microsoft Agent Framework, AgentScope, CAMEL / Eigent,
  MetaGPT, ChatDev, CrewAI, LangGraph, OpenAI Agents SDK, Google ADK, Agency Swarm, swarms, Agno.
- **CLI coding-agent orchestrators:** Claude Code agent teams, Codex subagents, claude-squad,
  Nimbalyst, Vibe Kanban, Sculptor, coder/xum, Agor, Orchestrator.inc, Paradev, Conductor, Kilo
  Agent Manager, Cline Kanban, agent-deck, ccmanager, oh-my-claudecode, AI Maestro, ClaudeChat.
- **AI group-chat apps:** ClawChat (Lenka0605, the closest copy of DJL's idea), Pi Bot, LobeHub
  Agent Groups, OpenClaw broadcast groups, SillyTavern, Open WebUI, Cherry Studio, LibreChat.

About 150 raw ideas came back. This document keeps the ones that (a) several products converged
on, (b) fit decisions the owner already made for v1, and (c) work for non-technical users without
a settings-heavy screen.

## What the field does that DJL did not

| Idea (who has it)                                                                                                                                                                                          | v2 call                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Silent pass token so agents with nothing to add stay quiet: `[PASS]`, `NO_REPLY` (ClawChat, OpenClaw, LLMGroupChat)                                                                                        | **Build**                                                                                  |
| One shared group brief every member reads (LobeHub group prompt, Pi Bot announcement, AgentScope announcement, Agency Swarm shared instructions, ChatGPT group instructions)                               | **Build**                                                                                  |
| Choosable default recipient, including a lead/coordinator (ClawChat, LobeHub orchestrator, Pi Bot coordinator, CrewAI manager, AutoGen selector)                                                           | **Build** as last speaker / everyone / a lead member                                       |
| Mute a member: never wakes on its own, still answers when named (SillyTavern, LLMGroupChat)                                                                                                                | **Build**                                                                                  |
| Automatic generator–critic loop: a reviewer checks every change and sends fixes back (Pi Bot, Orchestrator.inc, oh-my-claudecode, ChatDev, AgentScope GoalPipeline, AutoGen reflection, CrewAI guardrails) | **Build** as "Check changes automatically"                                                 |
| Pick one proposal / merge all proposals (Open WebUI select + Merge Responses, Cherry Studio, Pi Bot Start)                                                                                                 | **Build** as "Go with this" and "Combine"                                                  |
| Follow-up debate round: each agent sees the others' answers and replies only if it adds something (OpenClaw broadcast rounds, Claude Code "competing hypotheses", swarms debate, llm-council)              | **Build** as "Discuss"                                                                     |
| Context-used meter per member and a fresh-session reset (ClawChat 70/85% bar, Sculptor, xum, agent-deck)                                                                                                   | **Build**                                                                                  |
| Stuck detection: quiet for minutes → say so, offer restart (ClawChat, ccmanager, Magentic stall count)                                                                                                     | **Build**                                                                                  |
| Visible automatic-round counter (Pi Bot "Automatic rounds: N / M")                                                                                                                                         | **Build**                                                                                  |
| Per-turn checkpoint with restore (opcode, Terragon, uzi, LangGraph time travel)                                                                                                                            | **Build** as "Undo changes" on a round, reusing DJL checkpoints                            |
| Team templates (Pi Bot, LobeHub, uzi `claude:3,codex:2`, oh-my-claudecode pipelines)                                                                                                                       | **Build** in the setup dialog                                                              |
| Worktree per writer, race / best-of-N, merge, PR, CI routing (nearly every orchestrator)                                                                                                                   | **Later**: its own project (merge UI, conflicts)                                           |
| Shared task board with claim / dependencies, plan card with Start / Modify (Claude Code teams, Pi Bot, Cline Kanban, CAMEL)                                                                                | **Later**: needs an agent-callable tool and a Tasks panel                                  |
| Private DMs inside a group, busy-agent clone (LobeHub, ClawChat)                                                                                                                                           | **Later**: was a v1 non-goal                                                               |
| Plan-only / Execute mode switch (Pi Bot)                                                                                                                                                                   | **No**: owner chose one mode in v1                                                         |
| LLM speaker selection, bidding, talkativeness (AutoGen, swarms, SillyTavern)                                                                                                                               | **No**: extra model calls, opaque; the lead member covers the coordinator case             |
| Hand-off permission graph, combinable stop conditions (AutoGen, MAF)                                                                                                                                       | **No**: settings-heavy (a v1 anti-goal)                                                    |
| Dollar budget caps (MetaGPT, Pi Bot, LobeHub)                                                                                                                                                              | **No**: subscription CLIs report no cost; the context meter covers the part we can measure |
| Human collaborators, WeChat / Telegram bridges, webhook triggers                                                                                                                                           | **Later**: separate projects                                                               |

## Goals

- Fewer, better answers: agents stay silent when they have nothing to add.
- One place to tell every agent what the group is for and how to work.
- Rounds that finish the job: changes get checked by a reviewer and sent back until they pass,
  still bounded by the hop limit.
- An `@all` round ends in a decision, not a wall of text: pick one, combine, or let them discuss.
- The user always sees what is happening: hand-offs used, who is quiet, how full each agent is.
- New users start from a working team in one click.

## Non-goals

- No new mode, no new required setting. Every v2 setting has a default that behaves like v1.
- No phone changes in this pass. Contracts stay backward compatible: the phone ignores unknown
  fields and event types today (`groups_controller.dart` `_applyEvent` has a default branch).

## Design

### Silent pass

- In rounds that went to everyone (user `@all`, default recipient "everyone", the Discuss
  follow-up) the prompt says: if you have nothing to add, reply with exactly `[PASS]`.
- A reply whose text is `[PASS]` (case-insensitive, surrounding whitespace or punctuation
  ignored) is not added to the group log, does not count as a speaker, and starts no hand-off.
  It is recorded as an empty reply with `passed: true`; the chat shows one muted line
  ("Codex had nothing to add") instead of a bubble.

### Group brief

- `Group.brief` (up to 4,000 characters, empty by default), edited in the members panel.
- A member's first-wake briefing includes it.
- `Group.setupRev` goes up whenever what members are told about the group changes: the brief, the
  lead, the reviewer, a mute, a role, or a member joining or leaving. A member whose saved
  `setupRevSeen` is older gets the current setup again (members, roles, lead, mutes, brief; not
  the skill list) on its next wake, and its seen revision is saved when that reply completes.

### Default recipient

- `Group.defaultRecipient`: `"last"` (default, the v1 rule), `"all"` (everyone, propose-only like
  `@all`), or a member id (the lead).
- A lead gets every message without `@`, may edit, and its briefing says it is the lead: answer
  itself or hand parts to members with `@handle`. If the lead is removed the group falls back to
  `"last"`.

### Mute

- `GroupMember.muted`. A muted member is skipped by `@all`, by the "everyone" default recipient,
  by agents' hand-offs, by failure hand-over and by automatic review. The user's own `@Name` always
  wakes it, and a follow-up without `@` after it answered goes to it again (the user is talking to
  it). If every member is muted, everyone-rounds wake them all rather than nobody. Other members'
  briefings mark it "muted: answers only when the user names it".

### Check changes automatically

- `Group.reviewerMemberId` (null = off). Set in the members panel; the "Build & review" templates
  set it.
- When a member other than the reviewer finishes a reply that changed files, and its reply did not
  already `@` the reviewer, DJL wakes the reviewer as one hop. The reviewer's wake is read-only
  (the `@all` policy) and its prompt lists the changed files and says: read them; if they are
  right, say so briefly and `@` nobody; if something must change, `@` the author with exactly what
  to fix.
- The author's fix is an ordinary hand-off; if it changes files the reviewer is woken again. The
  hop limit bounds the loop and its Continue / Stop card works unchanged.
- A muted reviewer, a removed reviewer, or a reply with no file changes triggers nothing.

### After an `@all` round: Go with this, Combine, Discuss

- Replies remember whether they came from a propose-only round (`GroupReply.proposeOnly`).
- Under each such reply: **Go with this** sends `@Handle Go ahead with your proposal.`
- Under the last reply of a round with two or more proposals: **Combine** (a small member menu)
  sends `@Handle Combine the proposals above into one plan.`, and **Discuss** sends `@all` with
  "Read each other's answers above. Reply only if you disagree or have something to add;
  otherwise reply [PASS]."
- These are ordinary messages typed for the user, so they are visible, editable history.

### Context meter and fresh session

- The child session keeps the last `thread.token-usage.updated` usage its driver emits. When a
  reply completes it is saved on the member (`GroupMember.contextUsage`: used and max tokens).
- The members panel shows a small bar per member (amber from 70 %, red from 85 % when the max is
  known; just the token count otherwise) and **Start fresh** for each member: it stops the member,
  closes its CLI, clears its saved session and usage, and the next wake re-briefs it with the last
  40 messages (the existing path for a session that cannot resume).

### Quiet members and the hand-off counter

- The child session records the time of its driver's last event or request. While a round runs,
  a member that has been working with no activity for 3 minutes (and is not waiting for the write
  lock) is reported as quiet; activity clears it.
- A new live event `round.progress` (`groupId`, `hops`, `hopLimit`, `quiet` member ids) is
  published when either changes and at round end; the snapshot carries the same per group.
- The working bar shows "Hand-offs 2 of 6" once a round has used any, and a quiet member's row
  says "No activity for 3 min" next to its Stop and Start fresh buttons.

### Undo changes

- A round is one thread turn and the group folder is a git repository, so DJL's checkpoint
  reactor already captures the files after each round. It undoes one turn at a time, newest first,
  so the action sits under the last reply of the newest round that changed files.
- A user message whose round changed files gets **Undo changes** (with a confirm that also names
  later rounds). It reverts the thread's files to the checkpoint before that round
  (`thread.checkpoint.revert`, scope `files`). The service then waits (up to 30 s) for the
  reactor's answer on the event stream: that turn's diff with no files means it worked and a
  group-log note tells the members on their next wake; a `checkpoint.revert.failed` activity is
  returned to the screen as the reason, and nothing is noted.

### Templates

- Step one of the setup dialog offers templates above the agent list:
  - **Build & review**: Builder + Reviewer, automatic review on.
  - **Plan, build, review**: Planner as lead + Builder + Reviewer, automatic review on.
  - **Research & write**: Researcher + Writer.
  - **Second opinions**: up to three different agents, no roles, default recipient everyone.
- A template fills the agent picks from agents that are ready, preferring different providers, and
  leaves everything editable. `GroupCreateInput` gains optional `brief`, `defaultRecipient`
  (`"last" | "all"`), and per-member `lead` / `reviewer` flags.

### Storage and contracts

- Migration `064_GroupHarnessV2`: `groups.brief`, `groups.setup_rev`, `groups.default_recipient`,
  `groups.reviewer_member_id`; `group_members.muted`, `group_members.setup_rev_seen`,
  `group_members.context_json`; `group_replies.propose_only`, `group_replies.passed`.
- New RPCs `groups.resetMember` and `groups.undoRound`; `groups.update` and
  `groups.updateMember` gain the new fields. The group RPCs moved into their own `RpcGroup`
  (`WsGroupsRpcGroup` in `packages/contracts/src/rpc.ts`): adding two more to the core group pushed
  its declaration past TS7056, which only the `tsdown --dts` build reports.
- A changed member model now also starts that member fresh, since a CLI session cannot switch to
  another model mid-session.

### Changes during a round

- A round re-reads the group before each wake and before it follows a reply's hand-offs, so a
  mute, a new model, a reviewer turned off or a new lead applies at once, not only next round.
- **Start fresh** (and a model change) closes the member's CLI first, so a stuck member's long
  interrupt cannot keep the old session in use; a reply from before the reset is dropped, and the
  next wake opens a new session even before storage has forgotten the old one.

## Found in review (2026-11-23) and fixed

An independent review of the first build found: settings changed mid-round did not reach that
round; Start fresh could brief the old session while it was being interrupted; the automatic
reviewer counted as a last speaker, so a follow-up woke it with write access; Undo told the
members it worked before knowing; lead and mute changes reached only members with a new session;
a failed review could be handed to its own author; and a member the user named could pass. Each
has a test in `groupRound.test.ts`, `groupPrompt.test.ts` or `GroupService.test.ts`.

## Calls made by the builder

- Pass is offered only in everyone-rounds, so an agent the user named never stays silent; if one
  replies `[PASS]` anyway, it is shown as written.
- The automatic reviewer's answer does not make it a "last speaker"; a failed review is not handed
  to another member.
- The reviewer reviews read-only and by reading files: in a propose-only wake `git diff` is a
  command and is refused, and an auto-created folder has no commit to diff against.
- "Quiet" is 3 minutes and worded as "No activity", not "stuck": long builds are legitimately
  silent.
- Go with this / Combine / Discuss send plain localized messages rather than new round kinds.
- Undo is per round (turn) because that is the unit DJL checkpoints; reverting an earlier round
  also reverts later ones, and the confirm says so.

## Verification

- Server unit tests with fake child drivers (`groupRound.test.ts`, `groupPrompt.test.ts`,
  `childSession.test.ts`, `GroupService.test.ts`) for: pass, brief and brief revision, default
  recipient (all, lead, lead removed), mute in each wake path, automatic review (triggers, skips,
  loop bounded by hops, pending at the limit), context saved, fresh session, quiet detection,
  progress events.
- Web logic tests for templates, round grouping for Combine / Discuss, and pass rows.
- `ci:desktop:format`, `ci:desktop:lint`, `ci:desktop:typecheck`, server and web tests,
  `i18n:check` count unchanged, `brand:check`.
