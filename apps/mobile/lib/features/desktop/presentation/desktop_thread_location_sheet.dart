import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../settings/domain/appearance.dart';
import 'desktop_controller.dart';
import 'desktop_conversation_view.dart';
import 'desktop_thread_actions.dart';

class DesktopThreadLocationSheet extends StatefulWidget {
  const DesktopThreadLocationSheet({
    super.key,
    required this.controller,
    required this.thread,
    required this.path,
    required this.isCurrent,
  });
  final DesktopController controller;
  final RemoteJson thread;
  final String path;
  final bool Function() isCurrent;

  @override
  State<DesktopThreadLocationSheet> createState() =>
      _DesktopThreadLocationSheetState();
}

class _DesktopThreadLocationSheetState
    extends State<DesktopThreadLocationSheet> {
  Timer? _copiedTimer;
  bool _copying = false, _copied = false;
  String? _error;
  bool get _current =>
      mounted &&
      widget.isCurrent() &&
      ModalRoute.of(context)?.isCurrent == true;

  void _close() {
    if (mounted && ModalRoute.of(context)?.isCurrent == true) {
      Navigator.pop(context);
    }
  }

  Future<void> _copy() async {
    if (!_current || _copying) return;
    setState(() => _copying = true);
    try {
      await Clipboard.setData(ClipboardData(text: widget.path));
      if (!_current) return;
      unawaited(HapticFeedback.lightImpact());
      _copiedTimer?.cancel();
      setState(() {
        _copied = true;
        _error = null;
      });
      _copiedTimer = Timer(const Duration(milliseconds: 1500), () {
        if (mounted && widget.isCurrent()) {
          setState(() => _copied = false);
        }
      });
    } catch (_) {
      if (_current) {
        setState(() => _error = 'Could not copy the path. Try again.');
      }
    } finally {
      if (mounted) setState(() => _copying = false);
    }
  }

  Future<void> _rename() async {
    if (!_current) return;
    unawaited(HapticFeedback.lightImpact());
    await performDesktopThreadAction(
      context,
      widget.controller,
      widget.thread,
      'rename-chat',
      isCurrent: () => _current,
    );
  }

  @override
  void dispose() {
    _copiedTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final theme = Theme.of(context);
      final label = theme.textTheme.bodySmall!.copyWith(
        fontWeight: FontWeight.w600,
        color: theme.colorScheme.onSurfaceVariant,
      );
      final valid = widget.isCurrent();
      return DraggableScrollableSheet(
        key: const Key('thread.location.sheet'),
        initialChildSize: .4,
        minChildSize: .4,
        maxChildSize: .5,
        expand: false,
        builder: (context, scroll) => SafeArea(
          top: false,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsetsDirectional.only(start: 16, end: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        valid
                            ? desktopConversationPathLabel(widget.path)
                            : 'Conversation changed',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close location',
                      onPressed: _close,
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  controller: scroll,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  children: valid
                      ? [
                          Text('Thread', style: label),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  widget.controller.titleOf(widget.thread),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodyLarge!.copyWith(
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                              if (!widget.controller.threadList.data.isArchived(
                                widget.thread['id'] as String,
                              ))
                                IconButton(
                                  tooltip: 'Rename conversation',
                                  onPressed: _rename,
                                  icon: const Icon(
                                    Icons.edit_outlined,
                                    size: 20,
                                  ),
                                ),
                            ],
                          ),
                          for (final warning in [
                            widget.controller.threadList.localError,
                            widget.controller.threadList.syncWarning,
                          ].whereType<String>())
                            Padding(
                              padding: const EdgeInsets.only(top: 10),
                              child: Text(warning),
                            ),
                          const SizedBox(height: 20),
                          Row(
                            children: [
                              Text('Path', style: label),
                              const SizedBox(width: 8),
                              IconButton(
                                tooltip: _copied ? 'Path copied' : 'Copy path',
                                onPressed: _copying ? null : _copy,
                                icon: Icon(
                                  _copied ? Icons.check : Icons.copy_outlined,
                                  size: 18,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          SelectableText(
                            widget.path,
                            style: theme.textTheme.bodyMedium!.copyWith(
                              fontFamily: DjlAppearance.of(
                                context,
                              ).font.codeFamily,
                            ),
                          ),
                          if (_error != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Text(_error!),
                            ),
                        ]
                      : [
                          const Text(
                            'Close this sheet and reopen the conversation location.',
                          ),
                        ],
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
