// FILE: CloudMessageTree.swift
// Purpose: Resolves the visible branch of a conversation's message tree (edit / regenerate create siblings).
// Layer: Model
// Exports: CloudMessageTree
// Depends on: CloudModels

import Foundation

nonisolated struct CloudMessageTree: Sendable {
    private static let rootKey = ""
    private let byID: [String: CloudMessage]
    private let children: [String: [String]]

    init(messages: [CloudMessage]) {
        var byID: [String: CloudMessage] = [:]
        var children: [String: [String]] = [:]
        // Server order is creation order; keep it stable for siblings created in the same millisecond.
        let ordered = messages.enumerated().sorted { lhs, rhs in
            lhs.element.createdAt == rhs.element.createdAt
                ? lhs.offset < rhs.offset
                : lhs.element.createdAt < rhs.element.createdAt
        }
        for (_, message) in ordered {
            byID[message.id] = message
            children[message.parentId ?? Self.rootKey, default: []].append(message.id)
        }
        self.byID = byID
        self.children = children
    }

    /// Follows the chosen child at each fork, defaulting to the newest, like every chat client.
    func visibleBranch(selections: [String: String] = [:]) -> [CloudMessage] {
        var branch: [CloudMessage] = []
        var key = Self.rootKey
        while let ids = children[key], !ids.isEmpty {
            let chosen = selections[key].flatMap { ids.contains($0) ? $0 : nil } ?? ids[ids.count - 1]
            guard let message = byID[chosen] else { break }
            branch.append(message)
            key = message.id
        }
        return branch
    }

    /// Siblings of `message` (itself included) and its position, for the "‹ 2 / 3 ›" switcher.
    func siblings(of message: CloudMessage) -> (ids: [String], index: Int) {
        let ids = children[message.parentId ?? Self.rootKey] ?? [message.id]
        return (ids, ids.firstIndex(of: message.id) ?? 0)
    }

    /// Selection key for the fork a message hangs off.
    static func forkKey(for message: CloudMessage) -> String {
        message.parentId ?? rootKey
    }
}
