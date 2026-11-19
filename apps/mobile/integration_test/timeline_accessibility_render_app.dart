// Public, memory-only native diagnostic. Not an ordinary application entry.
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/presentation/assistant_code_block.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_response_footer.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: TimelineAccessibilityRender(),
    ),
  );
}

class TimelineAccessibilityRender extends StatefulWidget {
  const TimelineAccessibilityRender({super.key});
  @override
  State<TimelineAccessibilityRender> createState() =>
      _TimelineAccessibilityRenderState();
}

class _TimelineAccessibilityRenderState
    extends State<TimelineAccessibilityRender> {
  final _timeline = GlobalKey();
  late final SemanticsHandle _semantics;
  int _count = 40;
  double _pixels = 0, _after = 0;
  bool _queued = false;
  static const _reply = 'Known public accessibility response132';

  @override
  void initState() {
    super.initState();
    _semantics = SemanticsBinding.instance.ensureSemantics();
  }

  void _observe(ScrollMetrics metrics) {
    if ((_pixels - metrics.pixels).abs() < .01 &&
        (_after - metrics.extentAfter).abs() < .01) {
      return;
    }
    _pixels = metrics.pixels;
    _after = metrics.extentAfter;
    if (_queued) return;
    _queued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _queued = false;
      if (mounted) setState(() {});
    });
  }

  void _earlier() {
    final owner = _timeline.currentContext
        ?.findRenderObject()
        ?.owner
        ?.semanticsOwner;
    SemanticsNode? target;
    void visit(SemanticsNode node) {
      if (node.getSemanticsData().hasAction(
        ui.SemanticsAction.scrollToOffset,
      )) {
        target = node;
      }
      node.visitChildren((child) {
        visit(child);
        return true;
      });
    }

    final root = owner?.rootSemanticsNode;
    if (root == null) {
      throw StateError('Native render semantics are unavailable');
    }
    visit(root);
    if (target == null) {
      throw StateError('Actual timeline scroll action is unavailable');
    }
    owner!.performAction(
      target!.id,
      ui.SemanticsAction.scrollToOffset,
      Float64List.fromList([0, _pixels - 320]),
    );
  }

  @override
  void dispose() {
    _semantics.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: djlTheme(Brightness.light),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Timeline semantics QA'),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(80),
            child: Column(
              children: [
                Text(
                  '${_after > 16 ? 'Reading earlier' : 'Following latest'} · rows: $_count',
                ),
                Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        onPressed: _earlier,
                        child: const Text(
                          'Accessibility earlier',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                    Expanded(
                      child: TextButton(
                        onPressed: () => setState(() => _count++),
                        child: const Text(
                          'Append public row',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        body: Column(
          children: [
            Expanded(
              child: NotificationListener<ScrollMetricsNotification>(
                onNotification: (n) {
                  if (n.depth == 0) _observe(n.metrics);
                  return false;
                },
                child: NotificationListener<ScrollNotification>(
                  onNotification: (n) {
                    if (n.depth == 0) _observe(n.metrics);
                    return false;
                  },
                  child: DesktopFocusTimeline(
                    key: _timeline,
                    count: _count,
                    itemBuilder: (_, index) => SizedBox(
                      height: 100,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Public history $index'),
                          if (index == 39)
                            DesktopResponseFooter(
                              scope: const AssistantCodeScope(
                                mac: 'public-memory',
                                pin: 'none',
                                thread: 'timeline132',
                                item: 'reply',
                              ),
                              text: _reply,
                              readText: () => _reply,
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.all(12),
                child: TextField(
                  decoration: InputDecoration(
                    labelText: 'Public fixture input',
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
