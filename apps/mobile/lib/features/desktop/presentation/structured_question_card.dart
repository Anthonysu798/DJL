import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../settings/domain/appearance.dart';
import 'package:flutter/material.dart';
import '../../pairing/data/pairing_repository.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

class StructuredQuestionCard extends StatefulWidget {
  const StructuredQuestionCard({
    super.key,
    required this.request,
    required this.onAnswer,
    this.onCancel,
    this.margin = const EdgeInsets.all(12),
    this.enabled = true,
    this.submitted = false,
    this.responseUnknown = false,
    this.cancelling = false,
  });
  final RemoteJson request;
  final Future<void> Function(Map<String, List<String>>) onAnswer;
  final Future<void> Function()? onCancel;
  final EdgeInsetsGeometry margin;
  final bool enabled;
  final bool submitted, responseUnknown, cancelling;
  @override
  State<StructuredQuestionCard> createState() => _StructuredQuestionCardState();
}

Color _questionTint(BuildContext context) =>
    Theme.of(context).colorScheme.onSurface;

class _StructuredQuestionCardState extends State<StructuredQuestionCard> {
  final _selected = <String, List<String>>{},
      _fields = <String, TextEditingController>{};
  bool _sending = false;
  int _page = 0;
  late String _signature;
  List<RemoteJson> get _questions =>
      ((widget.request['params'] as RemoteJson?)?['questions'] as List? ?? [])
          .cast<RemoteJson>();
  bool get _busy => _sending || !widget.enabled || widget.cancelling;
  bool get _locked => _busy || widget.submitted;
  String get _questionSignature => jsonEncode([
    for (final q in _questions)
      [
        q['id'],
        q['header'] ?? '',
        q['question'],
        q['isOther'] == true,
        q['isSecret'] == true,
        q['selectionLimit'],
        for (final o in (q['options'] as List? ?? []).whereType<Map>())
          [o['label'], o['description'] ?? ''],
      ],
  ]);
  @override
  void initState() {
    super.initState();
    _signature = _questionSignature;
  }

  @override
  void didUpdateWidget(StructuredQuestionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = _questionSignature;
    if (next != _signature) {
      _signature = next;
      _page = 0;
      _selected.clear();
      for (final field in _fields.values) {
        field.dispose();
      }
      _fields.clear();
    }
  }

