import AppIntents

// Shared by Runner and DJLWidgets so the control opens the containing app.
@available(iOS 18.0, *)
enum DJLLaunchTarget: String, AppEnum {
    case home

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "DJL")
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .home: "DJL"
    ]
}

@available(iOS 18.0, *)
struct DJLLaunchIntent: OpenIntent {
    static var title: LocalizedStringResource = "Open DJL"
    static var description = IntentDescription("Brings DJL to the foreground.")

    @Parameter(title: "Target")
    var target: DJLLaunchTarget

    init() {
        self.target = .home
    }
}
