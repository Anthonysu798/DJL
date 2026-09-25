import SwiftUI

// A metadata-only list. Terminal history streams only after the user opens a pane.
struct SidebarWorkspaceList: View {
    let terminals: [DesktopWorkspaceTerminal]
    let searchText: String
    let isConnected: Bool
    let onOpen: (DesktopWorkspaceTerminal) -> Void

    private var filtered: [DesktopWorkspaceTerminal] {
        terminals.filter { searchText.isEmpty || "\($0.label) \($0.cwd)".localizedCaseInsensitiveContains(searchText) }
    }
    private var groups: [String] { Array(Set(filtered.map(\.threadId))).sorted() }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                if filtered.isEmpty {
                    ContentUnavailableView {
                        Label("No workspace terminals", systemImage: "rectangle.split.2x2")
                    } description: {
                        Text(isConnected ? "Open a terminal in DJL Workspaces on your computer. It will appear here automatically." : "Connect to your computer to see its workspaces.")
                    }
                } else {
                    ForEach(groups, id: \.self) { id in
                        let panes = filtered.filter { $0.threadId == id }
                        if let first = panes.first {
                            VStack(alignment: .leading, spacing: 9) {
                                Label(first.workspaceName ?? (first.cwd as NSString).lastPathComponent, systemImage: "rectangle.split.2x2")
                                    .font(AppFont.callout(weight: .semibold))
                                    .padding(.horizontal, 4)
                                Text(first.cwd).font(AppFont.caption()).foregroundStyle(.secondary)
                                    .lineLimit(1).truncationMode(.middle).padding(.horizontal, 4)
                                VStack(spacing: 0) {
                                    ForEach(Array(panes.enumerated()), id: \.element.id) { index, pane in
                                        Button { onOpen(pane) } label: {
                                            HStack(spacing: 12) {
                                                Image(systemName: "terminal").font(.system(size: 18))
                                                VStack(alignment: .leading, spacing: 4) {
                                                    Text("Terminal \(index + 1)").font(AppFont.callout(weight: .medium))
                                                    Text(pane.status == "running" ? "Live on your computer" : pane.status.capitalized).font(AppFont.caption()).foregroundStyle(.secondary)
                                                }
                                                Spacer(minLength: 0)
                                                Circle().fill(pane.status == "running" ? Color.green : Color.secondary).frame(width: 6, height: 6)
                                                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(.tertiary)
                                            }.foregroundStyle(.primary).padding(15).contentShape(Rectangle())
                                        }.buttonStyle(.plain).disabled(!isConnected)
                                        .accessibilityLabel("Open \(first.workspaceName ?? (first.cwd as NSString).lastPathComponent), terminal \(index + 1)")
                                        if index < panes.count - 1 { Divider().padding(.leading, 45) }
                                    }
                                }
                                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
                            }
                        }
                    }
                }
            }.padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 24)
        }
    }
}
