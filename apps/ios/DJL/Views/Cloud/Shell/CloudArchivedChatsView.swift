import SwiftUI

struct CloudArchivedChatsView: View {
    @Environment(CloudService.self) private var cloud
    @State private var conversations: [CloudConversation] = []
    @State private var cursor: String?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        List {
            ForEach(conversations) { conversation in
                HStack {
                    Text(conversation.displayTitle).lineLimit(1)
                    Spacer()
                    Button("Restore") {
                        let revision = cloud.sessionRevision
                        Task {
                            do {
                                let restored = try await cloud.client.updateConversation(conversation.id, archived: false)
                                guard revision == cloud.sessionRevision else { return }
                                cloud.upsert(restored); conversations.removeAll { $0.id == restored.id }
                            } catch { self.error = error.localizedDescription }
                        }
                    }.buttonStyle(.borderless)
                }
            }
            if loading { ProgressView() }
            else if cursor != nil { Button("Load more") { Task { await load() } } }
            if let error { Text(error).foregroundStyle(.secondary); Button("Retry") { Task { await load() } } }
        }
        .overlay { if conversations.isEmpty, !loading, error == nil { ContentUnavailableView("No archived chats", systemImage: "archivebox") } }
        .navigationTitle("Archived chats")
        .task { await load() }
    }

    private func load() async {
        guard !loading else { return }
        let revision = cloud.sessionRevision
        loading = true; error = nil
        defer { loading = false }
        do {
            let page = try await cloud.client.conversations(cursor: cursor, archived: true)
            guard revision == cloud.sessionRevision else { return }
            for conversation in page.conversations where !conversations.contains(where: { $0.id == conversation.id }) { conversations.append(conversation) }
            cursor = page.nextCursor
        } catch { self.error = error.localizedDescription }
    }
}
