import SwiftUI
import WidgetKit

@main
struct DJLWidgetsBundle: WidgetBundle {
    var body: some Widget {
        DJLLockScreenWidget()
        DJLLaunchControl()
        RunStatusLiveActivity()
    }
}
