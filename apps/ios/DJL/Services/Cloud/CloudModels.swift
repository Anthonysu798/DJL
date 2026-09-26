// FILE: CloudModels.swift
// Purpose: Codable mirrors of the DJL Cloud public API contract (packages/contracts/src/cloud/*.ts).
// Layer: Model
// Exports: Cloud* wire types
// Depends on: Foundation
//
// Ids are plain strings and money stays a decimal string of microcredits, exactly as on the wire.
// DJLTests/CloudContractFixtureTests decodes every JSON fixture with these types to catch drift.

import Foundation

// MARK: - Errors

nonisolated struct CloudAPIErrorEnvelope: Codable, Sendable {
    nonisolated struct Body: Codable, Sendable {
        let code: String
        let message: String
        let traceId: String
        let resetsAt: String?
    }

    let error: Body
}

// MARK: - Account

nonisolated struct CloudMe: Codable, Sendable, Equatable {
    nonisolated struct User: Codable, Sendable, Equatable {
        let id: String
        let email: String
        let emailVerified: Bool
    }

    nonisolated struct Organization: Codable, Sendable, Equatable {
        let id: String
        let name: String
        let slug: String
        let role: String
        let personal: Bool
    }

    let user: User
    let activeOrgId: String
    let role: String
    let organizations: [Organization]
}

nonisolated struct CloudCredits: Codable, Sendable, Equatable {
    nonisolated struct Balances: Codable, Sendable, Equatable {
        let trial: String
        let plan: String
        let topup: String
        let free: String?
    }

    nonisolated struct Display: Codable, Sendable, Equatable {
        let total: String
        let trial: String
        let plan: String
        let topup: String
    }

    let orgId: String
    let balances: Balances
    let total: String
    let display: Display
}

nonisolated struct CloudNativeToken: Codable, Sendable {
    let sessionToken: String
    let expiresAt: String
    let userId: String
    let orgId: String
}

// MARK: - Models and usage

nonisolated struct CloudModel: Codable, Sendable, Equatable, Identifiable, Hashable {
    nonisolated struct Price: Codable, Sendable, Equatable, Hashable {
        let inputPer1k: String
        let outputPer1k: String
        let perImage: String
    }

    let id: String
    let provider: String
    let displayName: String
    let capabilities: [String]
    let price: Price
    let contextWindow: Int?
    let maxOutputTokens: Int?
    let status: String

    var acceptsImages: Bool { capabilities.contains("vision") }
    var generatesImages: Bool { capabilities.contains("image.generate") }
    var isSelectable: Bool { status != "disabled" && capabilities.contains("text.chat") }
}

nonisolated struct CloudModelsResponse: Codable, Sendable {
    let models: [CloudModel]
}

nonisolated struct CloudUsageTrailer: Codable, Sendable, Equatable {
    let requestId: String
    let model: String
    let routeReason: String
    let inputTokens: Int
    let outputTokens: Int
    let settled: String
    let remaining: String
    let cutOff: Bool
}

nonisolated struct CloudUsageWindow: Codable, Sendable, Equatable {
    let kind: String
    let limit: String
    let used: String
    let remaining: String
    let resetsAt: String?

    /// Share of the window already spent, 0...1. Decimal strings can exceed Int64 only in theory.
    var fractionUsed: Double {
        guard let limit = Double(limit), limit > 0, let used = Double(used) else { return 0 }
        return min(max(used / limit, 0), 1)
    }

    var isExhausted: Bool { (Double(remaining) ?? 1) <= 0 }
}

nonisolated struct CloudResetBank: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let source: String
    let grantedAt: String
    let expiresAt: String
}

nonisolated struct CloudUsageStatus: Codable, Sendable, Equatable {
    nonisolated struct Windows: Codable, Sendable, Equatable {
        let fiveHour: CloudUsageWindow
        let week: CloudUsageWindow
    }

    let planId: String
    let windows: Windows
    let banks: [CloudResetBank]

    var exhaustedWindow: CloudUsageWindow? {
        [windows.fiveHour, windows.week].first(where: \.isExhausted)
    }
}

nonisolated struct CloudRedeemBankResponse: Codable, Sendable {
    let redeemedBankId: String
    let status: CloudUsageStatus
}

// MARK: - Chat

