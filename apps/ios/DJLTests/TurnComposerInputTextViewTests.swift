import UIKit
import XCTest
@testable import DJL

final class TurnComposerInputTextViewTests: XCTestCase {
    func testComposerDisablesKeyboardRewritesForCommandsAndPaths() {
        XCTAssertEqual(TurnComposerInputTextView.autocorrectionType, .no)
        XCTAssertEqual(TurnComposerInputTextView.autocapitalizationType, .none)
    }
}
