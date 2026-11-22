import { BROWSER_TOOL_NAMES, type ProviderInteractionMode, type RuntimeMode } from "@djl/contracts";

/** Exact tool names owned by DJL's capability-gated Computer gateway. */
export const DJL_COMPUTER_TOOL_NAMES = [
  "computer_activate_window",
  "computer_click",
  "computer_drag",
  "computer_get_accessibility_tree",
  "computer_get_cursor_position",
  "computer_get_screen_size",
  "computer_get_state",
  "computer_help",
  "computer_inspect",
  "computer_spaces",
  "computer_invoke_menu",
  "computer_kill_app",
  "computer_launch_app",
  "computer_list_apps",
  "computer_list_windows",
  "computer_move_cursor",
  "computer_paste",
  "computer_perform_action",
  "computer_press_key",
  "computer_read_clipboard",
  "computer_run",
  "computer_screenshot",
  "computer_scroll",
  "computer_select_text",
  "computer_set_app_visibility",
  "computer_set_value",
  "computer_set_window_frame",
  "computer_set_window_minimized",
  "computer_type_text",
  "computer_verify_state",
  "computer_wait",
  "computer_write_clipboard",
  "computer_zoom",
  // The cua-driver CDP browser family. Deliberately inside the Computer
  // namespace: these are the same capability (computer:control), the same
  // approval gate, and the same denial-card path as the desktop tools — they
  // merely dispatch over CDP rather than OS events. They must never collide
  // with the integrated `browser_*` surface, which is a different host.
  "computer_browser_state",
  "computer_browser_prepare",
  "computer_browser_navigate",
  "computer_browser_click",
  "computer_browser_type",
  "computer_browser_dialog",
  "computer_browser_upload",
  "computer_browser_download",
  "computer_browser_pointer",
  "computer_browser_press",
] as const;

export type DjlComputerToolName = (typeof DJL_COMPUTER_TOOL_NAMES)[number];

const DJL_COMPUTER_TOOL_NAME_SET = new Set<string>(DJL_COMPUTER_TOOL_NAMES);

function recordString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * Accept only the canonical gateway name or the exact provider qualifications
 * used for DJL's reserved MCP server. A similarly named tool from another
 * MCP server must continue through the provider's ordinary permission policy.
 */
export function canonicalDjlComputerToolName(value: unknown): DjlComputerToolName | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const canonical = normalized.startsWith("mcp__djl__")
    ? normalized.slice("mcp__djl__".length)
    : normalized.startsWith("djl_")
      ? normalized.slice("djl_".length)
      : normalized;
  return DJL_COMPUTER_TOOL_NAME_SET.has(canonical) ? (canonical as DjlComputerToolName) : undefined;
}

/**
 * Provider callbacks must carry DJL's namespace themselves. Bare canonical
 * names are safe only after a separate protocol field has proved the server
 * identity (for example Codex's `serverName`).
 */
export function qualifiedDjlComputerToolName(value: unknown): DjlComputerToolName | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("mcp__djl__") && !normalized.startsWith("djl_")) {
    return undefined;
  }
  return canonicalDjlComputerToolName(normalized);
}

/**
 * Namespace-insensitive matcher for Computer calls at the gateway boundary.
 *
 * A session that was never granted computer control must still surface the
 * denial card path when the model reaches for a Computer tool, or the attempt
 * dies as a silent tool error and the user never learns control is off.
 *
 * Gateway transport (all MCP providers): `makeAgentGatewayMcpTransport`
 * (`apps/server/src/agentGateway/mcpTransport.ts`) denies an unknown tool
 * name with `capability_denied` plus the denial hook only when
 * `isComputerToolName` matches. Wired in
 * `apps/server/src/agentGateway/Layers/AgentGateway.ts` as the catalog
 * membership test OR this family matcher, so a prefixed spelling from a
 * session that never saw the catalog —
 * `djl_computer_click`, `mcp__djl__computer_click` — still reaches
 * the denial hook and the card.
 *
 * Pi's native projection adds specialist forwarders only when its leased
 * catalog advertises Computer control. Disabled sessions carry no Computer
 * fallback schemas; stale calls reaching this boundary still receive the same
 * capability denial as other MCP clients.
 *
 * Entirely-unknown names (`computer_future_tool`, another server's
 * `mcp__other__computer_click`) must keep their current behavior — unknown
 * tools stay INVALID_PARAMS and foreign tools keep the provider's ordinary
 * permission policy — so this matcher accepts only exact owned names in any
 * of the three spellings, never prose around them.
 */
