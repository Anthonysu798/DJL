// FILE: CircularIconBadge.swift
// Purpose: Shared chrome for the small "icon centered inside a filled circle"
//          pattern used by composer-adjacent affordances (send button, stop
//          button, queue-resume, voice mic, recording badge, ...). Owning the
//          chrome in one place avoids drift between call sites and lets future
//          tweaks (size, weight, background scheme) happen in a single file.
// Layer: View Component
// Exports: CircularIconBadge, DJLCircleBadge

import SwiftUI

/// Round filled badge wrapping any icon-like content.
///
/// Use ``DJLCircleBadge`` for the common case (a single DJL icon at the
/// standard composer weight). Use this trailing-closure init for `ProgressView()`,
/// stacked content, or when intentionally bypassing `DJLIcon`'s custom
/// asset mapping (for example, forcing a native `Image(systemName:)`).
struct CircularIconBadge<Content: View>: View {
    let foreground: Color
    let background: Color
    let diameter: CGFloat
    @ViewBuilder let content: () -> Content

    init(
        foreground: Color,
        background: Color,
        diameter: CGFloat = 32,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.foreground = foreground
        self.background = background
        self.diameter = diameter
        self.content = content
    }

    var body: some View {
        content()
            .foregroundStyle(foreground)
            .frame(width: diameter, height: diameter)
            .background(background, in: Circle())
    }
}

/// Typed convenience over ``CircularIconBadge`` for the most common case: a
/// single DJL icon centered inside the filled circle, sized at the
/// composer chrome defaults (~12pt bold inside a 32pt circle). Routes the icon
/// through `DJLIcon.image(systemName:size:weight:)` so it benefits from
/// the universal square-anchor sizing and Dynamic Type scaling.
struct DJLCircleBadge: View {
    let systemName: String
    let foreground: Color
    let background: Color
    var diameter: CGFloat = 32
    var iconSize: CGFloat = 12
    var iconWeight: Font.Weight = .bold

    var body: some View {
        CircularIconBadge(
            foreground: foreground,
            background: background,
            diameter: diameter
        ) {
            DJLIcon.image(
                systemName: systemName,
                size: iconSize,
                weight: iconWeight
            )
        }
    }
}

#if DEBUG
#Preview("Composer circle badges") {
    HStack(spacing: 12) {
        DJLCircleBadge(
            systemName: "arrow.clockwise",
            foreground: Color(.systemBackground),
            background: Color(.systemGray2),
            diameter: 28
        )

        DJLCircleBadge(
            systemName: "stop.fill",
            foreground: .white,
            background: .red
        )

        DJLCircleBadge(
            systemName: "arrow.up",
            foreground: Color(.systemBackground),
            background: Color(.label)
        )

        CircularIconBadge(
            foreground: Color(.label),
            background: Color(.systemGray5)
        ) {
            ProgressView()
        }
    }
    .padding()
}
#endif
