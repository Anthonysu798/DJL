import { startApi } from "./server.ts";

const runtime = await startApi();
console.log(
  JSON.stringify({
    level: "info",
    msg: "api listening",
    host: runtime.address.host,
    port: runtime.address.port,
    env: runtime.env.env,
  }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void runtime.close().then(() => process.exit(0));
  });
}
