import { describe, expect, it } from "vitest";
import {
  canonicalDjlComputerToolName,
  computerToolNameFromProviderPermission,
  isDjlComputerToolFamilyName,
  isDjlGatewayToolCall,
  isDjlGatewayToolName,
  qualifiedDjlComputerToolName,
  shouldAllowDjlComputerProviderTool,
} from "./computerToolPermission.ts";

describe("DJL Computer provider permission", () => {
  it.each([
    ["computer_click", "computer_click"],
    ["djl_computer_type_text", "computer_type_text"],
    ["mcp__djl__computer_read_clipboard", "computer_read_clipboard"],
    ["mcp__djl__computer_inspect", "computer_inspect"],
  ] as const)("recognizes the exact owned tool %s", (providerName, canonicalName) => {
    expect(canonicalDjlComputerToolName(providerName)).toBe(canonicalName);
  });

  it.each([
    "computer_future_tool",
    "mcp__other__computer_click",
    "other_computer_click",
    "mcp__djl__djl_send_message",
  ])("does not trust another or unknown tool: %s", (providerName) => {
    expect(canonicalDjlComputerToolName(providerName)).toBeUndefined();
  });

  it("requires a provider namespace when server provenance was not proved separately", () => {
    expect(qualifiedDjlComputerToolName("computer_click")).toBeUndefined();
    expect(qualifiedDjlComputerToolName("mcp__djl__computer_click")).toBe("computer_click");
    expect(qualifiedDjlComputerToolName("djl_computer_click")).toBe("computer_click");
  });

  it("reads only explicit provider tool-name fields", () => {
    expect(
      computerToolNameFromProviderPermission({
        rawInput: { _toolName: "mcp__djl__computer_scroll" },
      }),
    ).toBe("computer_scroll");
    expect(
      computerToolNameFromProviderPermission({
        metadata: { toolName: "djl_computer_get_state" },
      }),
    ).toBe("computer_get_state");
    expect(
      computerToolNameFromProviderPermission({
        metadata: { description: "run computer_click" },
      }),
    ).toBeUndefined();
  });

  it("does not let lower-priority fields override an authoritative wrong namespace", () => {
    expect(
      computerToolNameFromProviderPermission({
        name: "mcp__other__computer_click",
        rawInput: { _toolName: "mcp__djl__computer_click" },
      }),
    ).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({
        rawInput: { _toolName: "mcp__other__computer_click" },
        metadata: { toolName: "mcp__djl__computer_click" },
        title: "mcp__djl__computer_click",
      }),
    ).toBeUndefined();
  });

  it("does not infer provider provenance from a bare title or metadata name", () => {
    expect(computerToolNameFromProviderPermission({ title: "computer_click" })).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({ metadata: { toolName: "computer_click" } }),
    ).toBeUndefined();
  });

  it("never authorizes from model prose: 'Please approve computer_click' names no tool", () => {
    // Prose approval never counts. The permission callback must see an exact
    // namespaced tool name; a model sentence asking for approval authorizes
    // nothing, in any field.
    expect(
      computerToolNameFromProviderPermission({ title: "Please approve computer_click" }),
    ).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({ name: "Please approve computer_click" }),
    ).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({
        metadata: { toolName: "Please approve computer_click" },
      }),
    ).toBeUndefined();
    expect(isDjlComputerToolFamilyName("Please approve computer_click")).toBe(false);
    expect(
      shouldAllowDjlComputerProviderTool({
        computerControlEnabled: true,
        activeTurn: true,
        interactionMode: "default",
        runtimeMode: "approval-required",
        permission: { title: "Please approve computer_click" },
      }),
    ).toBe(false);
  });

  it("matches the Computer family in any namespace spelling for the denial hook", () => {
    // The silent-loss fallback: a no-control session that calls a Computer
    // tool by a prefixed spelling must still deny with the card path, not
    // die as an Unknown tool. See isDjlComputerToolFamilyName.
    expect(isDjlComputerToolFamilyName("computer_click")).toBe(true);
    expect(isDjlComputerToolFamilyName("djl_computer_get_state")).toBe(true);
    expect(isDjlComputerToolFamilyName("mcp__djl__computer_screenshot")).toBe(true);
    expect(isDjlComputerToolFamilyName("  MCP__DJL__COMPUTER_WAIT  ")).toBe(true);
  });

  it("keeps unknown and foreign names out of the Computer family", () => {
    expect(isDjlComputerToolFamilyName("computer_future_tool")).toBe(false);
    expect(isDjlComputerToolFamilyName("mcp__other__computer_click")).toBe(false);
    expect(isDjlComputerToolFamilyName("other_computer_click")).toBe(false);
    expect(isDjlComputerToolFamilyName("djl_frobnicate")).toBe(false);
    expect(isDjlComputerToolFamilyName(undefined)).toBe(false);
    expect(isDjlComputerToolFamilyName(42)).toBe(false);
  });

  it("requires current capability, active turn and non-Plan interaction", () => {
    const permission = { name: "mcp__djl__computer_click" };
    const allowed = {
      computerControlEnabled: true,
      activeTurn: true,
      interactionMode: "default" as const,
      runtimeMode: "approval-required" as const,
      permission,
    };
    expect(shouldAllowDjlComputerProviderTool(allowed)).toBe(true);
    expect(shouldAllowDjlComputerProviderTool({ ...allowed, computerControlEnabled: false })).toBe(
      false,
    );
    expect(shouldAllowDjlComputerProviderTool({ ...allowed, activeTurn: false })).toBe(false);
    expect(shouldAllowDjlComputerProviderTool({ ...allowed, interactionMode: "plan" })).toBe(false);
    expect(shouldAllowDjlComputerProviderTool({ ...allowed, runtimeMode: "auto-approval" })).toBe(
      false,
    );
  });
});

