// FILE: CloudHomeView.swift
// Purpose: Signed-in home: searchable, date-grouped conversation list with pin/rename/archive/delete, new chat,
//          account, and the "My Macs" section.
// Layer: View
// Exports: CloudHomeView
// Depends on: CloudService, CloudChatView, CloudAccountView, CloudConversationGrouping

import SwiftUI

struct CloudHomeView: View {
    private enum Route: Hashable {
        case chat(CloudConversation?)
    }

    @Environment(CloudService.self) private var cloud
    @Environment(\.scenePhase) private var scenePhase
    @State private var path: [Route] = []
    @State private var query = ""
    @State private var searchResults: [CloudConversationSearchHit] = []
    @State private var isShowingAccount = false
    @State private var renameState = ThreadRenamePromptState()
    @State private var renaming: CloudConversation?
    @State private var pendingDelete: CloudConversation?

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle("DJL")
                .searchable(text: $query, prompt: "Search chats")
                .toolbar { toolbar }
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .chat(let conversation):
                        CloudChatView(conversation: conversation)
                    }
                }
                .refreshable { await cloud.refreshAll() }
        }
        .task { await cloud.refreshAll() }
        .task(id: query) { await runSearch() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await cloud.refreshConversations() } }
        }
        .onChange(of: cloud.pendingConversationID, initial: true) { _, id in openPendingConversation(id) }
        .sheet(isPresented: $isShowingAccount) {
            CloudAccountView()
        }
        .threadRenamePrompt(state: $renameState) { title in
            guard let renaming else { return }
            Task { await cloud.rename(renaming, to: title) }
        }
        .confirmationDialog("Delete this chat?", isPresented: isConfirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let pendingDelete { Task { await cloud.delete(pendingDelete) } }
            }
        } message: {
            Text("It will be removed from all your devices.")
        }
    }

    // MARK: List

    @ViewBuilder
    private var list: some View {
        List {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section {
                    shortcutRow(title: "New chat", systemImage: "square.and.pencil") { path.append(.chat(nil)) }
                    shortcutRow(title: "My Macs", systemImage: "laptopcomputer") { cloud.sectionPreference = .myMacs }
                }
                ForEach(CloudConversationGrouping.groups(cloud.conversations)) { group in
                    Section(group.title) {
                        ForEach(group.conversations) { conversation in
                            row(conversation)
                        }
                    }
                }
            } else {
                ForEach(searchResults) { hit in
                    NavigationLink(value: Route.chat(hit.conversation)) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(hit.conversation.displayTitle).font(AppFont.body(weight: .medium)).lineLimit(1)
                            Text(hit.snippet).font(AppFont.footnote()).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if cloud.conversations.isEmpty, !cloud.isLoadingConversations, query.isEmpty {
                ContentUnavailableView {
                    Label("No chats yet", systemImage: "bubble.left.and.text.bubble.right")
                } description: {
                    Text("Start a chat. It will show up on the web and your other devices too.")
                } actions: {
                    Button("New chat") { path.append(.chat(nil)) }
                        .buttonStyle(.borderedProminent)
                }
                .padding(.top, 120)
            }
        }
    }

    private func shortcutRow(title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(AppFont.body(weight: .medium))
        }
        .tint(.primary)
    }

    private func row(_ conversation: CloudConversation) -> some View {
        NavigationLink(value: Route.chat(conversation)) {
            HStack(spacing: 8) {
                Text(conversation.displayTitle)
                    .font(AppFont.body())
                    .lineLimit(1)
                if conversation.pinned {
                    Spacer(minLength: 4)
                    Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { pendingDelete = conversation } label: { Label("Delete", systemImage: "trash") }
            Button { Task { await cloud.archive(conversation) } } label: { Label("Archive", systemImage: "archivebox") }
                .tint(.indigo)
        }
        .swipeActions(edge: .leading) {
            Button { Task { await cloud.togglePin(conversation) } } label: {
                Label(conversation.pinned ? "Unpin" : "Pin", systemImage: conversation.pinned ? "pin.slash" : "pin")
            }
            .tint(.orange)
        }
        .contextMenu {
            Button { Task { await cloud.togglePin(conversation) } } label: {
                Label(conversation.pinned ? "Unpin" : "Pin", systemImage: "pin")
            }
            Button {
                renaming = conversation
                renameState.present(currentTitle: conversation.displayTitle)
            } label: { Label("Rename", systemImage: "pencil") }
            Button { Task { await cloud.archive(conversation) } } label: { Label("Archive", systemImage: "archivebox") }
            Button(role: .destructive) { pendingDelete = conversation } label: { Label("Delete", systemImage: "trash") }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button { isShowingAccount = true } label: {
                Image(systemName: "person.crop.circle")
            }
            .accessibilityLabel("Account")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { path.append(.chat(nil)) } label: {
                Image(systemName: "square.and.pencil")
            }
            .accessibilityLabel("New chat")
        }
    }

    // MARK: Helpers

    private func runSearch() async {
        let text = query
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            searchResults = []
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        searchResults = await cloud.search(text)
    }

    private func openPendingConversation(_ id: String?) {
        guard let id else { return }
        let target = cloud.conversations.first { $0.id == id }
            ?? CloudConversation(id: id, title: nil, pinned: false, archived: false, createdAt: "", updatedAt: "")
        cloud.pendingConversationID = nil
        path = [.chat(target)]
    }

    private var isConfirmingDelete: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }
}
