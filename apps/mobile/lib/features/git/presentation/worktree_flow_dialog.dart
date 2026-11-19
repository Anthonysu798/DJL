import 'dart:async';
import 'package:flutter/cupertino.dart' show CupertinoColors;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../desktop/presentation/worktree_flow_controller.dart';
import '../domain/git_creation_review.dart';

Future<bool?> showWorktreeFlowDialog({
  required BuildContext context,
  required WorktreeFlowController controller,
}) => showGeneralDialog<bool>(
  context: context,
  useRootNavigator: false,
  barrierDismissible: true,
  barrierLabel: 'Close worktree review',
  barrierColor: Colors.black.withValues(alpha: .45),
  transitionDuration: const Duration(milliseconds: 180),
  transitionBuilder: (_, animation, _, child) =>
      FadeTransition(opacity: animation, child: child),
  pageBuilder: (_, _, _) => WorktreeFlowDialog(controller: controller),
);

class WorktreeFlowDialog extends StatefulWidget {
  const WorktreeFlowDialog({super.key, required this.controller});
  final WorktreeFlowController controller;
  @override
  State<WorktreeFlowDialog> createState() => _WorktreeFlowDialogState();
}

class WorktreeMenuLabel extends StatelessWidget {
  const WorktreeMenuLabel({super.key, required this.title, this.fork = false});
  final String title;
  final bool fork;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      SvgPicture.asset(
        'assets/icons/command/${fork ? 'central-fork-code' : 'central-arrow-split-right'}.svg',
        width: 22,
        height: 22,
        colorFilter: ColorFilter.mode(
          DefaultTextStyle.of(context).style.color ??
              Theme.of(context).colorScheme.onSurface,
          BlendMode.srcIn,
        ),
      ),
      const SizedBox(width: 12),
      Flexible(child: Text(title)),
    ],
  );
}

class _WorktreeFlowDialogState extends State<WorktreeFlowDialog> {
  final _branch = TextEditingController();
  late final _base = TextEditingController(
    text: widget.controller.preferredBase,
  );
  String _previousBase = '';
  bool _dismissScheduled = false;
  WorktreeFlowController get _flow => widget.controller;
  bool get _top => mounted && ModalRoute.of(context)?.isCurrent == true;
  String get _title => _flow.mode == WorktreeFlowMode.handoff
      ? 'Hand off thread to worktree'
      : 'Fork thread into new worktree';
  String get _submitLabel =>
      _flow.mode == WorktreeFlowMode.handoff ? 'Hand off' : 'Fork';
  String get _message => _flow.mode == WorktreeFlowMode.handoff
      ? 'Create and check out a branch in a new worktree to continue in parallel. The branch is normalized with the djl/ prefix.'
      : 'Create and check out a branch in a new worktree, then fork this conversation into that checkout as a new chat.';

  @override
  void initState() {
    super.initState();
    _previousBase = _flow.preferredBase;
    _flow.addListener(_changed);
    unawaited(_flow.prepare());
  }

  void _changed() {
    if (!mounted) return;
    final preferred = _flow.preferredBase;
    if (preferred != _previousBase) {
      _previousBase = preferred;
      if (_base.text.trim().isEmpty) _base.text = preferred;
    }
    setState(() {});
  }

  void _close([bool? result]) {
    if (_top) Navigator.pop(context, result);
  }

