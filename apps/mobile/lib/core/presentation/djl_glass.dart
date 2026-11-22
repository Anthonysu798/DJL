import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../features/settings/domain/appearance.dart';
import 'djl_frosted.dart';

final _nativeGlassOverlays = Expando<ValueNotifier<int>>();

// UIKit planes must stay absent until a covering Flutter overlay has completed.
ValueNotifier<int> djlNativeGlassOverlays(NavigatorState navigator) =>
    _nativeGlassOverlays[navigator] ??= ValueNotifier(0);

Future<bool> supportsLiquidGlass() async {
  if (kIsWeb) return false;
  if (defaultTargetPlatform == TargetPlatform.android) {
    return true;
  }
  if (defaultTargetPlatform != TargetPlatform.iOS) return false;
  try {
    return await const MethodChannel(
          'djl.mobile/app-info',
        ).invokeMethod<bool>('supportsLiquidGlass') ??
        false;
  } on MissingPluginException {
    return false;
  } on PlatformException {
    return false;
  }
}

/// The background changes independently of the input and its focus state.
class DjlGlassSurface extends StatefulWidget {
  const DjlGlassSurface({
    super.key,
    required this.child,
    this.radius = 26,
    this.useNativeView = true,
  }) : _menu = false;

  const DjlGlassSurface.menu({super.key, required this.child, this.radius = 34})
    : useNativeView = true,
      _menu = true;

  final Widget child;
  final double radius;
  // Repeated scrolling surfaces can stay in Flutter's compositor.
  final bool useNativeView;
  final bool _menu;

  @override
  State<DjlGlassSurface> createState() => _DjlGlassSurfaceState();
}

class _DjlGlassSurfaceState extends State<DjlGlassSurface> {
  late final _supported = supportsLiquidGlass();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final enabled = theme.extension<DjlAppearance>()?.liquidGlass ?? true;
    final routeVisible = ModalRoute.of(context)?.isCurrent != false;
    return ValueListenableBuilder<int>(
      valueListenable: djlNativeGlassOverlays(Navigator.of(context)),
      builder: (context, overlays, _) => Stack(
        children: [
          Positioned.fill(
            child: ExcludeSemantics(
              child: IgnorePointer(
                child: FutureBuilder<bool>(
                  future: _supported,
                  builder: (context, snapshot) {
                    if (snapshot.data == true) {
                      if (defaultTargetPlatform == TargetPlatform.iOS &&
                          routeVisible &&
                          (overlays == 0 || widget._menu) &&
                          widget.useNativeView) {
                        return UiKitView(
                          key: ValueKey((enabled, dark, widget.radius)),
                          viewType: 'djl.mobile/glass',
                          creationParamsCodec: const StandardMessageCodec(),
                          creationParams: {
                            'enabled': enabled,
                            'dark': dark,
                            'radius': widget.radius,
                          },
                        );
                      }
                    }
                    // Everywhere else: the same frosted glass as the menus.
                    return DjlFrosted(
                      radius: widget.radius,
                      shadow: widget._menu,
                      child: const SizedBox.expand(),
                    );
                  },
                ),
              ),
            ),
          ),
          widget.child,
        ],
      ),
    );
  }
}
