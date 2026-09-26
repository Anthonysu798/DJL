// FILE: CloudAPIClient.swift
// Purpose: async/await URLSession client for the DJL Cloud public API (https://api.slcor.com/v1).
// Layer: Service
// Exports: CloudAPIConfiguration, CloudAPIError, CloudAccessTokenProviding, CloudJWTAccessTokenProvider,
//          CloudSessionBearerTokenProvider, CloudAPIClient
// Depends on: Foundation, CryptoKit, CloudModels, CloudSSEParser, CloudSessionStore

import CryptoKit
import Foundation

// MARK: - Configuration

nonisolated struct CloudAPIConfiguration: Sendable {
    static let defaultBaseURL = URL(string: "https://api.slcor.com")!
    static let infoPlistKey = "DJL_CLOUD_API_URL"

    let baseURL: URL

    /// Debug builds honour a `DJL_CLOUD_API_URL` launch environment (e.g. http://localhost:8787 in Simulator);
    /// every build honours the `DJL_CLOUD_API_URL` build setting; otherwise production.
    static func resolved(
        bundleValue: String? = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String,
        developmentOverride: String? = CloudAPIConfiguration.developmentOverride
    ) -> CloudAPIConfiguration {
        for candidate in [developmentOverride, bundleValue] {
            if let url = validatedURL(candidate) {
                return CloudAPIConfiguration(baseURL: url)
            }
        }
        return CloudAPIConfiguration(baseURL: defaultBaseURL)
    }

    static func validatedURL(_ raw: String?) -> URL? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              !raw.contains("$("),
              let components = URLComponents(string: raw),
              let scheme = components.scheme, ["https", "http"].contains(scheme),
              components.host?.isEmpty == false,
              components.user == nil, components.password == nil, components.query == nil
        else { return nil }
        return components.url
    }

    private static var developmentOverride: String? {
        #if DEBUG
        ProcessInfo.processInfo.environment[infoPlistKey]
        #else
        nil
        #endif
    }
}

// MARK: - Errors

nonisolated enum CloudAPIError: Error, Equatable, LocalizedError {
    /// The session is gone (revoked, expired, deleted); the user must sign in again.
    case unauthorized
    case server(status: Int, code: String, message: String, traceId: String?, resetsAt: String?)
    /// A 401 the access token can't fix: the session itself was signed out (`session_revoked`).
    static let sessionRevokedCode = "session_revoked"
    case transport(String)
    case decoding(String)

    var code: String? {
        if case .server(_, let code, _, _, _) = self { return code }
        return nil
    }

    var isRetryable: Bool {
        switch self {
        case .transport: return true
        case .server(let status, let code, _, _, _): return status >= 500 || code == "overloaded"
        case .unauthorized, .decoding: return false
        }
    }

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Your session has ended. Please sign in again."
        case .server(_, _, let message, _, _): return message
        case .transport(let message): return message
        case .decoding: return "DJL Cloud sent a response this version of the app can't read."
        }
    }

    static func from(status: Int, data: Data) -> CloudAPIError {
        if status == 401 { return .unauthorized }
        if let envelope = try? JSONDecoder().decode(CloudAPIErrorEnvelope.self, from: data) {
            let e = envelope.error
            return .server(status: status, code: e.code, message: e.message, traceId: e.traceId, resetsAt: e.resetsAt)
        }
        // Better Auth routes answer `{ code, message }` without the envelope.
        if let flat = try? JSONDecoder().decode(FlatError.self, from: data) {
            return .server(status: status, code: flat.code ?? "http_\(status)", message: flat.message ?? "Request failed.", traceId: nil, resetsAt: nil)
        }
        return .server(status: status, code: "http_\(status)", message: HTTPURLResponse.localizedString(forStatusCode: status), traceId: nil, resetsAt: nil)
    }

    private struct FlatError: Decodable { let code: String?; let message: String? }
}

// MARK: - Transport

nonisolated extension URLSession {
    /// Cloud traffic authenticates only with the bearer token. A cookie saved at sign-in would
    /// ride along on later auth calls without an Origin header, which the API refuses: signing in
    /// again fails and sign-out never reaches the server.
    static let djlCloud: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        return URLSession(configuration: configuration)
    }()
}

// MARK: - Access tokens

/// Supplies the bearer credential for API calls (a JWT from CloudJWTAccessTokenProvider in the app).
nonisolated protocol CloudAccessTokenProviding: Sendable {
    func accessToken() async throws -> String
    /// Drops any cached token so the next `accessToken()` mints a fresh one.
    func invalidate() async
}

/// Sends the long-lived session token itself (Better Auth `bearer()` plugin).
nonisolated struct CloudSessionBearerTokenProvider: CloudAccessTokenProviding {
    let sessionStore: CloudSessionStoring

    func accessToken() async throws -> String {
        guard let token = sessionStore.readSessionToken() else { throw CloudAPIError.unauthorized }
        return token
    }

    func invalidate() async {}
}

