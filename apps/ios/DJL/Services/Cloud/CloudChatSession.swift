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
    @ObservationIgnored private var lastAttempt: (() async -> Void)?

    init(cloud: CloudService, conversation: CloudConversation?) {
        self.cloud = cloud
        self.conversation = conversation
    }

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

    func send(text: String, attachments: [CloudPendingAttachment]) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty, !isSending else { return }
        let parentId = visibleMessages.last?.id
        let clientMessageId = UUID().uuidString
        let editImage = imageToEdit
        let attempt: () async -> Void = { [weak self] in
            await self?.post(text: trimmed, attachments: attachments, extraPart: editImage, parentId: parentId, clientMessageId: clientMessageId)
        }
        lastAttempt = attempt
        imageToEdit = nil
        await attempt()
    }

    /// Editing creates a sibling of the original user message; the old branch stays reachable.
    func edit(_ message: CloudMessage, newText: String) async {
        let trimmed = newText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard message.isUser, !trimmed.isEmpty, !isSending else { return }
        let kept = message.parts.filter { if case .text = $0 { return false } else { return true } }
        let clientMessageId = UUID().uuidString
        let attempt: () async -> Void = { [weak self] in
            await self?.post(parts: [.text(trimmed)] + kept, parentId: message.parentId, clientMessageId: clientMessageId)
        }
        lastAttempt = attempt
        await attempt()
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
            await lastAttempt?()
        }
    }

    private func post(text: String, attachments: [CloudPendingAttachment], extraPart: CloudMessagePart?, parentId: String?, clientMessageId: String) async {
        isSending = true
        defer { isSending = false }
        do {
            var parts: [CloudMessagePart] = []
            if !text.isEmpty { parts.append(.text(text)) }
            if let extraPart { parts.append(extraPart) }
            for attachment in attachments {
                let file = try await cloud.client.uploadFile(name: attachment.name, mimeType: attachment.mimeType, data: attachment.data)
                if attachment.isImage {
                    parts.append(.imageRef(fileId: file.id, mimeType: file.mimeType, width: nil, height: nil))
                } else {
                    parts.append(.fileRef(fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size))
                }
            }
            try await postParts(parts, parentId: parentId, clientMessageId: clientMessageId)
        } catch {
            report(error)
        }
    }

    private func post(parts: [CloudMessagePart], parentId: String?, clientMessageId: String) async {
        isSending = true
        defer { isSending = false }
        do {
            try await postParts(parts, parentId: parentId, clientMessageId: clientMessageId)
        } catch {
            report(error)
        }
    }

    private func postParts(_ parts: [CloudMessagePart], parentId: String?, clientMessageId: String) async throws {
        guard let model = cloud.selectedModel?.id else {
            throw CloudAPIError.server(status: 0, code: "no_model", message: "No model is available right now.", traceId: nil, resetsAt: nil)
        }
        let conversationId: String
        if let existing = conversation?.id {
            conversationId = existing
        } else {
            let created = try await cloud.client.createConversation()
            conversation = created
            cloud.upsert(created)
            conversationId = created.id
        }
        if mode == .task { cloud.enableTaskNotifications() }
        let input = CloudSendMessageInput(clientMessageId: clientMessageId, parentId: parentId, parts: parts, model: model, mode: mode.rawValue)
        accept(try await cloud.client.sendMessage(conversationId: conversationId, input: input))
    }

    private func accept(_ response: CloudSendMessageResponse) {
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
        guard let run, !run.isTerminal else { return }
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
        guard var run, event.runId == run.id, event.seq > run.lastSeq else { return }
        run.lastSeq = event.seq
        CloudRunEventReducer.apply(event, to: &messages, steps: &steps)
        if case .status(let status, let error) = event.payload {
            run.status = status
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
