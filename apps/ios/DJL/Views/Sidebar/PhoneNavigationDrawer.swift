// A persistent content stack slides aside without rebuilding the active conversation.
import SwiftUI
import UIKit

enum PhoneNavigationDrawerPolicy {
    static let transition = Animation.smooth(duration: 0.48, extraBounce: 0)

    static func width(for availableWidth: CGFloat) -> CGFloat {
        // Leave thirty percent of the conversation visible at every width.
        max(0, availableWidth * 0.70)
    }

    static func shouldOpen(isOpen: Bool, translation: CGFloat, predicted: CGFloat, width: CGFloat) -> Bool {
        let projectedReveal = (isOpen ? width : 0) + predicted
        guard abs(translation) > 12 else { return isOpen }
        return projectedReveal > width * 0.45
    }
}

struct PhoneNavigationDrawer<Menu: View, Content: View>: View {
    @Binding var isOpen: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var dragTranslation: CGFloat = 0
    private let menu: Menu
    private let content: Content

    init(isOpen: Binding<Bool>, @ViewBuilder menu: () -> Menu, @ViewBuilder content: () -> Content) {
        _isOpen = isOpen
        self.menu = menu()
        self.content = content()
    }

    var body: some View {
        GeometryReader { geometry in
            // Measure the safe content area before expanding the presentation
            // viewport. Controls retain these insets; the panel, scrim and
            // shadow extend all the way to the physical screen edges.
            GeometryReader { viewport in
                let width = PhoneNavigationDrawerPolicy.width(for: geometry.size.width)
                let reveal = min(width, max(0, (isOpen ? width : 0) + dragTranslation))
                let progress = width > 0 ? reveal / width : 0
                let panelShape = RoundedRectangle(cornerRadius: 56 * progress, style: .continuous)

                ZStack(alignment: .leading) {
                    Color(.systemBackground).ignoresSafeArea()

                    // Retain the menu between openings so its list and glass
                    // surfaces are ready before the tap-driven slide begins.
                    // The menu reaches the bottom screen edge so its list can
                    // scroll under the home indicator; the bottom inset is kept
                    // as safe area for the floating controls.
                    menu
                        .safeAreaPadding(.bottom, geometry.safeAreaInsets.bottom)
                        .frame(width: width, height: geometry.size.height + geometry.safeAreaInsets.bottom)
                        .padding(.top, geometry.safeAreaInsets.top)
                        .offset(x: reduceMotion ? 0 : -18 * (1 - progress))
                        .allowsHitTesting(isOpen)
                        .accessibilityElement(children: .contain)
                        .accessibilityHidden(!isOpen)
                        .simultaneousGesture(revealGesture(width: width))

                    content
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .padding(.top, geometry.safeAreaInsets.top)
                        .padding(.bottom, geometry.safeAreaInsets.bottom)
                        .background(Color(.systemBackground))
                        .overlay {
                            if reveal > 0 {
                                Color.black.opacity(0.06 * progress)
                                    .contentShape(Rectangle())
                                    .onTapGesture { isOpen = false }
                                    .accessibilityLabel("Close navigation")
                                    .accessibilityAddTraits(.isButton)
                                    .accessibilityAction { isOpen = false }
                                    .simultaneousGesture(revealGesture(width: width))
                            }
                        }
                        .clipShape(panelShape)
                        .overlay {
                            panelShape
                                .strokeBorder(Color.primary.opacity(0.04 * progress), lineWidth: 0.5)
                                .allowsHitTesting(false)
                        }
                        .shadow(color: .black.opacity(0.16 * progress), radius: 28, x: -10)
                        .offset(x: reveal)
                        .accessibilityElement(children: .contain)
                        .accessibilityHidden(isOpen)

                    if !isOpen {
                        Color.clear
                            .frame(width: 24)
                            .contentShape(Rectangle())
                            .gesture(revealGesture(width: width))
                            .accessibilityHidden(true)
                    }
                }
                .frame(width: viewport.size.width, height: viewport.size.height, alignment: .leading)
                .clipped()
                .animation(reduceMotion ? nil : PhoneNavigationDrawerPolicy.transition, value: dragTranslation == 0)
                .accessibilityAction(.escape) { isOpen = false }
            }
            .ignoresSafeArea(.container, edges: .vertical)
        }
        .animation(reduceMotion ? nil : PhoneNavigationDrawerPolicy.transition, value: isOpen)
        .onChange(of: isOpen) { _, _ in
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
        }
    }

    private func revealGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .updating($dragTranslation) { value, state, _ in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.25 else { return }
                state = value.translation.width
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.25 else { return }
                isOpen = PhoneNavigationDrawerPolicy.shouldOpen(
                    isOpen: isOpen,
                    translation: value.translation.width,
                    predicted: value.predictedEndTranslation.width,
                    width: width
                )
            }
    }
}
