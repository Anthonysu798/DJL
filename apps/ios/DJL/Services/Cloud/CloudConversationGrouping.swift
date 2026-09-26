// FILE: CloudConversationGrouping.swift
// Purpose: Groups the conversation list into Pinned / Today / Yesterday / Previous 7 days / Previous 30 days / Older.
// Layer: Model
// Exports: CloudDate, CloudConversationGroup, CloudConversationGrouping
// Depends on: CloudModels

import Foundation

nonisolated enum CloudDate {
    /// Parses the API's ISO-8601 timestamps, with or without fractional seconds.
    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

nonisolated struct CloudConversationGroup: Identifiable, Equatable {
    let title: String
    let conversations: [CloudConversation]
    var id: String { title }
}

nonisolated enum CloudConversationGrouping {
    static func groups(_ conversations: [CloudConversation], now: Date = Date(), calendar: Calendar = .current) -> [CloudConversationGroup] {
        let sorted = conversations.sorted { ($0.lastMessageAt) > ($1.lastMessageAt) }
        let startOfToday = calendar.startOfDay(for: now)
        func daysAgo(_ conversation: CloudConversation) -> Int {
            guard let date = CloudDate.parse(conversation.lastMessageAt) else { return .max }
            return calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: startOfToday).day ?? .max
        }

        var buckets: [(String, [CloudConversation])] = [
            ("Pinned", []), ("Today", []), ("Yesterday", []), ("Previous 7 days", []), ("Previous 30 days", []), ("Older", []),
        ]
        for conversation in sorted {
            let index: Int
            if conversation.pinned {
                index = 0
            } else {
                switch daysAgo(conversation) {
                case ...0: index = 1
                case 1: index = 2
                case 2...7: index = 3
                case 8...30: index = 4
                default: index = 5
                }
            }
            buckets[index].1.append(conversation)
        }
        return buckets.filter { !$0.1.isEmpty }.map { CloudConversationGroup(title: $0.0, conversations: $0.1) }
    }
}
