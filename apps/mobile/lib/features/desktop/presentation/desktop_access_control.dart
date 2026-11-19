import 'dart:math' as math;
import 'dart:ui' show ImageFilter;
import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../settings/domain/appearance.dart';
import 'desktop_composer_options_menu.dart';
import 'desktop_controller.dart';

const _modes = [
  (
    'on-request',
    'Ask for approval',
    'Always ask to edit external files and use the internet',
    'raising-hand-5-finger',
  ),
  (
    'auto-review',
    'Approve for me',
    'Only ask for actions detected as potentially unsafe',
    'shield-check-3',
  ),
  (
    'full-access',
    'Full access',
    'Full computer access (elevated risk)',
    'shield-access',
  ),
];

class DesktopAccessControl extends StatelessWidget {
  const DesktopAccessControl({
    super.key,
    required this.controller,
    required this.isCurrent,
  });
  final DesktopController controller;
  final bool Function() isCurrent;

  @override
  Widget build(BuildContext context) {
    final mode = _modes.firstWhere(
      (m) => m.$1 == controller.access,
      orElse: () => _modes.first,
    );
    final color = mode.$1 == 'full-access'
        ? Colors.orange
        : mode.$1 == 'auto-review'
        ? Colors.blue
        : Theme.of(context).colorScheme.onSurfaceVariant;
    return Builder(
      builder: (buttonContext) => Semantics(
        hint: 'Changes how Codex requests permission',
        child: IconButton(
          key: const Key('composer.access'),
          tooltip: mode.$2,
          constraints: const BoxConstraints.tightFor(width: 32, height: 32),
          padding: EdgeInsets.zero,
          style: IconButton.styleFrom(
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          icon: SvgPicture.asset(
            'assets/icons/access/${mode.$4}.svg',
            width: 20,
            height: 20,
            colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
            excludeFromSemantics: true,
          ),
          onPressed: () async {
            final owner = isCurrent, desktop = controller;
            final page = ModalRoute.of(buttonContext);
            if (!owner() || page?.isCurrent != true) return;
            final anchor = buttonContext.findRenderObject() as RenderBox;
            final value = await showDesktopComposerPopover<String>(
              context: buttonContext,
              screenMargin: 10,
              alignment: DesktopComposerMenuAlignment.center,
              builder: (menuContext) => _AccessPopover(
                selected: desktop.access,
                anchor: anchor,
                onSelected: (value) {
                  if (menuContext.mounted &&
                      owner() &&
                      ModalRoute.of(menuContext)?.isCurrent == true) {
                    Navigator.pop(menuContext, value);
                  }
                },
              ),
            );
            if (value == null ||
                !buttonContext.mounted ||
                !owner() ||
                page?.isCurrent != true) {
              return;
            }
            if (value == 'full-access') {
              final yes = await showDialog<bool>(
                context: buttonContext,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('Allow full desktop access?'),
                  content: const Text(
                    'The agent can change files and run commands outside the workspace without asking for approval.',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () {
                        if (dialogContext.mounted &&
                            ModalRoute.of(dialogContext)?.isCurrent == true) {
                          Navigator.pop(dialogContext, false);
                        }
                      },
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () {
                        if (dialogContext.mounted &&
                            ModalRoute.of(dialogContext)?.isCurrent == true) {
                          Navigator.pop(dialogContext, true);
                        }
                      },
                      child: const Text('Allow full access'),
                    ),
                  ],
                ),
              );
              if (yes != true) return;
            }
            if (owner() && page?.isCurrent == true) {
              await desktop.setAccess(value);
            }
          },
        ),
      ),
    );
  }
}

class _AccessPopover extends StatelessWidget {
  const _AccessPopover({
    required this.selected,
    required this.anchor,
    required this.onSelected,
  });
  final String selected;
  final RenderBox anchor;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), dark = theme.brightness == Brightness.dark;
    final color = dark ? const Color(0xff151614) : const Color(0xfff7f7f7);
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = math.min(312.0, constraints.maxWidth);
        final media = MediaQuery.of(context);
        final origin = anchor.localToGlobal(Offset.zero);
        final left = (origin.dx + anchor.size.width / 2 - width / 2).clamp(
          media.padding.left + 10,
          math.max(
            media.padding.left + 10,
            media.size.width - media.padding.right - 10 - width,
          ),
        );
        final arrow = (origin.dx + anchor.size.width / 2 - left).clamp(
          22.0,
          math.max(22.0, width - 22),
        );
        final shape = _AccessShape(arrow.toDouble());
        return SizedBox(
          key: const Key('composer.access.popover'),
          width: width,
          child: CustomPaint(
            foregroundPainter: _AccessBorder(
              shape,
              theme.colorScheme.onSurface.withValues(alpha: .12),
            ),
            child: ClipPath(
              clipper: shape,
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                child: ColoredBox(
                  color: color.withValues(
                    alpha:
                        theme.extension<DjlAppearance>()?.liquidGlass == false
                        ? 1
                        : .94,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 13),
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (final mode in _modes)
                            Semantics(
                              selected: mode.$1 == selected,
                              child: TextButton(
                                key: ValueKey('composer.access.${mode.$1}'),
                                onPressed: () => onSelected(mode.$1),
                                style: TextButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 10,
                                  ),
                                  minimumSize: Size.zero,
                                  tapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                  foregroundColor: theme.colorScheme.onSurface,
                                  shape: const RoundedRectangleBorder(),
                                  textStyle: const TextStyle(
                                    fontWeight: FontWeight.w400,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    SizedBox(
                                      width: 28,
                                      child: Center(
                                        child: SvgPicture.asset(
                                          'assets/icons/access/${mode.$4}.svg',
                                          width: 22,
                                          height: 22,
                                          excludeFromSemantics: true,
                                          colorFilter: ColorFilter.mode(
                                            theme.colorScheme.onSurface,
                                            BlendMode.srcIn,
                                          ),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 14),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            mode.$2,
                                            style: const TextStyle(
                                              fontSize: 15,
                                              height: 1.2,
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            mode.$3,
                                            style: TextStyle(
                                              fontSize: 14,
                                              height: 1.2,
                                              color: theme
                                                  .colorScheme
                                                  .onSurfaceVariant,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(width: 14),
                                    const SizedBox(width: 8),
                                    const SizedBox(width: 14),
                                    Opacity(
                                      opacity: mode.$1 == selected ? 1 : 0,
                                      child: const Icon(
                                        CupertinoIcons.check_mark,
                                        size: 15,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _AccessShape extends CustomClipper<Path> {
  const _AccessShape(this.arrow);
  final double arrow;
  @override
  Path getClip(Size size) {
    final bottom = size.height - 13;
    final body = Path()
      ..addRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(0, 0, size.width, bottom),
          const Radius.circular(32),
        ),
      );
    final tail = Path()
      ..moveTo(arrow - 14, bottom - 1)
      ..lineTo(arrow - 2, bottom + 11)
      ..quadraticBezierTo(arrow, bottom + 13, arrow + 2, bottom + 11)
      ..lineTo(arrow + 14, bottom - 1)
      ..close();
    return Path.combine(PathOperation.union, body, tail);
  }

  @override
  bool shouldReclip(_AccessShape oldClipper) => arrow != oldClipper.arrow;
}

class _AccessBorder extends CustomPainter {
  const _AccessBorder(this.shape, this.color);
  final _AccessShape shape;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) => canvas.drawPath(
    shape.getClip(size),
    Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = .7,
  );
  @override
  bool shouldRepaint(_AccessBorder oldDelegate) =>
      oldDelegate.color != color || oldDelegate.shape.arrow != shape.arrow;
}
