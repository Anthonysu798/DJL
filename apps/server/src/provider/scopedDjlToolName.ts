/** OpenCode scopes MCP tools by server name; MultiPost is a separate endpoint. */
export function scopedDjlToolName(
  tool: string,
  work: string | null,
  multipost: string | undefined,
) {
  const server = tool.startsWith("djl_multipost_") ? multipost : work;
  return server && (tool.startsWith("djl_") || tool.startsWith("computer_"))
    ? `${server}_${tool}`
    : tool;
}
