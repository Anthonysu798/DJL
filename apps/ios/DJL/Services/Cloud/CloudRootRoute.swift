// FILE: CloudRootRoute.swift
// Purpose: Decides the app's top-level screen: DJL Cloud chat, the signed-out welcome, or the paired-Mac UI.
// Layer: Model
// Exports: CloudRootRoute, CloudSectionPreference
// Depends on: Foundation

import Foundation

/// What the user last asked to see; `.automatic` until they pick.
enum CloudSectionPreference: Equatable {
    case automatic
    case cloud
    case myMacs
}

enum CloudRootRoute: Equatable {
    /// Signed in to DJL Cloud: ChatGPT-style chat is home.
    case cloudHome
    /// Signed out: welcome screen with sign-in first and "Pair with a Mac" second.
    case welcome
    /// "My Macs": the desktop pairing experience that used to be the whole app.
    case myMacs

    /// Signed-in users land in cloud chat. Signed-out users who already paired a Mac keep landing on it
    /// (nothing changes for them) until they choose DJL Cloud; everyone else sees the welcome screen.
    static func resolve(isSignedIn: Bool, preference: CloudSectionPreference, hasPairedMac: Bool) -> CloudRootRoute {
        switch preference {
        case .myMacs: return .myMacs
        case .cloud: return isSignedIn ? .cloudHome : .welcome
        case .automatic:
            if isSignedIn { return .cloudHome }
            return hasPairedMac ? .myMacs : .welcome
        }
    }
}

/// `djl://cloud/c/<conversation id>` opens a cloud conversation (task-completion pushes, shared links).
enum CloudDeepLink {
    static func conversationID(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "djl", url.host?.lowercased() == "cloud" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, parts[0] == "c", !parts[1].isEmpty else { return nil }
        return parts[1]
    }
}
