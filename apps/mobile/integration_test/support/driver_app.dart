// The ordinary app with Flutter Driver enabled, for driving it from tooling.
// Never used by the ordinary app entrypoint.
import 'package:flutter_driver/driver_extension.dart';
import 'package:djl_mobile/main.dart' as app;

void main() {
  enableFlutterDriverExtension();
  app.main();
}
