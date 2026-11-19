import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../chat/presentation/assistant_code_block.dart';
import '../../settings/domain/appearance.dart';
import '../domain/desktop_plan.dart';
import '../../desktop/presentation/desktop_conversation_view.dart'
    show desktopAssistantHeadings;

Color _planTint(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xff0096ff)
    : const Color.from(
        alpha: 1,
        red: .430,
        green: .740,
        blue: .983,
        colorSpace: ui.ColorSpace.displayP3,
      );

class DesktopPlanAccessory extends StatelessWidget {
  const DesktopPlanAccessory({
    super.key,
    required this.plan,
    required this.onTap,
  });
  final DesktopPlan plan;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final steps = plan.steps;
    final complete =
        steps.isNotEmpty && steps.every((s) => s['status'] == 'completed');
    final status = complete
        ? 'Completed'
        : steps.any((s) => s['status'] == 'in_progress')
        ? 'In progress'
        : 'Pending';
    final tint = complete
        ? CupertinoColors.systemGreen.resolveFrom(context)
        : _planTint(context);
    return Tooltip(
      message: 'Open active plan',
      child: Semantics(
        button: true,
        label: 'Open active plan',
        value:
            '$status, ${steps.isEmpty ? 'Plan' : 'Step ${plan.currentStep} of ${steps.length}'}',
        child: DjlGlassSurface(
          radius: 999,
          child: TextButton(
            onPressed: () {
              unawaited(HapticFeedback.lightImpact());
              onTap();
            },
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 34),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: const StadiumBorder(),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (steps.isEmpty)
                  Icon(CupertinoIcons.circle_fill, size: 8, color: tint)
                else
                  CustomPaint(
                    size: const Size(14, 14),
                    painter: _PlanRing(
                      steps.map((s) => s['status'] as String).toList(),
                      tint,
                    ),
                  ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    steps.isEmpty
                        ? 'Plan'
                        : 'Step ${plan.currentStep} / ${steps.length}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: DjlAppearance.of(context).font.family,
                      fontSize: 11,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlanRing extends CustomPainter {
  _PlanRing(this.statuses, this.tint);
  final List<String> statuses;
  final Color tint;
  @override
  void paint(Canvas canvas, Size size) {
    final count = statuses.length;
    final gap = count > 1 ? math.min(.05, .4 / count) : 0;
    final rect = (Offset.zero & size).deflate(1.125);
    for (var i = 0; i < count; i++) {
      final alpha = statuses[i] == 'completed'
          ? 1.0
          : statuses[i] == 'in_progress'
          ? .45
          : .16;
      canvas.drawArc(
        rect,
        (i / count + gap / 2) * 2 * math.pi - math.pi / 2,
        (1 / count - gap) * 2 * math.pi,
        false,
        Paint()
          ..color = tint.withValues(alpha: alpha)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.25,
      );
    }
  }

  @override
  bool shouldRepaint(_PlanRing oldDelegate) =>
      tint != oldDelegate.tint || !listEquals(statuses, oldDelegate.statuses);
}

Widget _markdown(
  BuildContext context,
  String text,
  AssistantCodeScope? scope,
  ValueChanged<String>? onLink, [
  MarkdownImageBuilder? imageBuilder,
  TextStyle? proseStyle,
]) => MarkdownBody(
  data: desktopAssistantHeadings(text),
  selectable: true,
  sizedImageBuilder: (image) =>
      imageBuilder?.call(image.uri, image.title, image.alt) ??
      Text(image.alt ?? image.title ?? 'Image'),
  styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
    listIndent: 14,
    listBulletPadding: const EdgeInsets.only(right: 3.75),
    p:
        proseStyle ??
        TextStyle(
          fontFamily: DjlAppearance.of(context).font.family,
          fontSize: 15,
          height: 1.3,
        ),
  ),
  builders: {if (scope != null) 'pre': AssistantCodeBlockBuilder(scope: scope)},
  onTapLink: (_, href, _) {
    if (href != null) onLink?.call(href);
  },
);

TextStyle _planDetailStyle(
  BuildContext context,
  double size, {
  Color? color,
  FontWeight weight = FontWeight.w400,
}) {
  final font = DjlAppearance.of(context).font;
  final iosSystem =
      Theme.of(context).platform == TargetPlatform.iOS &&
      font == AppFontStyle.system;
  final scaled = MediaQuery.textScalerOf(context).scale(size);
  return TextStyle(
    fontFamily: iosSystem ? 'CupertinoSystemText' : font.family,
    fontVariations: iosSystem
        ? [FontVariation.opticalSize(scaled < 17 ? 17 : scaled)]
        : null,
    fontSize: size,
    height: 1.2,
    letterSpacing: iosSystem
        ? switch (size) {
            17 => -.41,
            14 || 15 => -.23,
            10 => -.24,
            _ => 0,
          }
        : null,
    color: color,
    fontWeight: weight,
  );
}

class DesktopPlanDetailsCard extends StatelessWidget {
  const DesktopPlanDetailsCard({
    super.key,
    required this.plan,
    this.codeScope,
    this.onLink,
    this.imageBuilder,
    this.body,
  });
  final DesktopPlan plan;
  final AssistantCodeScope? codeScope;
  final ValueChanged<String>? onLink;
  final MarkdownImageBuilder? imageBuilder;
  final Widget? body;
  @override
  Widget build(BuildContext context) => DjlGlassSurface(
    radius: 24,
    useNativeView: false,
    child: DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        color: Colors.black.withValues(
          alpha: Theme.of(context).brightness == Brightness.dark ? .45 : .04,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Plan',
                  style: TextStyle(
                    fontFamily: DjlAppearance.of(context).font.codeFamily,
                    fontSize: 11,
                    height: 4 / 3,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                if (plan.streaming) ...[
                  const SizedBox(width: 6),
                  const CupertinoActivityIndicator(radius: 6),
                ],
              ],
            ),
            if (body != null) ...[
              const SizedBox(height: 12),
              body!,
            ] else if (plan.body.trim().isNotEmpty &&
                plan.body.trim() != 'Planning...') ...[
              const SizedBox(height: 12),
              _markdown(
                context,
                plan.body,
                codeScope,
                onLink,
                imageBuilder,
                _planDetailStyle(context, 15).copyWith(height: 1.3),
              ),
            ],
            if (body == null &&
                plan.explanation != null &&
                plan.explanation != plan.body.trim()) ...[
              const SizedBox(height: 12),
              if (plan.body.trim().isEmpty)
                _markdown(
                  context,
                  plan.explanation!,
                  codeScope,
                  onLink,
                  imageBuilder,
                  _planDetailStyle(context, 15).copyWith(height: 1.3),
                )
              else
                Text(
                  plan.explanation!,
                  style: _planDetailStyle(
                    context,
                    12,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
            if (plan.steps.isNotEmpty) ...[
              const SizedBox(height: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final entry in plan.steps.indexed) ...[
                    if (entry.$1 > 0) const SizedBox(height: 8),
                    _PlanStep(step: entry.$2),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

class _PlanStep extends StatelessWidget {
  const _PlanStep({required this.step});
  final Map<String, dynamic> step;
  @override
  Widget build(BuildContext context) {
    final status = step['status'];
    final tint = status == 'completed'
        ? CupertinoColors.systemGreen.resolveFrom(context)
        : status == 'in_progress'
        ? CupertinoColors.systemOrange.resolveFrom(context)
        : CupertinoColors.secondaryLabel.resolveFrom(context);
    final label = status == 'completed'
        ? 'Completed'
        : status == 'in_progress'
        ? 'In progress'
        : 'Pending';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(
            status == 'completed'
                ? CupertinoIcons.checkmark_circle_fill
                : status == 'in_progress'
                ? CupertinoIcons.clock
                : CupertinoIcons.circle,
            size: 12,
            color: tint,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                step['step'] as String,
                style: _planDetailStyle(context, 15),
              ),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: tint.withValues(alpha: tint.a * .12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  label,
                  style: _planDetailStyle(
                    context,
                    10,
                    color: tint,
                    weight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

Future<void> showDesktopPlanDetails(
  BuildContext context, {
  required Listenable changes,
  required DesktopPlan? Function() readPlan,
  AssistantCodeScope? codeScope,
  ValueChanged<String>? onLink,
  MarkdownImageBuilder? imageBuilder,
  Widget? Function(BuildContext, DesktopPlan)? bodyBuilder,
}) async {
  final extent = DraggableScrollableController();
  ModalRoute<dynamic>? sheetRoute;
  try {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: false,
      useSafeArea: true,
      barrierColor: Colors.black.withValues(alpha: .2),
      backgroundColor: Colors.transparent,
      builder: (context) {
        sheetRoute ??= ModalRoute.of(context);
        return ListenableBuilder(
          listenable: extent,
          builder: (context, _) {
            final size = extent.isAttached ? extent.size : .56;
            final expanded = ((size - .56) / .44).clamp(0.0, 1.0);
            final inset = 8 * (1 - expanded);
            final width = MediaQuery.sizeOf(context).width;
            final scale = (width - inset * 2) / width;
            return Padding(
              padding: EdgeInsets.fromLTRB(
                inset,
                0,
                inset,
                MediaQuery.viewInsetsOf(context).bottom + inset,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(56),
                child: Material(
                  color: CupertinoColors.secondarySystemGroupedBackground
                      .resolveFrom(context),
                  child: DraggableScrollableSheet(
                    controller: extent,
                    expand: false,
                    initialChildSize: .56,
                    minChildSize: .35,
                    maxChildSize: 1,
                    snap: true,
                    snapSizes: const [.56],
                    builder: (context, scroll) => LayoutBuilder(
                      builder: (context, constraints) => FittedBox(
                        fit: BoxFit.fill,
                        alignment: Alignment.topLeft,
                        child: SizedBox(
                          width: width,
                          height: constraints.maxHeight / scale,
                          child: ListenableBuilder(
                            listenable: changes,
                            builder: (context, _) {
                              final plan = readPlan();
                              return CustomScrollView(
                                controller: scroll,
                                slivers: [
                                  PinnedHeaderSliver(
                                    child: ColoredBox(
                                      color: CupertinoColors
                                          .secondarySystemGroupedBackground
                                          .resolveFrom(context),
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Padding(
                                            padding: const EdgeInsets.only(
                                              top: 5,
                                              bottom: 6,
                                            ),
                                            child: Container(
                                              key: const Key(
                                                'desktop_plan_grabber',
                                              ),
                                              width: 34,
                                              height: 5,
                                              decoration: BoxDecoration(
                                                color: CupertinoColors
                                                    .placeholderText
                                                    .resolveFrom(context),
                                                borderRadius:
                                                    BorderRadius.circular(3),
                                              ),
                                            ),
                                          ),
                                          SizedBox(
                                            height: math.max(
                                              44,
                                              MediaQuery.textScalerOf(
                                                        context,
                                                      ).scale(17) *
                                                      1.2 +
                                                  14,
                                            ),
                                            child: Padding(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 20,
                                                  ),
                                              child: NavigationToolbar(
                                                centerMiddle: true,
                                                middle: Text(
                                                  'Active plan',
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  style: _planDetailStyle(
                                                    context,
                                                    17,
                                                    weight: FontWeight.w600,
                                                  ),
                                                ),
                                                trailing: DjlGlassSurface(
                                                  radius: 999,
                                                  useNativeView: false,
                                                  child: DecoratedBox(
                                                    decoration: BoxDecoration(
                                                      borderRadius:
                                                          BorderRadius.circular(
                                                            999,
                                                          ),
                                                      color: Colors.black
                                                          .withValues(
                                                            alpha:
                                                                Theme.of(
                                                                      context,
                                                                    ).brightness ==
                                                                    Brightness
                                                                        .dark
                                                                ? .45
                                                                : .04,
                                                          ),
                                                    ),
                                                    child: TextButton(
                                                      onPressed: () =>
                                                          Navigator.pop(
                                                            context,
                                                          ),
                                                      style: TextButton.styleFrom(
                                                        minimumSize: const Size(
                                                          0,
                                                          36,
                                                        ),
                                                        tapTargetSize:
                                                            MaterialTapTargetSize
                                                                .shrinkWrap,
                                                        padding:
                                                            const EdgeInsets.symmetric(
                                                              horizontal: 12,
                                                              vertical: 7,
                                                            ),
                                                        shape:
                                                            const StadiumBorder(),
                                                      ),
                                                      child: Text(
                                                        'Done',
                                                        style: _planDetailStyle(
                                                          context,
                                                          17,
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                  SliverPadding(
                                    padding: const EdgeInsets.fromLTRB(
                                      16,
                                      25,
                                      16,
                                      24,
                                    ),
                                    sliver: SliverToBoxAdapter(
                                      child: plan == null
                                          ? const Text(
                                              'This plan is no longer available.',
                                            )
                                          : DesktopPlanDetailsCard(
                                              plan: plan,
                                              codeScope: codeScope,
                                              onLink: onLink,
                                              imageBuilder: imageBuilder,
                                              body: bodyBuilder?.call(
                                                context,
                                                plan,
                                              ),
                                            ),
                                    ),
                                  ),
                                ],
                              );
                            },
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
      },
    );
  } finally {
    await sheetRoute?.completed;
    extent.dispose();
  }
}

class DesktopPlanResultCard extends StatefulWidget {
  const DesktopPlanResultCard({
    super.key,
    required this.plan,
    this.codeScope,
    this.onLink,
    this.onImplement,
    this.proposed = true,
    this.imageBuilder,
  });
  final DesktopPlan plan;
  final AssistantCodeScope? codeScope;
  final ValueChanged<String>? onLink;
  final Future<bool> Function()? onImplement;
  final bool proposed;
  final MarkdownImageBuilder? imageBuilder;
  @override
  State<DesktopPlanResultCard> createState() => _DesktopPlanResultCardState();
}

class _DesktopPlanResultCardState extends State<DesktopPlanResultCard> {
  bool _expanded = false, _implementing = false, _started = false;
  Future<void> _implement() async {
    final action = widget.onImplement;
    if (action == null || _implementing || _started) return;
    unawaited(HapticFeedback.lightImpact());
    setState(() => _implementing = true);
    try {
      final accepted = await action();
      if (mounted) setState(() => _started = accepted);
    } finally {
      if (mounted) setState(() => _implementing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = widget.plan.body;
    final locked = _implementing || _started;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: CupertinoColors.secondarySystemBackground.resolveFrom(context),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: CupertinoColors.separator
              .resolveFrom(context)
              .withValues(
                alpha: CupertinoColors.separator.resolveFrom(context).a * .12,
              ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.proposed ? 'Proposed plan' : 'Plan',
                  style: TextStyle(
                    fontFamily: DjlAppearance.of(context).font.family,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Tooltip(
                message: _expanded ? 'Collapse plan' : 'Expand plan',
                child: DjlGlassSurface(
                  radius: 999,
                  useNativeView: false,
                  child: TextButton(
                    onPressed: () {
                      unawaited(HapticFeedback.lightImpact());
                      setState(() => _expanded = !_expanded);
                    },
                    style: TextButton.styleFrom(
                      minimumSize: Size.zero,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 7,
                      ),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: const StadiumBorder(),
                      foregroundColor: Theme.of(
                        context,
                      ).colorScheme.onSurfaceVariant,
                      textStyle: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_expanded ? 'Collapse' : 'Expand'),
                        const SizedBox(width: 5),
                        Icon(
                          _expanded
                              ? CupertinoIcons.chevron_up
                              : CupertinoIcons.chevron_down,
                          size: 10,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          AnimatedSize(
            duration: MediaQuery.disableAnimationsOf(context)
                ? Duration.zero
                : const Duration(milliseconds: 300),
            alignment: Alignment.topLeft,
            curve: Curves.easeOutCubic,
            child: _markdown(
              context,
              _expanded ? body : body.split('\n').take(5).join('\n').trim(),
              widget.codeScope,
              widget.onLink,
              widget.imageBuilder,
            ),
          ),
          if (widget.plan.presentation == 'resultReady' &&
              !widget.plan.streaming &&
              body.trim().isNotEmpty) ...[
            const SizedBox(height: 12),
            DjlGlassSurface(
              radius: 16,
              useNativeView: false,
              child: SizedBox(
                width: double.infinity,
                child: TextButton.icon(
                  onPressed: widget.onImplement == null || locked
                      ? null
                      : _implement,
                  style: TextButton.styleFrom(
                    alignment: Alignment.center,
                    foregroundColor: _planTint(context),
                    disabledForegroundColor: _planTint(
                      context,
                    ).withValues(alpha: .5),
                    minimumSize: Size.zero,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 11,
                    ),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    textStyle: TextStyle(
                      fontFamily: DjlAppearance.of(context).font.family,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  icon: SizedBox.square(
                    dimension: 16,
                    child: locked
                        ? CupertinoActivityIndicator(
                            radius: 7,
                            color: _planTint(context),
                          )
                        : const Icon(
                            CupertinoIcons.arrow_right_circle_fill,
                            size: 13,
                          ),
                  ),
                  label: Text(
                    locked ? 'Starting...' : 'Implement',
                    maxLines: 1,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
