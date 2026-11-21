import 'dart:math' as math;
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../chat/presentation/chat_controller.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';
import '../../../l10n/l10n.dart';

Future<bool?> showCloudImageCreationSheet(
  BuildContext context, {
  required ChatController controller,
}) async {
  final route = _CloudImageCreationRoute(controller, ValueNotifier(false));
  final result = await Navigator.of(context).push<bool>(route);
  // Callers may release the controller only after the sheet leaves the overlay.
  await route.completed;
  return result;
}

class _CloudImageCreationRoute extends CupertinoSheetRoute<bool> {
  _CloudImageCreationRoute(ChatController controller, this.starting)
    : super(builder: (_) => _CloudImageCreationSheet(controller, starting));

  final ValueNotifier<bool> starting;
  @override
  bool get enableDrag => !starting.value;
  @override
  Widget buildTransitions(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) => ValueListenableBuilder(
    valueListenable: starting,
    builder: (context, _, _) =>
        super.buildTransitions(context, animation, secondaryAnimation, child),
  );

  @override
  void dispose() {
    // The flag outlives the sheet's reverse animation, like its route.
    starting.dispose();
    super.dispose();
  }
}

class _CloudImageCreationSheet extends StatefulWidget {
  const _CloudImageCreationSheet(this.controller, this.starting);
  final ChatController controller;
  final ValueNotifier<bool> starting;
  @override
  State<_CloudImageCreationSheet> createState() =>
      _CloudImageCreationSheetState();
}

class _CloudImageCreationSheetState extends State<_CloudImageCreationSheet> {
  final _prompt = TextEditingController();
  String _ratio = '1:1';
  Map<String, String> _shapes(AppLocalizations l10n) => {
    '1:1': l10n.imagesSquare,
    '4:3': l10n.imagesLandscape,
    '3:4': l10n.imagesPortrait,
  };
  bool get _current => mounted && ModalRoute.of(context)?.isCurrent == true;
  bool get _canCreate =>
      _current &&
      !widget.starting.value &&
      widget.controller.composerReady &&
      !widget.controller.sending &&
      !widget.controller.streaming &&
      !widget.controller.uploading &&
      widget.controller.configuration.imageGeneration &&
      _prompt.text.trim().isNotEmpty &&
      _prompt.text.length <= 4000;

  void _close() {
    if (_current && !widget.starting.value) {
      Navigator.pop(context);
    }
  }

  Future<void> _create() async {
    if (!_canCreate) return;
    final prompt = _prompt.text, ratio = _ratio;
    widget.starting.value = true;
    final accepted = await widget.controller.generateImage(prompt, ratio);
    if (!mounted) return;
    if (!accepted) {
      widget.starting.value = false;
      return;
    }
    final route = ModalRoute.of(context);
    if (route?.isActive != true) return;
    final navigator = Navigator.of(context);
    if (route!.isCurrent) {
      navigator.pop(true);
    } else {
      navigator.removeRoute(route, true);
    }
  }

  @override
  void dispose() {
    _prompt.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.controller, widget.starting, _prompt]),
    builder: (context, _) {
      final theme = Theme.of(context), colors = theme.colorScheme;
      final scaled = MediaQuery.textScalerOf(context).scale(17);
      final large = scaled > 25, busy = widget.starting.value;
      final l10n = context.l10n;
      final closeMeasure = TextPainter(
        text: TextSpan(
          text: l10n.settingsClose,
          style: theme.textTheme.labelLarge?.copyWith(
            fontSize: 17,
            fontWeight: FontWeight.w400,
          ),
        ),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
      )..layout();
      final leadingWidth = math.max(88.0, closeMeasure.width + 36);
      closeMeasure.dispose();
      final secondary = theme.textTheme.bodySmall?.copyWith(
        fontSize: 13,
        height: 1.2,
        color: colors.onSurfaceVariant,
      );
      final caption = Text(
        l10n.imagesOnePerRequest,
        textAlign: TextAlign.center,
        style: secondary?.copyWith(fontSize: 12),
      );
      void shape(String? value) {
        if (_current && value != null) setState(() => _ratio = value);
      }

      return PopScope(
        canPop: !busy,
        child: Scaffold(
          appBar: AppBar(
            automaticallyImplyLeading: false,
            centerTitle: true,
            toolbarHeight: math.max(52, scaled * 1.2 + 24),
            leadingWidth: leadingWidth,
            leading: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 0, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: DjlGlassSurface(
                  radius: 999,
                  child: TextButton(
                    onPressed: busy ? null : _close,
                    style: TextButton.styleFrom(
                      minimumSize: const Size(44, 44),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                    ),
                    child: Text(
                      l10n.settingsClose,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            title: large
                ? null
                : Text(
                    l10n.imagesCreate,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
            actions: [if (!large) SizedBox(width: leadingWidth)],
          ),
          body: SafeArea(
            top: false,
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
                    children: [
                      if (large)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 24),
                          child: Semantics(
                            header: true,
                            child: Text(
                              l10n.imagesCreate,
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      Text(
                        l10n.imagesMakeYours,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                          height: 1.2,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.imagesDescribe,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontSize: 15,
                          height: 1.2,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 24),
                      TextField(
                        key: const Key('cloud.images.prompt'),
                        controller: _prompt,
                        minLines: 4,
                        maxLines: 8,
                        textCapitalization: TextCapitalization.sentences,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          fontSize: 17,
                          height: 1.2,
                        ),
                        decoration: InputDecoration(
                          hintText: l10n.imagesPromptHint,
                          contentPadding: const EdgeInsets.all(16),
                          filled: true,
                          fillColor: DjlColors.of(context).surfaceRaised,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(20),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                      Semantics(
                        label: l10n.imagesShape,
                        container: true,
                        explicitChildNodes: true,
                        child: large
                            ? Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  for (final entry in _shapes(l10n).entries)
                                    ChoiceChip(
                                      label: Text(entry.value),
                                      selected: _ratio == entry.key,
                                      onSelected: (_) => shape(entry.key),
                                    ),
                                ],
                              )
                            : CupertinoSlidingSegmentedControl<String>(
                                groupValue: _ratio,
                                onValueChanged: shape,
                                children: {
                                  for (final entry in _shapes(l10n).entries)
                                    entry.key: Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 4,
                                        vertical: 6,
                                      ),
                                      child: Text(
                                        entry.value,
                                        style: const TextStyle(fontSize: 13),
                                      ),
                                    ),
                                },
                              ),
                      ),
                      if (widget.controller.error case final error?)
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: Text(error, style: secondary),
                        ),
                      if (!widget.controller.configuration.imageGeneration)
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: Text(
                            l10n.imagesNotConfigured,
                            style: secondary,
                          ),
                        ),
                      if (large)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 24),
                          child: caption,
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: _canCreate ? _create : null,
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(0, 52),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 18,
                              vertical: 12,
                            ),
                            backgroundColor: colors.onSurface,
                            foregroundColor: colors.surface,
                            shape: const StadiumBorder(),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              if (busy) ...[
                                SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: colors.surface,
                                  ),
                                ),
                                const SizedBox(width: 8),
                              ],
                              Flexible(
                                child: Text(
                                  busy
                                      ? l10n.imagesStarting
                                      : l10n.imagesCreate,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              if (!busy) ...[
                                const SizedBox(width: 8),
                                const Icon(DjlIcons.arrowUp, size: 17),
                              ],
                            ],
                          ),
                        ),
                      ),
                      if (!large) ...[const SizedBox(height: 8), caption],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
