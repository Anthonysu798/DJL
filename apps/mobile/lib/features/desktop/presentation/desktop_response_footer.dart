import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../chat/presentation/assistant_code_block.dart';
import '../../reports/presentation/report_sheet.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';
import '../../../l10n/l10n.dart';

class DesktopResponseFooter extends StatefulWidget {
  const DesktopResponseFooter({
    super.key,
    required this.scope,
    required this.text,
    required this.readText,
    this.report,
  });
  final AssistantCodeScope scope;
  final String text;
  final String? Function() readText;
  final SendReport? report;

  @override
  State<DesktopResponseFooter> createState() => _DesktopResponseFooterState();
}

class _DesktopResponseFooterState extends State<DesktopResponseFooter> {
  bool _copied = false;
  int _generation = 0;
  Timer? _timer;

  @override
  void didUpdateWidget(DesktopResponseFooter oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.scope != widget.scope || oldWidget.text != widget.text) {
      _generation++;
      _timer?.cancel();
      _copied = false;
    }
  }

  Future<void> _copy() async {
    final generation = ++_generation;
    _timer?.cancel();
    if (_copied) setState(() => _copied = false);
    final text = widget.readText();
    if (text == null || text != widget.text) return;
    try {
      await Clipboard.setData(ClipboardData(text: text));
    } catch (_) {
      return;
    }
    if (!mounted || generation != _generation || widget.readText() != text) {
      return;
    }
    unawaited(HapticFeedback.lightImpact());
    setState(() => _copied = true);
    _timer = Timer(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = DjlColors.of(context).inkMuted;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        children: [
          _copyButton(color),
          if (widget.report case final send?) ReportAnswerButton(send: send),
        ],
      ),
    );
  }

  Widget _copyButton(Color color) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Semantics(
        container: true,
        label: context.l10n.chatUiCopyResponse,
        button: true,
        onTap: _copy,
        excludeSemantics: true,
        child: Tooltip(
          message: context.l10n.chatUiCopyResponse,
          excludeFromSemantics: true,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _copy,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              child: Align(
                widthFactor: 1,
                heightFactor: 1,
                alignment: Alignment.centerLeft,
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 150),
                  child: Row(
                    key: ValueKey(_copied),
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 20,
                        height: 20,
                        child: _copied
                            ? Icon(DjlIcons.check, size: 11, color: color)
                            : SvgPicture.asset(
                                'assets/icons/markdown/copy.svg',
                                colorFilter: ColorFilter.mode(
                                  color,
                                  BlendMode.srcIn,
                                ),
                              ),
                      ),
                      if (_copied) ...[
                        const SizedBox(width: 4),
                        Text(
                          context.l10n.chatUiCopied,
                          style: Theme.of(context).textTheme.bodyMedium!
                              .copyWith(
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                                color: color,
                              ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
