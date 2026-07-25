// FILE: SidebarAttentionProjection.swift
// Purpose: Projects existing orchestration state into a stable, review-first mobile inbox.
// Layer: View Support
// Exports: SidebarAttentionItem, SidebarAttentionProjection, DJLDeepLinkParser

import Foundation

enum SidebarAttentionSection: Int, Hashable, Sendable {
    case needsYou
    case readyToReview

    var title: String {
        switch self {
        case .needsYou:
            return "Needs You"
        case .readyToReview:
            return "Ready to Review"
        }
    }
}

enum SidebarAttentionKind: Int, Hashable, Sendable {
    case approval
    case question
    case failedRun
    case blockedGoal
    case completedRun

    nonisolated var section: SidebarAttentionSection {
        self == .completedRun ? .readyToReview : .needsYou
    }

    var title: String {
        switch self {
        case .approval:
            return "Approval needed"
        case .question:
            return "Agent has a question"
        case .failedRun:
            return "Run failed"
        case .blockedGoal:
            return "Goal needs attention"
        case .completedRun:
            return "Ready to review"
        }
    }

    var accessibilityAction: String {
        switch self {
        case .approval:
            return "Open the approval request"
        case .question:
            return "Open the agent question"
        case .failedRun:
            return "Open the failed run"
        case .blockedGoal:
            return "Open the blocked goal"
        case .completedRun:
            return "Open the completed run"
        }
    }
}

struct AttentionNavigationTarget: Hashable, Sendable {
    let threadID: String
    let turnID: String?
    let itemID: String?
    let messageID: String?
    let approvalRequestID: String?

    init(
        threadID: String,
        turnID: String? = nil,
        itemID: String? = nil,
        messageID: String? = nil,
        approvalRequestID: String? = nil
    ) {
        self.threadID = Self.normalized(threadID) ?? threadID
        self.turnID = Self.normalized(turnID)
        self.itemID = Self.normalized(itemID)
        self.messageID = Self.normalized(messageID)
        self.approvalRequestID = Self.normalized(approvalRequestID)
    }

    func resolvedMessageID(in messages: [CodexMessage]) -> String? {
        if let messageID, messages.contains(where: { $0.id == messageID }) {
            return messageID
        }
        if let itemID,
           let message = messages.last(where: { $0.itemId == itemID || $0.sourceItemKey == itemID }) {
            return message.id
        }
        if let turnID, let message = messages.last(where: { $0.turnId == turnID }) {
            return message.id
        }
        return nil
    }

    private static func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}

struct SidebarAttentionItem: Identifiable, Hashable, Sendable {
    let id: String
    let kind: SidebarAttentionKind
    let threadTitle: String
    let projectTitle: String?
    let summary: String
    let date: Date
    let sourceOrder: Int
    let target: AttentionNavigationTarget

    nonisolated var section: SidebarAttentionSection { kind.section }
}

