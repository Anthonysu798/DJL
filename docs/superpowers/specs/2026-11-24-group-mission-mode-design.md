# Multi agents: Mission mode, reactions and the live stage

**Date:** 2026-11-24
**Status:** The owner asked for Mission mode (live stage, starter quests, missions) with every
tap reaction answered by the agents, and agents putting an eye reaction on the messages they
pick up. Feature calls below are the builder's (the owner prefers decisions over questions).
**Builds on:** `2026-11-23-group-harness-v2-design.md`.

## Why

Make the group feel alive and game-like while staying a real tool: you see who picked up your
message, what each agent is doing right now, and a goal turning into finished steps. Every playful
element is a real thing shown well; nothing is decorative or invented.

## What the user sees

- **Agents react to what they pick up.** When a member is woken by your message it puts 👀 on it;
  when it finishes, the 👀 becomes ✅ (answered), 💤 (had nothing to add) or ⚠️ (failed). The same
  happens on a reply that hands work to another member, or that you reacted to.
- **Tap reactions on every answer:** 👍 Good, 👎 Not quite, ✅ Do it, 🤔 Explain simpler.
  - 👍 is feedback: it is shown on the answer and the agent reads it on its next wake. It does
    not wake anyone, so it costs nothing. Tapping it again takes it back.
  - 👎 wakes that agent to try again with a different, better answer.
  - ✅ wakes that agent to carry it out, with edit rights (the same as Go with this).
  - 🤔 wakes that agent to explain its answer again in plain words, briefly.
  - The agent puts 👀 on the reacted answer, then answers in the chat.
- **Live stage** under the header: each member's avatar with what it is doing now (thinking,
  reading a file, editing a file, running a command, writing, reviewing, planning, waiting for
  another agent, or ready), the file or command named, and "from Claude" when a hand-off woke it.
- **Starter quests** in a new group: Say hi to everyone (`@all`), Ask one agent (`@Name`), React to
  an answer, Run a mission. Each has a Try it button; finished quests tick off; the card can be
  hidden and goes away by itself once all four are done.
- **Missions.** A 🎯 button in the composer switches it to mission mode: you type a goal and the
  group's planner turns it into a mission card, 2–7 steps, each with the member who will do it.
  You can remove steps, then Start. Steps run one after another, each ticking off live with a
  progress ring; hand-offs and automatic review inside a step work as usual. At the end the card
  becomes a recap (steps, time, files changed, commands, reviews) with Copy summary.

## Design

### Turn input carries its message id

`ProviderSendTurnInput` gains an optional `messageId`, set by `ProviderCommandReactor` for sends
and steers. The group driver passes it to the round, so the round knows which user message woke a
member. Other providers ignore it.

### Reactions

- Table `group_reactions` (in migration 064, not shipped yet): group, target (a user message id or
  a member reply id), actor (`user` or a member id), kind, time. A member has one status reaction
  per target (seen → done/passed/failed); the user has one reaction per kind per target.
- The round sets a member's `seen` reaction when its wake starts and replaces it when it settles;
  a stopped wake removes it. A wake's target is the user message, the reply that handed off or
  asked for review, or the reacted reply.
- `groups.react({ groupId, replyId, kind, message? })`: 👍 toggles and adds a log note ("The user
  liked @Name's answer"); the other three save the reaction and post `message` (written by the
  screen in the user's language, starting with `@Name`) to the group. Posting goes into the running
  round through the driver's live controls, or starts a turn when none is running. A posted
  reaction is logged like a user message but never appears as a chat bubble; its wake targets the
  reacted reply.
- Events `reaction.set` / `reaction.removed`; the snapshot carries `reactions`.

### Live stage

- The child session reports activity from its driver's events: assistant text → writing; a file
  read → reading; a file change → editing (the path); a command → running (the command); Claude's
  Read/Grep/Glob/WebSearch/WebFetch count as reading. The round adds thinking at the start of a
  wake, reviewing for a review, planning for a mission plan, and waiting for the write lock.
- Event `member.activity` (`kind`, `detail`, `from`), published only when it changes; null when the
  member settles. The snapshot carries `activities`.

### Missions

- Table `group_missions`: id, group, goal, status (`planning`, `ready`, `running`, `paused`,
  `done`, `stopped`, `failed`), the plan reply id, steps (text, member, status), the current
  step, start and finish times, and stats. Event `mission.upserted`; snapshot `missions`.
- `groups.missionPlan({ groupId, goal, message })` picks the planner (the lead, else a member with
  the Planner role, else the first unmuted member), saves a `planning` mission and posts
  `@Planner <message>`. That wake is read-only, its mentions start no hand-offs, and its prompt
  asks for a checklist, one `- [ ] @Handle what to do` line per step. DJL parses the reply into
  steps (unknown handles are dropped); no steps marks the mission `failed` with Plan again.
- `groups.missionStart({ groupId, missionId, skipCurrent? })` (start, retry or skip) and
  `groups.missionStop` and `groups.missionRemoveStep`. Starting posts a mission cue; the round runs
  the current step's wake with edit rights. Hand-offs and reviews inside a step inherit it; when
  none of the step's wakes is left, the step is done (or failed when none of its replies was an
  answer) and the next one starts with a fresh hop count. A pause at the hop limit, Stop all, a
  stopped member or a failed step pauses the mission with Retry step / Skip step / Stop.
- Stats come from the mission's replies: files (distinct), commands, automatic reviews, and time.

### Quests

Worked out on the screen from the chat, the reactions and the missions; nothing is stored except
"hidden" per group in local storage.

## Not in this pass

Time-lapse replay of a mission, reassigning a step to another member, parallel steps, phone
support for missions and reactions (the phone ignores the new events), achievements beyond the
four starter quests.

## Verification

Server tests with fake child drivers for reactions (seen → done/passed/failed, removal on stop,
targets for hand-offs and reactions), activity, posting into a running round, mission planning,
parsing, running, pausing, skipping and stats; repository and service tests; web logic tests for
quests and mission/reaction rows; browser tests for the reaction bar and mission card; full
`ci:desktop` checks.
