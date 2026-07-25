// FILE: HapticButton.swift
// Purpose: Drop-in replacement for `Button` that triggers a haptic impact
//          before invoking the action. Centralizes the
//          `HapticFeedback.shared.triggerImpactFeedback` + `Button { ... }`
//          pattern used across the app so every tappable surface stays
//          consistent. The caller still owns presentation (`buttonStyle`,
//          `disabled`, accessibility), keeping this safe to drop into both
//          plain custom labels and context-menu items.
// Layer: View Component
// Exports: HapticButton
// Depends on: SwiftUI, UIKit, HapticFeedback

import SwiftUI
import UIKit

struct HapticButton<Label: View>: View {
    var hapticStyle: UIImpactFeedbackGenerator.FeedbackStyle = .light
    var role: ButtonRole? = nil
    let action: () -> Void
    @ViewBuilder var label: () -> Label

    var body: some View {
        Button(role: role) {
            HapticFeedback.shared.triggerImpactFeedback(style: hapticStyle)
            action()
        } label: {
            label()
        }
    }
}