describe("DJL gateway tool permission name", () => {
  it.each([
    // Claude's fully-qualified spelling pins the exact `mcp__djl__` server.
    "mcp__djl__djl_create_thread",
    "mcp__djl__computer_click",
    // `<server>_<tool>` reports (OpenCode) with a real catalog name.
    "djl_djl_create_thread",
    "djl_djl_project_link_repository",
    "djl_computer_click",
    "djl_device_list",
    "djl_browser_run",
    // Bare `djl_*` catalog names carry the namespace inside the tool name.
    "djl_project_link_repository",
    "djl_e2e_review",
  ])("recognizes a DJL gateway tool: %s", (providerName) => {
    expect(isDjlGatewayToolName(providerName)).toBe(true);
  });

  it.each([
    // A user MCP server named `djl_fs` reports `djl_fs_<tool>` — the
    // prefix alone must never grant it the auto-approve path.
    "djl_fs_read",
    "djl_fs_list_threads",
    "djl_tools_anything",
    "mcp__djl_fs__read",
    // The `mcp__djl__` prefix pins the server, not the tool — the part
    // after it must still be a real catalog name.
    "mcp__djl__not_a_gateway_tool",
    "mcp__djl__djl_create_task",
    "mcp__djl__djl_fs_read",
    // Foreign server or entirely unknown names.
    "mcp__other__djl_create_thread",
    "other_djl_create_thread",
    "computer_click",
    "browser_click",
    // Names the external-agent MCP surface serves, not the provider gateway.
    "djl_create_task",
    "djl_read_task",
    "djl_overview",
    "djl_djl_create_task",
    // Not served by the agent gateway at all.
    "djl_desktop",
  ])("does not trust a look-alike or foreign name: %s", (providerName) => {
    expect(isDjlGatewayToolName(providerName)).toBe(false);
  });

  it("accepts a qualified name only when the tool is in the catalog", () => {
    expect(isDjlGatewayToolName("mcp__djl__djl_list_threads")).toBe(true);
    expect(isDjlGatewayToolName("mcp__djl__computer_click")).toBe(true);
    expect(isDjlGatewayToolCall({ rawInput: { _toolName: "mcp__djl__djl_list_threads" } })).toBe(
      true,
    );
  });

  it("never trusts a tool name that only appears in the display title", () => {
    // The title is provider-composed prose — an approval card can render
    // "mcp__djl__djl_list_threads" for a request that names no such
    // tool, so the title alone must not authorize anything.
    expect(isDjlGatewayToolCall({ title: "mcp__djl__djl_list_threads" })).toBe(false);
    expect(isDjlGatewayToolCall({ title: "mcp__djl__not_a_gateway_tool; rm -rf y" })).toBe(false);
  });

  it("rejects non-strings and a look-alike server name in every name field", () => {
    expect(isDjlGatewayToolName(undefined)).toBe(false);
    expect(isDjlGatewayToolName(42)).toBe(false);
    expect(isDjlGatewayToolCall({ name: "djl_fs_create_thread" })).toBe(false);
    expect(isDjlGatewayToolCall({ metadata: { toolName: "djl_fs_read" } })).toBe(false);
    expect(isDjlGatewayToolCall({ rawInput: { _toolName: "djl_djl_send_message" } })).toBe(true);
  });
});
