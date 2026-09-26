import XCTest
@testable import DJL

@MainActor
final class CloudChatLogicTests: XCTestCase {
    // MARK: Routing

    func testSignedInUsersLandInCloudChat() {
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: true, preference: .automatic, hasPairedMac: false), .cloudHome)
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: true, preference: .automatic, hasPairedMac: true), .cloudHome)
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: true, preference: .cloud, hasPairedMac: true), .cloudHome)
    }

    func testSignedOutUsersSeeWelcomeUnlessTheyAlreadyPairedAMac() {
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: false, preference: .automatic, hasPairedMac: false), .welcome)
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: false, preference: .automatic, hasPairedMac: true), .myMacs)
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: false, preference: .cloud, hasPairedMac: true), .welcome)
    }

    func testMyMacsIsAlwaysReachable() {
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: true, preference: .myMacs, hasPairedMac: false), .myMacs)
        XCTAssertEqual(CloudRootRoute.resolve(isSignedIn: false, preference: .myMacs, hasPairedMac: false), .myMacs)
    }

    func testCloudServiceRoutesFromTheStoredSession() {
        let signedIn = CloudService(sessionStore: CloudMemorySessionStore(token: "s"), urlSession: CloudStubURLProtocol.session())
        XCTAssertEqual(signedIn.route(hasPairedMac: true), .cloudHome)
        let signedOut = CloudService(sessionStore: CloudMemorySessionStore(), urlSession: CloudStubURLProtocol.session())
        XCTAssertEqual(signedOut.route(hasPairedMac: false), .welcome)
    }

    func testUnauthorizedErrorsSignOutLocally() {
        let store = CloudMemorySessionStore(token: "s")
        let cloud = CloudService(sessionStore: store, urlSession: CloudStubURLProtocol.session())
        cloud.handle(CloudAPIError.unauthorized)
        XCTAssertFalse(cloud.isSignedIn)
        XCTAssertNil(store.readSessionToken())
        XCTAssertEqual(cloud.route(hasPairedMac: false), .welcome)
    }

    func testCloudDeepLink() {
        XCTAssertEqual(CloudDeepLink.conversationID(from: URL(string: "djl://cloud/c/conv_1")!), "conv_1")
        XCTAssertNil(CloudDeepLink.conversationID(from: URL(string: "djl://thread/abc")!))
        XCTAssertNil(CloudDeepLink.conversationID(from: URL(string: "https://cloud/c/conv_1")!))
        XCTAssertNil(CloudDeepLink.conversationID(from: URL(string: "djl://cloud/c/")!))
    }

    // MARK: Message tree

    private func message(_ id: String, parent: String?, role: String = "user", at second: Int) -> CloudMessage {
        CloudMessage(id: id, conversationId: "c", parentId: parent, role: role, parts: [.text(id)], model: nil, runId: nil, createdAt: String(format: "2026-09-26T12:00:%02d.000Z", second))
    }

    func testVisibleBranchFollowsTheNewestChildByDefault() {
        let tree = CloudMessageTree(messages: [
            message("u1", parent: nil, at: 0),
            message("a1", parent: "u1", role: "assistant", at: 1),
            message("a1b", parent: "u1", role: "assistant", at: 5), // regenerated
            message("u2", parent: "a1", at: 2),
        ])
        XCTAssertEqual(tree.visibleBranch().map(\.id), ["u1", "a1b"])
        XCTAssertEqual(tree.visibleBranch(selections: ["u1": "a1"]).map(\.id), ["u1", "a1", "u2"])
    }

    func testSiblingsDriveTheBranchSwitcher() {
        let edited = message("u1b", parent: nil, at: 3)
        let tree = CloudMessageTree(messages: [message("u1", parent: nil, at: 0), edited])
        let siblings = tree.siblings(of: edited)
        XCTAssertEqual(siblings.ids, ["u1", "u1b"])
        XCTAssertEqual(siblings.index, 1)
        XCTAssertEqual(CloudMessageTree.forkKey(for: edited), "")
    }

    // MARK: Run event reducer

    func testReducerAppendsDeltasPartsAndSteps() throws {
        var messages = [CloudMessage(id: "m", conversationId: "c", parentId: nil, role: "assistant", parts: [], model: nil, runId: "r", createdAt: "")]
        var steps: [CloudTaskStep] = []
        func apply(_ seq: Int, _ payload: CloudRunEventPayload) {
            CloudRunEventReducer.apply(CloudRunEvent(runId: "r", seq: seq, createdAt: "", payload: payload), to: &messages, steps: &steps)
        }

        apply(1, .stepStarted(step: 1, maxSteps: 25))
        apply(2, .textDelta(messageId: "m", text: "Hel"))
        apply(3, .textDelta(messageId: "m", text: "lo"))
        apply(4, .part(messageId: "m", part: .toolCall(toolCallId: "t", name: "generate_image", arguments: "{}")))
        apply(5, .part(messageId: "m", part: .imageRef(fileId: "f", mimeType: "image/png", width: nil, height: nil)))
        apply(6, .textDelta(messageId: "m", text: "Done"))

        XCTAssertEqual(messages[0].parts, [
            .text("Hello"),
            .toolCall(toolCallId: "t", name: "generate_image", arguments: "{}"),
            .imageRef(fileId: "f", mimeType: "image/png", width: nil, height: nil),
            .text("Done"),
        ])
        XCTAssertEqual(steps, [CloudTaskStep(id: 1, maxSteps: 25, tools: ["generate_image"])])
    }

    // MARK: List grouping and attachments

    func testConversationsGroupByDateWithPinnedFirst() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = CloudDate.parse("2026-09-26T15:00:00.000Z")!
        func conversation(_ id: String, _ updatedAt: String, pinned: Bool = false) -> CloudConversation {
            CloudConversation(id: id, title: id, pinned: pinned, archived: false, createdAt: updatedAt, updatedAt: updatedAt)
        }
        let groups = CloudConversationGrouping.groups([
            conversation("today", "2026-09-26T09:00:00.000Z"),
            conversation("yesterday", "2026-09-25T09:00:00.000Z"),
            conversation("week", "2026-09-21T09:00:00Z"),
            conversation("month", "2026-09-01T09:00:00.000Z"),
            conversation("old", "2026-01-01T09:00:00.000Z"),
            conversation("pinned", "2025-01-01T09:00:00.000Z", pinned: true),
        ], now: now, calendar: calendar)
        XCTAssertEqual(groups.map(\.title), ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"])
        XCTAssertEqual(groups.map { $0.conversations.map(\.id) }, [["pinned"], ["today"], ["yesterday"], ["week"], ["month"], ["old"]])
    }

    func testAttachmentPolicy() {
        XCTAssertNoThrow(try CloudAttachmentPolicy.validate(mimeType: "image/jpeg", byteCount: 1000, existingCount: 0))
        XCTAssertNoThrow(try CloudAttachmentPolicy.validate(mimeType: "application/pdf", byteCount: CloudAttachmentPolicy.maxBytes, existingCount: 0))
        XCTAssertThrowsError(try CloudAttachmentPolicy.validate(mimeType: "application/pdf", byteCount: CloudAttachmentPolicy.maxBytes + 1, existingCount: 0)) {
            XCTAssertEqual($0 as? CloudAttachmentPolicy.Rejection, .tooLarge)
        }
        XCTAssertThrowsError(try CloudAttachmentPolicy.validate(mimeType: "application/x-msdownload", byteCount: 10, existingCount: 0)) {
            XCTAssertEqual($0 as? CloudAttachmentPolicy.Rejection, .unsupportedType)
        }
        XCTAssertThrowsError(try CloudAttachmentPolicy.validate(mimeType: "image/png", byteCount: 0, existingCount: 0))
        XCTAssertThrowsError(try CloudAttachmentPolicy.validate(mimeType: "image/png", byteCount: 1, existingCount: CloudAttachmentPolicy.maxAttachmentsPerMessage))
        XCTAssertEqual(CloudAttachmentPolicy.mimeType(forFilename: "Plan.PDF"), "application/pdf")
        XCTAssertEqual(CloudAttachmentPolicy.mimeType(forFilename: "notes.md"), "text/markdown")
    }

    func testAppleNonceIsTheSHA256OfTheRawValue() {
        // SHA-256("abc")
        XCTAssertEqual(CloudAppleNonce(raw: "abc").hashed, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertNotEqual(CloudAppleNonce().raw, CloudAppleNonce().raw)
    }
}
