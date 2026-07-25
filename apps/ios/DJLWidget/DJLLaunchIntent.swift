// FILE: DJLLaunchIntent.swift
// Purpose: OpenIntent used by the Control Center quick-launch button to bring
//          DJL to the foreground. This file is compiled into both the app
//          and widget targets because Control Widgets require that membership
//          before an intent can open the parent app.
// Layer: Widget Extension

import ActivityKit
import AppIntents
import Foundation

enum DJLLaunchTarget: String, AppEnum {
    case home

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "DJL")
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .home: "DJL"
    ]
}

struct DJLLaunchIntent: OpenIntent {
    static var title: LocalizedStringResource = "Open DJL"
    static var description = IntentDescription("Brings DJL to the foreground.")

    @Parameter(title: "Target")
    var target: DJLLaunchTarget

    init() {
        self.target = .home
    }

    init(target: DJLLaunchTarget) {
        self.target = target
    }
}

// Single vocabulary for Live Activity conversation states; the wire format stays
// String (Codable content state), so coordinator and widget construct/compare
// through this enum instead of raw literals.
enum DJLDisplayIslandConversationState: String, Sendable {
    case running = "Running"
    case finishing = "Finishing"
    case ready = "Ready"
    case failed = "Failed"
    case paused = "Paused"

    var isRunningLike: Bool {
        self == .running || self == .finishing
    }
}

struct DJLDisplayIslandConversation: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let title: String
    let detail: String
    let state: String
    var runningStartedAt: Date?

    var resolvedState: DJLDisplayIslandConversationState? {
        DJLDisplayIslandConversationState(rawValue: state)
    }

    var threadURL: URL? {
        var components = URLComponents()
        components.scheme = "phodex"
        components.host = "thread"
        components.percentEncodedPath = "/" + (id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)
        return components.url
    }
}

struct DJLDisplayIslandAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var runningConversations: [DJLDisplayIslandConversation]
        var completedConversations: [DJLDisplayIslandConversation]
        var failedConversations: [DJLDisplayIslandConversation]
        var updatedAt: Date

        var primaryThreadURL: URL? {
            runningConversations.first?.threadURL
                ?? failedConversations.first?.threadURL
                ?? completedConversations.first?.threadURL
        }
    }

    let title: String
}
