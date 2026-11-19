import AppIntents
import SwiftUI
import WidgetKit

struct DJLLaunchControl: ControlWidget {
    static let kind = "app.djl.mobile.widgets.LaunchControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: DJLLaunchIntent()) {
                Label("DJL", image: "djl_control_symbol")
            }
        }
        .displayName("DJL")
        .description("Launch DJL from Control Center.")
    }
}
