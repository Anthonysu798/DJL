import SwiftUI
import WidgetKit

struct DJLLaunchEntry: TimelineEntry {
    let date: Date
}

struct DJLLaunchProvider: TimelineProvider {
    func placeholder(in context: Context) -> DJLLaunchEntry {
        DJLLaunchEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (DJLLaunchEntry) -> Void) {
        completion(DJLLaunchEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DJLLaunchEntry>) -> Void) {
        completion(Timeline(entries: [DJLLaunchEntry(date: Date())], policy: .never))
    }
}

struct DJLLockScreenWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular:
                Image("djl_symbol_medium")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .widgetAccentable()
            case .accessoryRectangular:
                HStack(spacing: 8) {
                    Image("djl_symbol_medium")
                        .resizable()
                        .renderingMode(.template)
                        .scaledToFit()
                        .frame(width: 28, height: 28)
                        .widgetAccentable()
                    VStack(alignment: .leading, spacing: 0) {
                        Text("DJL")
                            .font(.headline)
                            .lineLimit(1)
                        Text("Open Codex chat")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            case .accessoryInline:
                Label("DJL", image: "djl_symbol_medium")
            default:
                EmptyView()
            }
        }
        .containerBackground(.clear, for: .widget)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Open DJL")
    }
}

struct DJLLockScreenWidget: Widget {
    static let kind = "app.djl.mobile.widgets.LockScreen"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: DJLLaunchProvider()) { _ in
            DJLLockScreenWidgetView()
        }
        .configurationDisplayName("DJL")
        .description("Quick access to DJL from your Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
