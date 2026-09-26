import XCTest
@testable import DJL

final class CloudAPIClientTests: XCTestCase {
    private let configuration = CloudAPIConfiguration(baseURL: URL(string: "https://api.test")!)

    private func makeClient(tokens: [String] = ["jwt-1"]) -> (CloudAPIClient, CloudCountingTokenProvider) {
        let provider = CloudCountingTokenProvider(tokens: tokens)
        return (CloudAPIClient(configuration: configuration, tokenProvider: provider, urlSession: CloudStubURLProtocol.session()), provider)
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

    // MARK: Errors

    func testMapsTheErrorEnvelope() async throws {
        CloudStubURLProtocol.install { _, _ in
            .json(429, #"{"error":{"code":"usage_window_exhausted","message":"Limit reached.","traceId":"t1","resetsAt":"2026-09-26T17:00:00.000Z"}}"#)
        }
        let (client, _) = makeClient()

        do {
            _ = try await client.usageStatus()
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
        "event: \(type)\ndata: {\"runId\":\"run_1\",\"seq\":\(seq),\"type\":\"\(type)\",\"payload\":\(payload),\"createdAt\":\"2026-09-26T12:00:00.000Z\"}\n\n"
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
                return .sse([": ping\n\n", first, String(second[..<split]), String(second[split...])])
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

    func testSessionTokenFallsBackToTheBearerHeader() {
        let response = HTTPURLResponse(url: URL(string: "https://api.test")!, statusCode: 200, httpVersion: nil, headerFields: ["set-auth-token": "from-header"])!
        XCTAssertEqual(CloudAuthAPI.extractToken(data: Data("{}".utf8), response: response), "from-header")
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
