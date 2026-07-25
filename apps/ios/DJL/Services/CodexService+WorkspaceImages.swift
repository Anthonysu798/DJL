// FILE: CodexService+WorkspaceImages.swift
// Purpose: Fetches local workspace files and images through the paired Mac bridge on demand.
// Layer: Service extension
// Exports: WorkspaceImageReadResult, WorkspaceTextFileReadResult, CodexService workspace preview APIs
// Depends on: Foundation, CodexService, JSONValue

import Foundation

struct WorkspaceImageMetadata: Sendable {
    let path: String
    let fileName: String
    let mimeType: String
    let byteLength: Int
    let mtimeMs: Double?
    let previewMaxPixelDimension: Int?
}

struct WorkspaceImageReadResult: Sendable {
    let path: String
    let fileName: String
    let mimeType: String
    let byteLength: Int
    let mtimeMs: Double?
    let previewMaxPixelDimension: Int?
    let data: Data?
    let isNotModified: Bool

    var metadata: WorkspaceImageMetadata {
        WorkspaceImageMetadata(
            path: path,
            fileName: fileName,
            mimeType: mimeType,
            byteLength: byteLength,
            mtimeMs: mtimeMs,
            previewMaxPixelDimension: previewMaxPixelDimension
        )
    }
}

struct WorkspaceTextFileMetadata: Sendable {
    let path: String
    let fileName: String
    let byteLength: Int
    let mtimeMs: Double?
    let encoding: String
}

struct WorkspaceTextFileReadResult: Sendable {
    let path: String
    let fileName: String
    let byteLength: Int
    let mtimeMs: Double?
    let encoding: String
    let content: String?
    let lineCount: Int?
    let isNotModified: Bool

    var metadata: WorkspaceTextFileMetadata {
        WorkspaceTextFileMetadata(
            path: path,
            fileName: fileName,
            byteLength: byteLength,
            mtimeMs: mtimeMs,
            encoding: encoding
        )
    }
}

extension CodexService {
    private static let timelineImagePreviewMaxPixelDimension = 1_600

    // Loads text only after the user opens a path link, keeping timeline rows lightweight.
    func readWorkspaceTextFile(
        path: String,
        cwd: String?,
        cachedMetadata: WorkspaceTextFileMetadata? = nil
    ) async throws -> WorkspaceTextFileReadResult {
        var params: [String: JSONValue] = [
            "path": .string(path),
            "includeContent": .bool(true)
        ]
        if let cwd = cwd?.trimmingCharacters(in: .whitespacesAndNewlines), !cwd.isEmpty {
            params["cwd"] = .string(cwd)
        }
        if let cachedMetadata {
            params["ifByteLength"] = .integer(cachedMetadata.byteLength)
            if let mtimeMs = cachedMetadata.mtimeMs {
                params["ifMtimeMs"] = .double(mtimeMs)
            }
        }

        let response = try await sendRequest(method: "workspace/readFile", params: .object(params))
        guard let result = response.result?.objectValue else {
            throw CodexServiceError.invalidResponse("File preview response was missing a result.")
        }
        let metadata = parseWorkspaceTextFileMetadata(result: result, fallbackPath: path)
        if result["notModified"]?.boolValue == true {
            return WorkspaceTextFileReadResult(
                path: metadata.path,
                fileName: metadata.fileName,
                byteLength: metadata.byteLength,
                mtimeMs: metadata.mtimeMs,
                encoding: metadata.encoding,
                content: nil,
                lineCount: result["lineCount"]?.intValue,
                isNotModified: true
            )
        }

        guard let content = result["content"]?.stringValue else {
            throw CodexServiceError.invalidResponse("File preview response did not include file content.")
        }
        return WorkspaceTextFileReadResult(
            path: metadata.path,
            fileName: metadata.fileName,
            byteLength: metadata.byteLength,
            mtimeMs: metadata.mtimeMs,
            encoding: metadata.encoding,
            content: content,
            lineCount: result["lineCount"]?.intValue,
            isNotModified: false
        )
    }

