// FILE: CodexServiceBatchIncomingTests.swift
// Purpose: Verifies coalesced JSON-RPC batch frames from the bridge apply in order.
// Layer: Unit Test
// Exports: CodexServiceBatchIncomingTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexServiceBatchIncomingTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testBatchArrayAppliesEveryNotificationInOrder() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let batch = """
        [
          {"method":"turn/started","params":{"threadId":"\(threadID)","turnId":"\(turnID)"}},
          {"method":"item/agentMessage/delta","params":{"threadId":"\(threadID)","turnId":"\(turnID)","itemId":"item-1","delta":"Hello, "}},
          {"method":"item/agentMessage/delta","params":{"threadId":"\(threadID)","turnId":"\(turnID)","itemId":"item-1","delta":"world"}}
        ]
        """

        service.processIncomingText(batch)
        service.flushPendingAssistantDeltas(for: threadID)

        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .running)
        let assistant = service.messages(for: threadID).filter { $0.role == .assistant }
        XCTAssertEqual(assistant.count, 1)
        XCTAssertEqual(assistant.first?.text, "Hello, world")
    }

    func testBatchWithOneBadElementStillAppliesTheRest() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let batch = """
        [
          {"method":"turn/started","params":{"threadId":"\(threadID)","turnId":"\(turnID)"}},
          42,
          {"method":"item/agentMessage/delta","params":{"threadId":"\(threadID)","turnId":"\(turnID)","itemId":"item-1","delta":"ok"}}
        ]
        """

        service.processIncomingText(batch)
        service.flushPendingAssistantDeltas(for: threadID)

        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .running)
        XCTAssertEqual(
            service.messages(for: threadID).filter { $0.role == .assistant }.first?.text,
            "ok"
        )
        XCTAssertEqual(service.lastErrorMessage, "Unable to decode server payload")
    }

    func testPreDecoderClassifiesArraysAsBatches() {
        let result = WireMessagePreDecoder.classify(
            "[{\"method\":\"turn/started\",\"params\":{}},{\"id\":\"r\",\"result\":{}}]"
        )

        XCTAssertFalse(result.isSecure)
        guard case .batch(let messages)? = result.rpcResult else {
            return XCTFail("Expected a batch result")
        }
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(messages[0].method, "turn/started")
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexServiceBatchIncomingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        service.messagesByThread = [:]
        // CodexService currently crashes while deallocating in unit-test environment.
        // Keep instances alive for process lifetime so assertions remain deterministic.
        Self.retainedServices.append(service)
        return service
    }
}
