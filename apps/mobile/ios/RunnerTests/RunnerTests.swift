import Flutter
import UIKit
import XCTest
import app_links
@testable import Runner

class RunnerTests: XCTestCase {
  @MainActor
  func testArchiveElapsedDateMatchesSourceDurationWithoutAgo() {
    let reference = 1_793_966_400_000.0
    let locale = Locale(identifier: "en_CA")
    XCTAssertEqual(AppDelegate.formatRelativeDate(dateMilliseconds: reference - 3_600_000,
      relativeToMilliseconds: reference, locale: locale, elapsed: true), "1 hr, 0 mins")
    XCTAssertEqual(AppDelegate.formatRelativeDate(dateMilliseconds: reference + 7_200_000,
      relativeToMilliseconds: reference, locale: locale, elapsed: true), "2 hrs, 0 mins")
    XCTAssertEqual(AppDelegate.formatRelativeDate(dateMilliseconds: reference - 86_400_000,
      relativeToMilliseconds: reference, locale: locale, elapsed: true), "1 day")
  }

  @MainActor
  func testArchiveElapsedDateKeepsNativeLocalizedUnits() {
    let reference = 1_793_966_400_000.0
    XCTAssertEqual(AppDelegate.formatRelativeDate(dateMilliseconds: reference - 7_200_000,
      relativeToMilliseconds: reference, locale: Locale(identifier: "fr_FR"), elapsed: true),
      "2\u{202f}h et 0\u{00a0}min")
  }

  @MainActor
  func testRelativeDateUsesUTCMillisecondsAndSourceShortUnits() {
    let reference = 1_793_966_400_000.0
    let locale = Locale(identifier: "en_US")
    XCTAssertEqual(AppDelegate.formatRelativeDate(
      dateMilliseconds: reference - 120_000,
      relativeToMilliseconds: reference, locale: locale
    ), "2 min. ago")
    XCTAssertEqual(AppDelegate.formatRelativeDate(
      dateMilliseconds: reference - 7_200_000,
      relativeToMilliseconds: reference, locale: locale
    ), "2 hr. ago")
  }

  @MainActor
  func testRelativeDatePreservesLocalizedUnitsAndFutureClockSkew() {
    let reference = 1_793_966_400_000.0
    XCTAssertEqual(AppDelegate.formatRelativeDate(
      dateMilliseconds: reference - 7_200_000,
      relativeToMilliseconds: reference, locale: Locale(identifier: "fr_FR")
    ), "il y a 2\u{00a0}h")
    XCTAssertEqual(AppDelegate.formatRelativeDate(
      dateMilliseconds: reference + 120_000,
      relativeToMilliseconds: reference, locale: Locale(identifier: "en_US")
    ), "in 2 min.")
  }

  private func latestLink() -> String? {
    var value: String?
    AppLinks.shared.handle(FlutterMethodCall(methodName: "getLatestLink", arguments: nil)) {
      value = $0 as? String
    }
    return value
  }

  func testColdSceneForwardsDJLLinksToTheExistingPlugin() {
    let links = DJLSceneLinks()
    XCTAssertTrue(links.responds(to: NSSelectorFromString("scene:willConnectToSession:options:")))
    let first = URL(string: "djl://scene-test/first")!
    let last = URL(string: "DJL://scene-test/last")!
    XCTAssertTrue(links.route([first, URL(string: "https://example.test/ignored")!, last]))
    XCTAssertEqual(latestLink(), last.absoluteString)
  }

  func testColdSceneLeavesProviderAndWebLinksToTheirOwners() {
    let previous = latestLink()
    XCTAssertFalse(DJLSceneLinks().route([
      URL(string: "https://example.test/ignored")!,
      URL(string: "provider-qa://callback")!,
    ]))
    XCTAssertEqual(latestLink(), previous)
  }

  func testOrdinarySceneLaunchDoesNotManufactureALink() {
    let previous = latestLink()
    XCTAssertFalse(DJLSceneLinks().route([]))
    XCTAssertEqual(latestLink(), previous)
  }

}
