// FILE: CloudDebugLaunch.swift
// Purpose: Debug-only Simulator hooks for driving cloud screens against a local API without taps.
// Layer: Service (DEBUG only)
// Exports: CloudDebugLaunch
// Depends on: CloudSessionStore
//
// SIMCTL_CHILD_DJL_CLOUD_API_URL=http://localhost:8787 points the app at a local API;
// SIMCTL_CHILD_DJL_CLOUD_DEBUG_SESSION_TOKEN=<token> signs in; SIMCTL_CHILD_DJL_CLOUD_DEBUG_SCREEN picks
// "sign-in", "conversation:<id>" or "image:<conversation id>" to open a screen on launch.

#if DEBUG
import Foundation

enum CloudDebugLaunch {
    private static var environment: [String: String] { ProcessInfo.processInfo.environment }

    static func seedSessionIfRequested(sessionStore: CloudSessionStoring) {
        guard let token = environment["DJL_CLOUD_DEBUG_SESSION_TOKEN"], !token.isEmpty else { return }
        sessionStore.writeSessionToken(token)
    }

    static var screen: String? { environment["DJL_CLOUD_DEBUG_SCREEN"] }

    static func argument(for prefix: String) -> String? {
        guard let screen, screen.hasPrefix(prefix + ":") else { return nil }
        return String(screen.dropFirst(prefix.count + 1))
    }
}
#endif
