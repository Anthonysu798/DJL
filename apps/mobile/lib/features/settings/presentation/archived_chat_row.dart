import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'settings_group.dart';

class ArchivedChatRow extends StatefulWidget {
  const ArchivedChatRow({
    super.key,
    required this.title,
    this.subtitle,
    required this.color,
    required this.revealed,
    required this.onReveal,
    required this.onUnarchive,
    required this.onRemove,
    required this.onMenu,
  });
  final String title;
  final Widget? subtitle;
  final Color color;
  final bool revealed;
  final VoidCallback onReveal, onUnarchive;
  final ValueChanged<Offset> onMenu, onRemove;
  @override
  State<ArchivedChatRow> createState() => _ArchivedChatRowState();
}

class _ArchivedChatRowState extends State<ArchivedChatRow> {
  static const _actionWidth = 88.0;
  double _offset = 0;
  bool _dragging = false;
  void _close() => setState(() {
    _offset = 0;
    _dragging = false;
  });
  void _act(VoidCallback action) {
    _close();
    action();
  }

  Offset _anchor() {
    final box = context.findRenderObject() as RenderBox;
    return box.localToGlobal(box.size.center(Offset.zero));
  }

  @override
  void didUpdateWidget(ArchivedChatRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.revealed) {
      _offset = 0;
      _dragging = false;
    }
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final direction = Directionality.of(context) == TextDirection.rtl
          ? -1.0
          : 1.0;
      final colors = Theme.of(context).colorScheme;
      Widget action(
        String label,
        IconData icon,
        Color color,
        VoidCallback callback,
      ) => SizedBox(
        width: _actionWidth,
        child: ColoredBox(
          color: color,
          child: TextButton(
            onPressed: () => _act(callback),
            style: TextButton.styleFrom(
              foregroundColor: Colors.white,
              padding: const EdgeInsets.all(8),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 20),
                const SizedBox(height: 4),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: settingsTextStyle(context, 11, color: Colors.white),
                ),
              ],
            ),
          ),
        ),
      );
      return Semantics(
        customSemanticsActions: {
          const CustomSemanticsAction(label: 'Unarchive'): () =>
              _act(widget.onUnarchive),
          const CustomSemanticsAction(label: 'Remove from Phone'): () =>
              _act(() => widget.onRemove(_anchor())),
        },
        child: ClipRect(
          child: Stack(
            children: [
              if (_offset != 0)
                Positioned.fill(
                  child: Align(
                    alignment: _offset > 0
                        ? AlignmentDirectional.centerStart
                        : AlignmentDirectional.centerEnd,
                    child: SizedBox.expand(
                      child: Row(
                        mainAxisAlignment: _offset > 0
                            ? MainAxisAlignment.start
                            : MainAxisAlignment.end,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _offset > 0
                              ? action(
                                  'Unarchive',
                                  CupertinoIcons.tray_arrow_up,
                                  const Color(0xff007aff),
                                  widget.onUnarchive,
                                )
                              : action(
                                  'Remove',
                                  CupertinoIcons.trash,
                                  const Color(0xffff3b30),
                                  () => widget.onRemove(_anchor()),
                                ),
                        ],
                      ),
                    ),
                  ),
                ),
              GestureDetector(
                onHorizontalDragStart: (_) {
                  widget.onReveal();
                  setState(() => _dragging = true);
                },
                onHorizontalDragUpdate: (details) => setState(() {
                  _offset = (_offset + details.delta.dx * direction).clamp(
                    -_actionWidth,
                    constraints.maxWidth,
                  );
                }),
                onHorizontalDragEnd: (_) {
                  if (_offset >= constraints.maxWidth * .55) {
                    _act(widget.onUnarchive);
                    return;
                  }
                  setState(() {
                    _dragging = false;
                    _offset = _offset.abs() < 32
                        ? 0
                        : _offset > 0
                        ? _actionWidth
                        : -_actionWidth;
                  });
                },
                onHorizontalDragCancel: _close,
                onTap: _offset == 0 ? null : _close,
                onLongPressStart: (details) {
                  _close();
                  widget.onMenu(details.globalPosition);
                },
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: _offset * direction),
                  duration: _dragging || MediaQuery.disableAnimationsOf(context)
                      ? Duration.zero
                      : const Duration(milliseconds: 180),
                  builder: (_, offset, child) => Transform.translate(
                    offset: Offset(offset, 0),
                    child: child,
                  ),
                  child: ColoredBox(
                    color: widget.color,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 14,
                      ),
                      child: SizedBox(
                        width: double.infinity,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: settingsTextStyle(
                                context,
                                15,
                                color: colors.onSurface,
                              ),
                            ),
                            if (widget.subtitle != null) ...[
                              const SizedBox(height: 4),
                              widget.subtitle!,
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