  void _dismissInvalid() {
    if (_flow.isCurrent ||
        _flow.submitting ||
        _flow.completed ||
        !_top ||
        _dismissScheduled) {
      return;
    }
    _dismissScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _dismissScheduled = false;
      if (_top && !_flow.isCurrent && !_flow.submitting && !_flow.completed) {
        _close();
      }
    });
  }

  Future<bool> _review(GitCreationReview review) async {
    if (!_top || !_flow.isCurrent) return false;
    return await showDialog<bool>(
          context: context,
          builder: (dialog) => AlertDialog(
            title: Text(review.title),
            content: Text(review.message),
            scrollable: true,
            actions: [
              TextButton(
                onPressed: () {
                  if (dialog.mounted &&
                      ModalRoute.of(dialog)?.isCurrent == true) {
                    Navigator.pop(dialog, false);
                  }
                },
                child: Text(review.acceptLabel == null ? 'OK' : 'Cancel'),
              ),
              if (review.acceptLabel != null)
                TextButton(
                  onPressed: () {
                    if (dialog.mounted &&
                        ModalRoute.of(dialog)?.isCurrent == true) {
                      Navigator.pop(dialog, true);
                    }
                  },
                  child: Text(review.acceptLabel!),
                ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _submit() async {
    if (!_top || !_flow.isCurrent || _flow.submitting) return;
    final succeeded = await _flow.submit(
      name: _branch.text,
      base: _base.text,
      review: _review,
    );
    if (!mounted || !_top) return;
    if (succeeded) {
      _close(true);
    } else if (_flow.isCurrent && _flow.error != null) {
      await showDialog<void>(
        context: context,
        builder: (dialog) => AlertDialog(
          title: Text(_flow.errorTitle ?? _title),
          content: Text(_flow.error!),
          scrollable: true,
          actions: [
            TextButton(
              onPressed: () {
                if (dialog.mounted &&
                    ModalRoute.of(dialog)?.isCurrent == true) {
                  Navigator.pop(dialog);
                }
              },
              child: const Text('OK'),
            ),
          ],
        ),
      );
    }
  }

  Widget _input({
    required String label,
    required String hint,
    required TextEditingController controller,
    required Key fieldKey,
    bool autofocus = false,
  }) {
    final primary = Theme.of(context).colorScheme.onSurface;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        Semantics(
          label: label,
          child: TextField(
            key: fieldKey,
            controller: controller,
            autofocus: autofocus,
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: TextCapitalization.none,
            onChanged: (_) => setState(() {}),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
            decoration: InputDecoration(
              hintText: hint,
              isDense: true,
              filled: true,
              fillColor: primary.withValues(alpha: .03),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(color: primary.withValues(alpha: .06)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(color: primary.withValues(alpha: .06)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(color: primary.withValues(alpha: .06)),
              ),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    _dismissInvalid();
    final primary = Theme.of(context).colorScheme.onSurface;
    final secondary = CupertinoColors.secondaryLabel.resolveFrom(context);
    final normalized = normalizedGitCreatedBranchName(_branch.text);
    final enabled =
        _flow.isCurrent &&
        !_flow.loading &&
        !_flow.submitting &&
        _flow.status?.isRepo == true &&
        normalized.isNotEmpty &&
        normalized != 'djl/' &&
        _base.text.trim().isNotEmpty;
    return SafeArea(
      child: Dialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: CupertinoColors.secondarySystemBackground.resolveFrom(
              context,
            ),
            borderRadius: BorderRadius.circular(22),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: .2),
                blurRadius: 30,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: primary.withValues(alpha: .06),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        alignment: Alignment.center,
                        child: SvgPicture.asset(
                          'assets/icons/command/central-arrow-split-right.svg',
                          width: 16,
                          height: 16,
                          colorFilter: ColorFilter.mode(
                            primary,
                            BlendMode.srcIn,
                          ),
                        ),
                      ),
                      const Spacer(),
                      IconButton(
                        tooltip: 'Close worktree review',
                        onPressed: () => _close(),
                        constraints: const BoxConstraints.tightFor(
                          width: 28,
                          height: 28,
                        ),
                        padding: EdgeInsets.zero,
                        style: IconButton.styleFrom(
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        icon: SvgPicture.asset(
                          'assets/icons/command/central-cross-medium.svg',
                          width: 15,
                          height: 15,
                          colorFilter: ColorFilter.mode(
                            secondary,
                            BlendMode.srcIn,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    _message,
                    style: TextStyle(fontSize: 13, color: secondary),
                  ),
                  const SizedBox(height: 14),
                  _input(
                    label: 'Branch name',
                    hint: 'feature-name',
                    controller: _branch,
                    fieldKey: const Key('worktree.branch'),
                    autofocus: true,
                  ),
                  if (normalized.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        normalized,
                        style: TextStyle(
                          fontFamily: 'GeistMono',
                          fontSize: 12,
                          color: secondary,
                        ),
                      ),
                    ),
                  const SizedBox(height: 14),
                  _input(
                    label: 'Base branch',
                    hint: 'main',
                    controller: _base,
                    fieldKey: const Key('worktree.base'),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Starts from this base branch.',
                    style: TextStyle(fontSize: 12, color: secondary),
                  ),
                  if (_flow.loading)
                    const Padding(
                      padding: EdgeInsets.only(top: 12),
                      child: LinearProgressIndicator(
                        semanticsLabel: 'Loading worktree branches',
                      ),
                    ),
                  if (_flow.error != null && !_flow.submitting)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        _flow.error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    height: 46,
                    child: FilledButton(
                      onPressed: enabled ? _submit : null,
                      style: FilledButton.styleFrom(
                        minimumSize: Size.zero,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        backgroundColor: Colors.white,
                        foregroundColor: Colors.black,
                        disabledBackgroundColor: Colors.white.withValues(
                          alpha: .6,
                        ),
                        disabledForegroundColor: Colors.black.withValues(
                          alpha: .6,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: _flow.submitting
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(
                                color: Colors.black,
                                strokeWidth: 2,
                                semanticsLabel: 'Preparing worktree',
                              ),
                            )
                          : Text(
                              _submitLabel,
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _flow.removeListener(_changed);
    _branch.dispose();
    _base.dispose();
    super.dispose();
  }
}
