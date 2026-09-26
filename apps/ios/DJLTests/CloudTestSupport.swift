import Foundation
@testable import DJL

/// URLProtocol stub for CloudAPIClient tests: records every request and answers from a handler.
final class CloudStubURLProtocol: URLProtocol {
    struct Reply {
        var status: Int = 200
        var headers: [String: String] = ["Content-Type": "application/json"]
        /// Delivered as separate `didLoad` calls, so tests can split SSE frames across chunks.
        var chunks: [Data] = []

        static func json(_ status: Int = 200, _ body: String) -> Reply {
            Reply(status: status, chunks: [Data(body.utf8)])
        }

        static func sse(_ chunks: [String]) -> Reply {
            Reply(status: 200, headers: ["Content-Type": "text/event-stream"], chunks: chunks.map { Data($0.utf8) })
        }
    }

    struct Recorded {
        let request: URLRequest
        let body: Data?
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: ((URLRequest, Data?) -> Reply)?
    nonisolated(unsafe) private static var recorded: [Recorded] = []

    static func install(_ handler: @escaping (URLRequest, Data?) -> Reply) {
        lock.withLock {
            self.handler = handler
            recorded = []
        }
    }

    static var requests: [Recorded] { lock.withLock { recorded } }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudStubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let reply: Reply = Self.lock.withLock {
            Self.recorded.append(Recorded(request: request, body: body))
            return Self.handler?(request, body) ?? .json(500, "{}")
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in reply.chunks {
            client?.urlProtocol(self, didLoad: chunk)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

/// In-memory session store so tests never touch the Keychain.
final class CloudMemorySessionStore: CloudSessionStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    init(token: String? = nil) { self.token = token }

    func readSessionToken() -> String? { lock.withLock { token } }
    func writeSessionToken(_ token: String?) { lock.withLock { self.token = token } }
}

/// Hands out a fixed sequence of access tokens and counts refreshes.
actor CloudCountingTokenProvider: CloudAccessTokenProviding {
    private var tokens: [String]
    private(set) var invalidations = 0

    init(tokens: [String]) { self.tokens = tokens }

    func accessToken() async throws -> String {
        guard let first = tokens.first else { throw CloudAPIError.unauthorized }
        return first
    }

    func invalidate() async {
        invalidations += 1
        if tokens.count > 1 { tokens.removeFirst() }
    }
}

enum CloudFixtures {
    /// packages/contracts/fixtures/cloud, read straight from the repo (the Simulator shares the host file system).
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // DJLTests
        .deletingLastPathComponent() // apps/ios
        .deletingLastPathComponent() // apps
        .deletingLastPathComponent() // repo root
        .appending(path: "packages/contracts/fixtures/cloud")

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appending(path: "\(name).json"))
    }

    static func string(_ name: String) throws -> String {
        String(decoding: try data(name), as: UTF8.self)
    }
}
