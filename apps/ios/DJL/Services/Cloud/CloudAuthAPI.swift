// FILE: CloudAuthAPI.swift
// Purpose: Unauthenticated Better Auth routes under /v1/auth that turn credentials into a session token.
// Layer: Service
// Exports: CloudAuthAPI, CloudSignUpResult
// Depends on: Foundation, CloudAPIClient
//
// These routes are served by Better Auth. With the `bearer()` plugin every successful sign-in returns the
// session token in the `set-auth-token` header (CLOUD_SESSION_TOKEN_HEADER in the contract), and usually
// in the body's `token` as well. The app keeps the session token and trades it for short-lived JWTs.

import Foundation

nonisolated enum CloudSignUpResult: Equatable, Sendable {
    case signedIn(sessionToken: String)
    /// Email verification is required; a code was sent and must be confirmed with `verifyEmail`.
    case verificationRequired
}

nonisolated struct CloudAuthAPI: Sendable {
    let configuration: CloudAPIConfiguration
    var urlSession: URLSession = .shared

    func signIn(email: String, password: String) async throws -> String {
        try await sessionToken(from: post("sign-in/email", ["email": email, "password": password]))
    }

    func signUp(name: String, email: String, password: String) async throws -> CloudSignUpResult {
        let (data, response) = try await post("sign-up/email", ["name": name, "email": email, "password": password])
        if let token = Self.extractToken(data: data, response: response) {
            return .signedIn(sessionToken: token)
        }
        try await sendEmailCode(email: email, purpose: "email-verification")
        return .verificationRequired
    }

    /// `purpose` is Better Auth's OTP type: "sign-in" or "email-verification".
    func sendEmailCode(email: String, purpose: String = "sign-in") async throws {
        _ = try await post("email-otp/send-verification-otp", ["email": email, "type": purpose])
    }

    func signIn(email: String, code: String) async throws -> String {
        try await sessionToken(from: post("sign-in/email-otp", ["email": email, "otp": code]))
    }

    func verifyEmail(email: String, code: String) async throws -> String {
        try await sessionToken(from: post("email-otp/verify-email", ["email": email, "otp": code]))
    }

    /// Native Sign in with Apple / Google: the provider's ID token (and Apple's raw nonce) is verified server-side.
    func signIn(provider: String, idToken: String, nonce: String?, accessToken: String? = nil) async throws -> String {
        var token: [String: String] = ["token": idToken]
        if let nonce { token["nonce"] = nonce }
        if let accessToken { token["accessToken"] = accessToken }
        return try await sessionToken(from: post("sign-in/social", SocialBody(provider: provider, idToken: token)))
    }

    /// Best effort: revokes the session server-side. Local sign-out never depends on it.
    func signOut(sessionToken: String) async {
        var request = URLRequest(url: configuration.baseURL.appending(path: "v1/auth/sign-out"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        _ = try? await urlSession.data(for: request)
    }

    private struct SocialBody: Encodable {
        let provider: String
        let idToken: [String: String]
    }

    private func post(_ route: String, _ body: some Encodable) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: configuration.baseURL.appending(path: "v1/auth/\(route)"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw CloudAPIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw CloudAPIError.transport("No HTTP response.") }
        guard (200..<300).contains(http.statusCode) else {
            // A 401 here means wrong credentials, not an expired session.
            if http.statusCode == 401 {
                throw CloudAPIError.server(status: 401, code: "invalid_credentials", message: "That email and password don't match.", traceId: nil, resetsAt: nil)
            }
            throw CloudAPIError.from(status: http.statusCode, data: data)
        }
        return (data, http)
    }

    private func sessionToken(from result: (Data, HTTPURLResponse)) throws -> String {
        guard let token = Self.extractToken(data: result.0, response: result.1) else {
            throw CloudAPIError.decoding("Sign-in response had no session token.")
        }
        return token
    }

    static let sessionTokenHeader = "set-auth-token"

    static func extractToken(data: Data, response: HTTPURLResponse) -> String? {
        if let header = response.value(forHTTPHeaderField: sessionTokenHeader), !header.isEmpty {
            return header
        }
        if let body = try? JSONDecoder().decode(TokenBody.self, from: data), let token = body.token, !token.isEmpty {
            return token
        }
        return nil
    }

    private struct TokenBody: Decodable { let token: String? }
}
