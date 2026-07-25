import { spawn } from "node:child_process";
import { join } from "node:path";

export function buildSmokeEnvironment(baseEnvironment, smokeRoot, portOffset) {
  const environment = {
    ...baseEnvironment,
    HOME: join(smokeRoot, "home"),
    SYNARA_HOME: join(smokeRoot, "state"),
    SYNARA_PORT_OFFSET: portOffset,
    SYNARA_NO_BROWSER: "1",
    SYNARA_DISABLE_AUTO_UPDATE: "1",
    VITE_DEV_SERVER_URL: "",
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete environment.SYNARA_AUTH_TOKEN;
  return environment;
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
