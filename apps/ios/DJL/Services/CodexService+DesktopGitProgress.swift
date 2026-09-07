// FILE: CodexService+DesktopGitProgress.swift
// Purpose: Tracks git actions started on the paired desktop so the phone can show their progress.
// Layer: Service Extension
// Exports: CodexService desktop git progress APIs
// Depends on: CodexService, GitActionModels

import Foundation

extension CodexService {
    static let desktopGitActionProgressMethod = "djl/git/desktopActionProgress"

    func desktopGitActionProgress(for workingDirectory: String?) -> TurnGitActionProgress? {
        guard let workingDirectory, !workingDirectory.isEmpty else { return nil }
        return desktopGitActionProgressByCwd[workingDirectory]
    }

    // Mirrors the backend's git action progress stream into the same model the
    // phone uses for its own stacked git actions.
    func handleDesktopGitActionProgress(_ params: IncomingParamsObject?) {
        guard let params,
              let cwd = params["cwd"]?.stringValue, !cwd.isEmpty,
              let kind = params["kind"]?.stringValue else {
            return
        }
        let action = TurnGitActionKind(desktopStackedAction: params["action"]?.stringValue ?? "")

        switch kind {
        case "action_started":
            let phases = (params["phases"]?.arrayValue ?? [])
                .compactMap { $0.stringValue }
                .compactMap(TurnGitActionPhase.init(desktopPhase:))
            desktopGitActionProgressByCwd[cwd] = TurnGitActionProgress(
                action: action,
                plannedPhases: phases
            )
        case "phase_started":
            var progress = desktopGitActionProgressByCwd[cwd]
                ?? TurnGitActionProgress(action: action, plannedPhases: [])
            if let phase = params["phase"]?.stringValue.flatMap(TurnGitActionPhase.init(desktopPhase:)) {
                if let current = progress.currentPhase {
                    progress.completedPhases.insert(current)
                }
                progress.currentPhase = phase
            }
            desktopGitActionProgressByCwd[cwd] = progress
        case "action_finished", "action_failed":
            desktopGitActionProgressByCwd.removeValue(forKey: cwd)
        default:
            // A phone that connected mid-action still gets a spinner.
            if desktopGitActionProgressByCwd[cwd] == nil {
                desktopGitActionProgressByCwd[cwd] = TurnGitActionProgress(action: action, plannedPhases: [])
            }
        }
    }
}

extension TurnGitActionPhase {
    // Maps the desktop backend's `GitActionProgressPhase` to the phone's phases.
    init?(desktopPhase: String) {
        switch desktopPhase {
        case "branch": self = .branch
        case "commit": self = .commit
        case "push": self = .push
        case "pr": self = .createPR
        default: return nil
        }
    }
}

extension TurnGitActionKind {
    // Maps the desktop backend's `GitStackedAction` to the phone's action kinds.
    init(desktopStackedAction: String) {
        switch desktopStackedAction {
        case "push": self = .push
        case "create_pr": self = .createPR
        case "commit_push": self = .commitAndPush
        case "commit_push_pr": self = .commitPushCreatePR
        default: self = .commit
        }
    }
}
