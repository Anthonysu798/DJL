// TEST ONLY: appended to a disposable AppDelegate copy by the guarded preparer.
// Read-only public OS metadata. No publish/end/grant or raw content response.
import ActivityKit
import Flutter
import Foundation

@MainActor
enum NativeStatusQAObserver {
    private static var channel: FlutterMethodChannel?
    static func install(messenger: FlutterBinaryMessenger) {
        let observer = FlutterMethodChannel(name: "app.djl/test_only_run_status_observer", binaryMessenger: messenger)
        observer.setMethodCallHandler { call, result in
            guard call.method == "snapshot" else { result(FlutterMethodNotImplemented); return }
            guard #available(iOS 18.0, *) else { result(["supported": false]); return }
            let activities = Activity<RunStatusAttributes>.activities
            var output: [String: Any] = ["supported": true, "platform": "ios", "pid": ProcessInfo.processInfo.processIdentifier, "count": activities.count, "permissionAllowed": ActivityAuthorizationInfo().areActivitiesEnabled]
            if let activity = activities.first, activities.count == 1 {
                let state = activity.content.state
                let rows = state.rows
                let expectedDeadline = (call.arguments as? [String: Any])?["deadline"] as? Int64
                let generic = rows.allSatisfy { $0.threadId == nil && $0.title == nil && $0.detail == nil && $0.url == nil }
                let key = String(repeating: "a", count: 64)
                let expectedURL = "djl://thread/qa-status-public-thread?macId=qa-status-public-mac&macKeySha256=" + key
                output.merge([
                    "genericPrivateFieldsAbsent": generic,
                    "nonsemanticAttributes": UUID(uuidString: activity.attributes.instance) != nil,
                    "genericInitialOrder": rows.map(\.state) == ["running", "failed", "ready"] && state.runningCount == 1 && state.failedCount == 1 && state.readyCount == 1,
                    "genericUpdatedOrder": rows.map(\.state) == ["finishing", "paused", "ready"] && state.runningCount == 2 && state.failedCount == 0 && state.readyCount == 1,
                    "detailedCanaryMatches": rows.first?.threadId == "qa-status-public-thread" && rows.first?.title == "DJL QA PUBLIC TITLE" && rows.first?.detail == "qa-public-folder" && rows.first?.url == expectedURL,
                    "deadlineMatches": expectedDeadline != nil && state.deadline == expectedDeadline,
                    "stale": activity.activityState == .stale,
                    "runningCount": state.runningCount, "failedCount": state.failedCount, "readyCount": state.readyCount
                ]) { _, new in new }
            }
            result(output)
        }
        channel = observer
    }
}
