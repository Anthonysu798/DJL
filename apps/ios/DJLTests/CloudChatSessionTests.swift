import XCTest
@testable import DJL

final class CloudChatSessionTests: XCTestCase {
    @MainActor
    func testRetryKeepsTheAcceptedMessageIdentityAndReportsAcceptance() async throws {
        let me = try CloudFixtures.string("me")
        let models = try CloudFixtures.string("models")
        let list = try CloudFixtures.string("conversation-list")
        let conversation = try CloudFixtures.string("conversation")
        let reply = try CloudFixtures.string("send-message")
        var sends = 0
        CloudStubURLProtocol.install { request, _ in
            switch request.url?.path {
            case "/v1/me": return .json(200, me)
            case "/v1/models": return .json(200, models)
            case "/v1/conversations": return .json(200, request.httpMethod == "POST" ? conversation : list)
            case "/v1/conversations/conv_1/messages":
                sends += 1
                return sends <= 3 ? .json(503, #"{"error":{"code":"unavailable","message":"Retry","traceId":"test"}}"#) : .json(200, reply)
            default: return .json(200, "{}")
            }
        }
        let cloud = CloudService(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), sessionStore: CloudMemorySessionStore(token: "session"), urlSession: CloudStubURLProtocol.session(), tokenProvider: CloudCountingTokenProvider(tokens: ["jwt"]), draftStore: CloudDraftStore(defaults: UserDefaults(suiteName: "djl-tests-\(UUID())")!))
        await cloud.refreshAll()
        let session = CloudChatSession(cloud: cloud, conversation: nil)
        let first = await session.send(text: "Keep this draft", attachments: [])
        XCTAssertFalse(first)
        let retried = await session.send(text: "Keep this draft", attachments: [])
        XCTAssertTrue(retried)
        session.suspendStreaming()
        let bodies = try CloudStubURLProtocol.requests.filter { $0.request.url?.path == "/v1/conversations/conv_1/messages" }.map { try JSONDecoder().decode(CloudSendMessageInput.self, from: XCTUnwrap($0.body)) }
        XCTAssertEqual(bodies.count, 4)
        XCTAssertEqual(bodies[0].clientMessageId, bodies[3].clientMessageId)
        XCTAssertEqual(bodies[0].model, bodies[3].model)
    }
}

extension CloudChatSessionTests {
    @MainActor func testLostAcknowledgementKeepsSendIdentityAfterTheChatViewIsRecreated() async throws {
        let me=try CloudFixtures.string("me"),models=try CloudFixtures.string("models"),conversation=try CloudFixtures.string("conversation"),reply=try CloudFixtures.string("send-message")
        var calls=0
        CloudStubURLProtocol.install {request,_ in
            switch request.url?.path {
            case "/v1/me":return .json(200,me)
            case "/v1/models":return .json(200,models)
            case "/v1/conversations":return .json(200,request.httpMethod=="POST" ? conversation : #"{"conversations":[],"nextCursor":null}"#)
            case "/v1/conversations/conv_1/messages":calls+=1;return calls<=3 ? .json(503,#"{"error":{"code":"unavailable","message":"Retry","traceId":"test"}}"#):.json(200,reply)
            default:return .json(200,"{}")
            }
        }
        let cloud=CloudService(configuration:CloudAPIConfiguration(baseURL:URL(string:"https://test.invalid")!),sessionStore:CloudMemorySessionStore(token:"session"),urlSession:CloudStubURLProtocol.session(),tokenProvider:CloudCountingTokenProvider(tokens:["jwt"]),draftStore:CloudDraftStore(defaults:UserDefaults(suiteName:"navigation-send-\(UUID())")!))
        await cloud.refreshAll()
        let first=CloudChatSession(cloud:cloud,conversation:nil)
        let failed=await first.send(text:"Retained after navigation",attachments:[])
        XCTAssertFalse(failed)
        let reopened=CloudChatSession(cloud:cloud,conversation:first.conversation)
        let accepted=await reopened.send(text:"Retained after navigation",attachments:[])
        XCTAssertTrue(accepted)
        reopened.suspendStreaming()
        let inputs=try CloudStubURLProtocol.requests.filter{$0.request.url?.path=="/v1/conversations/conv_1/messages"}.map{try JSONDecoder().decode(CloudSendMessageInput.self,from:XCTUnwrap($0.body))}
        XCTAssertEqual(inputs.first?.clientMessageId,inputs.last?.clientMessageId)
    }
}
