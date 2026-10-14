import Foundation

nonisolated struct CloudClientConfig: Codable, Sendable, Equatable {
    nonisolated struct Auth: Codable, Sendable, Equatable { let google: Bool; let apple: Bool }
    nonisolated struct Tools: Codable, Sendable, Equatable { let imageGeneration: Bool; let imageEditing: Bool; let fileParsing: Bool }
    nonisolated struct PolicyUrls: Codable, Sendable, Equatable { let terms: String?; let privacy: String? }
    let auth: Auth
    let tools: Tools
    let pushConfigured: Bool
    let policyUrls: PolicyUrls
}
