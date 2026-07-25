// FILE: TurnFooterErrorFilter.swift
// Purpose: Filters transient recovery noise out of the turn timeline footer error slot.
// Layer: View Support
// Exports: TurnFooterErrorFilter
// Depends on: Foundation

import Foundation

enum TurnFooterErrorFilter {
    static func visibleFooterMessage(from rawMessage: String?) -> String? {
        guard let message = rawMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
              !message.isEmpty else {
            return nil
        }

        if isConnectionRecoveryNoise(message)
            || isBackgroundHistoryRetryNoise(message)
            || isUnmaterializedThreadNoise(message)
            || isCancellationNoise(message) {
            return nil
        }

        if looksLikeRawDiagnostic(message) {
            return SidebarAttentionProjection.actionableFailureSummary(from: message)
        }

        return message
    }

    private static func isConnectionRecoveryNoise(_ message: String) -> Bool {
        let normalizedMessage = message.lowercased()
        return normalizedMessage.contains("tap reconnect")
            || normalizedMessage.hasPrefix("connection was interrupted")
            || normalizedMessage.hasPrefix("connection timed out")
            || normalizedMessage.hasPrefix("trying to reconnect")
    }

    private static func isBackgroundHistoryRetryNoise(_ message: String) -> Bool {
        message.lowercased() == "couldn't load this chat yet. retrying in the background."
    }

    private static func isUnmaterializedThreadNoise(_ message: String) -> Bool {
        let normalizedMessage = message.lowercased()
        return normalizedMessage.contains("not materialized")
            || normalizedMessage.contains("not yet materialized")
            || (
                normalizedMessage.contains("thread/turns/list")
                    && normalizedMessage.contains("unavailable")
            )
    }

    private static func isCancellationNoise(_ message: String) -> Bool {
        let normalizedMessage = message.lowercased()
        return normalizedMessage.contains("cancellationerror")
            || normalizedMessage.contains("cancelled")
            || normalizedMessage.contains("canceled")
    }

    private static func looksLikeRawDiagnostic(_ message: String) -> Bool {
        let normalized = message.lowercased()
        if message.count > 700 || normalized.contains("traceback (most recent call last)") {
            return true
        }

        let lines = message.components(separatedBy: .newlines)
        let stackFrameCount = lines.filter { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            return trimmed.hasPrefix("at ")
                || trimmed.hasPrefix("#")
                || (trimmed.contains(".swift:") && trimmed.contains(":"))
                || (trimmed.contains(".js:") && trimmed.contains(":"))
        }.count
        return stackFrameCount >= 2
    }
}
