import SwiftUI

struct CloudNotificationsView: View {
    @Environment(CloudService.self) private var cloud
    @Environment(CodexService.self) private var codex

    private var remoteEntries: [MobileRemoteActivity] {
        guard let id = codex.normalizedCurrentTrustedMacDeviceId else { return [] }
        return cloud.remoteActivity.entries(macID: id)
    }

    var body: some View {
        let store = cloud.notifications
        List {
            if !store.notifications.isEmpty {
                Section("Cloud") {
                    ForEach(store.notifications) { item in
                        Button { Task { await store.open(item) } } label: {
                            HStack(spacing: 12) {
                                Circle().fill(item.readAt == nil ? Color.accentColor : .clear).frame(width: 7, height: 7)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.conversationTitle ?? "DJL task").font(AppFont.body(weight: item.readAt == nil ? .semibold : .regular))
                                    Text(item.status == "failed" ? "Task stopped" : "Task finished").font(AppFont.footnote()).foregroundStyle(.secondary)
                                    if let date = CloudDate.parse(item.finishedAt) { Text(date, style: .relative).font(AppFont.caption()).foregroundStyle(.tertiary) }
                                }
                            }
                        }.foregroundStyle(.primary)
                    }
                    if store.nextCursor != nil { Button("Load more") { Task { await store.loadMore() } } }
                }
            }
            if !remoteEntries.isEmpty {
                Section("Remote") {
                    ForEach(remoteEntries) { item in
                        Button {
                            cloud.remoteActivity.markRead(item.id)
                            codex.externalThreadOpenRequest = CodexExternalThreadOpenRequest(threadId: item.threadID, turnId: nil, itemId: nil)
                            cloud.sectionPreference = .myMacs
                        } label: {
                            HStack(spacing: 12) {
                                Circle().fill(item.readAt == nil ? Color.accentColor : .clear).frame(width: 7, height: 7)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.title).lineLimit(1)
                                    Text(item.kind == .approval ? "Needs your approval" : "Task finished").font(AppFont.footnote()).foregroundStyle(.secondary)
                                }
                            }
                        }.foregroundStyle(.primary)
                    }
                }
            }
            if let error = store.errorMessage { Text(error).foregroundStyle(.secondary); Button("Retry") { Task { await store.refresh() } } }
        }
        .overlay {
            if store.loading, store.notifications.isEmpty { ProgressView() }
            else if store.notifications.isEmpty, remoteEntries.isEmpty, store.errorMessage == nil {
                ContentUnavailableView("You're all caught up", systemImage: "bell", description: Text("Task updates and remote approvals appear here."))
            }
        }
        .navigationTitle("Notifications")
        .refreshable { await store.refresh() }
        .task { await store.refresh() }
        .toolbar {
            if store.notifications.contains(where: { $0.readAt == nil }) {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Mark read") { Task { await store.markRead(store.notifications.filter { $0.readAt == nil }.prefix(30).map(\.id)) } }
                }
            }
        }
    }
}
