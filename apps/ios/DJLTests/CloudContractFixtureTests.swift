import XCTest
@testable import DJL

/// Contract drift guard: every JSON fixture generated from packages/contracts/src/cloud must decode with the
/// iOS Codable models. A new fixture without a decoder here fails the suite on purpose.
final class CloudContractFixtureTests: XCTestCase {
    private let decoders: [String: (Data) throws -> Any] = [
        "conversation-detail": { try JSONDecoder().decode(CloudConversationDetail.self, from: $0) },
        "conversation-search": { try JSONDecoder().decode(CloudConversationSearchResponse.self, from: $0) },
        "credits": { try JSONDecoder().decode(CloudCredits.self, from: $0) },
        "file-presign": { try JSONDecoder().decode(CloudFilePresignResponse.self, from: $0) },
        "me": { try JSONDecoder().decode(CloudMe.self, from: $0) },
        "models": { try JSONDecoder().decode(CloudModelsResponse.self, from: $0) },
        "native-token": { try JSONDecoder().decode(CloudNativeToken.self, from: $0) },
        "run-events": { try JSONDecoder().decode(CloudRunEventsResponse.self, from: $0) },
        "send-message": { try JSONDecoder().decode(CloudSendMessageResponse.self, from: $0) },
        "share-create": { try JSONDecoder().decode(CloudCreateShareResponse.self, from: $0) },
        "share-public": { try JSONDecoder().decode(CloudPublicShare.self, from: $0) },
        "usage-redeem": { try JSONDecoder().decode(CloudRedeemBankResponse.self, from: $0) },
        "usage-status": { try JSONDecoder().decode(CloudUsageStatus.self, from: $0) },
    ]

    func testEveryFixtureFileDecodes() throws {
        let files = try FileManager.default.contentsOfDirectory(atPath: CloudFixtures.directory.path)
            .filter { $0.hasSuffix(".json") }
            .map { String($0.dropLast(".json".count)) }
            .sorted()
        XCTAssertFalse(files.isEmpty, "No fixtures found at \(CloudFixtures.directory.path)")
        XCTAssertEqual(files, decoders.keys.sorted(), "Fixture set changed: add or remove a decoder above.")

        for name in files {
            let decode = try XCTUnwrap(decoders[name])
            XCTAssertNoThrow(try decode(CloudFixtures.data(name)), name)
        }
    }

    func testConversationDetailDecodesEveryPartKind() throws {
        let detail = try JSONDecoder().decode(CloudConversationDetail.self, from: CloudFixtures.data("conversation-detail"))
        XCTAssertEqual(detail.messages[0].parts, [
            .text("Plan three days in Kyoto from this itinerary."),
            .fileRef(fileId: "file_1", name: "itinerary.pdf", mimeType: "application/pdf", size: 48213),
        ])
        XCTAssertEqual(detail.messages[1].parts, [
            .toolCall(toolCallId: "call_1", name: "web_search", arguments: "{\"query\":\"Kyoto temples\"}"),
            .toolResult(toolCallId: "call_1", name: "web_search", content: "5 results", isError: false),
            .text("Here is a plan."),
            .imageRef(fileId: "file_2", mimeType: "image/png", width: 1024, height: 1024),
        ])
    }

    func testRunEventsDecodeEveryEventType() throws {
        let response = try JSONDecoder().decode(CloudRunEventsResponse.self, from: CloudFixtures.data("run-events"))
        XCTAssertEqual(response.run.lastSeq, 5)
        XCTAssertEqual(response.events.map(\.seq), [1, 2, 3, 4, 5])
        XCTAssertEqual(response.events[0].payload, .status(status: "running", error: nil))
        XCTAssertEqual(response.events[1].payload, .stepStarted(step: 1, maxSteps: 25))
        XCTAssertEqual(response.events[2].payload, .part(messageId: "msg_2", part: .imageRef(fileId: "file_2", mimeType: "image/png", width: nil, height: nil)))
        XCTAssertEqual(response.events[3].payload, .textDelta(messageId: "msg_2", text: "Here is"))
        guard case .usage(let trailer) = response.events[4].payload else { return XCTFail("usage") }
        XCTAssertEqual(trailer.settled, "2758")
    }

    func testSendInputEncodesTheContractShape() throws {
        let input = CloudSendMessageInput(
            clientMessageId: "c1",
            parentId: nil,
            parts: [.text("Hi"), .imageRef(fileId: "f", mimeType: "image/png", width: nil, height: nil)],
            model: "gpt-5",
            mode: "chat"
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        XCTAssertTrue(object["parentId"] is NSNull, "parentId must be sent as null, not omitted")
        let parts = try XCTUnwrap(object["parts"] as? [[String: Any]])
        XCTAssertEqual(parts[0]["type"] as? String, "text")
        XCTAssertEqual(parts[1]["type"] as? String, "image_ref")
        XCTAssertTrue(parts[1]["width"] is NSNull)
    }

    func testUsageWindowMath() throws {
        let status = try JSONDecoder().decode(CloudUsageStatus.self, from: CloudFixtures.data("usage-status"))
        XCTAssertEqual(status.windows.fiveHour.fractionUsed, 0.28, accuracy: 0.0001)
        XCTAssertNil(status.exhaustedWindow)
        let exhausted = CloudUsageWindow(kind: "five_hour", limit: "10", used: "10", remaining: "0", resetsAt: nil)
        XCTAssertTrue(exhausted.isExhausted)
        XCTAssertEqual(exhausted.fractionUsed, 1)
    }
}
