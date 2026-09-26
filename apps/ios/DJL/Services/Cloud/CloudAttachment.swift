// FILE: CloudAttachment.swift
// Purpose: A pending composer attachment and the client-side size/type checks run before uploading.
// Layer: Model
// Exports: CloudPendingAttachment, CloudAttachmentPolicy
// Depends on: Foundation, UniformTypeIdentifiers

import Foundation
import UniformTypeIdentifiers

nonisolated struct CloudPendingAttachment: Identifiable, Equatable, Sendable {
    let id = UUID()
    let name: String
    let mimeType: String
    let data: Data

    var isImage: Bool { mimeType.hasPrefix("image/") }
}

nonisolated enum CloudAttachmentPolicy {
    /// Mirrors CLOUD_FILE_MAX_BYTES in packages/contracts/src/cloud/files.ts.
    static let maxBytes = 25 * 1024 * 1024
    static let maxAttachmentsPerMessage = 10
    /// What the API's magic-byte check accepts (cloud/apps/api/src/files/fileTypes.ts).
    static let imageTypes: Set<String> = ["image/png", "image/jpeg", "image/gif", "image/webp"]
    static let documentTypes: Set<String> = [
        "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]

    enum Rejection: Error, Equatable, LocalizedError {
        case empty
        case tooLarge
        case unsupportedType
        case tooMany

        var errorDescription: String? {
            switch self {
            case .empty: return "That file is empty."
            case .tooLarge: return "Files must be 25 MB or smaller."
            case .unsupportedType: return "DJL can read images, PDFs, Word and Excel files, and plain text."
            case .tooMany: return "You can attach up to \(CloudAttachmentPolicy.maxAttachmentsPerMessage) files per message."
            }
        }
    }

    static func mimeType(forFilename name: String) -> String {
        let ext = (name as NSString).pathExtension
        if ext.lowercased() == "md" { return "text/markdown" }
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    static func validate(mimeType: String, byteCount: Int, existingCount: Int) throws {
        guard existingCount < maxAttachmentsPerMessage else { throw Rejection.tooMany }
        guard byteCount > 0 else { throw Rejection.empty }
        guard byteCount <= maxBytes else { throw Rejection.tooLarge }
        guard imageTypes.contains(mimeType) || documentTypes.contains(mimeType) else { throw Rejection.unsupportedType }
    }
}
