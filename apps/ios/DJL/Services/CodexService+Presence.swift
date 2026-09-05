// FILE: CodexService+Presence.swift
// Purpose: Tracks whether the paired device is reachable and drives recovery when it returns.
// Layer: Service Extension
// Exports: CodexHostPresence, CodexService presence APIs
// Depends on: CodexService, CodexService+SecureTransport, CodexService+Sync

import Foundation

enum CodexHostPresence: Equatable, Sendable {
    case unknown
    case online
    case offline(since: Date)
}

private struct HostPresenceFrame: Decodable {
    let kind: String
    let online: Bool
    let at: Double?
}

extension CodexService {
    static let hostPresenceSilenceNanoseconds: UInt64 = 15_000_000_000
    static let hostPresenceFallbackResolveNanoseconds: UInt64 = 30_000_000_000
    static let presenceHeartbeatMethod = "djl/presence/heartbeat"

    // Any frame that came through the paired device proves it is alive.
    func noteHostActivity() {
        lastHostActivityAt = Date()
        let wasOffline: Bool
        if case .offline = hostPresence { wasOffline = true } else { wasOffline = false }
        hostPresence = .online
        restartHostPresenceSilenceTimer()
        if wasOffline {
            stopHostPresenceFallbackResolve()
            requestImmediateSync(threadId: activeThreadId)
        }
    }

    // Relay control frame: the host socket connected or closed at the relay.
    func applyHostPresenceFrame(_ rawText: String) {
        guard let data = rawText.data(using: .utf8),
              let frame = try? JSONDecoder().decode(HostPresenceFrame.self, from: data),
              frame.kind == "hostPresence" else {
            return
        }
        if frame.online {
            noteHostActivity()
            return
        }
        markHostOffline(since: frame.at.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date())
    }

    func markHostOffline(since: Date) {
        if case .offline = hostPresence {
            return
        }
        hostPresence = .offline(since: since)
        hostPresenceSilenceTask?.cancel()
        hostPresenceSilenceTask = nil
        startHostPresenceFallbackResolveIfNeeded()
    }

    func resetHostPresence() {
        hostPresenceSilenceTask?.cancel()
        hostPresenceSilenceTask = nil
        stopHostPresenceFallbackResolve()
        hostPresence = .unknown
        lastHostActivityAt = nil
    }

    // Called from setForegroundState: the fallback poll only runs while visible.
    func updateHostPresenceFallbackForForegroundChange() {
        if isAppInForeground {
            startHostPresenceFallbackResolveIfNeeded()
        } else {
            stopHostPresenceFallbackResolve()
        }
    }

    private func restartHostPresenceSilenceTimer() {
        hostPresenceSilenceTask?.cancel()
        guard isConnected else {
            hostPresenceSilenceTask = nil
            return
        }
        let timeout = hostPresenceSilenceOverrideNanoseconds ?? Self.hostPresenceSilenceNanoseconds
        hostPresenceSilenceTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: timeout)
            guard !Task.isCancelled, let self, self.isConnected else { return }
            self.markHostOffline(since: self.lastHostActivityAt ?? Date())
        }
    }

    // A gateway restart registers a new relay session that a waiting socket can
    // never see. Resolving the trusted session every 30s catches that case.
    private func startHostPresenceFallbackResolveIfNeeded() {
        guard hostPresenceFallbackResolveTask == nil,
              isAppInForeground,
              case .offline = hostPresence,
              hasReconnectCandidate else {
            return
        }
        let interval = hostPresenceFallbackResolveOverrideNanoseconds
            ?? Self.hostPresenceFallbackResolveNanoseconds
        hostPresenceFallbackResolveTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: interval)
                guard !Task.isCancelled, let self else { return }
                guard case .offline = self.hostPresence, self.isAppInForeground else { return }
                let currentSessionId = self.relaySessionId
                guard let resolved = try? await self.resolveTrustedMacSession(),
                      resolved.sessionId != currentSessionId else {
                    continue
                }
                // The bridge came back on a new session: rebuild the socket on it.
                await self.disconnect(preserveReconnectIntent: true)
                self.shouldAutoReconnectOnForeground = true
                return
            }
        }
    }

    private func stopHostPresenceFallbackResolve() {
        hostPresenceFallbackResolveTask?.cancel()
        hostPresenceFallbackResolveTask = nil
    }

    static func trustedResolveErrorCodeIsMacOffline(_ code: String?) -> Bool {
        code == "session_unavailable" || code == "mac_offline"
    }
}
