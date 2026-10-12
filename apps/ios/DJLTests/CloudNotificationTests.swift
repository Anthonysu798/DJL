import XCTest
@testable import DJL

final class CloudNotificationTests: XCTestCase {
    @MainActor
    func testInitialHistoryIsSilentNewCompletionsAlertOnceAndTapsRouteExactly() async throws {
        let me = try CloudFixtures.string("me")
        let models = try CloudFixtures.string("models")
        var entries = [CloudNotification(id: "old", conversationId: "conv-old", conversationTitle: "Old", status: "succeeded", finishedAt: "2026-10-11T12:00:00Z", readAt: nil)]
        CloudStubURLProtocol.install { request, _ in
            switch request.url?.path {
            case "/v1/me": return .json(200, me)
            case "/v1/models": return .json(200, models)
            case "/v1/conversations": return .json(200, #"{"conversations":[],"nextCursor":null}"#)
            case "/v1/notifications":
                let data = try! JSONEncoder().encode(CloudNotificationsPage(notifications: entries, nextCursor: nil, unreadCount: entries.filter { $0.readAt == nil }.count))
                return .json(200, String(data: data, encoding: .utf8)!)
            case "/v1/notifications/read":
                for i in entries.indices { entries[i].readAt = "2026-10-11T13:00:00Z" }
                return .json(200, #"{"unreadCount":0}"#)
            default: return .json(200, "{}")
            }
        }
        let defaults = UserDefaults(suiteName: "notification-tests-\(UUID())")!
        let cloud = CloudService(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), sessionStore: CloudMemorySessionStore(token: "session"), urlSession: CloudStubURLProtocol.session(), tokenProvider: CloudCountingTokenProvider(tokens: ["jwt"]), draftStore: CloudDraftStore(defaults: defaults))
        await cloud.refreshAll()
        let store = CloudNotificationStore(cloud: cloud, defaults: defaults)
        await store.refresh()
        XCTAssertNil(store.banner)
        XCTAssertEqual(store.unreadCount, 1)
        let new = CloudNotification(id: "new", conversationId: "conv-new", conversationTitle: "New", status: "failed", finishedAt: "2026-10-11T13:00:00Z", readAt: nil)
        entries.insert(new, at: 0)
        await store.refresh()
        XCTAssertEqual(store.banner?.id, "new")
        store.dismissBanner()
        await store.refresh()
        XCTAssertNil(store.banner)
        await store.open(new)
        XCTAssertEqual(cloud.pendingConversationID, "conv-new")
        XCTAssertEqual(store.unreadCount, 0)
        store.setActiveConversation("conv-new")
        entries.insert(CloudNotification(id: "active", conversationId: "conv-new", conversationTitle: "New", status: "succeeded", finishedAt: "2026-10-11T13:01:00Z", readAt: nil), at: 0)
        await store.refresh()
        XCTAssertNil(store.banner)
        XCTAssertEqual(store.unreadCount, 0)
        store.setForeground(true)
        store.setForeground(false)
        XCTAssertFalse(store.isPolling)
        cloud.handle(CloudAPIError.unauthorized)
        await store.refresh()
        XCTAssertTrue(store.notifications.isEmpty)
        XCTAssertEqual(store.unreadCount, 0)
    }
}
