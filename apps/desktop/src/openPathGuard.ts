// FILE: openPathGuard.ts
// Purpose: Decides whether a path may be handed to the operating system to open. The files
//          come from an agent, so the check is made on what the path really is: links are
//          followed first, and only a regular file of a document, image or media type passes.
//          A link dressed up as a PDF, or a folder named like one, does not.
// Layer: Desktop main-process helper

import * as FS from "node:fs";

import { isOpenableDocumentPath } from "@djl/shared/openableFiles";

/** The real path to open, or null when the target must only be shown in its folder. */
export async function resolveOpenableDocument(path: string): Promise<string | null> {
  try {
    const realPath = await FS.promises.realpath(path);
    // lstat, not stat: if the agent swapped the file for a link after the line above, this
    // sees the link and refuses. A swap after this line cannot be ruled out, because the
    // system opens by path; opening a private copy would close that gap but would send the
    // user's edits to the copy instead of their file.
    const stats = await FS.promises.lstat(realPath);
    return stats.isFile() && isOpenableDocumentPath(realPath) ? realPath : null;
  } catch {
    return null;
  }
}
