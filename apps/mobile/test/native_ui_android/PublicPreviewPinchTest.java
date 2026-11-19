package app.djl.qa;

import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

/** One prepared public-preview gesture; no navigation, text, grants or app data. */
public final class PublicPreviewPinchTest extends UiAutomatorTestCase {
  private static final String APP = "app.djl.mobile";

  private UiObject image(String name) {
    return new UiObject(new UiSelector().packageName(APP)
        .className("android.widget.ImageView").description(name));
  }

  private void report(String value) {
    Bundle result = new Bundle();
    result.putString("stream", value + "\n");
    getAutomationSupport().sendStatus(0, result);
  }

  private void requireScope(boolean value) {
    if (!value) {
      report("QA_PUBLIC_PINCH_REJECTED input_attempted=0");
      fail("Expected the owned Pixel9 public DJL image preview before input");
    }
  }

  public void testPreparedPublicPreviewPinch() throws Exception {
    requireScope(Build.VERSION.SDK_INT == 35
        && getUiDevice().getDisplayWidth() == 1080
        && getUiDevice().getDisplayHeight() == 2424
        && APP.equals(getUiDevice().getCurrentPackageName()));
    UiObject png = image("p.png"), svg = image("s.svg");
    requireScope(png.exists() != svg.exists());
    boolean raster = png.exists();
    UiObject image = raster ? png : svg;
    UiObject close = new UiObject(new UiSelector().packageName(APP)
        .description(raster ? "Close" : "Close SVG preview").clickable(true));
    requireScope(close.exists());
    Rect bounds = image.getVisibleBounds();
    requireScope(bounds.width() >= 600 && bounds.height() >= 800
        && bounds.left >= 0 && bounds.top >= 0
        && bounds.right <= 1080 && bounds.bottom <= 2424);
    // The installed SDK performs a real two-pointer gesture inside this object.
    assertTrue("Native two-pointer injection did not complete", image.pinchOut(60, 40));
    report("QA_PUBLIC_PINCH_OK asset=" + (raster ? "p.png" : "s.svg"));
  }
}
