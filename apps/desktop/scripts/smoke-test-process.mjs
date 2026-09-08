import { spawn } from "node:child_process";
import { join } from "node:path";

export function buildSmokeEnvironment(baseEnvironment, smokeRoot, portOffset) {
  const environment = {
    ...baseEnvironment,
    HOME: join(smokeRoot, "home"),
    DJL_HOME: join(smokeRoot, "state"),
    SYNARA_HOME: join(smokeRoot, "state"),
    DJL_DESKTOP_USER_DATA_DIR: join(smokeRoot, "profile"),
    SYNARA_DESKTOP_USER_DATA_DIR: join(smokeRoot, "profile"),
    DJL_DESKTOP_SMOKE_TEST: "1",
    SYNARA_PORT_OFFSET: portOffset,
    SYNARA_NO_BROWSER: "1",
    SYNARA_DISABLE_AUTO_UPDATE: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete environment.SYNARA_AUTH_TOKEN;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.VITE_DEV_SERVER_URL;
  return environment;
}

export function findSmokeFailures(
  output,
  exitCode,
  observationCompleted,
  platform = process.platform,
) {
  const failures = [];
  if (!observationCompleted) {
    failures.push("Electron exited before the smoke observation period completed");
  }
  const plannedTaskkill = observationCompleted && platform === "win32" && exitCode === 1;
  if (exitCode !== null && exitCode !== 0 && !plannedTaskkill) {
    failures.push(`Electron exited with code ${exitCode}`);
  }
  for (const pattern of [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "TypeError:",
    "ReferenceError:",
  ]) {
    if (output.includes(pattern)) failures.push(pattern);
  }
  if (!output.includes("[desktop-smoke] renderer ready")) {
    failures.push("Renderer readiness was not observed");
  }
  return failures;
}

export function buildSmokeLaunchArguments(mainJs, userDataDirectory) {
  return [mainJs, `--user-data-dir=${userDataDirectory}`];
}

export function unixProcessGroupTarget(pid) {
  return -pid;
}

export function terminateSmokeProcessTree(child, signal = "SIGTERM") {
  if (!child.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  try {
    process.kill(unixProcessGroupTarget(child.pid), signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}
