// FILE: CloudChatView.swift
// Purpose: One cloud conversation: streaming timeline, composer, model picker, task steps, usage banner,
//          share link, and the full-screen image preview with "Edit image".
// Layer: View
// Exports: CloudChatView
// Depends on: CloudChatSession, CloudMessageRow, CloudComposerView, ZoomableImagePreviewScreen

import SwiftUI

struct CloudChatView: View {
    @Environment(CloudService.self) private var cloud
    let conversation: CloudConversation?
    @State private var session: CloudChatSession?

    var body: some View {
        Group {
            if let session {
                CloudChatContent(session: session)
            } else {
                Color(.systemBackground)
            }
        }
        .onAppear {
            if session == nil { session = CloudChatSession(cloud: cloud, conversation: conversation) }
        }
    }
}

private struct CloudChatContent: View {
    @Environment(CloudService.self) private var cloud
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var session: CloudChatSession
    @State private var draft = ""
    @State private var attachments: [CloudPendingAttachment] = []
    @State private var preview: PreviewImagePayload?
    @State private var previewPart: CloudMessagePart?
    @State private var editing: CloudMessage?
    @State private var shareURL: URL?
    @State private var isCreatingShare = false
    @State private var loadedScope: String?
    @State private var loadedDraftKey = "new"
    @State private var displayed = true
    @State private var atBottom = true

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(session.visibleMessages) { message in
                        CloudMessageRow(
                            message: message,
                            isStreaming: session.isRunning && message.id == session.run?.messageId,
                            siblings: session.siblings(of: message),
                            onOpenImage: openPreview,
                            onEdit: { editing = message },
                            onRegenerate: { Task { await session.regenerate(message) } },
                            onSwitchBranch: { session.selectSibling(of: message, offset: $0) }
                        )
                        .id(message.id)
                    }
                    if !session.steps.isEmpty {
                        CloudTaskStepsView(steps: session.steps, isRunning: session.isRunning)
                    }
                    Color.clear.frame(height: 1).id(bottomID)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .overlay {
                if session.visibleMessages.isEmpty, !session.isLoading { emptyState }
                else if session.isLoading { ProgressView() }
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.visibleRect.maxY >= geometry.contentSize.height - 60
            } action: { _, nearBottom in atBottom = nearBottom }
            .onChange(of: session.visibleMessages.last?.text.count) { _, _ in
                if atBottom { proxy.scrollTo(bottomID, anchor: .bottom) }
            }
            .onChange(of: session.visibleMessages.count) { _, _ in
                if atBottom { proxy.scrollTo(bottomID, anchor: .bottom) }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if let resetsAt = session.usageBlockedUntil {
                    CloudUsageBanner(resetsAt: resetsAt) { Task { await session.retryAfterReset() } }
                }
                if let error = session.errorMessage {
                    errorBanner(error)
                }
                CloudComposerView(
                    text: $draft,
                    attachments: $attachments,
                    session: session,
                    onSend: send
                )
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        }
        .navigationTitle(session.conversation?.displayTitle ?? "New chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { CloudModelPicker().disabled(session.isSending) }
            ToolbarItem(placement: .topBarTrailing) { shareButton }
        }
        .task { await session.load() }
        .onChange(of: scenePhase) { _, phase in
            // iOS suspends sockets in the background; reattach from the last seq when we come back.
            if phase == .background { session.suspendStreaming() }
            if phase == .active { session.startStreaming() }
        }
        .onDisappear { displayed = false; cloud.notifications.clearActiveConversation(session.conversation?.id); session.suspendStreaming() }
        .onAppear { displayed = true; loadDraft(); cloud.notifications.setActiveConversation(session.conversation?.id) }
        .onChange(of: cloud.accountScopeKey, initial: true) { _, _ in loadDraft() }
        .onChange(of: draft) { _, value in
            guard displayed, session.isCurrentSession, let scope = loadedScope, scope == cloud.accountScopeKey else { return }
            cloud.drafts.save(value, accountID: scope, conversationID: loadedDraftKey)
        }
        .onChange(of: session.conversation?.id) { old, id in
            guard displayed, session.isCurrentSession, let id else { return }
            if old == nil, let scope = loadedScope {
                cloud.drafts.save(draft, accountID: scope, conversationID: id)
                cloud.drafts.save("", accountID: scope, conversationID: "new")
                loadedDraftKey = id
            }
            cloud.navigation.acknowledgeCreatedConversation(id)
            cloud.notifications.setActiveConversation(id)
        }
        .fullScreenCover(item: $preview) { payload in
            imagePreview(payload)
        }
        .sheet(item: $editing) { message in
            CloudEditMessageSheet(original: message.text) { newText in
                Task { await session.edit(message, newText: newText) }
            }
        }
        .sheet(item: shareItem) { item in
            CloudShareLinkSheet(url: item.url)
                .presentationDetents([.medium])
        }
        .onAppear(perform: openDebugPreviewIfRequested)
    }

    private let bottomID = "cloud-chat-bottom"

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image("AppLogo")
                .resizable()
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            Text(session.mode == .task ? "What should DJL work on?" : "How can I help?")
                .font(AppFont.title3(weight: .semibold))
            if session.mode == .task {
                Text("Start a task and return to the result when it's ready.")
                    .font(AppFont.subheadline())
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(message).font(AppFont.footnote()).lineLimit(3)
            Spacer(minLength: 0)
            if session.canRetry {
                Button("Retry") {
                    Task {
                        if await session.retryLastSend(), session.isCurrentSession { draft = ""; attachments = [] }
                    }
                }.disabled(session.isSending)
            }
            Button { session.errorMessage = nil } label: { Image(systemName: "xmark").font(.footnote.weight(.semibold)) }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private var shareButton: some View {
        if session.conversation != nil, !session.visibleMessages.isEmpty {
            Button {
                isCreatingShare = true
                Task {
                    shareURL = await session.createShareLink()
                    isCreatingShare = false
                }
            } label: {
                if isCreatingShare { ProgressView() } else { Image(systemName: "square.and.arrow.up") }
            }
            .accessibilityLabel("Share link")
            .disabled(isCreatingShare)
        }
    }

    private struct ShareItem: Identifiable {
        let url: URL
        var id: String { url.absoluteString }
    }

    private var shareItem: Binding<ShareItem?> {
        Binding(get: { shareURL.map(ShareItem.init) }, set: { shareURL = $0?.url })
    }

    private func imagePreview(_ payload: PreviewImagePayload) -> some View {
        ZStack(alignment: .bottom) {
            ZoomableImagePreviewScreen(payload: payload) { preview = nil }
            if cloud.clientConfig?.tools.imageEditing == true {
            Button {
                session.imageToEdit = previewPart
                preview = nil
            } label: {
                Label("Edit image", systemImage: "wand.and.stars")
                    .font(AppFont.body(weight: .semibold))
                    .padding(.horizontal, 22)
                    .frame(height: 48)
                    .adaptiveGlass(.regular, in: Capsule())
            }
            .buttonStyle(.plain)
            .padding(.bottom, 24)
            }
        }
    }

    private func openPreview(_ part: CloudMessagePart, _ image: UIImage) {
        previewPart = part
        preview = PreviewImagePayload(image: image, title: session.conversation?.displayTitle)
    }

    private func send() {
        let text = draft
        let files = attachments
        Task {
            if await session.send(text: text, attachments: files), session.isCurrentSession { draft = ""; attachments = [] }
        }
    }

    private func loadDraft() {
        guard session.isCurrentSession, let scope = cloud.accountScopeKey else { return }
        guard loadedScope != scope else { return }
        loadedScope = scope
        loadedDraftKey = session.conversation?.id ?? "new"
        draft = cloud.drafts.draft(accountID: scope, conversationID: loadedDraftKey)
    }

    private func openDebugPreviewIfRequested() {
        #if DEBUG
        guard CloudDebugLaunch.argument(for: "image") == session.conversation?.id else { return }
        Task {
            await session.load()
            for message in session.visibleMessages {
                for part in message.parts {
                    if case .imageRef(let fileId, _, _, _) = part, let image = await cloud.image(fileId: fileId) {
                        openPreview(part, image)
                        return
                    }
                }
            }
        }
        #endif
    }
}

private struct CloudEditMessageSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    let onSave: (String) -> Void

    init(original: String, onSave: @escaping (String) -> Void) {
        _text = State(initialValue: original)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(AppFont.body())
                .padding(.horizontal, 12)
                .navigationTitle("Edit message")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Send") {
                            onSave(text)
                            dismiss()
                        }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct CloudShareLinkSheet: View {
    let url: URL
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Share link created")
                .font(AppFont.title3(weight: .semibold))
            Text("Anyone with the link can read this chat as it is now. Messages you send later aren't shared.")
                .font(AppFont.subheadline())
                .foregroundStyle(.secondary)
            Text(url.absoluteString)
                .font(AppFont.mono(.footnote))
                .lineLimit(2)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            HStack(spacing: 12) {
                Button {
                    UIPasteboard.general.url = url
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                ShareLink(item: url) {
                    Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            .controlSize(.large)
        }
        .padding(24)
    }
}
