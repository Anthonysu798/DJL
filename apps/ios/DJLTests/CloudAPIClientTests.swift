import XCTest
@testable import DJL

final class CloudAPIClientTests: XCTestCase {
    private typealias Reply = CloudStubURLProtocol.Reply
    private let configuration = CloudAPIConfiguration(baseURL: URL(string: "https://api.test")!)

    private func makeClient(tokens: [String] = ["jwt-1"]) -> (CloudAPIClient, CloudCountingTokenProvider) {
        let provider = CloudCountingTokenProvider(tokens: tokens)
        return (CloudAPIClient(configuration: configuration, tokenProvider: provider, urlSession: CloudStubURLProtocol.session()), provider)
    }

    // MARK: Transport

    func testCloudSessionNeverStoresOrSendsCookies() {
        let configuration = URLSession.djlCloud.configuration
        XCTAssertNil(configuration.httpCookieStorage)
        XCTAssertFalse(configuration.httpShouldSetCookies)
        XCTAssertEqual(configuration.httpCookieAcceptPolicy, .never)
    }

    // MARK: Auth header and refresh

    func testSendsBearerAccessToken() async throws {
        let me = try CloudFixtures.string("me")
        CloudStubURLProtocol.install { _, _ in .json(200, me) }
        let (client, _) = makeClient()

        let result = try await client.me()

        XCTAssertEqual(result.user.email, "ada@example.com")
        let request = try XCTUnwrap(CloudStubURLProtocol.requests.first?.request)
        XCTAssertEqual(request.url?.absoluteString, "https://api.test/v1/me")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer jwt-1")
    }

    func testRefreshesTheAccessTokenOnceOn401() async throws {
        let me = try CloudFixtures.string("me")
        CloudStubURLProtocol.install { request, _ in
            request.value(forHTTPHeaderField: "Authorization") == "Bearer stale" ? .json(401, "{}") : .json(200, me)
        }
        let (client, provider) = makeClient(tokens: ["stale", "fresh"])

        _ = try await client.me()

        let invalidations = await provider.invalidations
        XCTAssertEqual(invalidations, 1)
        XCTAssertEqual(CloudStubURLProtocol.requests.map { $0.request.value(forHTTPHeaderField: "Authorization") }, ["Bearer stale", "Bearer fresh"])
    }

    func testSecond401EndsTheSession() async throws {
        CloudStubURLProtocol.install { _, _ in .json(401, "{}") }
        let (client, provider) = makeClient(tokens: ["a", "b", "c"])

        do {
            _ = try await client.me()
            XCTFail("Expected unauthorized")
        } catch {
            XCTAssertEqual(error as? CloudAPIError, .unauthorized)
        }
        XCTAssertEqual(CloudStubURLProtocol.requests.count, 2, "Refresh is attempted exactly once")
        let invalidations = await provider.invalidations
        XCTAssertEqual(invalidations, 1)
    }

