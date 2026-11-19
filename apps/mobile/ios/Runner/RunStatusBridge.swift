import ActivityKit
import Flutter
import UIKit

@MainActor
final class RunStatusBridge {
    private let channel: FlutterMethodChannel
    private var gate = RunStatusGate()
    private var tail: Task<Void, Never>?

    init(messenger: FlutterBinaryMessenger) {
        channel = FlutterMethodChannel(name: "app.djl/local_run_status", binaryMessenger: messenger)
        channel.setMethodCallHandler { [weak self] call, result in
            self?.handle(call, result: result)
        }
    }

    private func permission() -> [String: Any] {
        // The existing extension is iOS 18; ActivityKit's API floor alone cannot
        // establish render capability on 16/17. Runner remains iOS 15.
        guard #available(iOS 18.0, *) else {
            return ["state": "unsupported", "canRequest": false, "canOpenSettings": false]
        }
        let allowed = ActivityAuthorizationInfo().areActivitiesEnabled
        return ["state": allowed ? "allowed" : "denied", "canRequest": !allowed, "canOpenSettings": true]
    }
    private func response(_ available: Bool, _ reason: String = "unavailable") -> [String: Any] {
        available ? ["available": true] : ["available": false, "reason": reason]
    }
    private func openSettings(_ completion: @escaping (Bool) -> Void) {
        guard #available(iOS 18.0, *), let url = URL(string: UIApplication.openSettingsURLString) else { completion(false); return }
        UIApplication.shared.open(url, options: [:], completionHandler: completion)
    }
    private func enqueue(_ work: @escaping @MainActor () async -> Void) {
        let previous = tail
        tail = Task { @MainActor in
            await previous?.value
            await work()
        }
    }
    @available(iOS 16.2, *)
    private func removeAll() async {
        for activity in Activity<RunStatusAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
    private func reject(_ result: @escaping FlutterResult) {
        gate.invalidate()
        // Even malformed generic input retracts any previously detailed surface.
        enqueue { [self] in
            if #available(iOS 16.2, *) { await removeAll() }
            result(response(false, "invalidPayload"))
        }
    }
    private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "availability": result(permission())
        case "requestPermission":
            if permission()["state"] as? String == "denied" {
                // Live Activities have no requestAuthorization equivalent.
                // This is only reached through an explicit Settings action.
                openSettings { [weak self] _ in result(self?.permission() ?? ["state": "unsupported"]) }
            } else { result(permission()) }
        case "openSettings": openSettings { result($0) }
        case "end":
            guard let raw = call.arguments as? [String: Any], Set(raw.keys) == ["schemaVersion", "epoch", "instance"],
                  let identity = try? RunStatusIdentity.decode(raw) else { reject(result); return }
            guard let token = gate.end(identity) else { result(response(false, "superseded")); return }
            enqueue { [self] in
                // End never depends on permission. A newer update also cleans up
                // incompatible activity instances before it can publish.
                if #available(iOS 16.2, *) { await removeAll() }
                guard gate.current(token) else { result(response(false, "superseded")); return }
                let state = permission()["state"] as? String ?? "unsupported"
                result(response(state == "allowed", state))
            }
        case "update":
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            guard let raw = call.arguments as? [String: Any], let snapshot = try? RunStatusSnapshot.decode(raw, now: now) else { reject(result); return }
            guard let token = gate.update(snapshot.identity) else { result(response(false, "superseded")); return }
            enqueue { [self] in
                guard gate.current(token) else { result(response(false, "superseded")); return }
                guard #available(iOS 18.0, *) else { result(response(false, "unsupported")); return }
                guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                    await removeAll(); result(response(false, "denied")); return
                }
                // Do not adopt prior process/privacy/host content, or keep a
                // duplicate activity even if its instance happens to match.
                let current = Activity<RunStatusAttributes>.activities.first { $0.attributes.instance == snapshot.identity.instance }
                for activity in Activity<RunStatusAttributes>.activities where activity.id != current?.id {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
                guard gate.current(token) else { result(response(false, "superseded")); return }
                let at = Int64(Date().timeIntervalSince1970 * 1000)
                let live = snapshot.projected(at: at)
                guard !live.rows.isEmpty, let deadline = live.nextDeadline(after: at) else {
                    await removeAll(); result(response(true)); return
                }
                let state = RunStatusAttributes.ContentState(rows: live.rows, runningCount: live.running.count,
                    failedCount: live.failed.count, readyCount: live.ready.count, deadline: deadline)
                // ActivityKit caps dynamic content at 4KB. Reject rather than
                // truncate a link or retain an old, more revealing surface.
                guard let encoded = try? JSONEncoder().encode(state), encoded.count <= 3800 else {
                    await removeAll(); result(response(false, "contentTooLarge")); return
                }
                let content = ActivityContent(state: state, staleDate: Date(timeIntervalSince1970: Double(deadline) / 1000))
                if let activity = Activity<RunStatusAttributes>.activities.first(where: { $0.attributes.instance == snapshot.identity.instance }) {
                    await activity.update(content)
                } else {
                    do {
                        _ = try Activity<RunStatusAttributes>.request(attributes: RunStatusAttributes(instance: snapshot.identity.instance), content: content, pushType: nil)
                    } catch {
                        result(response(false, "requestUnavailable")); return
                    }
                }
                // A late native completion cannot claim or survive a barrier.
                if !gate.current(token) {
                    await removeAll(); result(response(false, "superseded")); return
                }
                result(response(true))
            }
        default: result(FlutterMethodNotImplemented)
        }
    }
}
