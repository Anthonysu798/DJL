import { expect, it } from "vitest";
import { createSubmissionGate } from "./browser";

it("reads already-owned inline media under a platform connect-src policy without a network fetch", async () => {
  const frame = document.createElement("iframe");
  frame.srcdoc =
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">';
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  document.body.append(frame);
  try {
    await loaded;
    const w = frame.contentWindow! as Window & typeof globalThis;
    const read = w.Function(
      `return (async()=>{const gate=(${createSubmissionGate.toString()})();const response=await gate.fetch('data:image/png;base64,AQIDBA==');return {type:response.headers.get('Content-Type'),bytes:[...new Uint8Array(await response.arrayBuffer())]};})()`,
    );
    expect(await read()).toEqual({ type: "image/png", bytes: [1, 2, 3, 4] });
  } finally {
    frame.remove();
  }
});
