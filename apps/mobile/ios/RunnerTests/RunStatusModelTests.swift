import Foundation
import XCTest
#if !RUN_STATUS_HOST_TEST
@testable import Runner
#endif

final class RunStatusModelTests: XCTestCase {
    let now: Int64 = 1_800_000_000_000
    let instance = "4b85f888-2c0a-4ead-9243-7f0792fc3ecb"
    func envelope(_ epoch: Int = 0, _ instance: String? = nil) -> [String: Any] {
        ["schemaVersion": 1, "epoch": epoch, "instance": instance ?? self.instance]
    }
    func row(_ state: String = "running") -> [String: Any] {
        ["state": state, "startedAt": now - 1000, "staleAt": now + 1000, "expiresAt": now + 3000]
    }
    func payload(_ detailed: Bool = false) -> [String: Any] {
        envelope().merging(["detailed": detailed, "counts": ["running": 1, "failed": 0, "ready": 0],
            "buckets": ["running": [row()], "failed": [], "ready": []], "action": "openApp",
            "nextDeadline": now + 1000]) { _, new in new }
    }
    func testGenericRejectsPrivateAndUnknownFields() throws {
        var data = payload()
        var privateRow = row(); privateRow["title"] = "private"
        data["buckets"] = ["running": [privateRow], "failed": [], "ready": []]
        XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
        data = payload(); data["host"] = "private"
        XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
        data = payload(); data["detailed"] = 1
        XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
    }
    func testBoundsAndQualifiedURL() throws {
        var data = payload(true), detail = row()
        detail.merge(["threadId": "t", "title": String(repeating: "😀", count: 120), "detail": "project",
                      "url": "djl://thread/t?macId=m&macKeySha256=" + String(repeating: "a", count: 64)]) { _, new in new }
        data["buckets"] = ["running": [detail], "failed": [], "ready": []]
        XCTAssertNotNil(try RunStatusSnapshot.decode(data, now: now).rows.first?.url)
        detail["title"] = String(repeating: "😀", count: 121)
        data["buckets"] = ["running": [detail], "failed": [], "ready": []]
        XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
        detail["title"] = "Title"; detail["url"] = "djl://thread/t?macId=m"
        data["buckets"] = ["running": [detail], "failed": [], "ready": []]
        XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
        detail["url"] = "djl://thread/wrong?macId=m&macKeySha256=" + String(repeating: "a", count: 64)
        data["buckets"] = ["running": [detail], "failed": [], "ready": []]
        XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
    }
    func testCanonicalURLRejectsAlternateEscapesAndInvalidUTF8() throws {
        var data = payload(true)
        let fingerprint = String(repeating: "a", count: 64)
        for url in ["djl://thread/t?macId=%6D&macKeySha256=" + fingerprint,
                    "djl://thread/t?macId=%FF&macKeySha256=" + fingerprint,
                    "djl://thread/t?macId=m&macKeySha256=" + fingerprint + "&extra=x"] {
            var detail = row()
            detail.merge(["threadId": "t", "title": "Title", "detail": "project", "url": url]) { _, new in new }
            data["buckets"] = ["running": [detail], "failed": [], "ready": []]
            XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
        }
        var detail = row()
        detail.merge(["threadId": "t+é", "title": "Title", "detail": "project", "url": "djl://thread/t+%C3%A9?macId=a+b&macKeySha256=" + fingerprint]) { _, new in new }
        data["buckets"] = ["running": [detail], "failed": [], "ready": []]
        XCTAssertNotNil(try RunStatusSnapshot.decode(data, now: now).rows.first?.url)
    }

    func testDeadlinesDeriveCountsAndPauseWithoutFreshEvidence() throws {
        var data = payload()
        var expired = row("ready"); expired["expiresAt"] = now; expired["staleAt"] = now
        data["counts"] = ["running": 1, "failed": 0, "ready": 1]
        data["buckets"] = ["running": [row()], "failed": [], "ready": [expired]]
        let snapshot = try RunStatusSnapshot.decode(data, now: now)
        XCTAssertEqual(snapshot.rows.count, 1)
        XCTAssertEqual(snapshot.deadline, now + 1000)
        XCTAssertEqual(snapshot.projected(at: now + 1000).rows.first?.state, "paused")
        XCTAssertTrue(snapshot.projected(at: now + 3000).rows.isEmpty)
        data = payload(); data["buckets"] = ["running": Array(repeating: row(), count: 4), "failed": [], "ready": []]
        XCTAssertThrowsError(try RunStatusSnapshot.decode(data, now: now))
    }
    func testNineEntriesRetainBucketDeadlinesAndOnlyThreeVisibleRows() throws {
        var data = payload()
        var failed = row("failed"); failed["expiresAt"] = now + 2000; failed["staleAt"] = now + 2000
        var ready = row("ready"); ready["expiresAt"] = now + 500; ready["staleAt"] = now + 500
        data["counts"] = ["running": 3, "failed": 3, "ready": 3]
        data["buckets"] = ["running": Array(repeating: row(), count: 3), "failed": Array(repeating: failed, count: 3), "ready": Array(repeating: ready, count: 3)]
        let snapshot = try RunStatusSnapshot.decode(data, now: now)
        XCTAssertEqual(snapshot.rows.map(\.state), ["running", "running", "running"])
        XCTAssertEqual(snapshot.nextDeadline(after: now), now + 500)
        XCTAssertEqual(snapshot.projected(at: now + 500).ready.count, 0)
        let encoded = try JSONEncoder().encode(snapshot.rows)
        let json = String(decoding: encoded, as: UTF8.self)
        for field in ["threadId", "title", "detail", "url"] { XCTAssertFalse(json.contains(field)) }
    }

    func testEndAdoptsFreshInstanceAndInvalidatesOldCompletions() throws {
        var gate = RunStatusGate()
        let a = try RunStatusIdentity.decode(envelope(90))
        XCTAssertNil(gate.update(a))
        let old = try XCTUnwrap(gate.end(a))
        XCTAssertNotNil(gate.update(a))
        XCTAssertNil(gate.update(try RunStatusIdentity.decode(envelope(89))))
        let b = try RunStatusIdentity.decode(envelope(0, "1b85f888-2c0a-4ead-9243-7f0792fc3ecb"))
        XCTAssertNotNil(gate.end(b))
        XCTAssertFalse(gate.current(old))
        XCTAssertNil(gate.update(a))
        XCTAssertNil(gate.end(a))
        XCTAssertNotNil(gate.update(b))
    }
}
