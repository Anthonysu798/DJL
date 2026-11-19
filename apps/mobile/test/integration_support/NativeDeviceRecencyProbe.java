package app.djl.qa;

import dalvik.system.PathClassLoader;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.Locale;

/** Runs only pure formatting from the built APK in a separate Android process. */
public final class NativeDeviceRecencyProbe {
  private static int passed;

  private static void check(Method method, Object formatter, long date, long reference, String expected)
      throws Exception {
    String actual = (String) method.invoke(formatter, date, reference);
    String normalized = actual.replace('\u00a0', ' ').replace('\u202f', ' ');
    if (!normalized.equals(expected)) {
      throw new AssertionError("Expected " + expected + "; got " + actual);
    }
    passed++;
  }

  public static void main(String[] args) {
    try {
      run(args);
    } catch (Throwable failure) {
      java.io.PrintStream output = new java.io.PrintStream(
          new java.io.FileOutputStream(java.io.FileDescriptor.out));
      failure.printStackTrace(output);
      output.flush();
      System.exit(1);
    }
  }

  private static void run(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("Expected the owned APK path");
    PathClassLoader loader = new PathClassLoader(args[0], ClassLoader.getSystemClassLoader());
    Class<?> type = loader.loadClass("app.djl.mobile.DeviceRecencyFormatter");
    Object formatter = type.getField("INSTANCE").get(null);
    Method method = type.getMethod("format", long.class, long.class);
    Locale.setDefault(Locale.US);
    java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
    long now = 1793966400000L;
    check(method, formatter, now - 120000L, now, "2 min. ago");
    check(method, formatter, now - 7200000L, now, "2 hr. ago");
    check(method, formatter, now + 120000L, now, "in 2 min.");
    check(method, formatter, now - 90000L, now, "1 min. ago");
    check(method, formatter, now - 3599600L, now, "59 min. ago");
    check(method, formatter, now - 86399600L, now, "23 hr. ago");
    check(method, formatter, now - 604799600L, now, "6 days ago");
    check(method, formatter, Instant.parse("2026-06-15T12:00:00Z").toEpochMilli(),
        Instant.parse("2026-07-15T12:00:00Z").toEpochMilli(), "1 mo. ago");
    check(method, formatter, Instant.parse("2024-11-06T12:00:00Z").toEpochMilli(), now, "2 yr. ago");
    Locale.setDefault(Locale.FRANCE);
    check(method, formatter, now - 7200000L, now, "il y a 2 h");
    check(method, formatter, now + 120000L, now, "dans 2 min");
    java.io.PrintStream output = new java.io.PrintStream(
        new java.io.FileOutputStream(java.io.FileDescriptor.out));
    output.println("PASS native date cases=" + passed);
    output.flush();
  }
}
