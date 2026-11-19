import Foundation

@main struct ElementActionGeometryTests {
    static func main() {
        let window = CGRect(x: 80, y: 515, width: 520, height: 512)
        let scroll = CGRect(x: 104, y: 617, width: 470, height: 140)
        let document = CGRect(x: 104, y: 617, width: 1400, height: 1920)
        // A large document's center is off-window, but its viewport is actionable.
        assert(ElementActionGeometry.point(element: document, window: window, scrollAreas: [scroll]) == CGPoint(x: 339, y: 687))
        // Window intersection alone chooses a point below the scroll viewport.
        assert(ElementActionGeometry.point(element: document, window: window, scrollAreas: []) == CGPoint(x: 352, y: 822))
        assert(ElementActionGeometry.point(element: CGRect(x: 120, y: 650, width: 40, height: 30), window: window, scrollAreas: [scroll]) == CGPoint(x: 140, y: 665))
        assert(ElementActionGeometry.point(element: document, window: window, scrollAreas: [scroll, CGRect(x: 200, y: 630, width: 100, height: 50)]) == CGPoint(x: 250, y: 655))
        assert(ElementActionGeometry.point(element: CGRect(x: 90, y: 400, width: 100, height: 115), window: window, scrollAreas: []) == nil)
        assert(ElementActionGeometry.point(element: CGRect(x: 600, y: 600, width: 10, height: 10), window: window, scrollAreas: []) == nil)
        assert(ElementActionGeometry.point(element: document, window: window, scrollAreas: [CGRect(x: 700, y: 600, width: 100, height: 100)]) == nil)
        for invalid in [CGRect.zero, CGRect.null, CGRect.infinite, CGRect(x: 0, y: 0, width: -1, height: 20), CGRect(x: CGFloat.nan, y: 0, width: 20, height: 20)] {
            assert(ElementActionGeometry.point(element: invalid, window: window, scrollAreas: []) == nil)
            assert(ElementActionGeometry.point(element: document, window: invalid, scrollAreas: []) == nil)
            assert(ElementActionGeometry.point(element: document, window: window, scrollAreas: [invalid]) == nil)
        }
        print("Element action geometry: 22 assertions passed")
    }
}