export function isDjlComputerToolFamilyName(value: unknown): boolean {
  return canonicalDjlComputerToolName(value) !== undefined;
}

function firstRecordString(value: unknown, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const candidate = recordString(value, key);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

export function computerToolNameFromProviderPermission(input: {
  readonly name?: unknown;
  readonly title?: unknown;
  readonly rawInput?: unknown;
  readonly metadata?: unknown;
}): DjlComputerToolName | undefined {
  const explicitName = typeof input.name === "string" ? input.name : undefined;
  if (explicitName !== undefined) return qualifiedDjlComputerToolName(explicitName);

  const rawToolName = firstRecordString(input.rawInput, ["_toolName", "toolName", "tool_name"]);
  if (rawToolName !== undefined) return qualifiedDjlComputerToolName(rawToolName);

  const metadataToolName = firstRecordString(input.metadata, [
    "_toolName",
    "toolName",
    "tool_name",
  ]);
  if (metadataToolName !== undefined) return qualifiedDjlComputerToolName(metadataToolName);

  // The display `title` is provider-composed text, not a tool name — a
  // request that only *renders* as a DJL computer call names no such tool
  // and must keep the ordinary permission path.
  return undefined;
}

/**
 * The `djl_*` catalog served by DJL's agent gateway: thread read/write,
 * project agent, automation, diagnostics, and review tools. Kept exact — a
 * look-alike MCP server (`djl_fs`, `djl_tools`) must never inherit the
 * auto-approve path the reserved `djl` server gets.
 */
const DJL_GATEWAY_OWNED_TOOL_NAMES = [
  // Thread read tools (threadReadTools.ts)
  "djl_context",
  "djl_capabilities",
  "djl_list_projects",
  "djl_list_threads",
  "djl_read_thread",
  "djl_wait_for_threads",
  // Kanban tools (kanbanTools.ts)
  "djl_read_kanban_board",
  "djl_read_kanban_card",
  "djl_create_kanban_task",
  "djl_create_kanban_draft",
  "djl_move_kanban_card",
  "djl_update_kanban_card",
  "djl_set_kanban_goal",
  "djl_delete_kanban_card",
  // To-do tools (todoTools.ts)
  "djl_create_todo",
  "djl_list_todos",
  "djl_update_todo",
  // Inline visuals (inlineVisualTools.ts; available in Stable and Beta)
  "djl_show_visual",
  // Thread write tools (Layers/AgentGateway.ts)
  "djl_create_threads",
  "djl_create_thread",
  "djl_send_message",
  "djl_interrupt_thread",
  "djl_set_thread_title",
  "djl_set_thread_pull_request",
  "djl_set_thread_archived",
  "djl_set_thread_goal",
  // Thread diagnostics (threadDiagnosticTools.ts)
  "djl_read_thread_activity",
  "djl_diagnose_thread",
  "djl_read_thread_events",
  "djl_read_thread_runtime_events",
  // Automations (automationTools.ts)
  "djl_create_automation",
  "djl_list_automations",
  "djl_view_automation",
  "djl_update_automation",
  "djl_update_automation_memory",
  "djl_cancel_automation",
  "djl_report_automation_result",
  // Project agent tools (projectAgentTools.ts)
  "djl_project_context",
  "djl_project_forget",
  "djl_project_get_overview",
  "djl_project_library_add",
  "djl_project_library_list",
  "djl_project_link_repository",
  "djl_project_list_tasks",
  "djl_project_list_threads",
  "djl_project_read_document",
  "djl_project_remember",
  "djl_project_report_result",
  "djl_project_write_document",
  // Browser review tool (browserTools.ts)
  "djl_e2e_review",
  // Capability-gated device tools (deviceTools.ts — not in contracts)
  "device_boot",
  "device_configure",
  "device_describe_ui",
  "device_install",
  "device_launch",
  "device_list",
  "device_logs",
  "device_open_url",
  "device_press_button",
  "device_screenshot",
  "device_scroll_to_element",
  "device_swipe",
  "device_tap",
  "device_type",
  "device_wait",
] as const;

/** Every tool name the agent gateway serves, from the shared catalogs. */
const DJL_GATEWAY_TOOL_NAME_SET: ReadonlySet<string> = new Set<string>([
  ...DJL_GATEWAY_OWNED_TOOL_NAMES,
  ...DJL_COMPUTER_TOOL_NAMES,
  ...BROWSER_TOOL_NAMES,
]);

const DJL_MCP_QUALIFIED_PREFIX = "mcp__djl__";
const DJL_MCP_SERVER_PREFIX = "djl_";

/**
 * Any tool DJL's agent gateway serves under its reserved MCP server name —
 * the whole gateway catalog (thread, project, automation, diagnostics,
 * computer, browser, device). The session token is what authorizes each call
 * server-side, so providers that were granted the gateway may let these names
 * skip their own interactive permission prompt when the start input opts in
 * (`ProviderSessionStartInput.autoApproveDjlTools`).
 *
 * Providers report MCP calls two ways, and both must pin the server identity:
 * Claude-style `mcp__djl__<tool>` matches on the exact `mcp__djl__`
 * prefix (a `djl_fs` server produces `mcp__djl_fs__*`, which fails it);
 * `<server>_<tool>` reports like OpenCode's `djl_computer_click` match only
 * when the name — or the part after the `djl_` server prefix — is in the
 * served catalog. A bare `djl_*` catalog name (`djl_list_threads`) also
 * matches because the name itself carries the namespace; capability families
 * (`computer_*`, `browser_*`, `device_*`) must arrive server-qualified.
 * Everything else keeps the ordinary permission path.
 */
export function isDjlGatewayToolName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith(DJL_MCP_QUALIFIED_PREFIX)) {
    // The `mcp__djl__` prefix pins the server, not the tool — only a real
    // catalog name after the prefix may take the auto-approve path, so a
    // look-alike tool name on the same server cannot ride it.
    return DJL_GATEWAY_TOOL_NAME_SET.has(normalized.slice(DJL_MCP_QUALIFIED_PREFIX.length));
  }
  if (DJL_GATEWAY_TOOL_NAME_SET.has(normalized)) {
    return normalized.startsWith(DJL_MCP_SERVER_PREFIX);
  }
  return (
    normalized.startsWith(DJL_MCP_SERVER_PREFIX) &&
    DJL_GATEWAY_TOOL_NAME_SET.has(normalized.slice(DJL_MCP_SERVER_PREFIX.length))
  );
}