nonisolated enum CloudMessagePart: Codable, Sendable, Equatable, Hashable {
    case text(String)
    case fileRef(fileId: String, name: String, mimeType: String, size: Int)
    case imageRef(fileId: String, mimeType: String, width: Int?, height: Int?)
    case toolCall(toolCallId: String, name: String, arguments: String)
    case toolResult(toolCallId: String, name: String, content: String, isError: Bool)

    private enum CodingKeys: String, CodingKey {
        case type, text, fileId, name, mimeType, size, width, height
        case toolCallId, arguments, content, isError
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "text":
            self = .text(try c.decode(String.self, forKey: .text))
        case "file_ref":
            self = .fileRef(
                fileId: try c.decode(String.self, forKey: .fileId),
                name: try c.decode(String.self, forKey: .name),
                mimeType: try c.decode(String.self, forKey: .mimeType),
                size: try c.decode(Int.self, forKey: .size)
            )
        case "image_ref":
            self = .imageRef(
                fileId: try c.decode(String.self, forKey: .fileId),
                mimeType: try c.decode(String.self, forKey: .mimeType),
                width: try c.decodeIfPresent(Int.self, forKey: .width),
                height: try c.decodeIfPresent(Int.self, forKey: .height)
            )
        case "tool_call":
            self = .toolCall(
                toolCallId: try c.decode(String.self, forKey: .toolCallId),
                name: try c.decode(String.self, forKey: .name),
                arguments: try c.decode(String.self, forKey: .arguments)
            )
        case "tool_result":
            self = .toolResult(
                toolCallId: try c.decode(String.self, forKey: .toolCallId),
                name: try c.decode(String.self, forKey: .name),
                content: try c.decode(String.self, forKey: .content),
                isError: try c.decode(Bool.self, forKey: .isError)
            )
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown part type \(type)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let text):
            try c.encode("text", forKey: .type)
            try c.encode(text, forKey: .text)
        case .fileRef(let fileId, let name, let mimeType, let size):
            try c.encode("file_ref", forKey: .type)
            try c.encode(fileId, forKey: .fileId)
            try c.encode(name, forKey: .name)
            try c.encode(mimeType, forKey: .mimeType)
            try c.encode(size, forKey: .size)
        case .imageRef(let fileId, let mimeType, let width, let height):
            try c.encode("image_ref", forKey: .type)
            try c.encode(fileId, forKey: .fileId)
            try c.encode(mimeType, forKey: .mimeType)
            try c.encode(width, forKey: .width)
            try c.encode(height, forKey: .height)
        case .toolCall(let toolCallId, let name, let arguments):
            try c.encode("tool_call", forKey: .type)
            try c.encode(toolCallId, forKey: .toolCallId)
            try c.encode(name, forKey: .name)
            try c.encode(arguments, forKey: .arguments)
        case .toolResult(let toolCallId, let name, let content, let isError):
            try c.encode("tool_result", forKey: .type)
            try c.encode(toolCallId, forKey: .toolCallId)
            try c.encode(name, forKey: .name)
            try c.encode(content, forKey: .content)
            try c.encode(isError, forKey: .isError)
        }
    }
}

nonisolated struct CloudMessage: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let parentId: String?
    let role: String
    var parts: [CloudMessagePart]
    let model: String?
    let runId: String?
    let createdAt: String

    var isUser: Bool { role == "user" }

    var text: String {
        parts.compactMap { part -> String? in
            if case .text(let text) = part { return text }
            return nil
        }.joined()
    }
}

nonisolated struct CloudConversation: Codable, Sendable, Equatable, Identifiable, Hashable {
    let id: String
    var title: String?
    var pinned: Bool
    var archived: Bool
    let createdAt: String
    var updatedAt: String

    var displayTitle: String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "New chat" : trimmed
    }
}

nonisolated struct CloudConversationList: Codable, Sendable {
    let conversations: [CloudConversation]
    let nextCursor: String?
}

nonisolated struct CloudConversationDetail: Codable, Sendable {
    let conversation: CloudConversation
    let messages: [CloudMessage]
}

nonisolated struct CloudConversationSearchHit: Codable, Sendable, Identifiable {
    let conversation: CloudConversation
    let messageId: String?
    let snippet: String

    var id: String { conversation.id + (messageId ?? "") }
}

nonisolated struct CloudConversationSearchResponse: Codable, Sendable {
    let results: [CloudConversationSearchHit]
    let nextCursor: String?
}