enum SidebarAttentionProjection {
    static func project(
        threads: [CodexThread],
        pendingApprovals: [CodexApprovalRequest],
        messagesByThread: [String: [CodexMessage]],
        readyThreadIDs: Set<String>,
        failedThreadIDs: Set<String>,
        goalsByThreadID: [String: CodexThreadGoal],
        activeThreadID: String?
    ) -> [SidebarAttentionItem] {
        let liveThreads = threads.filter { $0.syncState != .archivedLocal }
        let threadsByID = Dictionary(uniqueKeysWithValues: liveThreads.map { ($0.id, $0) })
        var items: [SidebarAttentionItem] = []

        for (sourceOrder, approval) in pendingApprovals.enumerated() {
            guard let threadID = normalized(approval.threadId) ?? normalized(activeThreadID),
                  let thread = threadsByID[threadID] else {
                continue
            }
            let params = approval.params?.objectValue
            let itemID = firstNormalizedString(in: params, keys: ["itemId", "item_id"])
            items.append(
                makeItem(
                    id: "approval:\(approval.id)",
                    kind: .approval,
                    thread: thread,
                    summary: approvalSummary(approval),
                    date: activityDate(for: thread),
                    sourceOrder: sourceOrder,
                    target: AttentionNavigationTarget(
                        threadID: threadID,
                        turnID: approval.turnId,
                        itemID: itemID,
                        approvalRequestID: approval.id
                    )
                )
            )
        }

        for thread in liveThreads {
            let messages = messagesByThread[thread.id] ?? []
            for message in messages where message.kind == .userInputPrompt && message.structuredUserInputRequest != nil {
                items.append(
                    makeItem(
                        id: "question:\(message.id)",
                        kind: .question,
                        thread: thread,
                        summary: questionSummary(message),
                        date: message.createdAt,
                        sourceOrder: message.orderIndex,
                        target: AttentionNavigationTarget(
                            threadID: thread.id,
                            turnID: message.turnId,
                            itemID: message.itemId,
                            messageID: message.id
                        )
                    )
                )
            }

            if failedThreadIDs.contains(thread.id) {
                let targetMessage = latestReviewTargetMessage(in: messages)
                items.append(
                    makeItem(
                        id: "failed:\(thread.id)",
                        kind: .failedRun,
                        thread: thread,
                        summary: actionableFailureSummary(from: targetMessage?.text),
                        date: targetMessage?.createdAt ?? activityDate(for: thread),
                        sourceOrder: targetMessage?.orderIndex ?? 0,
                        target: target(for: thread.id, message: targetMessage)
                    )
                )
            }

            if let goal = goalsByThreadID[thread.id], goalNeedsAttention(goal) {
                let targetMessage = messages.last
                items.append(
                    makeItem(
                        id: "goal:\(thread.id)",
                        kind: .blockedGoal,
                        thread: thread,
                        summary: goalAttentionSummary(goal),
                        date: targetMessage?.createdAt ?? activityDate(for: thread),
                        sourceOrder: targetMessage?.orderIndex ?? 0,
                        target: target(for: thread.id, message: targetMessage)
                    )
                )
            }

            if readyThreadIDs.contains(thread.id) {
                let targetMessage = latestReviewTargetMessage(in: messages)
                items.append(
                    makeItem(
                        id: "completed:\(thread.id)",
                        kind: .completedRun,
                        thread: thread,
                        summary: "The run finished. Review the result and any file changes before continuing.",
                        date: targetMessage?.createdAt ?? activityDate(for: thread),
                        sourceOrder: targetMessage?.orderIndex ?? 0,
                        target: target(for: thread.id, message: targetMessage)
                    )
                )
            }
        }

        return items.sorted(by: precedes)
    }

