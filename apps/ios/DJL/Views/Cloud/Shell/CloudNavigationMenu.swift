import SwiftUI

struct CloudNavigationMenu: View {
    @Environment(CloudService.self) private var cloud
    @State private var query = ""
    @State private var searching = false
    @State private var results: [CloudConversationSearchHit] = []
    @State private var renameTarget: CloudConversation?
    @State private var renameText = ""
    @State private var deleteTarget: CloudConversation?

    private var history: [CloudConversation] {
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? cloud.conversations : results.map(\.conversation)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 4) {
                if searching {
                    TextField("Search chats", text: $query)
                        .textInputAutocapitalization(.never)
                        .padding(14)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
                }
                action("Chat", icon: "bubble.left.and.bubble.right") { cloud.navigation.destination = .chat; cloud.navigation.isMenuOpen = false }
                action("Images", icon: "photo.on.rectangle") { cloud.navigation.destination = .images; cloud.navigation.isMenuOpen = false }
                action("Remote", icon: "laptopcomputer") { cloud.navigation.isMenuOpen = false; cloud.sectionPreference = .myMacs }
                Button { cloud.navigation.destination = .notifications; cloud.navigation.isMenuOpen = false } label: {
                    HStack {
                        Label("Notifications", systemImage: "bell")
                        Spacer()
                        if cloud.notifications.unreadCount > 0 { Text("\(cloud.notifications.unreadCount)").font(AppFont.footnote()).foregroundStyle(.secondary) }
                    }
                    .font(AppFont.body(weight: .medium)).padding(.horizontal, 14).frame(minHeight: 50)
                }
                section("Pinned", rows: history.filter(\.pinned))
                section("Recent chats", rows: history.filter { !$0.pinned })
                if cloud.nextConversationCursor != nil, query.isEmpty {
                    Button { Task { await cloud.loadMoreConversations() } } label: {
                        HStack { if cloud.isLoadingConversations { ProgressView() }; Text("Load more") }
                            .font(AppFont.subheadline()).padding(14)
                    }.disabled(cloud.isLoadingConversations)
                }
                if let error = cloud.lastError {
                    Text(error).font(AppFont.footnote()).foregroundStyle(.secondary).padding(14)
                    Button("Retry") { Task { await cloud.refreshAll() } }.padding(.horizontal, 14)
                }
            }
            .padding(.horizontal, 10).padding(.top, 86).padding(.bottom, 124)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .top) {
            AdaptiveGlassContainer(spacing: 16) {
                HStack {
                    HStack(spacing: 8) {
                        Image("AppLogo").resizable().scaledToFit().frame(width: 26, height: 26)
                        Text("DJL").font(AppFont.title3(weight: .semibold))
                    }
                    .padding(.horizontal, 14).frame(height: 48)
                    .adaptiveGlass(.regular, in: Capsule())
                    Spacer(minLength: 8)
                    Button { searching.toggle(); if !searching { query = "" } } label: {
                        Image(systemName: "magnifyingglass").font(.system(size: 20)).frame(width: 48, height: 48)
                    }
                    .adaptiveGlass(.regular, isInteractive: true, in: Circle())
                    .accessibilityLabel("Search chats")
                }.padding(.horizontal, 16).padding(.top, 12)
            }
        }
        .overlay(alignment: .bottom) {
            AdaptiveGlassContainer(spacing: 16) {
                HStack {
                    Button { cloud.navigation.newChat() } label: {
                        Label("Chat", systemImage: "square.and.pencil")
                            .font(AppFont.body(weight: .semibold)).padding(.horizontal, 20).frame(height: 50)
                            .foregroundStyle(Color(.systemBackground))
                    }
                    .adaptiveGlass(.regular, isInteractive: true, tint: .primary, in: Capsule())
                    .accessibilityLabel("New chat")
                    Spacer(minLength: 8)
                    Button { cloud.navigation.destination = .settings; cloud.navigation.isMenuOpen = false } label: {
                        Image(systemName: "gearshape").font(.system(size: 22)).frame(width: 50, height: 50)
                    }
                    .adaptiveGlass(.regular, isInteractive: true, in: Circle())
                    .accessibilityLabel("Settings")
                    .accessibilityIdentifier("cloud.navigation.settings")
                }.padding(.horizontal, 18).padding(.bottom, 16)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .task(id: query) {
            guard !query.isEmpty else { results = []; return }
            do { try await Task.sleep(for: .milliseconds(250)); try Task.checkCancellation() }
            catch { return }
            let found = await cloud.search(query)
            guard !Task.isCancelled else { return }
            results = found
        }
        .alert("Rename chat", isPresented: Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })) {
            TextField("Title", text: $renameText)
            Button("Save") { if let target = renameTarget { Task { await cloud.rename(target, to: renameText) } }; renameTarget = nil }
            Button("Cancel", role: .cancel) { renameTarget = nil }
        }
        .confirmationDialog("Delete this chat?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })) {
            Button("Delete", role: .destructive) {
                guard let target = deleteTarget else { return }
                if cloud.navigation.selectedConversationID == target.id { cloud.navigation.newChat() }
                Task { await cloud.delete(target) }; deleteTarget = nil
            }
        }
    }

    private func action(_ title: String, icon: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Label(title, systemImage: icon).font(AppFont.body(weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).frame(minHeight: 50)
        }
    }

    @ViewBuilder
    private func section(_ title: String, rows: [CloudConversation]) -> some View {
        Text(title).font(AppFont.footnote(weight: .semibold)).foregroundStyle(.secondary)
            .padding(.horizontal, 14).padding(.top, 24).padding(.bottom, 8)
        if rows.isEmpty {
            Text(title == "Pinned" ? "Touch and hold a chat to pin it." : "Your conversations appear here.")
                .font(AppFont.subheadline()).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.vertical, 8)
        }
        ForEach(rows) { conversation in
            Button { cloud.navigation.openConversation(conversation.id) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "bubble.left").frame(width: 24)
                    Text(conversation.displayTitle).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .font(AppFont.body()).padding(.horizontal, 14).frame(minHeight: 50)
                .background(cloud.navigation.selectedConversationID == conversation.id ? Color.primary.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 16))
            }
            .accessibilityHint("Cloud conversation")
            .contextMenu {
                Button(conversation.pinned ? "Unpin" : "Pin", systemImage: "pin") { Task { await cloud.togglePin(conversation) } }
                Button("Rename", systemImage: "pencil") { renameText = conversation.displayTitle; renameTarget = conversation }
                Button("Archive", systemImage: "archivebox") {
                    if cloud.navigation.selectedConversationID == conversation.id { cloud.navigation.newChat() }
                    Task { await cloud.archive(conversation) }
                }
                Button("Delete", systemImage: "trash", role: .destructive) { deleteTarget = conversation }
            }
        }
    }
}
