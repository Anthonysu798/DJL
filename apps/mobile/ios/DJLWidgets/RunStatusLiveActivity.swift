import ActivityKit
import SwiftUI
import WidgetKit

struct RunStatusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunStatusAttributes.self) { context in
            RunStatusActivityView(state: context.state, stale: context.isStale)
                .padding(16)
                .activityBackgroundTint(Color(red: 0.05, green: 0.055, blue: 0.06))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.isStale ? nil : context.state.primaryURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Label("DJL", image: "djl_symbol_medium").font(.headline) }
                DynamicIslandExpandedRegion(.trailing) { Text(LocalizedStringKey(context.isStale ? "Open DJL" : "Task status")).font(.caption) }
                DynamicIslandExpandedRegion(.bottom) {
                    RunStatusActivityView(state: context.state, stale: context.isStale)
                }
            } compactLeading: {
                Image("djl_symbol_medium").resizable().scaledToFit().frame(width: 20, height: 20)
            } compactTrailing: {
                Text(context.isStale ? "Open" : "\(context.state.runningCount + context.state.failedCount + context.state.readyCount)").font(.caption2)
            } minimal: {
                Image("djl_symbol_medium").resizable().scaledToFit()
            }
            .keylineTint(.gray)
            .widgetURL(context.isStale ? nil : context.state.primaryURL)
        }
    }
}

private struct RunStatusActivityView: View {
    let state: RunStatusAttributes.ContentState
    let stale: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("DJL").font(.headline)
                Spacer()
                Text(LocalizedStringKey(stale ? "Open DJL" : "Task status")).font(.caption).foregroundStyle(.secondary)
            }
            if stale {
                // ActivityKit marks the whole content stale at the first row
                // deadline. Hide outcomes, counts and private links together.
                Text(state.runningCount > 0 ? "Paused · Open DJL for current status" : "Open DJL for current status")
                    .font(.subheadline)
            } else {
                Text("\(state.runningCount) active/paused · \(state.failedCount) failed · \(state.readyCount) ready")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(Array(state.rows.enumerated()), id: \.offset) { _, row in
                    if let url = row.url.flatMap(URL.init(string:)) {
                        Link(destination: url) { rowView(row) }
                    } else { rowView(row) }
                }
            }
        }
        .foregroundStyle(.white)
    }
    private func rowView(_ row: RunStatusRow) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: row.state == "failed" ? "exclamationmark.circle" : row.state == "ready" ? "checkmark.circle" : row.state == "paused" ? "pause.circle" : "circle.dotted")
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title?.isEmpty == false ? row.title! : row.state.capitalized).font(.subheadline.weight(.medium)).lineLimit(1)
                if let detail = row.detail, !detail.isEmpty { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer(minLength: 0)
            if row.title != nil { Text(row.state.capitalized).font(.caption2).foregroundStyle(.secondary) }
        }
    }
}
