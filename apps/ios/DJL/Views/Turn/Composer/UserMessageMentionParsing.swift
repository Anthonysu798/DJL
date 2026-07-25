// FILE: UserMessageMentionParsing.swift
// Purpose: Legacy user-message mention token parsing (leading `@file` mentions).
// Layer: View Support
// Exports: UserMessageParsed, UserMessageParser
// Depends on: Foundation, TurnFileMentionHeuristics

import Foundation

struct UserMessageParsed: Equatable {
    let mentions: [String]  // raw paths, e.g. "src/Views/Foo.swift"
    let body: String        // remaining text after mention tokens
}

enum UserMessageParser {
    // Supports both legacy `@token` mentions and file paths with spaces ending in a file extension.
    private static let leadingFileMentionRegex = try? NSRegularExpression(
        pattern: #"^@((?:[^@\n]+?\.[A-Za-z0-9]+)|(?:[^\s@]+))(?=[\s,.;:!?)\]}>]|$)"#
    )

    /// Splits a user message into leading `@path` mention tokens and the rest of the body.
    /// File mentions can contain spaces as long as they still resolve to a path-like token.
    static func parse(_ text: String) -> UserMessageParsed {
        var mentions: [String] = []
        var remainingText = text[...]

        while true {
            let trimmedLeadingText = remainingText.drop(while: \.isWhitespace)
            guard trimmedLeadingText.first == "@",
                  let regex = leadingFileMentionRegex else {
                break
            }

            let workingText = String(trimmedLeadingText)
            let fullRange = NSRange(workingText.startIndex..., in: workingText)
            guard let match = regex.firstMatch(in: workingText, range: fullRange),
                  match.range.location == 0,
                  let mentionRange = Range(match.range(at: 1), in: workingText),
                  let fullMatchRange = Range(match.range, in: workingText) else {
                break
            }

            let mention = String(workingText[mentionRange])
            guard isAllowedFileMentionToken(mention) else {
                break
            }

            mentions.append(mention)
            remainingText = workingText[fullMatchRange.upperBound...]
        }

        let body = String(remainingText).trimmingCharacters(in: .whitespacesAndNewlines)

        return UserMessageParsed(mentions: mentions, body: body)
    }

    // Keeps legacy `@filename` support while rejecting known Swift attribute syntax.
    private static func isAllowedFileMentionToken(_ mention: String) -> Bool {
        TurnFileMentionHeuristics.isAllowedInlineMentionToken(mention)
    }
}
