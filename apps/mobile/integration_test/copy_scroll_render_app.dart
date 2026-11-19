// Public native diagnostic only. No normal app or services are initialized.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/presentation/assistant_code_block.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_response_footer.dart';

void main() => runApp(const MaterialApp(home: CopyScrollRender()));

class CopyScrollRender extends StatefulWidget {
  const CopyScrollRender({super.key});

  @override
  State<CopyScrollRender> createState() => _CopyScrollRenderState();
}

class _CopyScrollRenderState extends State<CopyScrollRender> {
  String _mode = 'Static';
  int _activations = 0;
  static const _publicText = 'Public Copy scroll control133';

  Widget _controls() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      const Text(_publicText),
      DesktopResponseFooter(
        scope: AssistantCodeScope(
          mac: 'public-memory',
          pin: 'none',
          thread: 'copy-scroll133',
          item: _mode,
        ),
        text: _publicText,
        readText: () => _publicText,
      ),
      TextButton(
        onPressed: () => setState(() => _activations++),
        child: const Text('Plain action'),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) => Theme(
    data: djlTheme(Brightness.light),
    child: Scaffold(
      appBar: AppBar(title: const Text('Copy scroll control133')),
      body: Column(
        children: [
          Row(
            children: [
              for (final mode in ['Static', 'List', 'Timeline', 'Prefix'])
                Expanded(
                  child: TextButton(
                    onPressed: () => setState(() {
                      _mode = mode;
                      _activations = 0;
                    }),
                    child: Text(mode),
                  ),
                ),
            ],
          ),
          Text('$_mode · activations: $_activations'),
          Expanded(
            child: KeyedSubtree(
              key: ValueKey(_mode),
              child: switch (_mode) {
                'List' => ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: 10,
                  itemBuilder: (_, index) => SizedBox(
                    height: 180,
                    child: index == 0
                        ? _controls()
                        : Text('Public list row $index'),
                  ),
                ),
                'Timeline' || 'Prefix' => DesktopFocusTimeline(
                  count: _mode == 'Prefix' ? 11 : 10,
                  itemBuilder: (_, index) => SizedBox(
                    height: 180,
                    child: index == 9
                        ? _controls()
                        : Text('Public timeline row $index'),
                  ),
                ),
                _ => Padding(
                  padding: const EdgeInsets.all(16),
                  child: Align(
                    alignment: Alignment.topLeft,
                    child: _controls(),
                  ),
                ),
              },
            ),
          ),
          const SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.all(12),
              child: TextField(
                decoration: InputDecoration(labelText: 'Public input'),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