nonisolated struct CloudSendMessageInput: Codable, Sendable, Equatable {
    let clientMessageId: String
    let parentId: String?
    let parts: [CloudMessagePart]
    let model: String
    let mode: String

    private enum CodingKeys: String, CodingKey { case clientMessageId, parentId, parts, model, mode }

    init(clientMessageId: String, parentId: String?, parts: [CloudMessagePart], model: String, mode: String) {
        self.clientMessageId = clientMessageId
        self.parentId = parentId
        self.parts = parts
        self.model = model
        self.mode = mode
    }

    /// `parentId` is required-but-nullable in the contract, so a root message sends an explicit null.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(clientMessageId, forKey: .clientMessageId)
        try c.encode(parentId, forKey: .parentId)
        try c.encode(parts, forKey: .parts)
        try c.encode(model, forKey: .model)
        try c.encode(mode, forKey: .mode)
    }
}

// MARK: - Runs

nonisolated struct CloudRunError: Codable, Sendable, Equatable {
    let code: String
    let message: String
}

nonisolated struct CloudRun: Codable, Sendable, Equatable {
    let id: String
    let conversationId: String
    let messageId: String
    let mode: String
    var status: String
    let model: String
    var error: CloudRunError?
    var lastSeq: Int
    let createdAt: String
    var finishedAt: String?

    static let terminalStatuses: Set<String> = ["succeeded", "failed", "cancelled"]
    var isTerminal: Bool { Self.terminalStatuses.contains(status) }
}

nonisolated struct CloudSendMessageResponse: Codable, Sendable {
    let message: CloudMessage
    let reply: CloudMessage
    let run: CloudRun
}

nonisolated struct CloudRunResponse: Codable, Sendable {
    let run: CloudRun
}

nonisolated enum CloudRunEventPayload: Sendable, Equatable {
    case textDelta(messageId: String, text: String)
    case part(messageId: String, part: CloudMessagePart)
    case stepStarted(step: Int, maxSteps: Int)
    case usage(CloudUsageTrailer)
    case status(status: String, error: CloudRunError?)
}

nonisolated struct CloudRunEvent: Decodable, Sendable, Equatable {
    let runId: String
    let seq: Int
    let createdAt: String
    let payload: CloudRunEventPayload

    private enum CodingKeys: String, CodingKey { case runId, seq, type, payload, createdAt }
    private struct TextDelta: Decodable { let messageId: String; let text: String }
    private struct Part: Decodable { let messageId: String; let part: CloudMessagePart }
    private struct Step: Decodable { let step: Int; let maxSteps: Int }
    private struct Status: Decodable { let status: String; let error: CloudRunError? }

    init(runId: String, seq: Int, createdAt: String, payload: CloudRunEventPayload) {
        self.runId = runId
        self.seq = seq
        self.createdAt = createdAt
        self.payload = payload
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        runId = try c.decode(String.self, forKey: .runId)
        seq = try c.decode(Int.self, forKey: .seq)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "text.delta":
            let p = try c.decode(TextDelta.self, forKey: .payload)
            payload = .textDelta(messageId: p.messageId, text: p.text)
        case "message.part":
            let p = try c.decode(Part.self, forKey: .payload)
            payload = .part(messageId: p.messageId, part: p.part)
        case "step.started":
            let p = try c.decode(Step.self, forKey: .payload)
            payload = .stepStarted(step: p.step, maxSteps: p.maxSteps)
        case "usage":
            payload = .usage(try c.decode(CloudUsageTrailer.self, forKey: .payload))
        case "status":
            let p = try c.decode(Status.self, forKey: .payload)
            payload = .status(status: p.status, error: p.error)
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown run event \(type)")
        }
    }
}

nonisolated struct CloudRunEventsResponse: Decodable, Sendable {
    let run: CloudRun
    let events: [CloudRunEvent]
}

// MARK: - Files and shares

nonisolated struct CloudFile: Codable, Sendable, Equatable {
    let id: String
    let name: String
    let mimeType: String
    let size: Int
    let status: String
    let createdAt: String
}

nonisolated struct CloudFilePresignResponse: Codable, Sendable {
    nonisolated struct Upload: Codable, Sendable {
        let url: String
        let method: String
        let headers: [String: String]
        let expiresAt: String
    }

    let file: CloudFile
    let upload: Upload
}

nonisolated struct CloudFileDownload: Codable, Sendable {
    let url: String
    let expiresAt: String
}

nonisolated struct CloudShare: Codable, Sendable, Equatable {
    let id: String
    let conversationId: String
    let title: String?
    let createdAt: String
    let revokedAt: String?
}

nonisolated struct CloudCreateShareResponse: Codable, Sendable {
    let share: CloudShare
    let url: String
}

nonisolated struct CloudPublicShare: Codable, Sendable {
    nonisolated struct Message: Codable, Sendable {
        let role: String
        let parts: [CloudMessagePart]
        let createdAt: String
    }

    let title: String?
    let createdAt: String
    let messages: [Message]
}
