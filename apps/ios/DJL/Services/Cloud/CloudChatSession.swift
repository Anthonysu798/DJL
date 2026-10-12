// FILE: CloudChatSession.swift
// Purpose: State and actions for one open cloud conversation: send, stream, stop, resume, edit, regenerate, branches.
// Layer: Service
// Exports: CloudChatSession, CloudTaskStep, CloudRunEventReducer
// Depends on: CloudService, CloudAPIClient, CloudMessageTree, CloudModels

import Foundation
import Observation

nonisolated struct CloudTaskStep: Identifiable, Equatable, Sendable {
    let id: Int
    let maxSteps: Int
    var tools: [String] = []
}

/// Pure application of run events to the message list, so streaming and replay are unit-testable.
nonisolated enum CloudRunEventReducer {
    static func apply(_ event: CloudRunEvent, to messages: inout [CloudMessage], steps: inout [CloudTaskStep]) {
        switch event.payload {
        case .textDelta(let messageId, let text):
            guard let index = messages.firstIndex(where: { $0.id == messageId }) else { return }
            if case .text(let existing)? = messages[index].parts.last {
                messages[index].parts[messages[index].parts.count - 1] = .text(existing + text)
            } else {
                messages[index].parts.append(.text(text))
            }
        case .part(let messageId, let part):
            guard let index = messages.firstIndex(where: { $0.id == messageId }) else { return }
            messages[index].parts.append(part)
            if case .toolCall(_, let name, _) = part, !steps.isEmpty {
                steps[steps.count - 1].tools.append(name)
            }
        case .stepStarted(let step, let maxSteps):
            if !steps.contains(where: { $0.id == step }) {
                steps.append(CloudTaskStep(id: step, maxSteps: maxSteps))
            }
        case .usage, .status:
            break
        }
    }
}

@MainActor
@Observable
final class CloudChatSession {
    enum Mode: String { case chat, task }

    private(set) var conversation: CloudConversation?
    private(set) var messages: [CloudMessage] = []
    private(set) var run: CloudRun?
    private(set) var steps: [CloudTaskStep] = []
    private(set) var isSending = false
    private(set) var isLoading = false
    /// Set when a send or run hit `usage_window_exhausted`; the UI offers a banked reset.
    private(set) var usageBlockedUntil: String?
    var errorMessage: String?
    var mode: Mode = .chat
    /// A generated or uploaded image the next message should edit.
    var imageToEdit: CloudMessagePart?
    var branchSelections: [String: String] = [:]

    @ObservationIgnored private let cloud: CloudService
    @ObservationIgnored private var streamTask: Task<Void, Never>?
    @ObservationIgnored private var lastAttempt: (() async -> Bool)?
    @ObservationIgnored private let sessionRevision: UInt64
    @ObservationIgnored private let creationID = UUID().uuidString
    @ObservationIgnored private var pendingInput: (text: String, files: [UUID], image: CloudMessagePart?, model: String, mode: Mode)?
    @ObservationIgnored private var pendingImage: (prompt: String, ratio: String, id: String)?
    @ObservationIgnored private var uploadedParts: [UUID: CloudMessagePart] = [:]

    init(cloud: CloudService, conversation: CloudConversation?) {
        self.cloud = cloud
        sessionRevision = cloud.sessionRevision
        self.conversation = conversation
    }

    private var isCurrent: Bool { cloud.isSignedIn && cloud.sessionRevision == sessionRevision }
    var isCurrentSession: Bool { isCurrent }
    var canRetry: Bool { lastAttempt != nil || run?.status == "failed" }

    var visibleMessages: [CloudMessage] {
        CloudMessageTree(messages: messages).visibleBranch(selections: branchSelections)
    }

    var isRunning: Bool {
        guard let run else { return false }
        return !run.isTerminal
    }

    func siblings(of message: CloudMessage) -> (ids: [String], index: Int) {
        CloudMessageTree(messages: messages).siblings(of: message)
    }

    func selectSibling(of message: CloudMessage, offset: Int) {
        let (ids, index) = siblings(of: message)
        let target = index + offset
        guard ids.indices.contains(target) else { return }
        branchSelections[CloudMessageTree.forkKey(for: message)] = ids[target]
    }

    // MARK: Loading

