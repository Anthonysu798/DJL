// Public geometry-only native probe. No services or storage are initialized.
import 'package:flutter/material.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_phone_drawer.dart';

void main() => runApp(const DrawerCornerRender());

class DrawerCornerRender extends StatefulWidget {
  const DrawerCornerRender({super.key, this.brightness = Brightness.light});
  final Brightness brightness;

  @override
  State<DrawerCornerRender> createState() => _DrawerCornerRenderState();
}

class _DrawerCornerRenderState extends State<DrawerCornerRender> {
  final _drawer = GlobalKey<DesktopPhoneDrawerState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _drawer.currentState?.toggle();
    });
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(brightness: widget.brightness),
    home: DesktopPhoneDrawer(
      key: _drawer,
      menu: const ColoredBox(color: Colors.white),
      child: const SizedBox.expand(child: ColoredBox(color: Color(0xffff0000))),
    ),
  );
}
