import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:liquid_glass_renderer/liquid_glass_renderer.dart';
import '../../features/settings/domain/appearance.dart';

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
                      if (defaultTargetPlatform == TargetPlatform.iOS &&
                          routeVisible &&
                          enabled &&
                          !widget.useNativeView) {
                        return DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(widget.radius),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: .07),
                                blurRadius: 24,
                                offset: const Offset(0, 8),
                                blurStyle: BlurStyle.outer,
                              ),
                            ],
                          ),
                          child: FakeGlass(
                            shape: LiquidRoundedRectangle(
                              borderRadius: widget.radius,
                            ),
                            settings: LiquidGlassSettings(
                              glassColor: Colors.white.withValues(
                                alpha: dark ? .11 : .65,
                              ),
                            ),
                            child: const SizedBox.expand(),
                          ),
                        );
                      }
                      if (defaultTargetPlatform == TargetPlatform.android &&
                          enabled) {
                        return DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(widget.radius),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: .07),
                                blurRadius: 24,
                                offset: Offset.zero,
                                blurStyle: BlurStyle.outer,
                              ),
                            ],
                          ),
                          // Impeller's shader-support flag also includes GLES,
                          // whose filter pass can abort the raster thread.
                          child: FakeGlass(
                            shape: LiquidRoundedRectangle(
                              borderRadius: widget.radius,
                            ),
                            settings: LiquidGlassSettings(
                              glassColor: widget._menu
                                  ? Colors.white.withValues(
                                      alpha: dark ? .055 : .65,
                                    )
                                  : (dark ? Colors.white : Colors.black)
                                        .withValues(alpha: dark ? .075 : .02),
                            ),
                            child: const SizedBox.expand(),
                          ),
                        );
                      }
                    }
                    return ClipRRect(
                      borderRadius: BorderRadius.circular(widget.radius),
                      child: BackdropFilter(
                        filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                        child: ColoredBox(
                          color: theme.colorScheme.surfaceContainerLow
                              .withValues(alpha: .72),
                        ),
                      ),
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
