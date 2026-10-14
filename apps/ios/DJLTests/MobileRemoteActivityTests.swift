import XCTest
@testable import DJL

final class MobileRemoteActivityTests: XCTestCase {
    @MainActor
    func testRemoteActivityStaysLocalPersistsAndDeduplicatesPerMac() {
        let name = "remote-activity-tests-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let store = MobileRemoteActivityStore(defaults: defaults)
        store.record(eventID: "turn-1", threadID: "thread-1", macID: "mac-a", title: "Private remote chat", kind: .completed)
        store.record(eventID: "turn-1", threadID: "thread-1", macID: "mac-a", title: "Private remote chat", kind: .completed)
        store.record(eventID: "turn-1", threadID: "thread-1", macID: "mac-b", title: "Another Mac", kind: .approval)
        XCTAssertEqual(store.entries(macID: "mac-a").count, 1)
        XCTAssertEqual(store.entries(macID: "mac-b").count, 1)
        let reopened = MobileRemoteActivityStore(defaults: defaults)
        XCTAssertEqual(reopened.entries(macID: "mac-a").first?.title, "Private remote chat")
        let entry = reopened.entries(macID: "mac-a")[0]
        reopened.markRead(entry.id)
        XCTAssertNotNil(reopened.entries(macID: "mac-a")[0].readAt)
    }
}
