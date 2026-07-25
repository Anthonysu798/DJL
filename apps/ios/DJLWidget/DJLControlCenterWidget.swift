// FILE: DJLControlCenterWidget.swift
// Purpose: iOS 18 Control Center widget that adds a DJL quick-launch
//          button to the Controls Gallery. Tapping the button triggers
//          `DJLLaunchIntent`, which brings the DJL app to the
//          foreground.
// Layer: Widget Extension

import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct DJLLaunchControl: ControlWidget {
    static let kind = "app.djl.ios.DJLWidget.LaunchControl.v9"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: DJLLaunchIntent()) {
                // Control Center only accepts symbol images, so this routes
                // through the control-sized DJL symbolset.
                Label("DJL", image: "djl_control_symbol")
            }
        }
        .displayName("DJL")
        .description("Launch DJL from Control Center.")
    }
}