    func testRevokedSessionEndsWithoutARetry() async throws {
        CloudStubURLProtocol.install { _, _ in
            .json(401, #"{"error":{"code":"session_revoked","message":"Signed out.","traceId":"t"}}"#)
        }
        let (client, provider) = makeClient(tokens: ["a", "b"])

        do {
            _ = try await client.me()
            XCTFail("Expected unauthorized")
        } catch {
            XCTAssertEqual(error as? CloudAPIError, .unauthorized)
        }
        XCTAssertEqual(CloudStubURLProtocol.requests.count, 1)
        let invalidations = await provider.invalidations
        XCTAssertEqual(invalidations, 0)
    }

    // MARK: Endpoints

    private func recordedPaths() -> [String] {
        CloudStubURLProtocol.requests.map { "\($0.request.httpMethod ?? "?") \($0.request.url?.path ?? "")" }
    }

    private func jsonBody(_ index: Int) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(CloudStubURLProtocol.requests[index].body)) as? [String: Any])
    }

    func testUsageEndpoints() async throws {
        let windows = try CloudFixtures.string("usage-windows")
        let redeem = try CloudFixtures.string("usage-redeem")
        CloudStubURLProtocol.install { request, _ in .json(200, request.httpMethod == "POST" ? redeem : windows) }
        let (client, _) = makeClient()

        let usage = try await client.usageWindows()
        let redeemed = try await client.redeemBank(idempotencyKey: "k1")

        XCTAssertEqual(usage.banks.count, 1)
        XCTAssertEqual(redeemed.usage.banks.count, 0)
        XCTAssertEqual(recordedPaths(), ["GET /v1/usage/windows", "POST /v1/usage/resets/redeem"])
        XCTAssertEqual(try jsonBody(1)["idempotencyKey"] as? String, "k1")
    }

    func testRegistersThePushTokenWithTheContractBody() async throws {
        CloudStubURLProtocol.install { _, _ in Reply(status: 204) }
        let (client, _) = makeClient()

        try await client.registerPushToken("abcdef0123456789abcdef0123456789", environment: .sandbox)

        XCTAssertEqual(recordedPaths(), ["POST /v1/devices/push-token"])
        let body = try jsonBody(0)
        XCTAssertEqual(body as? [String: String], ["token": "abcdef0123456789abcdef0123456789", "environment": "sandbox"])
    }

    func testDeletesTheAccount() async throws {
        let deleted = try CloudFixtures.string("account-delete")
        CloudStubURLProtocol.install { _, _ in .json(200, deleted) }
        let (client, _) = makeClient()

        try await client.deleteAccount()

        XCTAssertEqual(recordedPaths(), ["DELETE /v1/me"])
    }

    func testSharesAConversationBranch() async throws {
        let created = try CloudFixtures.string("share-create")
        CloudStubURLProtocol.install { _, _ in .json(201, created) }
        let (client, _) = makeClient()

        let share = try await client.createShare(conversationId: "conv_1", messageId: "msg_2")

        XCTAssertEqual(share.url, "https://app.slcor.com/share/token_example")
        XCTAssertEqual(recordedPaths(), ["POST /v1/conversations/conv_1/shares"])
        XCTAssertEqual(try jsonBody(0) as? [String: String], ["messageId": "msg_2"])
    }

    func testUploadDeclaresHashAndPurposeThenCompletes() async throws {
        let presign = try CloudFixtures.string("file-presign")
        let file = try CloudFixtures.string("file")
        CloudStubURLProtocol.install { request, _ in
            switch (request.httpMethod, request.url?.path) {
            case ("POST", "/v1/files"): return .json(201, presign)
            case ("PUT", _): return Reply(status: 200)
            default: return .json(200, file)
            }
        }
        let (client, _) = makeClient()
        let data = Data("hello".utf8)

        let uploaded = try await client.uploadFile(name: "notes.pdf", mimeType: "application/pdf", data: data)

        XCTAssertEqual(uploaded.status, "ready")
        XCTAssertEqual(recordedPaths(), ["POST /v1/files", "PUT /upload/file_1", "POST /v1/files/file_1/complete"])
        let body = try jsonBody(0)
        XCTAssertEqual(body["sha256"] as? String, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
        XCTAssertEqual(body["purpose"] as? String, "attachment")
        XCTAssertEqual(body["size"] as? Int, 5)
        XCTAssertNil(CloudStubURLProtocol.requests[1].request.value(forHTTPHeaderField: "Authorization"), "Storage PUTs never carry the API token")
    }

    func testImageUploadsUseTheImagePurpose() async throws {
        let presign = try CloudFixtures.string("file-presign")
        let file = try CloudFixtures.string("file")
        CloudStubURLProtocol.install { request, _ in
            request.url?.path == "/v1/files" ? .json(201, presign) : (request.httpMethod == "PUT" ? Reply(status: 200) : .json(200, file))
        }
        let (client, _) = makeClient()

        _ = try await client.uploadFile(name: "a.png", mimeType: "image/png", data: Data([1]))

        XCTAssertEqual(try jsonBody(0)["purpose"] as? String, "image")
    }

    func testDownloadURLUsesTheSignedURLRoute() async throws {
        let signed = try CloudFixtures.string("file-url")
        CloudStubURLProtocol.install { _, _ in .json(200, signed) }
        let (client, _) = makeClient()

        let url = try await client.downloadURL(fileId: "file_1")

        XCTAssertEqual(url.absoluteString, "https://storage.example.com/file_1?signature=abc")
        XCTAssertEqual(recordedPaths(), ["GET /v1/files/file_1/url"])
    }

    func testRegenerateTargetsTheAssistantReply() async throws {
        let sent = try CloudFixtures.string("send-message")
        CloudStubURLProtocol.install { _, _ in .json(201, sent) }
        let (client, _) = makeClient()

        _ = try await client.regenerate(conversationId: "conv_1", messageId: "msg_2", model: nil)

        XCTAssertEqual(recordedPaths(), ["POST /v1/conversations/conv_1/messages/msg_2/regenerate"])
        XCTAssertEqual(try jsonBody(0).count, 0)
    }

    // MARK: Errors

    func testMapsTheErrorEnvelope() async throws {
        CloudStubURLProtocol.install { _, _ in
            .json(429, #"{"error":{"code":"usage_window_exhausted","message":"Limit reached.","traceId":"t1","resetsAt":"2026-09-26T17:00:00.000Z"}}"#)
        }
        let (client, _) = makeClient()

        do {
            _ = try await client.usageWindows()
            XCTFail("Expected an error")
        } catch let error as CloudAPIError {
            XCTAssertEqual(error, .server(status: 429, code: "usage_window_exhausted", message: "Limit reached.", traceId: "t1", resetsAt: "2026-09-26T17:00:00.000Z"))
            XCTAssertEqual(error.code, "usage_window_exhausted")
            XCTAssertFalse(error.isRetryable)
        }
    }

    func testNonEnvelopeErrorsStillMap() {
        let error = CloudAPIError.from(status: 503, data: Data("<html>".utf8))
        XCTAssertEqual(error.code, "http_503")
        XCTAssertTrue(error.isRetryable)
    }

    // MARK: Idempotent send

    func testSendRetryReusesTheClientMessageId() async throws {
        let sent = try CloudFixtures.string("send-message")
        var calls = 0
        CloudStubURLProtocol.install { _, _ in
            calls += 1
            return calls == 1 ? .json(503, #"{"error":{"code":"overloaded","message":"Busy","traceId":"t"}}"#) : .json(200, sent)
        }
        let (client, _) = makeClient()
        let input = CloudSendMessageInput(clientMessageId: "client-42", parentId: nil, parts: [.text("Hello")], model: "gpt-5", mode: "chat")

        let response = try await client.sendMessage(conversationId: "conv_1", input: input, retryDelay: .milliseconds(1))

        XCTAssertEqual(response.run.id, "run_1")
        let bodies = try CloudStubURLProtocol.requests.map { try JSONDecoder().decode(CloudSendMessageInput.self, from: XCTUnwrap($0.body)) }
        XCTAssertEqual(bodies.count, 2)
        XCTAssertEqual(Set(bodies.map(\.clientMessageId)), ["client-42"])
        XCTAssertEqual(bodies[0], bodies[1])
    }

    func testSendDoesNotRetryClientErrors() async throws {
        CloudStubURLProtocol.install { _, _ in .json(400, #"{"error":{"code":"bad_request","message":"No","traceId":"t"}}"#) }
        let (client, _) = makeClient()
        let input = CloudSendMessageInput(clientMessageId: "c", parentId: nil, parts: [.text("x")], model: "m", mode: "chat")

        do {
            _ = try await client.sendMessage(conversationId: "conv_1", input: input, retryDelay: .milliseconds(1))
            XCTFail("Expected an error")
        } catch {}
        XCTAssertEqual(CloudStubURLProtocol.requests.count, 1)
    }

    // MARK: Run streaming

    private func event(_ seq: Int, _ type: String, _ payload: String) -> String {
        "id: \(seq)\nevent: \(type)\ndata: {\"runId\":\"run_1\",\"seq\":\(seq),\"type\":\"\(type)\",\"payload\":\(payload),\"createdAt\":\"2026-09-26T12:00:00.000Z\"}\n\n"
    }

    func testStreamResumesAfterTheLastSeqAndStopsOnTerminalStatus() async throws {
        let first = event(1, "text.delta", #"{"messageId":"msg_2","text":"Hel"}"#)
        let second = event(2, "text.delta", #"{"messageId":"msg_2","text":"lo"}"#)
        let done = event(3, "status", #"{"status":"succeeded","error":null}"#)
        CloudStubURLProtocol.install { request, _ in
            let after = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "after" }?.value
            if after == "0" {
                // Split frame + heartbeat, then the connection drops without a terminal status.
                let split = second.index(second.startIndex, offsetBy: 20)
                return .sse(["retry: 3000\n\n", ": heartbeat\n\n", first, String(second[..<split]), String(second[split...])])
            }
            // A resumed stream may replay an already-seen event; it must be ignored.
            return .sse([second, done])
        }
        let (client, _) = makeClient()

        var seqs: [Int] = []
        for try await event in client.streamRun("run_1", after: 0, reconnectDelay: .milliseconds(1)) {
            seqs.append(event.seq)
        }

        XCTAssertEqual(seqs, [1, 2, 3])
        let afters = CloudStubURLProtocol.requests.map { URLComponents(url: $0.request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "after" }?.value }
        XCTAssertEqual(afters, ["0", "2"])
        XCTAssertEqual(CloudStubURLProtocol.requests.first?.request.value(forHTTPHeaderField: "Accept"), "text/event-stream")
    }

    // MARK: JWT exchange

    func testJWTProviderExchangesTheSessionAndCaches() async throws {
        // exp far in the future: header.payload.signature with {"exp": 4102444800}
        let jwt = "e30.eyJleHAiOjQxMDI0NDQ4MDB9.sig"
        CloudStubURLProtocol.install { _, _ in .json(200, "{\"token\":\"\(jwt)\"}") }
        let provider = CloudJWTAccessTokenProvider(configuration: configuration, sessionStore: CloudMemorySessionStore(token: "session-1"), urlSession: CloudStubURLProtocol.session())

        let a = try await provider.accessToken()
        let b = try await provider.accessToken()

        XCTAssertEqual(a, jwt)
        XCTAssertEqual(b, jwt)
        XCTAssertEqual(CloudStubURLProtocol.requests.count, 1)
        let request = try XCTUnwrap(CloudStubURLProtocol.requests.first?.request)
        XCTAssertEqual(request.url?.path, "/v1/auth/token")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer session-1")

        await provider.invalidate()
        _ = try await provider.accessToken()
        XCTAssertEqual(CloudStubURLProtocol.requests.count, 2)
    }

    func testJWTProviderWithoutASessionIsUnauthorized() async {
        let provider = CloudJWTAccessTokenProvider(configuration: configuration, sessionStore: CloudMemorySessionStore(), urlSession: CloudStubURLProtocol.session())
        do {
            _ = try await provider.accessToken()
            XCTFail("Expected unauthorized")
        } catch {
            XCTAssertEqual(error as? CloudAPIError, .unauthorized)
        }
    }

    func testJWTExpiryIsReadFromThePayload() {
        XCTAssertEqual(CloudJWTAccessTokenProvider.expiry(ofJWT: "e30.eyJleHAiOjQxMDI0NDQ4MDB9.sig"), Date(timeIntervalSince1970: 4_102_444_800))
        XCTAssertNil(CloudJWTAccessTokenProvider.expiry(ofJWT: "not-a-jwt"))
    }

    // MARK: Auth API and configuration

    func testSocialSignInPostsTheIdTokenAndReadsTheSession() async throws {
        CloudStubURLProtocol.install { _, _ in .json(200, #"{"redirect":false,"token":"sess-9","user":{}}"#) }
        let auth = CloudAuthAPI(configuration: configuration, urlSession: CloudStubURLProtocol.session())

        let token = try await auth.signIn(provider: "apple", idToken: "id-token", nonce: "n1")

        XCTAssertEqual(token, "sess-9")
        let recorded = try XCTUnwrap(CloudStubURLProtocol.requests.first)
        XCTAssertEqual(recorded.request.url?.path, "/v1/auth/sign-in/social")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(recorded.body)) as? [String: Any])
        XCTAssertEqual(body["provider"] as? String, "apple")
        XCTAssertEqual(body["idToken"] as? [String: String], ["token": "id-token", "nonce": "n1"])
    }

    func testSessionTokenComesFromTheBearerHeaderFirst() {
        let response = HTTPURLResponse(url: URL(string: "https://api.test")!, statusCode: 200, httpVersion: nil, headerFields: ["set-auth-token": "from-header"])!
        XCTAssertEqual(CloudAuthAPI.extractToken(data: Data("{}".utf8), response: response), "from-header")
        XCTAssertEqual(CloudAuthAPI.extractToken(data: Data(#"{"token":"from-body"}"#.utf8), response: response), "from-header")
        let bare = HTTPURLResponse(url: URL(string: "https://api.test")!, statusCode: 200, httpVersion: nil, headerFields: [:])!
        XCTAssertEqual(CloudAuthAPI.extractToken(data: Data(#"{"token":"from-body"}"#.utf8), response: bare), "from-body")
    }

    func testBaseURLResolution() {
        XCTAssertEqual(CloudAPIConfiguration.resolved(bundleValue: nil, developmentOverride: nil).baseURL.absoluteString, "https://api.slcor.com")
        XCTAssertEqual(CloudAPIConfiguration.resolved(bundleValue: "https://api-asia.slcor.com", developmentOverride: nil).baseURL.absoluteString, "https://api-asia.slcor.com")
        XCTAssertEqual(CloudAPIConfiguration.resolved(bundleValue: "https://api.slcor.com", developmentOverride: "http://localhost:8787").baseURL.absoluteString, "http://localhost:8787")
        for invalid in ["", "$(DJL_CLOUD_API_URL)", "ftp://x", "https://user:pw@api.slcor.com", "https://api.slcor.com?x=1"] {
            XCTAssertEqual(CloudAPIConfiguration.resolved(bundleValue: invalid, developmentOverride: nil).baseURL.absoluteString, "https://api.slcor.com", invalid)
        }
    }
}