/// Exchanges the session token for a 15-minute JWT at GET /v1/auth/token (Better Auth `jwt()` plugin) and caches it.
actor CloudJWTAccessTokenProvider: CloudAccessTokenProviding {
    private let configuration: CloudAPIConfiguration
    private let sessionStore: CloudSessionStoring
    private let urlSession: URLSession
    private let now: @Sendable () -> Date
    private var cached: (token: String, expiresAt: Date)?
    private var inFlight: Task<String, Error>?

    init(
        configuration: CloudAPIConfiguration,
        sessionStore: CloudSessionStoring,
        urlSession: URLSession = .djlCloud,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.configuration = configuration
        self.sessionStore = sessionStore
        self.urlSession = urlSession
        self.now = now
    }

    func accessToken() async throws -> String {
        if let cached, cached.expiresAt.timeIntervalSince(now()) > 60 {
            return cached.token
        }
        if let inFlight { return try await inFlight.value }
        let task = Task { try await self.exchange() }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }

    func invalidate() {
        cached = nil
    }

    private func exchange() async throws -> String {
        guard let session = sessionStore.readSessionToken() else { throw CloudAPIError.unauthorized }
        var request = URLRequest(url: configuration.baseURL.appending(path: "v1/auth/token"))
        request.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw CloudAPIError.transport(error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw CloudAPIError.from(status: status, data: data) }
        guard let body = try? JSONDecoder().decode(CloudAccessToken.self, from: data) else {
            throw CloudAPIError.decoding("auth/token")
        }
        let expiresAt = Self.expiry(ofJWT: body.token) ?? now().addingTimeInterval(15 * 60)
        cached = (body.token, expiresAt)
        return body.token
    }

    /// Reads `exp` from the unverified JWT payload; only used to schedule refreshes.
    static func expiry(ofJWT token: String) -> Date? {
        let segments = token.split(separator: ".")
        guard segments.count == 3 else { return nil }
        var base64 = segments[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = object["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }
}

// MARK: - Client

nonisolated final class CloudAPIClient: Sendable {
    let configuration: CloudAPIConfiguration
    let tokenProvider: CloudAccessTokenProviding
    private let urlSession: URLSession

    init(configuration: CloudAPIConfiguration, tokenProvider: CloudAccessTokenProviding, urlSession: URLSession = .djlCloud) {
        self.configuration = configuration
        self.tokenProvider = tokenProvider
        self.urlSession = urlSession
    }

    // MARK: Transport

    func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: configuration.baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        return components.url!
    }

    private func makeRequest(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Encodable? = nil) throws -> URLRequest {
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    /// Sends an authenticated request; on 401 mints a fresh access token and retries exactly once,
    /// unless the session itself was revoked, which no new token can fix.
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var attempt = 0
        while true {
            var authorized = request
            authorized.setValue("Bearer \(try await tokenProvider.accessToken())", forHTTPHeaderField: "Authorization")
            let (data, response) = try await transport(authorized)
            if response.statusCode == 401, attempt == 0, !Self.isSessionRevoked(data) {
                attempt += 1
                await tokenProvider.invalidate()
                continue
            }
            guard (200..<300).contains(response.statusCode) else {
                throw CloudAPIError.from(status: response.statusCode, data: data)
            }
            return (data, response)
        }
    }

    private static func isSessionRevoked(_ data: Data) -> Bool {
        (try? JSONDecoder().decode(CloudAPIErrorEnvelope.self, from: data))?.error.code == CloudAPIError.sessionRevokedCode
    }

    private func transport(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw CloudAPIError.transport("No HTTP response.") }
            return (data, http)
        } catch let error as CloudAPIError {
            throw error
        } catch {
            throw CloudAPIError.transport(error.localizedDescription)
        }
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw CloudAPIError.decoding(String(describing: error))
        }
    }

    func send<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Encodable? = nil, as type: T.Type = T.self) async throws -> T {
        let (data, _) = try await perform(try makeRequest(method, path, query: query, body: body))
        return try decode(type, from: data)
    }

    func sendIgnoringBody(_ method: String, _ path: String, body: Encodable? = nil) async throws {
        _ = try await perform(try makeRequest(method, path, body: body))
    }

    // MARK: Account and usage

    func me() async throws -> CloudMe { try await send("GET", "v1/me") }
    func credits() async throws -> CloudCredits { try await send("GET", "v1/credits") }
    func models() async throws -> [CloudModel] { try await send("GET", "v1/models", as: CloudModelsResponse.self).models }
    func usageWindows() async throws -> CloudUsageWindows { try await send("GET", "v1/usage/windows") }

    func redeemBank(idempotencyKey: String) async throws -> CloudRedeemBankResponse {
        try await send("POST", "v1/usage/resets/redeem", body: ["idempotencyKey": idempotencyKey])
    }

    /// In-app account deletion, required by App Store 5.1.1(v).
    func deleteAccount() async throws {
        _ = try await send("DELETE", "v1/me", as: CloudDeleteAccountResponse.self)
    }

    enum PushEnvironment: String { case production, sandbox }

    /// APNs token for task-completion pushes (204).
    func registerPushToken(_ token: String, environment: PushEnvironment) async throws {
        try await sendIgnoringBody("POST", "v1/devices/push-token", body: ["token": token, "environment": environment.rawValue])
    }

    // MARK: Conversations

    func conversations(cursor: String? = nil, archived: Bool = false) async throws -> CloudConversationList {
        var query = [URLQueryItem(name: "archived", value: archived ? "true" : "false")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await send("GET", "v1/conversations", query: query)
    }

    func searchConversations(_ text: String) async throws -> [CloudConversationSearchHit] {
        try await send("GET", "v1/conversations/search", query: [URLQueryItem(name: "q", value: text)], as: CloudConversationSearchResponse.self).results
    }

    func createConversation() async throws -> CloudConversation {
        try await send("POST", "v1/conversations", body: [String: String]())
    }

    func conversation(_ id: String) async throws -> CloudConversationDetail {
        try await send("GET", "v1/conversations/\(id)")
    }

    func updateConversation(_ id: String, title: String? = nil, pinned: Bool? = nil, archived: Bool? = nil) async throws -> CloudConversation {
        try await send("PATCH", "v1/conversations/\(id)", body: ConversationPatch(title: title, pinned: pinned, archived: archived))
    }

    func deleteConversation(_ id: String) async throws {
        try await sendIgnoringBody("DELETE", "v1/conversations/\(id)")
    }

    private struct ConversationPatch: Encodable {
        let title: String?
        let pinned: Bool?
        let archived: Bool?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encodeIfPresent(title, forKey: .title)
            try c.encodeIfPresent(pinned, forKey: .pinned)
            try c.encodeIfPresent(archived, forKey: .archived)
        }

        private enum CodingKeys: String, CodingKey { case title, pinned, archived }
    }

    /// Posts a message. Transport failures and 5xx are retried with the *same* input, so the server's
    /// `clientMessageId` idempotency returns the original message and run instead of creating a duplicate.
    func sendMessage(
        conversationId: String,
        input: CloudSendMessageInput,
        maxAttempts: Int = 3,
        retryDelay: Duration = .milliseconds(400)
    ) async throws -> CloudSendMessageResponse {
        var attempt = 1
        while true {
            do {
                return try await send("POST", "v1/conversations/\(conversationId)/messages", body: input)
            } catch let error as CloudAPIError where error.isRetryable && attempt < maxAttempts {
                attempt += 1
                try await Task.sleep(for: retryDelay * attempt)
            }
        }
    }

    func regenerate(conversationId: String, messageId: String, model: String?) async throws -> CloudSendMessageResponse {
        var body: [String: String] = [:]
        if let model { body["model"] = model }
        return try await send("POST", "v1/conversations/\(conversationId)/messages/\(messageId)/regenerate", body: body)
    }

    /// Snapshots the branch ending at `messageId` behind a read-only link.
    func createShare(conversationId: String, messageId: String) async throws -> CloudCreateShareResponse {
        try await send("POST", "v1/conversations/\(conversationId)/shares", body: ["messageId": messageId])
    }

    // MARK: Runs

    func run(_ id: String) async throws -> CloudRun { try await send("GET", "v1/runs/\(id)", as: CloudRunResponse.self).run }

    @discardableResult
    func cancelRun(_ id: String) async throws -> CloudRun {
        try await send("POST", "v1/runs/\(id)/cancel", as: CloudRunResponse.self).run
    }

    func runEvents(_ id: String, after: Int) async throws -> CloudRunEventsResponse {
        try await send("GET", "v1/runs/\(id)/events", query: [URLQueryItem(name: "after", value: String(after))])
    }

    /// Streams a run's events as SSE and transparently reconnects with `after=<last seq>` until a terminal
    /// status arrives. Events at or below the last seen seq are dropped, so replays never double-apply.
    func streamRun(
        _ id: String,
        after initialSeq: Int,
        maxReconnects: Int = 8,
        reconnectDelay: Duration = .seconds(1)
    ) -> AsyncThrowingStream<CloudRunEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var lastSeq = initialSeq
                var failures = 0
                do {
                    while !Task.isCancelled {
                        do {
                            var finished = false
                            for try await event in try await openEventStream(id, after: lastSeq) {
                                guard event.seq > lastSeq else { continue }
                                lastSeq = event.seq
                                failures = 0
                                continuation.yield(event)
                                if case .status(let status, _) = event.payload, CloudRun.terminalStatuses.contains(status) {
                                    finished = true
                                    break
                                }
                            }
                            if finished { break }
                        } catch let error as CloudAPIError where !error.isRetryable {
                            throw error
                        } catch is CancellationError {
                            break
                        } catch {
                            // Dropped connection: fall through and resume after the last seq.
                        }
                        failures += 1
                        if failures > maxReconnects { throw CloudAPIError.transport("Lost connection to DJL Cloud.") }
                        try await Task.sleep(for: reconnectDelay * min(failures, 5))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error is CancellationError ? nil : error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// One SSE connection; ends when the server closes it.
    private func openEventStream(_ id: String, after: Int) async throws -> AsyncThrowingStream<CloudRunEvent, Error> {
        var request = try makeRequest("GET", "v1/runs/\(id)/events", query: [URLQueryItem(name: "after", value: String(after))])
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        // Heartbeats keep an idle stream alive well inside this window; silence past it means a dead socket.
        request.timeoutInterval = 45

        var attempt = 0
        var bytes: URLSession.AsyncBytes
        while true {
            request.setValue("Bearer \(try await tokenProvider.accessToken())", forHTTPHeaderField: "Authorization")
            let (stream, response) = try await urlSession.bytes(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401, attempt == 0 {
                attempt += 1
                await tokenProvider.invalidate()
                continue
            }
            guard (200..<300).contains(status) else {
                var body = Data()
                for try await byte in stream { body.append(byte) }
                throw CloudAPIError.from(status: status, data: body)
            }
            bytes = stream
            break
        }

        let source = bytes
        return AsyncThrowingStream { continuation in
            let task = Task {
                var parser = CloudSSEParser()
                var chunk: [UInt8] = []
                chunk.reserveCapacity(1024)
                do {
                    for try await byte in source {
                        chunk.append(byte)
                        // Parse on every newline so deltas reach the UI immediately.
                        guard byte == 0x0A || byte == 0x0D else { continue }
                        for frame in parser.feed(chunk) {
                            if let event = try? JSONDecoder().decode(CloudRunEvent.self, from: Data(frame.data.utf8)) {
                                continuation.yield(event)
                            }
                        }
                        chunk.removeAll(keepingCapacity: true)
                    }
                    for frame in parser.feed(chunk + [0x0A, 0x0A]) {
                        if let event = try? JSONDecoder().decode(CloudRunEvent.self, from: Data(frame.data.utf8)) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Files

    /// Declares the file (with its SHA-256), PUTs the bytes straight to storage with the pinned headers, then
    /// completes it; completion verifies and scans before answering, so the result is `ready` or an error.
    func uploadFile(name: String, mimeType: String, data: Data) async throws -> CloudFile {
        let sha256 = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let presign: CloudFilePresignResponse = try await send(
            "POST", "v1/files",
            body: PresignBody(
                name: name,
                mimeType: mimeType,
                size: data.count,
                sha256: sha256,
                purpose: mimeType.hasPrefix("image/") ? "image" : "attachment"
            )
        )
        guard let uploadURL = URL(string: presign.upload.url) else { throw CloudAPIError.decoding("upload url") }
        var put = URLRequest(url: uploadURL)
        put.httpMethod = presign.upload.method
        for (field, value) in presign.upload.headers { put.setValue(value, forHTTPHeaderField: field) }
        let (body, response) = try await transportUpload(put, data: data)
        guard (200..<300).contains(response.statusCode) else { throw CloudAPIError.from(status: response.statusCode, data: body) }
        return try await send("POST", "v1/files/\(presign.file.id)/complete")
    }

    private struct PresignBody: Encodable {
        let name: String
        let mimeType: String
        let size: Int
        let sha256: String
        let purpose: String
    }

    private func transportUpload(_ request: URLRequest, data: Data) async throws -> (Data, HTTPURLResponse) {
        do {
            let (body, response) = try await urlSession.upload(for: request, from: data)
            guard let http = response as? HTTPURLResponse else { throw CloudAPIError.transport("No HTTP response.") }
            return (body, http)
        } catch let error as CloudAPIError {
            throw error
        } catch {
            throw CloudAPIError.transport(error.localizedDescription)
        }
    }

    func downloadURL(fileId: String) async throws -> URL {
        let response: CloudFileDownload = try await send("GET", "v1/files/\(fileId)/url")
        guard let url = URL(string: response.url) else { throw CloudAPIError.decoding("download url") }
        return url
    }

    func fileData(fileId: String) async throws -> Data {
        let signed = try await downloadURL(fileId: fileId)
        let (data, response) = try await transport(URLRequest(url: signed))
        guard (200..<300).contains(response.statusCode) else { throw CloudAPIError.from(status: response.statusCode, data: data) }
        return data
    }
}
