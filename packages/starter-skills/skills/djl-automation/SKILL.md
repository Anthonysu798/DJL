---
name: djl-automation
description: Safely automate repetitive work on the user's computer - renaming, sorting or moving files, merging spreadsheets, cleaning folders, and small scripts they can rerun. Use when the user asks to rename, organise, tidy, sort, move, merge, convert in bulk, or write a script to do a chore for them.
---

# Safe automations for non-programmers

The person trusts you with their own files. Nothing may be lost, overwritten or moved without them seeing it first. Safety beats speed every time.

## The rules

1. **Look before you touch.** List what is there first (names, counts, sizes, dates). Never assume a folder's contents.
2. **Preview every change.** Before renaming, moving, converting or deleting anything, show a plan: a table of `before → after` for each file (or the first 20 and a count if there are many). Wait for the user to say yes.
3. **Never delete.** Move unwanted files to a clearly named folder (for example `To review - 2026-05-14`) or the system Trash instead. Only delete permanently if the user explicitly asks, after showing exactly what will go.
4. **Never overwrite.** If a target name already exists, add a number (`Report (2).pdf`) and mention it in the preview.
5. **Work on copies for risky edits.** When changing file contents (spreadsheets, documents), write a new file next to the original unless the user asks to replace it.
6. **Keep an undo list.** After making changes, save a small log (CSV or text) of every `before → after` path in the folder, so the change can be reversed. Offer to undo.
7. **Stay in the chosen folder.** Do not touch files outside the folder the user named. Skip hidden and system files (names starting with `.`, `desktop.ini`, `Thumbs.db`) unless asked.

## How to build it

- Prefer a small, readable script (Python or the system shell) over many one-off commands, so the same job can be run again later. Put a short comment at the top saying what it does and how to run it.
- Give the script a **dry-run mode that is the default**: it prints what it would do. Making real changes needs an explicit flag such as `--apply`.
- Handle odd names: spaces, accents, emoji and very long names. Match file types by extension case-insensitively (`.JPG` and `.jpg`).
- For photo dates use the date the photo was taken (EXIF) when present, and fall back to the file's modified date, telling the user which files used the fallback.
- For merging spreadsheets, keep the same columns, add a column with the source file name, and report rows that did not fit.
- Use only tools already on the computer when possible. If something must be installed, say what and why, and ask first.

## Talking to the user

- Explain in plain words what you will do before doing it, and what happened afterwards: how many files changed, where the undo log is, and anything skipped and why.
- If you are about to change more than about 200 files, or files in a system folder, stop and confirm again.
- At the end, explain how to run the script again in one or two simple steps.
