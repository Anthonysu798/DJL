// FILE: DJLWidgetBundle.swift
// Purpose: Entry point for the DJL widget extension. Bundles together the
//          Lock Screen accessory widget and the iOS 18 Control Center
//          quick-launch control, both branded with the DJL outline mark.
// Layer: Widget Extension

import SwiftUI
import WidgetKit

@main
struct DJLWidgetBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        DJLLockScreenWidget()
        DJLDisplayIslandLiveActivity()
        if #available(iOS 18.0, *) {
            DJLLaunchControl()
        }
    }
}
