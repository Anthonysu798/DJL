// FILE: SidebarForegroundStyle.swift
// Purpose: Centralized foreground styles for sidebar muted/metadata text and
//          glyphs so every "secondary line" in the sidebar reads with the
//          same tint and can be retuned in one place.
// Layer: View Utility
// Exports: SidebarForegroundStyle

import SwiftUI

enum SidebarForegroundStyle {
    // Muted tint shared by row metadata (pinned project label, in-row pin
    // glyph, archived caption, etc.). Mapped to `.tertiary` today; route any
    // new caption-level usage through this constant so the whole sidebar
    // tracks a single design token.
    static let meta: HierarchicalShapeStyle = .tertiary
}
