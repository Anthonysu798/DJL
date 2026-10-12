import XCTest
@testable import DJL

final class CloudAuthRecoveryTests: XCTestCase {
    override func tearDown() { CloudStubURLProtocol.install { _, _ in .json(500, "{}") } }

    func testInvalidEmailCodeDoesNotClaimPasswordMismatch() async {
        CloudStubURLProtocol.install { _, _ in .json(401, #"{"code":"INVALID_OTP","message":"That code is incorrect or expired."}"#) }
        let auth = CloudAuthAPI(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), urlSession: CloudStubURLProtocol.session())
        do {
            _ = try await auth.signIn(email: "test@example.com", code: "123456")
            XCTFail("Expected an invalid code")
        } catch {
            XCTAssertEqual(error.localizedDescription, "That code is incorrect or expired.")
        }
    }

    func testCodePasswordAndResendValidation() {
        XCTAssertFalse(CloudAuthFormState.isValidCode("12a456"))
        XCTAssertFalse(CloudAuthFormState.isValidCode("１２３４５６"))
        XCTAssertTrue(CloudAuthFormState.isValidCode("123456"))
        XCTAssertFalse(CloudAuthFormState.isValidPassword(String(repeating: "a", count: 9)))
        XCTAssertTrue(CloudAuthFormState.isValidPassword(String(repeating: "a", count: 10)))
        XCTAssertTrue(CloudAuthFormState.isValidPassword(String(repeating: "a", count: 256)))
        XCTAssertFalse(CloudAuthFormState.isValidPassword(String(repeating: "a", count: 257)))
        let sentAt = Date(timeIntervalSince1970: 0)
        XCTAssertFalse(CloudAuthFormState.canResend(sentAt: sentAt, now: sentAt.addingTimeInterval(59)))
        XCTAssertTrue(CloudAuthFormState.canResend(sentAt: sentAt, now: sentAt.addingTimeInterval(60)))
    }

    func testPasswordRecoveryUsesTheEmailOtpRoutes() async throws {
        CloudStubURLProtocol.install { _, _ in .json(200, #"{"success":true}"#) }
        let auth = CloudAuthAPI(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), urlSession: CloudStubURLProtocol.session())
        try await auth.requestPasswordReset(email: "test@example.com")
        try await auth.resetPassword(email: "test@example.com", code: "123456", password: "A-new-test-password")
        XCTAssertEqual(CloudStubURLProtocol.requests.map { $0.request.url?.path }, ["/v1/auth/email-otp/request-password-reset", "/v1/auth/email-otp/reset-password"])
        let body = try JSONDecoder().decode([String: String].self, from: XCTUnwrap(CloudStubURLProtocol.requests.last?.body))
        XCTAssertEqual(body["otp"], "123456")
        XCTAssertEqual(body["password"], "A-new-test-password")
    }

    func testSignupUsesTheServerGeneratedVerificationCode() async throws {
        CloudStubURLProtocol.install { _, _ in .json(200, #"{"user":{"id":"new-user"}}"#) }
        let auth = CloudAuthAPI(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), urlSession: CloudStubURLProtocol.session())
        let result = try await auth.signUp(name: "Test", email: "test@example.com", password: "A-new-test-password")
        XCTAssertEqual(result, .verificationRequired)
        XCTAssertEqual(CloudStubURLProtocol.requests.count, 1, "Signup already sends an OTP; sending a second code invalidates the first email.")
    }

    @MainActor
    func testSignOutClearsTheSessionBeforeNetworkRevocationFinishes() async throws {
        let started = expectation(description: "revocation started")
        let release = DispatchSemaphore(value: 0)
        CloudStubURLProtocol.install { _, _ in
            started.fulfill(); _ = release.wait(timeout: .now() + 5)
            return .json(200, #"{"success":true}"#)
        }
        let store = CloudMemorySessionStore(token: "session")
        let cloud = CloudService(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), sessionStore: store, urlSession: CloudStubURLProtocol.session(), tokenProvider: CloudCountingTokenProvider(tokens: ["jwt"]), draftStore: CloudDraftStore(defaults: UserDefaults(suiteName: "djl-tests-\(UUID())")!))
        let signOut = Task { await cloud.signOut() }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertFalse(cloud.isSignedIn)
        XCTAssertNil(store.readSessionToken())
        release.signal()
        await signOut.value
    }

    @MainActor
    func testDelayedRefreshCannotRepopulateSignedOutAccount() async throws {
        let started = expectation(description: "me request started")
        let release = DispatchSemaphore(value: 0)
        let me = try CloudFixtures.string("me")
        let models = try CloudFixtures.string("models")
        let list = try CloudFixtures.string("conversation-list")
        CloudStubURLProtocol.install { request, _ in
            switch request.url?.path {
            case "/v1/me": started.fulfill(); _ = release.wait(timeout: .now() + 5); return .json(200, me)
            case "/v1/models": return .json(200, models)
            case "/v1/conversations": return .json(200, list)
            default: return .json(200, "{}")
            }
        }
        let cloud = CloudService(configuration: CloudAPIConfiguration(baseURL: URL(string: "https://test.invalid")!), sessionStore: CloudMemorySessionStore(token: "session"), urlSession: CloudStubURLProtocol.session(), tokenProvider: CloudCountingTokenProvider(tokens: ["jwt"]), draftStore: CloudDraftStore(defaults: UserDefaults(suiteName: "djl-tests-\(UUID())")!))
        let refresh = Task { await cloud.refreshAll() }
        await fulfillment(of: [started], timeout: 3)
        cloud.handle(CloudAPIError.unauthorized)
        release.signal()
        await refresh.value
        XCTAssertFalse(cloud.isSignedIn)
        XCTAssertNil(cloud.me)
        XCTAssertTrue(cloud.conversations.isEmpty)
    }
}
