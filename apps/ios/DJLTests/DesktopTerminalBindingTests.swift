// FILE: DesktopTerminalBindingTests.swift
// Purpose: Verifies the terminal source profile field and phone/desktop terminal id mapping.
// Layer: Unit Test
// Exports: DesktopTerminalBindingTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

final class DesktopTerminalBindingTests: XCTestCase {
    func testProfileWithoutSourceDecodesAsSSH() throws {
        let json = #"{"host":"h","username":"u","port":22,"cwd":"","nickname":""}"#

        let profile = try JSONDecoder().decode(DJLTerminalProfile.self, from: Data(json.utf8))

        XCTAssertEqual(profile.source, .ssh)
    }

    func testProfileRoundTripsDesktopSource() throws {
        var profile = DJLTerminalProfile.empty
        profile.source = .desktop

        let data = try JSONEncoder().encode(profile)
        let decoded = try JSONDecoder().decode(DJLTerminalProfile.self, from: data)

        XCTAssertEqual(decoded.source, .desktop)
        XCTAssertEqual(profile.normalizedForSave.source, .desktop)
    }

    func testDefaultTerminalIdMapsToDesktopDefault() {
        XCTAssertEqual(DesktopTerminalBinding.desktopTerminalId(forPhoneTerminalId: "term-1"), "default")
        XCTAssertEqual(DesktopTerminalBinding.phoneTerminalId(forDesktopTerminalId: "default"), "term-1")
        XCTAssertEqual(DesktopTerminalBinding.desktopTerminalId(forPhoneTerminalId: "term-2"), "term-2")
        XCTAssertEqual(DesktopTerminalBinding.phoneTerminalId(forDesktopTerminalId: "abc"), "abc")
    }
}
