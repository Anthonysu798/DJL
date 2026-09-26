// FILE: CloudAppleSignIn.swift
// Purpose: Native Sign in with Apple button with a SHA-256 nonce, exchanged for a DJL Cloud session.
// Layer: View
// Exports: CloudAppleNonce, CloudAppleSignInButton
// Depends on: AuthenticationServices, CryptoKit, CloudService

import AuthenticationServices
import CryptoKit
import SwiftUI

nonisolated struct CloudAppleNonce: Sendable {
    let raw: String

    init(raw: String = CloudAppleNonce.randomRaw()) {
        self.raw = raw
    }

    /// Apple embeds this value verbatim in the ID token's `nonce` claim; the server compares against it.
    var hashed: String {
        SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func randomRaw(byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

struct CloudAppleSignInButton: View {
    @Environment(CloudService.self) private var cloud
    @Environment(\.colorScheme) private var colorScheme
    @State private var nonce = CloudAppleNonce()
    let onError: (String) -> Void

    var body: some View {
        SignInWithAppleButton(.continue) { request in
            nonce = CloudAppleNonce()
            request.requestedScopes = [.email, .fullName]
            request.nonce = nonce.hashed
        } onCompletion: { result in
            handle(result)
        }
        .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
        .frame(height: 52)
        .clipShape(Capsule())
    }

    private func handle(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            onError(error.localizedDescription)
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8) else {
                onError("Apple didn't return an identity token.")
                return
            }
            let hashedNonce = nonce.hashed
            Task {
                do {
                    let session = try await cloud.authAPI.signIn(provider: "apple", idToken: idToken, nonce: hashedNonce)
                    await cloud.completeSignIn(sessionToken: session)
                } catch {
                    onError((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
                }
            }
        }
    }
}
