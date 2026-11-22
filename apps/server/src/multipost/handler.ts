import { resolveMultiPostMedia } from "./media";
import { importLegacyCampaign } from "./legacy";
import { Effect } from "effect";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { MultiPostCommand } from "@djl/contracts";
import { ServerConfig } from "../config";
import { collectBoundedStream } from "../streamingAttachmentUpload";
import { getMultiPost, multiPostScope } from "./live";
const mediaTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const multiPostHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request)!;
  const sql = yield* SqlClient.SqlClient;
  const config = yield* ServerConfig;
  return yield* Effect.tryPromise({
    try: async () => {
      const media = url.pathname.includes("/media");
      let input: { threadId?: string; command?: MultiPostCommand } = {};
      const thread = url.searchParams.get("threadId");
      if (thread) input.threadId = thread;
      if (request.method === "POST" && !media) {
        const bytes = await Effect.runPromise(
          collectBoundedStream(request.stream, 2 * 1024 * 1024),
        );
        input = JSON.parse(new TextDecoder().decode(bytes));
      }
      if (typeof input.threadId !== "string" || input.threadId.length > 200)
        throw new Error("Select an existing DJL conversation");
      const rows = await Effect.runPromise(
        sql<{
          root: string;
        }>`SELECT COALESCE(t.worktree_path,p.workspace_root) AS root FROM projection_threads t JOIN projection_projects p ON p.project_id=t.project_id WHERE t.thread_id=${input.threadId}`,
      );
      if (!rows[0]?.root) throw new Error("Conversation workspace was not found");
      const scope = await multiPostScope(rows[0].root, input.threadId, config.stateDir);
      if (media) {
        await mkdir(scope.mediaRoot!, { recursive: true, mode: 0o700 });
        if (request.method === "POST") {
          const name = path.basename(
            decodeURIComponent(request.headers["x-djl-filename"] ?? "media"),
          );
          const type = mediaTypes[name.split(".").pop()?.toLowerCase() ?? ""];
          if (!type) throw new Error("Choose an image, video, audio or DOCX file");
          const bytes = await Effect.runPromise(
            collectBoundedStream(request.stream, 100 * 1024 * 1024),
          );
          const id = randomUUID();
          await writeFile(path.join(scope.mediaRoot!, id), bytes, { mode: 0o600, flag: "wx" });
          await writeFile(
            path.join(scope.mediaRoot!, id + ".json"),
            JSON.stringify({ name, type, size: bytes.length }),
            { mode: 0o600, flag: "wx" },
          );
          return HttpServerResponse.jsonUnsafe(
            { name, type, size: bytes.length, url: `Media/${id}` },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        const source = url.searchParams.get("path");
        if (source) {
          const file = await resolveMultiPostMedia(scope, source);
          return HttpServerResponse.uint8Array(await readFile(file.full), {
            headers: {
              "Content-Type": file.type,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        const id = url.pathname.split("/").pop() ?? "";
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Unknown media");
        const full = await realpath(path.join(scope.mediaRoot!, id));
        if (!full.startsWith((await realpath(scope.mediaRoot!)) + path.sep))
          throw new Error("Media path is invalid");
        const metadata = JSON.parse(
          await readFile(path.join(scope.mediaRoot!, id + ".json"), "utf8"),
        ) as { name: string; type: string };
        return HttpServerResponse.uint8Array(await readFile(full), {
          headers: {
            "Content-Type": metadata.type,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `${metadata.type.includes("wordprocessing") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
          },
        });
      }
      const { service } = await getMultiPost(sql);
      if (request.method !== "POST" && request.method !== "GET")
        return HttpServerResponse.empty({ status: 405 });
      if (input.command?.action === "import-campaign")
        return HttpServerResponse.jsonUnsafe(
          await Effect.runPromise(
            importLegacyCampaign(config, scope, input.command).pipe(
              Effect.provideService(SqlClient.SqlClient, sql),
            ),
          ),
          { headers: { "Cache-Control": "no-store" } },
        );
      const result = await service.command(
        scope,
        request.method === "GET" ? { action: "state" } : input.command!,
        "ui",
      );
      return HttpServerResponse.jsonUnsafe(result, { headers: { "Cache-Control": "no-store" } });
    },
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.text(
          error instanceof Error ? error.message : "MultiPost request failed",
          { status: 400 },
        ),
      ),
    ),
  );
});