    func load() async {
        guard let id = conversation?.id else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let detail = try await cloud.client.conversation(id)
            guard isCurrent else { return }
            conversation = detail.conversation
            messages = detail.messages
            await resumeUnfinishedRun()
        } catch {
            report(error)
        }
    }

    /// Reattaches to the newest assistant message's run if it is still going (e.g. started on another
    /// device); a failed one shows its reason, as it would have live.
    private func resumeUnfinishedRun() async {
        guard let reply = visibleMessages.last(where: { !$0.isUser }), let runId = reply.runId else { return }
        do {
            let current = try await cloud.client.run(runId)
            run = current
            if current.status == "failed", let error = current.error { errorMessage = error.message }
            guard !current.isTerminal else { return }
            // Replay the full log into an empty message so persisted partial text is never duplicated.
            if let index = messages.firstIndex(where: { $0.id == reply.id }) { messages[index].parts = [] }
            steps = []
            run?.lastSeq = 0
            startStreaming()
        } catch {
            report(error)
        }
    }

    // MARK: Sending

    @discardableResult
    func send(text: String, attachments: [CloudPendingAttachment]) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isCurrent, !isSending, !trimmed.isEmpty || !attachments.isEmpty else { return false }
        guard let model = cloud.selectedModel?.id else {
            errorMessage = "No model is available right now."
            return false
        }
        let parentId = visibleMessages.last?.id
        if attachments.contains(where: \.isImage), cloud.selectedModel?.acceptsImages != true {
            errorMessage = "Choose a model that can view images before sending this attachment."
            return false
        }
        let files = attachments.map(\.id)
        if let pending = pendingInput, pending.text == trimmed, pending.files == files,
           pending.image == imageToEdit, pending.model == model, pending.mode == mode, lastAttempt != nil {
            return await retryLastSend()
        }
        pendingInput = (trimmed, files, imageToEdit, model, mode)
        uploadedParts = [:]
        let clientMessageId = UUID().uuidString
        let editImage = imageToEdit
        let requestedMode = mode
        let attempt: () async -> Bool = { [weak self] in
            await self?.post(text: trimmed, attachments: attachments, extraPart: editImage, parentId: parentId, clientMessageId: clientMessageId, model: model, requestedMode: requestedMode) ?? false
        }
        lastAttempt = attempt
        let accepted = await attempt()
        if accepted { imageToEdit = nil }
        return accepted
    }

    @discardableResult
    func generateImage(prompt: String, aspectRatio: String) async -> Bool {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isCurrent, !isSending, !isRunning, !text.isEmpty else { return false }
        guard cloud.clientConfig?.tools.imageGeneration == true else { errorMessage = "Image generation isn't available yet."; return false }
        guard ["1:1", "4:3", "3:4"].contains(aspectRatio) else { return false }
        let id: String
        if let pendingImage, pendingImage.prompt == text, pendingImage.ratio == aspectRatio { id = pendingImage.id }
        else { id = UUID().uuidString; pendingImage = (text, aspectRatio, id) }
        let attempt: () async -> Bool = { [weak self] in await self?.postImage(prompt: text, aspectRatio: aspectRatio, id: id) ?? false }
        lastAttempt = attempt
        return await attempt()
    }

    private func postImage(prompt: String, aspectRatio: String, id: String) async -> Bool {
        guard isCurrent else { return false }
        isSending = true
        defer { isSending = false }
        do {
            if conversation == nil {
                let created = try await cloud.client.createConversation(clientConversationId: creationID)
                guard isCurrent else { return false }
                conversation = created; cloud.upsert(created)
            }
            let response = try await cloud.client.createImage(conversationID: conversation!.id, input: CloudCreateImageInput(clientMessageId: id, prompt: prompt, aspectRatio: aspectRatio))
            guard isCurrent else { return false }
            accept(response)
            return true
        } catch { report(error); return false }
    }

    @discardableResult
    func retryLastSend() async -> Bool {
        guard isCurrent, !isSending else { return false }
        if let lastAttempt { return await lastAttempt() }
        if let reply = visibleMessages.last(where: { !$0.isUser }), run?.status == "failed" {
            await regenerate(reply)
            return errorMessage == nil
        }
        return false
    }

    /// Editing creates a sibling of the original user message; the old branch stays reachable.
    func edit(_ message: CloudMessage, newText: String) async {
        let trimmed = newText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard message.isUser, !trimmed.isEmpty, !isSending else { return }
        let kept = message.parts.filter { if case .text = $0 { return false } else { return true } }
        let clientMessageId = UUID().uuidString
        guard let model = cloud.selectedModel?.id else { return }
        let requestedMode = mode
        let attempt: () async -> Bool = { [weak self] in
            await self?.post(parts: [.text(trimmed)] + kept, parentId: message.parentId, clientMessageId: clientMessageId, model: model, requestedMode: requestedMode) ?? false
        }
        lastAttempt = attempt
        _ = await attempt()
    }

    func regenerate(_ reply: CloudMessage) async {
        guard !reply.isUser, let conversationId = conversation?.id, !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            let response = try await cloud.client.regenerate(conversationId: conversationId, messageId: reply.id, model: cloud.selectedModel?.id)
            accept(response)
        } catch {
            report(error)
        }
    }

    func stop() async {
        guard let run, !run.isTerminal else { return }
        do {
            self.run = try await cloud.client.cancelRun(run.id)
        } catch {
            report(error)
        }
        streamTask?.cancel()
    }

    func retryAfterReset() async {
        usageBlockedUntil = nil
        if let run, run.status == "blocked_on_usage" {
            startStreaming()
        } else {
            _ = await lastAttempt?()
        }
    }

    private func post(text: String, attachments: [CloudPendingAttachment], extraPart: CloudMessagePart?, parentId: String?, clientMessageId: String, model: String, requestedMode: Mode) async -> Bool {
        guard isCurrent else { return false }
        isSending = true
        defer { isSending = false }
        do {
            var parts: [CloudMessagePart] = []
            if !text.isEmpty { parts.append(.text(text)) }
            if let extraPart { parts.append(extraPart) }
            for attachment in attachments {
                if let saved = uploadedParts[attachment.id] { parts.append(saved); continue }
                let file = try await cloud.client.uploadFile(name: attachment.name, mimeType: attachment.mimeType, data: attachment.data)
                guard isCurrent else { throw CancellationError() }
                let part: CloudMessagePart
                if attachment.isImage {
                    part = .imageRef(fileId: file.id, mimeType: file.mimeType, width: nil, height: nil)
                } else {
                    part = .fileRef(fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size)
                }
                uploadedParts[attachment.id] = part
                parts.append(part)
            }
            try await postParts(parts, parentId: parentId, clientMessageId: clientMessageId, model: model, requestedMode: requestedMode)
            return true
        } catch {
            report(error)
            return false
        }
    }

    private func post(parts: [CloudMessagePart], parentId: String?, clientMessageId: String, model: String, requestedMode: Mode) async -> Bool {
        guard isCurrent else { return false }
        isSending = true
        defer { isSending = false }
        do {
            try await postParts(parts, parentId: parentId, clientMessageId: clientMessageId, model: model, requestedMode: requestedMode)
            return true
        } catch {
            report(error)
            return false
        }
    }

    private func postParts(_ parts: [CloudMessagePart], parentId: String?, clientMessageId: String, model: String, requestedMode: Mode) async throws {
        guard isCurrent else { throw CancellationError() }
        let conversationId: String
        if let existing = conversation?.id {
            conversationId = existing
        } else {
            let created = try await cloud.client.createConversation(clientConversationId: creationID)
            guard isCurrent else { throw CancellationError() }
            conversation = created
            cloud.upsert(created)
            conversationId = created.id
        }
        if requestedMode == .task { cloud.enableTaskNotifications() }
        let input = CloudSendMessageInput(clientMessageId: clientMessageId, parentId: parentId, parts: parts, model: model, mode: requestedMode.rawValue)
        let response = try await cloud.client.sendMessage(conversationId: conversationId, input: input)
        guard isCurrent else { throw CancellationError() }
        accept(response)
    }

    private func accept(_ response: CloudSendMessageResponse) {
        guard isCurrent else { return }
        lastAttempt = nil
        pendingImage = nil
        pendingInput = nil
        uploadedParts = [:]
        for message in [response.message, response.reply] {
            if let index = messages.firstIndex(where: { $0.id == message.id }) {
                messages[index] = message
            } else {
                messages.append(message)
            }
            branchSelections[CloudMessageTree.forkKey(for: message)] = message.id
        }
        run = response.run
        steps = []
        errorMessage = nil
        startStreaming()
    }

    // MARK: Streaming

    /// Starts (or resumes, after backgrounding) the live event stream from the last applied seq.
    func startStreaming() {
        guard isCurrent, let run, !run.isTerminal else { return }
        streamTask?.cancel()
        let runId = run.id
        let after = run.lastSeq
        streamTask = Task { [weak self] in
            guard let stream = self?.cloud.client.streamRun(runId, after: after) else { return }
            do {
                for try await event in stream {
                    self?.apply(event)
                }
            } catch {
                self?.report(error)
            }
        }
    }

    func suspendStreaming() {
        streamTask?.cancel()
        streamTask = nil
    }

    private func apply(_ event: CloudRunEvent) {
        guard isCurrent, var run, event.runId == run.id, event.seq > run.lastSeq else { return }
        run.lastSeq = event.seq
        CloudRunEventReducer.apply(event, to: &messages, steps: &steps)
        if case .status(let status, let error) = event.payload {
            run.status = status
            if run.isTerminal, run.mode == "task" { Task { await cloud.notifications.refresh() } }
            run.error = error
            if status == "blocked_on_usage" { usageBlockedUntil = cloud.usage?.exhaustedWindow?.resetsAt ?? "" }
            if let error, status == "failed" { errorMessage = error.message }
        }
        self.run = run
        if run.isTerminal {
            Task { [cloud] in
                await cloud.refreshUsage()
                await cloud.refreshConversations()
            }
        }
    }

    private func report(_ error: Error) {
        guard isCurrent else { return }
        if let apiError = error as? CloudAPIError, apiError.code == "usage_window_exhausted" {
            if case .server(_, _, _, _, let resetsAt) = apiError { usageBlockedUntil = resetsAt ?? "" }
            Task { await cloud.refreshUsage() }
            return
        }
        cloud.handle(error)
        if !(error is CancellationError) {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        cloud.lastError = nil
    }

    // MARK: Sharing

    func createShareLink() async -> URL? {
        guard let conversationId = conversation?.id, let last = visibleMessages.last else { return nil }
        do {
            return URL(string: try await cloud.client.createShare(conversationId: conversationId, messageId: last.id).url)
        } catch {
            report(error)
            return nil
        }
    }
}
