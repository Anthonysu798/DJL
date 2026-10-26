// Protocol fixture only: no provider credential, customer data, or paid inference.
let calls = 0;
Bun.serve({
  port: 8090,
  hostname: "0.0.0.0",
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/responses")
      return new Response(null, { status: 404 });
    const body = (await request.json()) as {
      tools?: { type: string; name?: string }[];
      input: unknown[];
    };
    calls += 1;
    const tool = body.tools?.find(
      (t) =>
        t.type === "function" && ["exec_command", "shell", "shell_command"].includes(t.name ?? ""),
    );
    const withResult = body.input.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "function_call_output",
    );
    const item =
      tool && !withResult
        ? {
            id: "fc_1",
            type: "function_call",
            call_id: "call_1",
            name: tool.name,
            arguments: JSON.stringify(
              tool.name === "shell"
                ? { command: ["sh", "-c", "printf DJL_CODEX_TOOL_OK"], workdir: "/workspace" }
                : {
                    cmd: "printf DJL_CODEX_TOOL_OK",
                    command: "printf DJL_CODEX_TOOL_OK",
                    workdir: "/workspace",
                  },
            ),
            status: "completed",
          }
        : {
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "DJL_CODEX_PROTOCOL_OK", annotations: [] }],
          };
    const response = {
      id: `resp_${calls}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "in_progress",
      output: [],
      usage: null,
    };
    const events = [
      { type: "response.created", response },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress" },
      },
      ...(item.type === "message"
        ? [
            {
              type: "response.content_part.added",
              item_id: item.id,
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            },
            {
              type: "response.output_text.delta",
              item_id: item.id,
              output_index: 0,
              content_index: 0,
              delta: "DJL_CODEX_PROTOCOL_OK",
            },
            {
              type: "response.output_text.done",
              item_id: item.id,
              output_index: 0,
              content_index: 0,
              text: "DJL_CODEX_PROTOCOL_OK",
            },
          ]
        : []),
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          ...response,
          status: "completed",
          output: [item],
          usage: {
            input_tokens: 20,
            output_tokens: 10,
            total_tokens: 30,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    ];
    console.log(
      JSON.stringify({
        calls,
        tool: tool?.name ?? null,
        withResult,
        toolTypes: body.tools?.map((t) => t.type),
      }),
    );
    return new Response(
      events
        .map(
          (event, sequence_number) =>
            `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
        )
        .join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
