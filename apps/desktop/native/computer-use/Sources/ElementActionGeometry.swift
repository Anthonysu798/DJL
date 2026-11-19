import CoreGraphics

enum ElementActionGeometry {
    static func point(element: CGRect, window: CGRect, scrollAreas: [CGRect]) -> CGPoint? {
        func valid(_ rect: CGRect) -> Bool {
            !rect.isNull && !rect.isInfinite && rect.origin.x.isFinite && rect.origin.y.isFinite &&
                rect.size.width.isFinite && rect.size.height.isFinite && rect.size.width > 0 && rect.size.height > 0
        }
        guard valid(element), valid(window), scrollAreas.allSatisfy(valid) else { return nil }
        var visible = element.intersection(window)
        for viewport in scrollAreas { visible = visible.intersection(viewport) }
        guard valid(visible) else { return nil }
        return CGPoint(x: visible.midX, y: visible.midY)
    }
}
