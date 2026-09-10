// FILE: bootstrap.ts
// Purpose: Completes synchronous renderer storage migration before any app store can hydrate.

import "./storageOriginMigration";

import { startLocalInterface } from "./startup/bootstrap";

const startup = startLocalInterface();
const loadApplication = () => {
  void import("./main").catch(() => startup?.setStatus("runtime-error"));
};
// Let the tiny local editor paint before evaluating the full application graph.
if (startup) requestAnimationFrame(() => requestAnimationFrame(loadApplication));
else loadApplication();