/**
 * Namespace-insensitive matcher across the fields a provider permission
 * prompt may report a tool name through — the direct name, or a tool-name
 * field nested in raw input / metadata the way some adapters deliver MCP
 * calls. The display `title` is deliberately not consulted: it is
 * presentational text the provider composes, so it can look like a gateway
 * name without one ever being called.
 */
export function isDjlGatewayToolCall(input: {
  readonly name?: unknown;
  // Accepted for call-site shape compatibility but never consulted.
  readonly title?: unknown;
  readonly rawInput?: unknown;
  readonly metadata?: unknown;
}): boolean {
  const explicitName = typeof input.name === "string" ? input.name : undefined;
  if (explicitName !== undefined) return isDjlGatewayToolName(explicitName);

  const rawToolName = firstRecordString(input.rawInput, ["_toolName", "toolName", "tool_name"]);
  if (rawToolName !== undefined) return isDjlGatewayToolName(rawToolName);

  const metadataToolName = firstRecordString(input.metadata, [
    "_toolName",
    "toolName",
    "tool_name",
  ]);
  if (metadataToolName !== undefined) return isDjlGatewayToolName(metadataToolName);

  return false;
}

/**
 * Provider permission prompts are redundant for an active DJL Computer
 * capability: the gateway performs the authoritative task-scoped approval.
 * Plan mode and requests outside an active turn remain fail-closed.
 */
export function shouldAllowDjlComputerProviderTool(input: {
  readonly computerControlEnabled: boolean;
  readonly activeTurn: boolean;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly permission: Parameters<typeof computerToolNameFromProviderPermission>[0];
}): boolean {
  return (
    input.computerControlEnabled &&
    input.activeTurn &&
    input.runtimeMode === "approval-required" &&
    input.interactionMode === "default" &&
    computerToolNameFromProviderPermission(input.permission) !== undefined
  );
}