    static func filtered(_ items: [SidebarAttentionItem], query: String) -> [SidebarAttentionItem] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedQuery.isEmpty else { return items }
        return items.filter { item in
            item.kind.title.localizedCaseInsensitiveContains(normalizedQuery)
                || item.threadTitle.localizedCaseInsensitiveContains(normalizedQuery)
                || (item.projectTitle?.localizedCaseInsensitiveContains(normalizedQuery) ?? false)
                || item.summary.localizedCaseInsensitiveContains(normalizedQuery)
        }
    }

    static func actionableFailureSummary(from rawMessage: String?) -> String {
        let normalized = rawMessage?.lowercased() ?? ""
        if normalized.contains("permission denied") || normalized.contains("operation not permitted") {
            return "Review the requested access or change this chat's access mode, then retry the run."
        }
        if normalized.contains("authentication") || normalized.contains("unauthorized") || normalized.contains("sign in") {
            return "Sign in again on your Mac, then retry the run."
        }
        if normalized.contains("timed out") || normalized.contains("timeout") {
            return "Check the Mac connection, then retry the run."
        }
        if normalized.contains("network") || normalized.contains("connection refused") || normalized.contains("offline") {
            return "Check that the Mac and relay are online, then retry the run."
        }
        if normalized.contains("test failed") || normalized.contains("tests failed") || normalized.contains("build failed") {
            return "Open the chat to inspect the failing check, fix it, and retry."
        }
        return "Open the chat to review the last step, correct the issue, and retry."
    }

    private static func makeItem(
        id: String,
        kind: SidebarAttentionKind,
        thread: CodexThread,
        summary: String,
        date: Date,
        sourceOrder: Int,
        target: AttentionNavigationTarget
    ) -> SidebarAttentionItem {
        SidebarAttentionItem(
            id: id,
            kind: kind,
            threadTitle: thread.displayTitle,
            projectTitle: thread.normalizedProjectPath == nil ? nil : thread.projectDisplayName,
            summary: summary,
            date: date,
            sourceOrder: sourceOrder,
            target: target
        )
    }

    private static func approvalSummary(_ approval: CodexApprovalRequest) -> String {
        if let reason = normalized(approval.reason) {
            return concise(reason)
        }
        if let command = normalized(approval.command) {
            return "Allow Codex to run “\(concise(command, limit: 96))”?"
        }
        return "Codex is waiting for permission to continue."
    }

    private static func questionSummary(_ message: CodexMessage) -> String {
        guard let question = message.structuredUserInputRequest?.questions.first else {
            return "Open the chat to answer the agent."
        }
        return concise(question.question.isEmpty ? question.header : question.question)
    }

    private static func latestReviewTargetMessage(in messages: [CodexMessage]) -> CodexMessage? {
        messages.last(where: { message in
            message.role == .assistant && message.kind == .chat && !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }) ?? messages.last(where: { $0.role != .user }) ?? messages.last
    }

    private static func target(for threadID: String, message: CodexMessage?) -> AttentionNavigationTarget {
        AttentionNavigationTarget(
            threadID: threadID,
            turnID: message?.turnId,
            itemID: message?.itemId,
            messageID: message?.id
        )
    }

    private static func activityDate(for thread: CodexThread) -> Date {
        thread.updatedAt ?? thread.createdAt ?? .distantPast
    }

    private nonisolated static func precedes(_ lhs: SidebarAttentionItem, _ rhs: SidebarAttentionItem) -> Bool {
        if lhs.section.rawValue != rhs.section.rawValue {
            return lhs.section.rawValue < rhs.section.rawValue
        }
        if lhs.kind.rawValue != rhs.kind.rawValue {
            return lhs.kind.rawValue < rhs.kind.rawValue
        }
        if lhs.kind == .approval, lhs.sourceOrder != rhs.sourceOrder {
            return lhs.sourceOrder < rhs.sourceOrder
        }
        if lhs.date != rhs.date {
            return lhs.date > rhs.date
        }
        if lhs.sourceOrder != rhs.sourceOrder {
            return lhs.sourceOrder > rhs.sourceOrder
        }
        return lhs.id < rhs.id
    }

    private static func goalNeedsAttention(_ goal: CodexThreadGoal) -> Bool {
        switch goal.status {
        case .blocked, .usageLimited, .budgetLimited:
            return true
        case .active, .paused, .complete:
            return false
        }
    }

    private static func goalAttentionSummary(_ goal: CodexThreadGoal) -> String {
        switch goal.status {
        case .blocked:
            return "The goal is blocked. Open the chat to review what the agent needs."
        case .usageLimited:
            return "Usage limits paused this goal. Review the chat before resuming it."
        case .budgetLimited:
            return "The goal reached its budget. Review the result before deciding what to do next."
        case .active, .paused, .complete:
            return "Open the chat to review the goal."
        }
    }

    private static func firstNormalizedString(in object: [String: JSONValue]?, keys: [String]) -> String? {
        for key in keys {
            if let value = normalized(object?[key]?.stringValue) {
                return value
            }
        }
        return nil
    }

    private static func concise(_ value: String, limit: Int = 160) -> String {
        let oneLine = value
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard oneLine.count > limit else { return oneLine }
        return String(oneLine.prefix(limit - 1)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    private nonisolated static func normalized(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }
}

struct DJLDeepLinkDestination: Equatable, Sendable {
    let target: AttentionNavigationTarget
}

enum DJLDeepLinkParser {
    static func destination(from url: URL) -> DJLDeepLinkDestination? {
        guard url.scheme?.caseInsensitiveCompare("djl") == .orderedSame else {
            return nil
        }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []
        let routeComponents = url.pathComponents
            .dropFirst()
            .compactMap(normalized)
        let host = normalized(url.host)

        let pathThreadID: String? = {
            if let host, isThreadRoute(host) {
                return routeComponents.first
            }
            if host == nil, let route = routeComponents.first, isThreadRoute(route) {
                return routeComponents.dropFirst().first
            }
            return nil
        }()

        let threadID = pathThreadID ?? queryValue(names: ["threadId", "thread"], in: queryItems)
        guard let threadID = normalized(threadID?.removingPercentEncoding ?? threadID) else {
            return nil
        }

        return DJLDeepLinkDestination(
            target: AttentionNavigationTarget(
                threadID: threadID,
                turnID: queryValue(names: ["turnId", "turn"], in: queryItems),
                itemID: queryValue(names: ["itemId", "item"], in: queryItems),
                messageID: queryValue(names: ["messageId", "message"], in: queryItems)
            )
        )
    }

    private static func queryValue(names: [String], in items: [URLQueryItem]) -> String? {
        items.first { item in names.contains(where: { item.name.caseInsensitiveCompare($0) == .orderedSame }) }?.value
    }

    private static func isThreadRoute(_ value: String) -> Bool {
        value.caseInsensitiveCompare("thread") == .orderedSame
            || value.caseInsensitiveCompare("threads") == .orderedSame
    }

    private nonisolated static func normalized(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }
}