    // Loads image bytes only after the user asks to preview them, keeping timeline rows lightweight.
    func readWorkspaceImage(
        path: String,
        cwd: String?,
        cachedMetadata: WorkspaceImageMetadata? = nil
    ) async throws -> WorkspaceImageReadResult {
        let result = try await readWorkspaceImageObject(
            path: path,
            cwd: cwd,
            includeData: true,
            maxPixelDimension: Self.timelineImagePreviewMaxPixelDimension,
            cachedMetadata: cachedMetadata
        )
        let metadata = parseWorkspaceImageMetadata(result: result, fallbackPath: path)
        if result["notModified"]?.boolValue == true {
            return WorkspaceImageReadResult(
                path: metadata.path,
                fileName: metadata.fileName,
                mimeType: metadata.mimeType,
                byteLength: metadata.byteLength,
                mtimeMs: metadata.mtimeMs,
                previewMaxPixelDimension: metadata.previewMaxPixelDimension,
                data: nil,
                isNotModified: true
            )
        }

        guard let dataBase64 = result["dataBase64"]?.stringValue else {
            throw CodexServiceError.invalidResponse("Image preview response did not include image data.")
        }
        let data = try await WorkspaceImageBase64Decoder.decode(dataBase64)

        return WorkspaceImageReadResult(
            path: metadata.path,
            fileName: metadata.fileName,
            mimeType: metadata.mimeType,
            byteLength: metadata.byteLength,
            mtimeMs: metadata.mtimeMs,
            previewMaxPixelDimension: metadata.previewMaxPixelDimension,
            data: data,
            isNotModified: false
        )
    }

    private func readWorkspaceImageObject(
        path: String,
        cwd: String?,
        includeData: Bool,
        maxPixelDimension: Int? = nil,
        cachedMetadata: WorkspaceImageMetadata? = nil
    ) async throws -> RPCObject {
        var params: [String: JSONValue] = [
            "path": .string(path),
            "includeData": .bool(includeData)
        ]
        if let maxPixelDimension {
            params["maxPixelDimension"] = .integer(maxPixelDimension)
        }
        if let cachedMetadata {
            params["ifByteLength"] = .integer(cachedMetadata.byteLength)
            if let previewMaxPixelDimension = cachedMetadata.previewMaxPixelDimension {
                params["ifPreviewMaxPixelDimension"] = .integer(previewMaxPixelDimension)
            }
            if let mtimeMs = cachedMetadata.mtimeMs {
                params["ifMtimeMs"] = .double(mtimeMs)
            }
        }
        if let cwd = cwd?.trimmingCharacters(in: .whitespacesAndNewlines), !cwd.isEmpty {
            params["cwd"] = .string(cwd)
        }

        let response = try await sendRequest(method: "workspace/readImage", params: .object(params))
        guard let result = response.result?.objectValue else {
            throw CodexServiceError.invalidResponse("Image preview response was missing a result.")
        }
        return result
    }

    private func parseWorkspaceImageMetadata(result: RPCObject, fallbackPath path: String) -> WorkspaceImageMetadata {
        WorkspaceImageMetadata(
            path: result["path"]?.stringValue ?? path,
            fileName: result["fileName"]?.stringValue ?? (path as NSString).lastPathComponent,
            mimeType: result["mimeType"]?.stringValue ?? "image",
            byteLength: result["byteLength"]?.intValue ?? 0,
            mtimeMs: result["mtimeMs"]?.doubleValue,
            previewMaxPixelDimension: result["previewMaxPixelDimension"]?.intValue
        )
    }

    private func parseWorkspaceTextFileMetadata(result: RPCObject, fallbackPath path: String) -> WorkspaceTextFileMetadata {
        WorkspaceTextFileMetadata(
            path: result["path"]?.stringValue ?? path,
            fileName: result["fileName"]?.stringValue ?? (path as NSString).lastPathComponent,
            byteLength: result["byteLength"]?.intValue ?? 0,
            mtimeMs: result["mtimeMs"]?.doubleValue,
            encoding: result["encoding"]?.stringValue ?? "utf-8"
        )
    }
}

private enum WorkspaceImageBase64Decoder {
    static func decode(_ dataBase64: String) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            guard let data = Data(base64Encoded: dataBase64) else {
                throw CodexServiceError.invalidResponse("Image preview response did not include valid image data.")
            }
            return data
        }.value
    }
}
