// Public diagnostic: identical controls, explicit semantics lease at startup.
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'copy_scroll_render_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MaterialApp(home: ForcedCopyScrollRender()));
}

class ForcedCopyScrollRender extends StatefulWidget {
  const ForcedCopyScrollRender({super.key});

  @override
  State<ForcedCopyScrollRender> createState() => _ForcedCopyScrollRenderState();
}

class _ForcedCopyScrollRenderState extends State<ForcedCopyScrollRender> {
  late final SemanticsHandle _semantics;

  @override
  void initState() {
    super.initState();
    _semantics = SemanticsBinding.instance.ensureSemantics();
  }

  @override
  void dispose() {
    _semantics.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const CopyScrollRender();
}
