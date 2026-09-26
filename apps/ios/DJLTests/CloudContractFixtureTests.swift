import XCTest
@testable import DJL

/// Contract drift guard: every JSON fixture generated from packages/contracts/src/cloud must decode with the
/// iOS Codable models. A new fixture without a decoder here fails the suite on purpose.
final class CloudContractFixtureTests: XCTestCase {
    private let decoders: [String: (Data) throws -> Any] = [
        "access-token": { try JSONDecoder().decode(CloudAccessToken.self, from: $0) },
        "account-delete": { try JSONDecoder().decode(CloudDeleteAccountResponse.self, from: $0) },
        "conversation": { try JSONDecoder().decode(CloudConversation.self, from: $0) },
        "conversation-detail": { try JSONDecoder().decode(CloudConversationDetail.self, from: $0) },
        "conversation-list": { try JSONDecoder().decode(CloudConversationList.self, from: $0) },
        // The branch view adds `siblingIds` to each message; the app reads the whole tree instead.
        "conversation-messages": { try JSONDecoder().decode(CloudConversationDetail.self, from: $0) },
        "conversation-search": { try JSONDecoder().decode(CloudConversationSearchResponse.self, from: $0) },
        "credits": { try JSONDecoder().decode(CloudCredits.self, from: $0) },
        // Web-only (cookie CSRF); decoded here only so the fixture set stays complete.
        "csrf": { try JSONDecoder().decode([String: String].self, from: $0) },
        "file": { try JSONDecoder().decode(CloudFile.self, from: $0) },
        "file-presign": { try JSONDecoder().decode(CloudFilePresignResponse.self, from: $0) },
        "file-url": { try JSONDecoder().decode(CloudFileDownload.self, from: $0) },
        "me": { try JSONDecoder().decode(CloudMe.self, from: $0) },
        "models": { try JSONDecoder().decode(CloudModelsResponse.self, from: $0) },
        "native-token": { try JSONDecoder().decode(CloudNativeToken.self, from: $0) },
        "run": { try JSONDecoder().decode(CloudRunResponse.self, from: $0) },
        "run-events": { try JSONDecoder().decode(CloudRunEventsResponse.self, from: $0) },
        "run-push": { try JSONDecoder().decode(CloudRunPush.self, from: $0) },
        "send-message": { try JSONDecoder().decode(CloudSendMessageResponse.self, from: $0) },
        "share-create": { try JSONDecoder().decode(CloudCreateShareResponse.self, from: $0) },
        "share-public": { try JSONDecoder().decode(CloudPublicShare.self, from: $0) },
        "share-revoke": { try JSONDecoder().decode([String: CloudShare].self, from: $0) },
        "usage-banks": { try JSONDecoder().decode([String: [CloudResetBank]].self, from: $0) },
        "usage-redeem": { try JSONDecoder().decode(CloudRedeemBankResponse.self, from: $0) },
        "usage-windows": { try JSONDecoder().decode(CloudUsageWindows.self, from: $0) },
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
        XCTAssertEqual(detail.conversation.lastMessageAt, "2026-09-26T12:00:00.000Z")
        XCTAssertEqual(detail.messages[0].parts, [
            .text("Plan three days in Kyoto from this itinerary."),
            .fileRef(fileId: "file_1", name: "itinerary.pdf", mimeType: "application/pdf", size: 48213),
        ])
        XCTAssertEqual(detail.messages[1].parts, [
            .toolCall(toolCallId: "call_1", name: "web_search", arguments: "{\"query\":\"Kyoto temples\"}"),
            .toolResult(toolCallId: "call_1", name: "web_search", content: "5 results", isError: false),
            .text("Here is a plan."),
            .imageRef(fileId: "file_2", mimeType: "image/png", width: 1024, height: 1024),
            .citation(url: "https://example.com/kyoto", title: "Kyoto temples guide"),
        ])
    }

    func testCitationRoundTripsWithANullTitle() throws {
        let part = CloudMessagePart.citation(url: "https://example.com", title: nil)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(part)) as? [String: Any])
        XCTAssertEqual(object["type"] as? String, "citation")
        XCTAssertTrue(object["title"] is NSNull)
        XCTAssertEqual(try JSONDecoder().decode(CloudMessagePart.self, from: JSONEncoder().encode(part)), part)
    }

    func testSearchHitCarriesTheMatchingMessage() throws {
        let response = try JSONDecoder().decode(CloudConversationSearchResponse.self, from: CloudFixtures.data("conversation-search"))
        XCTAssertEqual(response.results.first?.messageId, "msg_1")
    }

    func testPublicShareCarriesSignedImageURLs() throws {
        let share = try JSONDecoder().decode(CloudPublicShare.self, from: CloudFixtures.data("share-public"))
        XCTAssertEqual(share.imageUrls["file_2"], "https://storage.example.com/file_2?signature=abc")
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
        let usage = try JSONDecoder().decode(CloudUsageWindows.self, from: CloudFixtures.data("usage-windows"))
        XCTAssertEqual(usage.windows.fiveHour.fractionUsed, 0.28, accuracy: 0.0001)
        XCTAssertNil(usage.exhaustedWindow)
        XCTAssertEqual(usage.banks.count, 1)
        XCTAssertEqual(usage.banks.nextExpiresAt, "2026-12-25T12:00:00.000Z")
        let exhausted = CloudUsageWindow(kind: "five_hour", limit: "10", used: "10", remaining: "0", resetsAt: nil)
        XCTAssertTrue(exhausted.isExhausted)
        XCTAssertEqual(exhausted.fractionUsed, 1)
    }

    func testRedeemReturnsTheResetWindows() throws {
        let response = try JSONDecoder().decode(CloudRedeemBankResponse.self, from: CloudFixtures.data("usage-redeem"))
        XCTAssertEqual(response.usage.banks.count, 0)
        XCTAssertEqual(response.usage.windows.week.used, "0")
    }

    func testRunPushOpensItsConversation() throws {
        let push = try JSONDecoder().decode(CloudRunPush.self, from: CloudFixtures.data("run-push"))
        XCTAssertEqual(push.conversationID, "conv_1")
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "DJL task finished"]],
            "source": "djl.cloudRun",
            "runId": "run_1",
            "conversationId": "conv_1",
            "status": "succeeded",
            "url": "djl://cloud/c/conv_1",
        ]
        XCTAssertEqual(CloudRunPush(userInfo: userInfo)?.conversationID, "conv_1")
        XCTAssertNil(CloudRunPush(userInfo: ["source": "codex.runCompletion", "url": "djl://cloud/c/conv_1"]))
        XCTAssertNil(CloudRunPush(userInfo: ["source": "djl.cloudRun", "url": "https://evil.test/c/x"])?.conversationID)
    }
}
