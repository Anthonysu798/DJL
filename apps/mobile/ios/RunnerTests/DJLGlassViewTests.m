#import <Flutter/Flutter.h>
#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

@interface DJLGlassViewTests : XCTestCase
@end

@implementation DJLGlassViewTests

- (void)onMain:(void (^)(void))body {
  if ([NSThread isMainThread]) body();
  else dispatch_sync(dispatch_get_main_queue(), body);
}

- (UIVisualEffectView *)surfaceEnabled:(BOOL)enabled dark:(BOOL)dark {
  Class factoryClass = NSClassFromString(@"DJLGlassViewFactory");
  XCTAssertNotNil(factoryClass, @"Native glass must be implemented by the app");
  if (factoryClass == nil) return nil;
  id<FlutterPlatformViewFactory> factory = [[factoryClass alloc] init];
  XCTAssertNotNil([factory createArgsCodec]);
  NSObject<FlutterPlatformView> *platform =
      [factory createWithFrame:CGRectMake(0, 0, 320, 84)
                viewIdentifier:51
                     arguments:@{@"enabled": @(enabled), @"dark": @(dark), @"radius": @26}];
  UIView *view = [platform view];
  XCTAssertTrue([view isKindOfClass:[UIVisualEffectView class]]);
  [view setNeedsLayout];
  [view layoutIfNeeded];
  return (UIVisualEffectView *)view;
}

- (void)testEnabledUsesTheAvailableNativeMaterial {
  [self onMain:^{
    UIVisualEffectView *view = [self surfaceEnabled:YES dark:NO];
    if (view == nil) return;
    if (@available(iOS 26.0, *)) {
      XCTAssertTrue([view.effect isKindOfClass:[UIGlassEffect class]]);
      XCTAssertFalse(((UIGlassEffect *)view.effect).interactive);
    } else {
      XCTAssertTrue([view.effect isKindOfClass:[UIBlurEffect class]]);
    }
  }];
}

- (void)testDisabledUsesMaterialWithoutGlass {
  [self onMain:^{
    UIVisualEffectView *view = [self surfaceEnabled:NO dark:NO];
    if (view == nil) return;
    XCTAssertTrue([view.effect isKindOfClass:[UIBlurEffect class]]);
    if (@available(iOS 26.0, *)) {
      XCTAssertFalse([view.effect isKindOfClass:[UIGlassEffect class]]);
    }
  }];
}

- (void)testBackdropDoesNotInterceptControlsOrAddAccessibilityContent {
  [self onMain:^{
    UIVisualEffectView *view = [self surfaceEnabled:YES dark:NO];
    if (view == nil) return;
    XCTAssertFalse(view.userInteractionEnabled);
    XCTAssertFalse(view.isAccessibilityElement);
    XCTAssertTrue(view.accessibilityElementsHidden);
  }];
}

- (void)testMaterialRespectsTheAppThemeAndSurfaceGeometry {
  [self onMain:^{
    for (NSNumber *dark in @[@NO, @YES]) {
      UIVisualEffectView *view = [self surfaceEnabled:YES dark:dark.boolValue];
      if (view == nil) return;
      XCTAssertEqual(view.overrideUserInterfaceStyle,
                     dark.boolValue ? UIUserInterfaceStyleDark : UIUserInterfaceStyleLight);
      XCTAssertEqualWithAccuracy(view.bounds.size.width, 320, .001);
      XCTAssertEqualWithAccuracy(view.bounds.size.height, 84, .001);
      XCTAssertEqualWithAccuracy(view.layer.cornerRadius, 26, .001);
    }
  }];
}

- (void)testNativeBackdropHidesWhileInactiveAndReturnsOnActivation {
  [self onMain:^{
    UIVisualEffectView *view = [self surfaceEnabled:YES dark:NO];
    if (view == nil) return;
    [[NSNotificationCenter defaultCenter]
        postNotificationName:UIApplicationWillResignActiveNotification object:nil];
    XCTAssertTrue(view.hidden, @"Inactive snapshots must not contain the native backdrop");
    [[NSNotificationCenter defaultCenter]
        postNotificationName:UIApplicationDidBecomeActiveNotification object:nil];
    XCTAssertFalse(view.hidden);
  }];
}

@end
