import XCTest
@testable import DJL

final class CloudDraftStoreTests: XCTestCase {
    func testDraftsPersistAndStayScopedToAccountAndConversation() {
        let name = "djl-draft-tests-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let store = CloudDraftStore(defaults: defaults)
        store.save("Unsent question", accountID: "alice:org", conversationID: "new")
        store.save("Other chat", accountID: "alice:org", conversationID: "chat-2")
        store.save("Bob's question", accountID: "bob:org", conversationID: "new")
        let reopened = CloudDraftStore(defaults: defaults)
        XCTAssertEqual(reopened.draft(accountID: "alice:org", conversationID: "new"), "Unsent question")
        XCTAssertEqual(reopened.draft(accountID: "alice:org", conversationID: "chat-2"), "Other chat")
        reopened.clear(accountID: "alice:org")
        XCTAssertEqual(store.draft(accountID: "alice:org", conversationID: "new"), "")
        XCTAssertEqual(store.draft(accountID: "bob:org", conversationID: "new"), "Bob's question")
    }
}