  @override
  void dispose() {
    for (final field in _fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  Map<String, List<String>> get _answers => Map.fromEntries(
    _questions.map((q) {
      final id = q['id'] as String;
      final typed = _fields[id]?.text.trim() ?? '';
      return MapEntry(id, typed.isEmpty ? (_selected[id] ?? []) : [typed]);
    }),
  );
  void _move(int page) {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    unawaited(HapticFeedback.lightImpact());
    setState(() {
      _page = page;
    });
  }

  Future<void> _send() async {
    if (_locked ||
        _questions.isEmpty ||
        _answers.values.any((a) => a.isEmpty)) {
      return;
    }
    FocusScope.of(context).unfocus();
    unawaited(HapticFeedback.lightImpact());
    setState(() {
      _sending = true;
    });
    try {
      await widget.onAnswer(_answers);
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
        });
      }
    }
  }

  TextStyle _style(
    double size,
    Color color, {
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
      fontWeight: weight,
      color: color,
    );
  }

  Widget _action(
    String title,
    VoidCallback? onPressed, {
    bool primary = false,
    IconData? before,
    IconData? after,
  }) {
    final secondary = DjlColors.of(context).inkMuted;
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        minimumSize: const Size(0, 35),
        padding: EdgeInsets.symmetric(
          horizontal: primary ? 16 : 14,
          vertical: 9,
        ),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: const StadiumBorder(),
        foregroundColor: primary ? DjlColors.of(context).onInk : secondary,
        disabledForegroundColor: DjlColors.of(context).inkFaint,
        backgroundColor: primary && onPressed != null
            ? _questionTint(context)
            : DjlColors.of(context).surfaceRaised,
        disabledBackgroundColor: DjlColors.of(context).surfaceRaised,
        textStyle: _style(14, secondary, weight: FontWeight.w500),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (before != null) ...[
            Icon(before, size: MediaQuery.textScalerOf(context).scale(11)),
            const SizedBox(width: 4),
          ],
          if (_sending && primary) ...[
            const SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(strokeWidth: 1.5),
            ),
            const SizedBox(width: 6),
          ],
          Flexible(child: Text(title)),
          if (after != null) ...[
            const SizedBox(width: 4),
            Icon(after, size: MediaQuery.textScalerOf(context).scale(11)),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final questions = _questions;
    final question = questions.isEmpty ? null : questions[_page];
    final secondary = DjlColors.of(context).inkMuted;
    final separator = DjlColors.of(context).hairline;
    final tint = _questionTint(context);
    final canNext =
        question != null && (_answers[question['id']] ?? []).isNotEmpty;
    final canSend =
        !_locked &&
        questions.isNotEmpty &&
        _answers.values.every((a) => a.isNotEmpty);
    final questionContent = question == null
        ? null
        : KeyedSubtree(
            key: ValueKey((_page, _signature)),
            child: _question(question),
          );
    return Padding(
      padding: widget.margin,
      child: DjlGlassSurface(
        radius: 24,
        useNativeView: false,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            color: Colors.black.withValues(
              alpha: Theme.of(context).brightness == Brightness.dark
                  ? .45
                  : .02,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('Questions', style: _style(11, secondary)),
                    if (questions.length > 1) ...[
                      Container(
                        width: 3,
                        height: 3,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: separator.withValues(alpha: separator.a * .6),
                        ),
                      ),
                      Text(
                        '${_page + 1} of ${questions.length}',
                        style: _style(10, secondary),
                      ),
                      Wrap(
                        spacing: 3,
                        runSpacing: 3,
                        children: [
                          for (var i = 0; i < questions.length; i++)
                            Container(
                              width: 10,
                              height: 3,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(999),
                                color: i < _page
                                    ? DjlColors.of(
                                        context,
                                      ).ink.withValues(alpha: .72)
                                    : i == _page
                                    ? tint.withValues(alpha: .72)
                                    : separator.withValues(
                                        alpha: separator.a * .22,
                                      ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
                if (questionContent != null) ...[
                  const SizedBox(height: 14),
                  if (MediaQuery.disableAnimationsOf(context))
                    questionContent
                  else
                    AnimatedSize(
                      duration: const Duration(milliseconds: 350),
                      curve: Curves.easeOutCubic,
                      alignment: Alignment.topLeft,
                      child: questionContent,
                    ),
                ],
                if (widget.responseUnknown) ...[
                  const SizedBox(height: 14),
                  Text(
                    'A previous response may have been sent. Check the desktop state before replying again.',
                    style: _style(12, secondary),
                  ),
                ],
                const SizedBox(height: 14),
                Wrap(
                  alignment: _page > 0
                      ? WrapAlignment.spaceBetween
                      : WrapAlignment.end,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 10,
                  runSpacing: 8,
                  children: [
                    if (_page > 0)
                      _action(
                        'Back',
                        _busy ? null : () => _move(_page - 1),
                        before: DjlIcons.chevronLeft,
                      ),
                    Wrap(
                      alignment: WrapAlignment.end,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (widget.onCancel != null)
                          _action(
                            widget.cancelling ? 'Closing...' : 'ESC',
                            _locked
                                ? null
                                : () {
                                    unawaited(widget.onCancel!());
                                  },
                          ),
                        if (_page < questions.length - 1)
                          _action(
                            'Next',
                            _busy || !canNext ? null : () => _move(_page + 1),
                            primary: true,
                            after: DjlIcons.chevronRight,
                          )
                        else
                          _action(
                            widget.submitted
                                ? 'Response sent'
                                : _sending
                                ? 'Sending...'
                                : 'Send',
                            canSend ? _send : null,
                            primary: true,
                          ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _question(RemoteJson q) {
    final id = q['id'] as String;
    final header = (q['header'] as String? ?? '').trim();
    final options = (q['options'] as List? ?? []).cast<RemoteJson>();
    final limit = (q['selectionLimit'] as int? ?? 1) < 1
        ? 1
        : q['selectionLimit'] as int? ?? 1;
    final selected = _selected[id] ??= [];
    final separator = DjlColors.of(context).hairline;
    final tint = _questionTint(context);
    final foreground = DjlColors.of(context).ink,
        secondary = DjlColors.of(context).inkMuted;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (header.isNotEmpty) ...[
          Text(
            header.toUpperCase(),
            style: _style(
              10,
              secondary,
              weight: FontWeight.w500,
            ).copyWith(letterSpacing: .4),
          ),
          const SizedBox(height: 10),
        ],
        Text((q['question'] as String).trim(), style: _style(15, foreground)),
        if (limit > 1) ...[
          const SizedBox(height: 10),
          Text('Select up to $limit', style: _style(11, secondary)),
        ],
        if (options.isNotEmpty) const SizedBox(height: 10),
        for (final option in options.indexed) ...[
          if (option.$1 > 0) const SizedBox(height: 6),
          Builder(
            builder: (_) {
              final label = option.$2['label'] as String;
              final description = (option.$2['description'] as String? ?? '')
                  .trim();
              final checked = selected.contains(label);
              void toggle() {
                if (_locked) return;
                unawaited(HapticFeedback.lightImpact());
                setState(() {
                  if (checked) {
                    selected.remove(label);
                  } else if (limit == 1) {
                    selected
                      ..clear()
                      ..add(label);
                  } else if (selected.length < limit) {
                    selected.add(label);
                  }
                });
              }

              return Semantics(
                button: true,
                selected: checked,
                enabled: !_locked,
                label: [
                  label,
                  if (description.isNotEmpty) description,
                ].join('\n'),
                onTap: _locked ? null : toggle,
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: _locked ? null : toggle,
                  behavior: HitTestBehavior.opaque,
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 38),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(14),
                      color: checked
                          ? tint.withValues(alpha: .08)
                          : DjlColors.of(context).surface.withValues(alpha: .6),
                      border: Border.all(
                        color: checked
                            ? tint.withValues(alpha: .3)
                            : separator.withValues(alpha: separator.a * .15),
                      ),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                label,
                                style: _style(
                                  14,
                                  checked ? tint : foreground,
                                  weight: FontWeight.w500,
                                ),
                              ),
                              if (description.isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text(
                                  description,
                                  style: _style(
                                    11,
                                    checked
                                        ? tint.withValues(alpha: .6)
                                        : secondary,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        if (checked) ...[
                          const SizedBox(width: 10),
                          Icon(
                            DjlIcons.check,
                            size: MediaQuery.textScalerOf(context).scale(12),
                            color: tint,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ],
        if (options.isEmpty ||
            q['isOther'] == true ||
            q['isSecret'] == true) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: DjlColors.of(context).surface.withValues(alpha: .6),
              borderRadius: BorderRadius.circular(14),
            ),
            child: TextField(
              controller: _fields.putIfAbsent(
                id,
                () => TextEditingController(),
              ),
              enabled: !_locked,
              readOnly: _locked,
              obscureText: q['isSecret'] == true,
              autocorrect: q['isSecret'] != true,
              enableSuggestions: q['isSecret'] != true,
              enableIMEPersonalizedLearning: q['isSecret'] != true,
              textCapitalization: q['isSecret'] == true
                  ? TextCapitalization.none
                  : TextCapitalization.sentences,
              maxLines: q['isSecret'] == true ? 1 : null,
              style: _style(15, foreground),
              decoration: InputDecoration.collapsed(
                hintText: q['isOther'] == true ? 'Other answer' : 'Your answer',
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
        ],
      ],
    );
  }
}

class InferredPlanQuestionCard extends StatefulWidget {
  const InferredPlanQuestionCard({
    super.key,
    required this.questions,
    required this.onAnswer,
    required this.enabled,
  });
  final List<RemoteJson> questions;
  final Future<bool> Function(Map<String, List<String>>) onAnswer;
  final bool enabled;
  @override
  State<InferredPlanQuestionCard> createState() =>
      _InferredPlanQuestionCardState();
}

class _InferredPlanQuestionCardState extends State<InferredPlanQuestionCard> {
  var _submitted = false;
  Future<void> _answer(Map<String, List<String>> answers) async {
    final accepted = await widget.onAnswer(answers);
    if (mounted && accepted) {
      setState(() {
        _submitted = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) => StructuredQuestionCard(
    request: {
      'params': {'questions': widget.questions},
    },
    margin: EdgeInsets.zero,
    enabled: widget.enabled,
    submitted: _submitted,
    onAnswer: _answer,
  );
}
