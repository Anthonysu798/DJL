import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct RunStatusAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let rows: [RunStatusRow]
        let runningCount: Int
        let failedCount: Int
        let readyCount: Int
        let deadline: Int64
        var primaryURL: URL? { rows.first?.url.flatMap(URL.init(string:)) }
    }
    // Nonsemantic only. No host, thread, URL or content in immutable attributes.
    let instance: String
}
