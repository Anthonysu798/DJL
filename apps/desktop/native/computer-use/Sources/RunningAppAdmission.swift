import Foundation
import AppKit

struct RunningApplicationBinding {
    let app: NSRunningApplication
    let identity: ProcessIdentity
}

// Running-app metadata can briefly be unavailable for a live process. Retry fresh metadata, never a cached binding.
func admitRunningApplication(_ target: Target, isCancelled: () -> Bool) throws -> RunningApplicationBinding {
    let started = DispatchTime.now().uptimeNanoseconds
    func check() throws {
        if isCancelled() { try fail("cancelled", "Thread computer work was stopped") }
        guard DispatchTime.now().uptimeNanoseconds &- started < 100_000_000 else {
            try fail("target-unavailable", "Requested process identity is unavailable")
        }
    }
    try check()
    let initialIdentity = try? ProcessIdentity(target.pid)
    try check()
    guard let identity = initialIdentity else { try fail("target-unavailable", "Process start identity is unavailable") }
    guard ApplicationScopePolicy.ownsProcess(helperPID: getpid(), processPID: target.pid, userID: geteuid(), processUserID: identity.ownerUserID) else {
        try fail("target-unavailable", "Requested application is outside this helper's user scope")
    }
    while true {
        try check()
        let before = try? ProcessIdentity(target.pid)
        try check()
        guard before == identity else { try fail("target-unavailable", "Process start/executable identity changed") }
        let app = NSRunningApplication(processIdentifier: target.pid)
        try check()
        let bundle = app?.bundleIdentifier
        try check()
        let terminated = app?.isTerminated ?? false
        try check()
        let after = try? ProcessIdentity(target.pid)
        try check()
        guard after == identity else { try fail("target-unavailable", "Process start/executable identity changed") }
        guard !terminated else { try fail("target-unavailable", "Requested application has terminated") }
        if let app = app, let bundle = bundle {
            guard bundle == target.bundle else { try fail("target-unavailable", "Requested process identity is unavailable") }
            return RunningApplicationBinding(app: app, identity: identity)
        }
        Thread.sleep(forTimeInterval: 0.002)
    }
}
