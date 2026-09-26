// FILE: CloudGoogleSignIn.swift
// Purpose: Google sign-in without the GoogleSignIn SDK: OAuth code + PKCE in ASWebAuthenticationSession,
//          then the Google ID token is exchanged for a DJL Cloud session.
// Layer: View / Service
// Exports: CloudGoogleSignIn
// Depends on: AuthenticationServices, CryptoKit, CloudAuthAPI
//
// Needs the iOS OAuth client id in the DJL_GOOGLE_IOS_CLIENT_ID build setting; the button hides without it.

import AuthenticationServices
import CryptoKit
import UIKit

@MainActor
final class CloudGoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let infoPlistKey = "DJL_GOOGLE_IOS_CLIENT_ID"

    static var clientID: String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String,
              raw.hasSuffix(".apps.googleusercontent.com") else { return nil }
        return raw
    }

    private var session: ASWebAuthenticationSession?

    /// Returns Google's ID token for the signed-in account.
    func idToken(clientID: String) async throws -> String {
        let reversed = clientID.split(separator: ".").reversed().joined(separator: ".")
        let redirectURI = "\(reversed):/oauth2redirect"
        let verifier = CloudAppleNonce.randomRaw(byteCount: 48)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let state = CloudAppleNonce.randomRaw()

        var authorize = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        authorize.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authorize.url!, callbackURLScheme: reversed) { url, error in
                if let url {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: error ?? CloudAPIError.transport("Google sign-in was cancelled."))
                }
            }
            session.presentationContextProvider = self
            self.session = session
            session.start()
        }

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else {
            throw CloudAPIError.transport("Google sign-in didn't complete.")
        }

        var token = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        token.httpMethod = "POST"
        token.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "code_verifier", value: verifier),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
        ]
        token.httpBody = Data((form.percentEncodedQuery ?? "").utf8)
        let (data, _) = try await URLSession.shared.data(for: token)
        guard let body = try? JSONDecoder().decode(TokenResponse.self, from: data) else {
            throw CloudAPIError.transport("Google didn't return an ID token.")
        }
        return body.id_token
    }

    private struct TokenResponse: Decodable { let id_token: String }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}
