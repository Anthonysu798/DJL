import Foundation

nonisolated struct CloudNotification: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let conversationTitle: String?
    let status: String
    let finishedAt: String
    var readAt: String?
}

nonisolated struct CloudNotificationsPage: Codable, Sendable {
    let notifications: [CloudNotification]
    let nextCursor: String?
    let unreadCount: Int
}

nonisolated struct CloudNotificationReadResult: Codable, Sendable { let unreadCount: Int }
