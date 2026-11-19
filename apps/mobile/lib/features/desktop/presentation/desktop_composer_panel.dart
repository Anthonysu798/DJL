import 'dart:math' as math;
import 'package:flutter/cupertino.dart'
    show CupertinoIcons, CupertinoColors, CupertinoDynamicColor;
import 'package:flutter/material.dart';
import '../../../core/presentation/djl_glass.dart';

/// A single input stays in the same element slot while its chrome morphs.
class DesktopComposerPanel extends StatefulWidget {
  const DesktopComposerPanel({
    super.key,
    required this.controller,
    required this.placeholder,
    required this.accessories,
    required this.hasAccessories,
    required this.options,
    required this.runtimeControl,
    required this.accessControl,
    required this.onVoice,
    required this.listening,
    required this.voiceInitializing,
    required this.starting,
    required this.onSend,
    required this.onStop,
    this.autofocus = false,
    this.queuePaused = false,
    this.onResumeQueued,
    this.stoppingTurn = false,
    this.focusRequest,
  });
  final TextEditingController controller;
  final String placeholder;
  final Widget accessories, options, accessControl, runtimeControl;
  final bool hasAccessories, autofocus, listening, voiceInitializing, starting;
  final VoidCallback? onVoice, onSend, onStop;
  final bool queuePaused;
  final bool stoppingTurn;
  final VoidCallback? onResumeQueued;
  final Object? focusRequest;
  @override
  State<DesktopComposerPanel> createState() => _DesktopComposerPanelState();
}

class _DesktopComposerPanelState extends State<DesktopComposerPanel> {
  final _focus = FocusNode();
  Object? _handledFocusRequest;
  @override
  void initState() {
    super.initState();
    _focus.addListener(_changed);
    widget.controller.addListener(_changed);
    _requestFocus();
  }

  @override
  void didUpdateWidget(DesktopComposerPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.focusRequest, widget.focusRequest)) {
      _requestFocus();
    }
  }

  void _requestFocus() {
    final request = widget.focusRequest;
    if (request == null || identical(request, _handledFocusRequest)) return;
    _handledFocusRequest = request;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && identical(widget.focusRequest, request)) {
        _focus.requestFocus();
      }
    });
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _focus.dispose();
    super.dispose();
  }

  Widget _voice() => IconButton(
    tooltip: widget.listening ? 'Stop dictation' : 'Start dictation',
    onPressed: widget.voiceInitializing ? null : widget.onVoice,
    constraints: const BoxConstraints.tightFor(width: 34, height: 34),
    padding: EdgeInsets.zero,
    style: IconButton.styleFrom(
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    ),
    iconSize: 20,
    icon: Icon(widget.listening ? Icons.mic : Icons.mic_none),
  );

  Widget _resume() => IconButton(
    tooltip: 'Resume queued messages',
    onPressed: widget.onResumeQueued,
    constraints: const BoxConstraints.tightFor(width: 34, height: 34),
    padding: EdgeInsets.zero,
    icon: Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: CupertinoDynamicColor.resolve(
          CupertinoColors.systemGrey2,
          context,
        ),
      ),
      child: Icon(
        CupertinoIcons.arrow_clockwise,
        size: 14,
        color: Theme.of(context).colorScheme.surface,
      ),
    ),
  );

  Widget _action({required bool expanded}) {
    if (widget.onStop != null &&
        widget.onSend == null &&
        widget.controller.text.trim().isEmpty) {
      return IconButton(
        tooltip: 'Stop turn',
        onPressed: widget.stoppingTurn ? null : widget.onStop,
        constraints: const BoxConstraints.tightFor(width: 34, height: 34),
        padding: EdgeInsets.zero,
        style: IconButton.styleFrom(
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        icon: const Icon(Icons.stop, size: 20),
      );
    }
    if (!expanded && !widget.starting) return const SizedBox.shrink();
    return IconButton.filled(
      tooltip: 'Send to desktop',
      onPressed: widget.onSend,
      constraints: const BoxConstraints.tightFor(width: 34, height: 34),
      padding: EdgeInsets.zero,
      style: IconButton.styleFrom(
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      icon: widget.starting
          ? const SizedBox.square(
              dimension: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                semanticsLabel: 'Starting run',
              ),
            )
          : const Icon(Icons.arrow_upward, size: 20),
    );
  }

  @override
  Widget build(BuildContext context) {
    final expanded =
        _focus.hasFocus ||
        widget.controller.text.isNotEmpty ||
        widget.hasAccessories ||
        widget.listening ||
        widget.voiceInitializing;
    final line = MediaQuery.textScalerOf(context).scale(22);
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      child: DjlGlassSurface(
        radius: expanded ? 26 : (math.max(line, 34) + 12) / 2,
        child: AnimatedContainer(
          key: const Key('desktop_composer_surface'),
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
          padding: expanded
              ? const EdgeInsets.fromLTRB(14, 0, 16, 4)
              : const EdgeInsets.all(6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              widget.accessories,
              Padding(
                padding: EdgeInsets.only(
                  top: expanded ? (widget.hasAccessories ? 10 : 14) : 0,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    if (!expanded) widget.options else const SizedBox.shrink(),
                    Expanded(
                      key: const ValueKey('persistent_composer_input'),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight: math.max(line, 34),
                        ),
                        child: TextField(
                          key: const Key('desktop_composer'),
                          controller: widget.controller,
                          focusNode: _focus,
                          autofocus: widget.autofocus,
                          autocorrect: false,
                          keyboardType: TextInputType.multiline,
                          textCapitalization: TextCapitalization.none,
                          minLines: 1,
                          maxLines: expanded
                              ? (widget.hasAccessories ? 4 : 6)
                              : 1,
                          style: Theme.of(
                            context,
                          ).textTheme.bodyMedium?.copyWith(fontSize: 15),
                          decoration: InputDecoration(
                            hintText: widget.placeholder,
                            isDense: true,
                            filled: false,
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            contentPadding: const EdgeInsets.only(
                              top: 3,
                              bottom: 5,
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (!expanded && widget.queuePaused) _resume(),
                    if (!expanded) _voice() else const SizedBox.shrink(),
                    if (!expanded)
                      _action(expanded: false)
                    else
                      const SizedBox.shrink(),
                  ],
                ),
              ),
              if (expanded)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(
                    children: [
                      widget.options,
                      widget.accessControl,
                      const SizedBox(width: 10),
                      Expanded(
                        child: Align(
                          alignment: Alignment.centerRight,
                          child: widget.runtimeControl,
                        ),
                      ),
                      const SizedBox(width: 10),
                      if (widget.queuePaused) _resume(),
                      _voice(),
                      const SizedBox(width: 10),
                      _action(expanded: true),
                    ],
                  ),
                )
              else
                const SizedBox.shrink(),
            ],
          ),
        ),
      ),
    );
  }
}
