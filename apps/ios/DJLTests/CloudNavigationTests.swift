import XCTest
@testable import DJL

final class CloudNavigationTests: XCTestCase {
    @MainActor
    func testHistoryPagesMergeWithoutDuplicatingConversations() async throws {
        let me = try CloudFixtures.string("me")
        let models = try CloudFixtures.string("models")
        let list = try CloudFixtures.string("conversation-list")
        let first = try JSONDecoder().decode(CloudConversationList.self, from: CloudFixtures.data("conversation-list"))
        var second = first.conversations[0]
        second = CloudConversation(id: "conv_2", title: "Second", pinned: false, archived: false, lastMessageAt: second.lastMessageAt, createdAt: second.createdAt, updatedAt: second.updatedAt)
        let page = String(data: try JSONEncoder().encode(CloudConversationList(conversations: first.conversations + [second], nextCursor: nil)), encoding: .utf8)!
        CloudStubURLProtocol.install { request, _ in
            switch request.url?.path {
            case "/v1/me": return .json(200, me)
            case "/v1/models": return .json(200, models)
            case "/v1/conversations": return .json(200, request.url?.query?.contains("cursor=") == true ? page : list)
            default: return .json(200, "{}")
            }
        }
        let cloud = CloudService(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), sessionStore: CloudMemorySessionStore(token: "session"), urlSession: CloudStubURLProtocol.session(), tokenProvider: CloudCountingTokenProvider(tokens: ["jwt"]), draftStore: CloudDraftStore(defaults: UserDefaults(suiteName: "djl-tests-\(UUID())")!))
        await cloud.refreshAll()
        await cloud.loadMoreConversations()
        XCTAssertEqual(cloud.conversations.map(\.id), ["conv_2", "conv_1"])
        XCTAssertNil(cloud.nextConversationCursor)
    }

    @MainActor
    func testTheDrawerAndOtherDestinationsRetainTheActiveConversation() {
        let state = CloudNavigationState()
        state.openConversation("chat-1")
        let identity = state.presentationID
        state.isMenuOpen = true
        state.isMenuOpen = false
        XCTAssertEqual(state.selectedConversationID, "chat-1")
        XCTAssertEqual(state.presentationID, identity)
        state.destination = .settings
        XCTAssertEqual(state.selectedConversationID, "chat-1")
        state.destination = .chat
        XCTAssertEqual(state.presentationID, identity)
        state.newChat()
        XCTAssertNil(state.selectedConversationID)
        XCTAssertNotEqual(state.presentationID, identity)
        XCTAssertEqual(PhoneNavigationDrawerPolicy.width(for: 390), 273, accuracy: 0.001)
    }
}
