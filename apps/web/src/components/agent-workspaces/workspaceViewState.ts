// Renderer-lifetime navigation state; never persisted across a full app restart.
export interface WorkspaceViewState {
  scrollTop: number;
  maximized: string | null;
  focusedPane: string | null;
}
const views = new Map<string, WorkspaceViewState>();
export function getWorkspaceViewState(workspaceId: string): WorkspaceViewState {
  let view = views.get(workspaceId);
  if (!view) {
    view = { scrollTop: 0, maximized: null, focusedPane: null };
    views.set(workspaceId, view);
  }
  return view;
}
export function removeWorkspaceViewState(workspaceId: string) {
  views.delete(workspaceId);
}
