// FILE: CodexTextContentFingerprint.swift
// Purpose: Shared streaming text fingerprint used by model and timeline cache keys.
// Layer: Model Utility
// Exports: CodexTextContentFingerprint
// Depends on: Foundation

import Foundation

nonisolated struct CodexTextContentFingerprint: Codable, Hashable, Sendable {
    let byteCount: Int
    let hash: UInt64

    init(_ text: String) {
        self.byteCount = text.utf8.count
        self.hash = Self.hashBytes(in: text)
    }

    var cacheKey: String {
        "\(byteCount)|\(String(hash, radix: 16))"
    }

    static func cacheKey(for text: String) -> String {
        CodexTextContentFingerprint(text).cacheKey
    }

    // FNV-1a over UTF-8 keeps cache keys deterministic without allocating copies of large strings.
    private static func hashBytes(in text: String) -> UInt64 {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return hash
    }
}
