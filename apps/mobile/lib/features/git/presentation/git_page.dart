import 'dart:async';
import 'dart:ui' show SemanticsRole;
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';
import '../data/git_repository.dart';
import '../domain/git_models.dart';
import '../domain/git_creation_review.dart';
import '../domain/git_branch_picker_models.dart';
import '../domain/repository_diff.dart';
import 'git_controller.dart';
import 'git_new_branch_dialog.dart';
import 'git_branch_picker.dart';
import 'repository_diff_sheet.dart';
import '../../../l10n/l10n.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';
import '../../../core/presentation/djl_glass_menu.dart';

enum _GitCreationDecision { cancel, proceed, commitFirst }

enum GitComposerAction { branch, worktree }

typedef GitCheckedOutBranchHandler =
    Future<void> Function(
      String branch,
      String path,
      bool Function() isCurrent,
    );

class GitPage extends StatefulWidget {
  const GitPage({
    super.key,
    required this.repository,
    required this.onOpenWorktree,
    this.writerModels = const [],
    this.initialWriter,
    this.toolbarMenu = false,
    this.scopeChanges,
    this.onStatus,
    this.onBusy,
    this.canChangeBranch,
    this.onCheckedOutBranch,
    this.composerAction,
    this.onRoutingOperation,
  });
  final GitRepository repository;
  final void Function(String path) onOpenWorktree;
  final List<String> writerModels;
  final String? initialWriter;
  final bool toolbarMenu;
  final Listenable? scopeChanges;
  final ValueChanged<GitStatus>? onStatus;
  final ValueChanged<bool>? onBusy;
  final bool Function()? canChangeBranch;
  final GitCheckedOutBranchHandler? onCheckedOutBranch;
  final GitComposerAction? composerAction;
  final ValueChanged<Future<void>>? onRoutingOperation;
  @override
  State<GitPage> createState() => _GitPageState();
}

class _GitPageState extends State<GitPage> {
  late final GitController _git;
  String? _writer;
  GitStatus? _publishedStatus;
  ModalRoute<dynamic>? _route;
  bool _publishedBusy = false, _toolbarSelecting = false;
  bool _toolbarOperationAttempted = false;
  int _branchReviewEpoch = 0;
  late final int _composerEpoch;
  bool _composerSelecting = false;
  static const _routingActions = {
    'branch',
    'worktree',
    'managed',
    'transfer',
    'remove',
  };
  bool get _branchReady =>
      widget.canChangeBranch?.call() != false && !_git.busy && !_git.loading;
  bool get _ownsAction =>
      mounted && _route?.isActive != false && widget.repository.isCurrent;
  bool _routingCurrent(int epoch) =>
      _ownsAction && _branchReady && epoch == _branchReviewEpoch;
  bool _allowRouting(int epoch) {
    if (_routingCurrent(epoch)) {
      return true;
    }
    if (mounted && _ownsAction) {
      setState(
        () => _git.error = _branchReady
            ? context.l10n.gitThreadChangedReopenAction
            : widget.canChangeBranch?.call() == false
            ? context.l10n.gitWaitForThread
            : context.l10n.gitWaitForOperation,
      );
    }
    return false;
  }

  String? get _writerModel =>
      _writer ??
      (widget.writerModels.contains(widget.initialWriter)
          ? widget.initialWriter
          : null) ??
      (widget.writerModels.contains('gpt-5.4-mini')
          ? 'gpt-5.4-mini'
          : widget.writerModels.firstOrNull);
  @override
  void initState() {
    super.initState();
    _composerEpoch = _branchReviewEpoch;
    _git = GitController(widget.repository);
    _git.addListener(_publishState);
    widget.scopeChanges?.addListener(_scopeChanged);
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    await _git.refresh();
    if (!mounted || widget.composerAction != GitComposerAction.worktree) return;
    if (!_ownsAction || widget.canChangeBranch?.call() == false) {
      _closeToolbar();
    } else if (_git.error == null) {
      if (_git.status?.isRepo != true) {
        setState(() => _git.error = context.l10n.gitNotRepositorySentence);
      } else {
        await _runComposer(() async {
          await _worktree(false);
          if (!_routingCurrent(_composerEpoch) || _git.error != null) return;
          final path = _git.result?['worktreePath'];
          if (path is String && path.trim().isNotEmpty) {
            widget.onOpenWorktree(path);
          }
        });
      }
    }
  }

  Future<void> _runComposer(Future<void> Function() action) async {
    if (_composerSelecting || !_allowRouting(_composerEpoch)) return;
    final settled = Completer<void>();
    setState(() => _composerSelecting = true);
    widget.onRoutingOperation?.call(settled.future);
    try {
      await action();
    } finally {
      if (mounted) {
        if (_git.error == null || !_ownsAction) {
          _closeToolbar();
        } else {
          setState(() => _composerSelecting = false);
        }
      }
      settled.complete();
    }
  }

  void _publishState() {
    if (!_ownsAction) return;
    final status = _git.status;
    if (status != null && !identical(status, _publishedStatus)) {
      _publishedStatus = status;
      widget.onStatus?.call(status);
    }
    if (_publishedBusy != _git.busy) {
      _publishedBusy = _git.busy;
      widget.onBusy?.call(_git.busy);
    }
  }

  void _scopeChanged() {
    if (widget.canChangeBranch?.call() == false) {
      _branchReviewEpoch++;
    }
    if (mounted) setState(() {});
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
  }

  @override
  void didUpdateWidget(GitPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.canChangeBranch?.call() == false) {
      _branchReviewEpoch++;
    }
    if (oldWidget.scopeChanges != widget.scopeChanges) {
      oldWidget.scopeChanges?.removeListener(_scopeChanged);
      widget.scopeChanges?.addListener(_scopeChanged);
    }
  }

  @override
  void dispose() {
    widget.scopeChanges?.removeListener(_scopeChanged);
    _git.removeListener(_publishState);
    _git.dispose();
    super.dispose();
  }

  void _finishDialog(BuildContext dialog, Object? result) {
    if (dialog.mounted && ModalRoute.of(dialog)?.isCurrent == true) {
      Navigator.pop(dialog, result);
    }
  }

  Future<bool> _confirm(String title, String text, {String? accept}) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(text),
          actions: [
            TextButton(
              onPressed: () => _finishDialog(context, false),
              child: Text(context.l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => _finishDialog(context, _ownsAction),
              child: Text(accept ?? context.l10n.gitContinue),
            ),
          ],
        ),
      ) ??
      false;
  Future<String?> _text(
    String title,
    String label, {
    String initial = '',
    bool multiline = false,
    bool generate = false,
  }) async {
    final field = TextEditingController(text: initial);
    var generating = false;
    var editRevision = 0;
    final value = await showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(title),
          scrollable: true,
          content: TextField(
            controller: field,
            autofocus: true,
            minLines: multiline ? 3 : 1,
            maxLines: multiline ? 6 : 1,
            onChanged: (_) => editRevision++,
            decoration: InputDecoration(
              labelText: label,
              errorText: generate && !generating
                  ? _git.error?.replaceFirst('Bad state: ', '')
                  : null,
              errorMaxLines: 3,
            ),
          ),
          actions: [
            if (generate)
              TextButton(
                onPressed: generating || _writerModel == null
                    ? null
                    : () async {
                        if (!_ownsAction ||
                            ModalRoute.of(context)?.isCurrent != true) {
                          return;
                        }
                        final startedRevision = editRevision;
                        update(() => generating = true);
                        final draft = await _git.perform(
                          () => widget.repository.generateCommitMessage(
                            _writerModel,
                          ),
                        );
                        if (context.mounted) {
                          if (_ownsAction &&
                              editRevision == startedRevision &&
                              draft != null) {
                            field.text = draft['fullMessage'] as String? ?? '';
                          }
                          update(() => generating = false);
                        }
                      },
                child: Text(
                  generating
                      ? context.l10n.gitGenerating
                      : context.l10n.gitGenerateMessage,
                ),
              ),
            TextButton(
              onPressed: () => _finishDialog(context, null),
              child: Text(context.l10n.commonCancel),
            ),
            FilledButton(
              onPressed: generating
                  ? null
                  : () => _finishDialog(
                      context,
                      _ownsAction ? field.text.trim() : null,
                    ),
              child: Text(context.l10n.gitContinue),
            ),
          ],
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 250));
    field.dispose();
    return _ownsAction ? value : null;
  }

  Future<void> _commit({String action = 'commit'}) async {
    final l10n = context.l10n;
    final message = await _text(
      action == 'commit' ? l10n.gitCommitAllTitle : l10n.gitCommitPublishTitle,
      l10n.gitCommitMessageLabel,
      multiline: true,
      generate: true,
    );
    if (message == null || message.isEmpty || !_ownsAction) return;
    _git.notice = null;
    if (action != 'commit') {
      _toolbarOperationAttempted = true;
      await _git.refresh();
      if (!_ownsAction || _git.error != null) return;
    }
    final base = (_git.branches['default'] as String?)?.trim();
    final featureBranch =
        action == 'commit_push_pr' &&
        base?.isNotEmpty == true &&
        _git.status?.branch?.trim() == base;
    if (action != 'commit' &&
        !await _confirm(
          l10n.gitPublishBranchTitle,
          action == 'commit_push'
              ? l10n.gitPublishCommitPushBody
              : featureBranch
              ? l10n.gitPublishFeatureBranchPrBody
              : l10n.gitPublishCommitPrBody,
        )) {
      return;
    }
    if (!_ownsAction) return;
    _toolbarOperationAttempted = true;
    if (action == 'commit') {
      await _git.perform(() => widget.repository.commit(message));
    } else {
      await _git.stacked(
        action,
        message: message,
        model: _writerModel,
        base: base,
        featureBranch: featureBranch,
      );
    }
  }

  Future<bool> _freshCreationStatus(int epoch) async {
    if (!_allowRouting(epoch)) return false;
    await _git.refresh();
    if (!_allowRouting(epoch) || _git.error != null) return false;
    if (_git.status?.isRepo != true) {
      setState(() => _git.error = context.l10n.gitNoLongerRepository);
      return false;
    }
    return true;
  }

  Future<_GitCreationDecision> _reviewCreation(
    GitCreationReview? review,
    int epoch,
  ) async {
    if (!_allowRouting(epoch)) {
      return _GitCreationDecision.cancel;
    }
    if (review == null) return _GitCreationDecision.proceed;
    final choice =
        await showDialog<_GitCreationDecision>(
          context: context,
          builder: (dialog) => AlertDialog(
            title: Text(review.title),
            content: Text(review.message),
            scrollable: true,
            actions: [
              TextButton(
                onPressed: () =>
                    _finishDialog(dialog, _GitCreationDecision.cancel),
                child: Text(
                  review.acceptLabel == null
                      ? context.l10n.gitOk
                      : context.l10n.commonCancel,
                ),
              ),
              if (review.acceptLabel != null)
                TextButton(
                  onPressed: () =>
                      _finishDialog(dialog, _GitCreationDecision.proceed),
                  child: Text(review.acceptLabel!),
                ),
              if (review.canCommitFirst)
                FilledButton(
                  onPressed: () =>
                      _finishDialog(dialog, _GitCreationDecision.commitFirst),
                  child: Text(context.l10n.gitCommitCreateSwitch),
                ),
            ],
          ),
        ) ??
        _GitCreationDecision.cancel;
    if (choice == _GitCreationDecision.cancel || !_allowRouting(epoch)) {
      return _GitCreationDecision.cancel;
    }
    return choice;
  }

  Future<void> _createBranch({String? suppliedName}) async {
    final epoch = _branchReviewEpoch;
    if (!_allowRouting(epoch)) return;
    final name = suppliedName != null
        ? normalizedGitCreatedBranchName(suppliedName)
        : await showDialog<String>(
            context: context,
            builder: (_) => GitNewBranchDialog(
              isCurrent: () => _routingCurrent(epoch),
              scopeChanges: widget.scopeChanges,
            ),
          );
    if (name == null ||
        name.isEmpty ||
        name == 'djl/' ||
        !await _freshCreationStatus(epoch)) {
      return;
    }
    final choice = await _reviewCreation(
      gitBranchCreationReview(
        _git.status!,
        defaultBranch: _git.branches['default'] as String? ?? '',
        name: name,
      ),
      epoch,
    );
    if (choice == _GitCreationDecision.cancel || !_allowRouting(epoch)) {
      return;
    }
    if (choice == _GitCreationDecision.commitFirst) {
      final committed = await _git.perform(
        () => widget.repository.commit('WIP before switching branches'),
      );
      if (committed == null || _git.error != null || !_allowRouting(epoch)) {
        return;
      }
    }
    await _git.perform(() => widget.repository.createBranch(name));
  }

  Future<void> _worktree(bool managed) async {
    final epoch = _branchReviewEpoch;
    if (!_allowRouting(epoch)) return;
    final names = ((_git.branches['branches'] as List?) ?? []).cast<String>();
    var base =
        _git.branches['default'] as String? ??
        _git.status?.branch ??
        names.firstOrNull ??
        '';
    if (!names.contains(base) && names.isNotEmpty) base = names.first;
    var transfer = 'move';
    final field = TextEditingController();
    ModalRoute<bool>? namingRoute;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) {
        namingRoute = ModalRoute.of<bool>(context);
        return StatefulBuilder(
          builder: (context, update) => AlertDialog(
            title: Text(
              managed
                  ? context.l10n.gitCreateManagedWorktree
                  : context.l10n.gitCreateWorktree,
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!managed)
                    TextField(
                      controller: field,
                      autofocus: true,
                      autocorrect: false,
                      enableSuggestions: false,
                      textCapitalization: TextCapitalization.none,
                      onChanged: (_) => update(() {}),
                      decoration: InputDecoration(
                        labelText: context.l10n.gitBranchName,
                        hintText: 'feature-name',
                      ),
                    ),
                  if (!managed && field.text.trim().isNotEmpty)
                    Text(
                      normalizedGitCreatedBranchName(field.text),
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(fontFamily: 'GeistMono'),
                    ),
                  DropdownButton<String>(
                    isExpanded: true,
                    value: names.contains(base) ? base : null,
                    hint: Text(context.l10n.gitBaseBranch),
                    items: names
                        .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) update(() => base = v);
                    },
                  ),
                  DropdownButton<String>(
                    isExpanded: true,
                    value: transfer,
                    items: [
                      DropdownMenuItem(
                        value: 'move',
                        child: Text(context.l10n.gitMoveCurrentChanges),
                      ),
                      DropdownMenuItem(
                        value: 'copy',
                        child: Text(context.l10n.gitCopyCurrentChanges),
                      ),
                      DropdownMenuItem(
                        value: 'none',
                        child: Text(context.l10n.gitLeaveChangesHere),
                      ),
                    ],
                    onChanged: (v) {
                      if (v != null) update(() => transfer = v);
                    },
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => _finishDialog(context, false),
                child: Text(context.l10n.commonCancel),
              ),
              FilledButton(
                onPressed:
                    base.trim().isEmpty ||
                        !managed &&
                            (normalizedGitCreatedBranchName(
                                  field.text,
                                ).isEmpty ||
                                normalizedGitCreatedBranchName(field.text) ==
                                    'djl/')
                    ? null
                    : () => _finishDialog(context, _ownsAction),
                child: Text(context.l10n.gitCreate),
              ),
            ],
          ),
        );
      },
    );
    final name = normalizedGitCreatedBranchName(field.text);
    await namingRoute?.completed;
    field.dispose();
    if (!_ownsAction ||
        accepted != true ||
        base.isEmpty ||
        !managed && (name.isEmpty || name == 'djl/')) {
      return;
    }
    if (!await _freshCreationStatus(epoch)) return;
    final choice = await _reviewCreation(
      gitWorktreeCreationReview(
        _git.status!,
        defaultBranch: _git.branches['default'] as String? ?? '',
        name: name,
        base: base,
        transfer: transfer,
        managed: managed,
      ),
      epoch,
    );
    if (choice != _GitCreationDecision.proceed || !_allowRouting(epoch)) {
      return;
    }
    await _git.perform(
      () => managed
          ? widget.repository.createManagedWorktree(base, transfer)
          : widget.repository.createWorktree(name, base, transfer),
    );
  }

  Future<void> _action(String action) async {
    final l10n = context.l10n;
    if (!_ownsAction) return;
    final epoch = _branchReviewEpoch;
    if (_routingActions.contains(action) && !_allowRouting(epoch)) {
      return;
    }
    switch (action) {
      case 'init':
        if (await _confirm(l10n.gitInitializeTitle, l10n.gitInitializeBody)) {
          _toolbarOperationAttempted = true;
          await _git.perform(widget.repository.initialize);
        }
      case 'push':
        if (await _confirm(l10n.gitPushTitle, l10n.gitPushBody)) {
          _toolbarOperationAttempted = true;
          await _git.perform(widget.repository.push);
        }
      case 'update':
        _toolbarOperationAttempted = true;
        await _git.refresh();
        if (!_ownsAction || _git.error != null) return;
        final sync = _git.status?.state;
        if (sync == 'behind_only' || sync == 'dirty_and_behind') {
          final dirty = sync == 'dirty_and_behind';
          if (await _confirm(
            dirty
                ? l10n.gitLocalChangesNeedAttention
                : l10n.gitUpdateRepositoryTitle,
            dirty ? l10n.gitDirtyAndBehindBody : l10n.gitPullBody,
            accept: dirty ? l10n.gitPullAndRebase : l10n.gitUpdate,
          )) {
            await _git.perform(widget.repository.pull);
          }
        }
      case 'branch':
        await _createBranch();
      case 'worktree':
        await _worktree(false);
      case 'managed':
        await _worktree(true);
      case 'transfer':
        final path = await _text(
          l10n.gitTransferChangesTitle,
          l10n.gitTargetWorkspacePath,
        );
        if (path?.isNotEmpty == true && _allowRouting(epoch)) {
          await _git.perform(() => widget.repository.transfer(path!));
        }
      case 'remove':
        if (await _confirm(
              l10n.gitRemoveWorktreeTitle,
              l10n.gitRemoveWorktreeBody,
            ) &&
            _allowRouting(epoch)) {
          await _git.perform(
            () => widget.repository.removeWorktree(_git.status?.branch),
          );
        }
      case 'reset':
        if (await _confirm(l10n.gitDiscardTitle, l10n.gitDiscardBody)) {
          await _git.perform(widget.repository.resetToRemote);
        }
      case 'draft':
        final result = await _git.perform(
          () => widget.repository.prDraft(
            model: _writerModel,
            base: _git.branches['default'] as String?,
          ),
        );
        if (result != null && mounted) {
          await showDialog<void>(
            context: context,
            builder: (context) => AlertDialog(
              title: Text(result['title'] as String? ?? l10n.gitPrDraftTitle),
              content: SingleChildScrollView(
                child: SelectableText(result['body'] as String? ?? ''),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    if (_ownsAction &&
                        ModalRoute.of(context)?.isCurrent == true) {
                      unawaited(
                        Clipboard.setData(
                          ClipboardData(
                            text:
                                '${result['title'] ?? ''}\n\n${result['body'] ?? ''}',
                          ),
                        ),
                      );
                    }
                  },
                  child: Text(l10n.gitCopyDraft),
                ),
                TextButton(
                  onPressed: () => _finishDialog(context, null),
                  child: Text(l10n.gitDone),
                ),
              ],
            ),
          );
        }
      case 'pr':
        if (await _confirm(l10n.gitCreatePrTitle, l10n.gitCreatePrBody)) {
          _toolbarOperationAttempted = true;
          await _git.stacked(
            'create_pr',
            model: _writerModel,
            base: _git.branches['default'] as String?,
          );
        }
      case 'commit_push':
      case 'commit_push_pr':
        await _commit(action: action);
    }
  }

  Future<void> _diff() async {
    _toolbarOperationAttempted = true;
    await _git.loadDiff();
    if (!mounted || !_ownsAction || _git.error != null || _git.patch == null) {
      return;
    }
    final patch = _git.patch!;
    if (patch.trim().isEmpty) {
      setState(() => _git.error = context.l10n.gitNoChangesToShow);
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => RepositoryDiffSheet(
        diff: RepositoryDiff.parse(patch),
        isCurrent: () => _ownsAction,
        scopeChanges: widget.scopeChanges,
      ),
    );
  }

  Future<void> _checkout(String branch) async {
    final epoch = _branchReviewEpoch;
    if (_route?.isCurrent != true || !_allowRouting(epoch)) return;
    final snapshot = GitBranchSnapshot.fromJson(
      _git.branches,
      fallbackCurrent: _git.status?.branch,
    );
    if (!snapshot.branches.contains(branch)) return;
    if (snapshot.elsewhere.contains(branch)) {
      final path = snapshot.worktreePaths[branch];
      final handler = widget.onCheckedOutBranch;
      if (path != null && handler != null) {
        await handler(branch, path, () => _routingCurrent(epoch));
        _allowRouting(epoch);
      } else {
        await showDialog<void>(
          context: context,
          builder: (dialog) => AlertDialog(
            title: Text(context.l10n.gitBranchSwitchFailed),
            content: Text(context.l10n.gitBranchOpenElsewhere),
            actions: [
              TextButton(
                onPressed: () => _finishDialog(dialog, null),
                child: Text(context.l10n.gitOk),
              ),
            ],
          ),
        );
      }
      return;
    }
    if (_allowRouting(epoch)) {
      await _git.perform(() => widget.repository.checkout(branch));
    }
  }

  Future<void> _openBranchPicker(BuildContext buttonContext) async {
    final epoch = _branchReviewEpoch;
    if (!buttonContext.mounted ||
        _route?.isCurrent != true ||
        !_allowRouting(epoch)) {
      return;
    }
    final choice = await showGitBranchPicker(
      context: buttonContext,
      controller: _git,
      isCurrent: () =>
          _ownsAction &&
          widget.canChangeBranch?.call() != false &&
          epoch == _branchReviewEpoch,
      scopeChanges: widget.scopeChanges,
    );
    if (choice == null || !_allowRouting(epoch)) return;
    if (choice.create) {
      await _createBranch(suppliedName: choice.branch);
    } else {
      await _checkout(choice.branch);
    }
  }

  void _closeToolbar() {
    if (!mounted) return;
    final route = ModalRoute.of(context);
    if (route == null || !route.isActive) return;
    final navigator = Navigator.of(context);
    if (route.isCurrent) {
      navigator.pop();
    } else {
      navigator.removeRoute(route);
    }
  }

  Future<void> _selectToolbarAction(GitToolbarAction action) async {
    if (_toolbarSelecting || _git.busy) return;
    if (!_ownsAction) {
      _closeToolbar();
      return;
    }
    _toolbarOperationAttempted = false;
    _git.notice = null;
    setState(() => _toolbarSelecting = true);
    try {
      switch (action) {
        case GitToolbarAction.initialize:
          await _action('init');
        case GitToolbarAction.changes:
          await _diff();
        case GitToolbarAction.commit:
          await _commit();
        case GitToolbarAction.push:
          await _action('push');
        case GitToolbarAction.commitAndPush:
          await _commit(action: 'commit_push');
        case GitToolbarAction.commitPushPr:
          await _commit(action: 'commit_push_pr');
        case GitToolbarAction.createPr:
          await _action('pr');
        case GitToolbarAction.update:
          await _action('update');
      }
      if (!mounted || !_ownsAction || !_toolbarOperationAttempted) return;
      if (_git.error != null) {
        await showDialog<void>(
          context: context,
          builder: (dialog) => AlertDialog(
            title: Text(context.l10n.gitErrorTitle),
            content: Text(_git.error!.replaceFirst('Bad state: ', '')),
            actions: [
              TextButton(
                onPressed: () => _finishDialog(dialog, null),
                child: Text(context.l10n.gitOk),
              ),
            ],
          ),
        );
      } else if (_git.notice != null) {
        if (!mounted || !_ownsAction) return;
        final pr = _git.result?['pr'];
        final raw = pr is Map ? pr['url'] : null;
        final uri = raw is String ? Uri.tryParse(raw) : null;
        final repository = widget.repository;
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          SnackBar(
            content: Text(_git.notice!),
            action: uri != null && ['https', 'http'].contains(uri.scheme)
                ? SnackBarAction(
                    label: context.l10n.gitOpenPr,
                    onPressed: () {
                      if (repository.isCurrent) {
                        unawaited(
                          launchUrl(uri, mode: LaunchMode.externalApplication),
                        );
                      }
                    },
                  )
                : null,
          ),
        );
      }
    } finally {
      _closeToolbar();
    }
  }

  Widget _toolbarIcon(GitToolbarAction action, Color color) {
    final name = switch (action) {
      GitToolbarAction.initialize => 'central-circle-plus',
      GitToolbarAction.changes => 'changes',
      GitToolbarAction.commit => 'git-commit',
      GitToolbarAction.push => 'central-arrow-up-circle',
      GitToolbarAction.commitAndPush => 'cloud-upload',
      GitToolbarAction.commitPushPr ||
      GitToolbarAction.createPr => 'GitHub_Invertocat_Black',
      GitToolbarAction.update => 'central-arrows-repeat-circle',
    };
    return SvgPicture.asset(
      'assets/icons/command/$name.svg',
      width: 20,
      height: 20,
      colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
    );
  }

  Widget _toolbarRow(GitToolbarAction action) {
    final scheme = Theme.of(context).colorScheme;
    final status = _git.status;
    final enabled =
        gitToolbarActionEnabled(
          action,
          status: status,
          defaultBranch: _git.branches['default'] as String? ?? '',
          enabled: _ownsAction && _git.error == null,
          busy: _git.busy,
        ) &&
        (!{
              GitToolbarAction.createPr,
              GitToolbarAction.commitPushPr,
            }.contains(action) ||
            _writerModel != null);
    final color = scheme.onSurface.withValues(alpha: enabled ? 1 : .38);
    Widget title = Text(action.title);
    Widget icon = _toolbarIcon(action, color);
    var label = action.title;
    if (action == GitToolbarAction.changes) {
      final totals = status?.diffTotals;
      if (_git.loading && status == null) {
        label = context.l10n.gitLoadingChanges;
        title = Text(context.l10n.gitLoadingChangesEllipsis);
        icon = const CupertinoActivityIndicator(
          key: Key('git.menu.changes.loading'),
          radius: 8,
        );
      } else if (totals == null) {
        label = context.l10n.gitChangesUnavailable;
        title = Text(label);
        icon = SvgPicture.asset(
          'assets/icons/command/central-exclamation-circle.svg',
          width: 20,
          height: 20,
          colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
        );
      } else if (!totals.hasChanges) {
        label = context.l10n.gitNoChanges;
        title = Text(label);
        icon = Icon(DjlIcons.checkCircle, size: 20, color: color);
      } else {
        label =
            '+${totals.additions} -${totals.deletions}'
            '${totals.binaryFiles > 0 ? ' B${totals.binaryFiles}' : ''}';
        title = Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            Text(
              '+${totals.additions}',
              style: TextStyle(
                color: enabled ? DjlColors.of(context).ink : color,
              ),
            ),
            Text(
              '-${totals.deletions}',
              style: TextStyle(
                color: enabled ? DjlColors.of(context).danger : color,
              ),
            ),
            if (totals.binaryFiles > 0)
              Text(
                'B${totals.binaryFiles}',
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
          ],
        );
      }
    }
    void select() => unawaited(_selectToolbarAction(action));
    return Semantics(
      container: true,
      button: true,
      enabled: enabled,
      label: label,
      excludeSemantics: true,
      onTap: enabled ? select : null,
      child: InkWell(
        key: ValueKey('git.menu.action.${action.name}'),
        onTap: enabled ? select : null,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: DefaultTextStyle.merge(
              style: Theme.of(context).textTheme.bodyLarge!.copyWith(
                fontSize: 17,
                height: 1.2,
                color: color,
              ),
              child: Row(
                children: [
                  Expanded(child: title),
                  const SizedBox(width: 14),
                  icon,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _toolbarContents() {
    if (!_ownsAction) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(context.l10n.gitDesktopChanged),
            TextButton(
              onPressed: _closeToolbar,
              child: Text(context.l10n.gitClose),
            ),
          ],
        ),
      );
    }
    if (_toolbarSelecting) {
      return _git.busy || _git.loading
          ? Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const CupertinoActivityIndicator(),
                  const SizedBox(width: 12),
                  Expanded(child: Text(_git.phase ?? context.l10n.gitWorking)),
                ],
              ),
            )
          : const SizedBox.shrink();
    }
    final sections = gitToolbarSections(_git.status);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_git.error != null)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(_git.error!.replaceFirst('Bad state: ', '')),
                TextButton(
                  onPressed: _git.loading ? null : _git.refresh,
                  child: Text(context.l10n.gitRetryStatus),
                ),
              ],
            ),
          ),
        for (var i = 0; i < sections.length; i++) ...[
          if (i > 0) const Divider(height: 16, thickness: .5),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
            child: Text(
              sections[i].title,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontSize: 12,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          for (final action in sections[i].actions) _toolbarRow(action),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _git,
    builder: (context, _) {
      final c = _git, s = c.status;
      if (widget.composerAction case final action?) {
        final Widget child;
        if (_composerSelecting) {
          child = const SizedBox.shrink();
        } else if (action == GitComposerAction.branch) {
          child = GitBranchPicker(
            controller: c,
            isCurrent: () =>
                _ownsAction &&
                widget.canChangeBranch?.call() != false &&
                _composerEpoch == _branchReviewEpoch,
            scopeChanges: widget.scopeChanges,
            onChoice: (choice) => unawaited(
              _runComposer(
                () => choice.create
                    ? _createBranch(suppliedName: choice.branch)
                    : _checkout(choice.branch),
              ),
            ),
          );
        } else if (c.error != null) {
          child = AlertDialog(
            title: Text(context.l10n.gitWorktreeUnavailable),
            content: Text(c.error!),
            actions: [
              TextButton(
                onPressed: _closeToolbar,
                child: Text(context.l10n.gitClose),
              ),
            ],
          );
        } else {
          child = const Center(child: CircularProgressIndicator());
        }
        return PopScope(canPop: !_composerSelecting && !c.busy, child: child);
      }
      if (widget.toolbarMenu) {
        if (_toolbarSelecting && !_git.busy && !_git.loading) {
          return const SizedBox.shrink();
        }
        return CallbackShortcuts(
          bindings: {
            const SingleActivator(LogicalKeyboardKey.escape): _closeToolbar,
            const SingleActivator(LogicalKeyboardKey.arrowDown): () =>
                FocusScope.of(context).nextFocus(),
            const SingleActivator(LogicalKeyboardKey.arrowUp): () =>
                FocusScope.of(context).previousFocus(),
          },
          child: Focus(
            autofocus: true,
            child: Semantics(
              role: SemanticsRole.menu,
              scopesRoute: true,
              namesRoute: true,
              explicitChildNodes: true,
              label: context.l10n.gitActionsLabel,
              child: Material(
                type: MaterialType.card,
                color: Theme.of(
                  context,
                ).colorScheme.surface.withValues(alpha: .97),
                surfaceTintColor: Colors.transparent,
                shadowColor: Colors.black.withValues(alpha: .15),
                elevation: 12,
                borderRadius: BorderRadius.circular(28),
                clipBehavior: Clip.antiAlias,
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: _toolbarContents(),
                ),
              ),
            ),
          ),
        );
      }
      if (!_ownsAction) {
        return Scaffold(
          appBar: AppBar(title: const Text('Git')),
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text(context.l10n.gitDesktopChanged),
              ),
            ),
          ),
        );
      }
      final branchSnapshot = GitBranchSnapshot.fromJson(
        _git.branches,
        fallbackCurrent: s?.branch,
      );
      final branchEpoch = _branchReviewEpoch;
      final resultPath =
          c.result?['worktreePath'] as String? ??
          c.result?['targetPath'] as String?;
      final pr = c.result?['pr'] as Map?;
      final url = pr?['url'] as String?;
      return Scaffold(
        appBar: AppBar(
          title: const Text('Git'),
          actions: [
            IconButton(
              tooltip: context.l10n.gitRefreshStatus,
              onPressed: c.loading || c.busy ? null : c.refresh,
              icon: const Icon(DjlIcons.refresh),
            ),
            DjlGlassMenuButton<String>(
              tooltip: context.l10n.gitShowMenu,
              enabled: !c.busy,
              onSelected: (action) {
                if (_routingActions.contains(action) &&
                    !_allowRouting(branchEpoch)) {
                  return;
                }
                unawaited(_action(action));
              },
              itemBuilder: (_) => [
                if (s?.isRepo != true)
                  PopupMenuItem(
                    value: 'init',
                    child: Text(context.l10n.gitInitializeRepository),
                  ),
                if (s?.isRepo == true) ...[
                  PopupMenuItem(
                    enabled: _branchReady,
                    value: 'branch',
                    child: Text(context.l10n.gitCreateBranch),
                  ),
                  PopupMenuItem(
                    enabled: _branchReady,
                    value: 'worktree',
                    child: Text(context.l10n.gitCreateWorktree),
                  ),
                  PopupMenuItem(
                    enabled: _branchReady,
                    value: 'managed',
                    child: Text(context.l10n.gitCreateManagedWorktree),
                  ),
                  PopupMenuItem(
                    enabled: _branchReady,
                    value: 'transfer',
                    child: Text(context.l10n.gitTransferToWorkspace),
                  ),
                  PopupMenuItem(
                    enabled: _branchReady,
                    value: 'remove',
                    child: Text(context.l10n.gitRemoveManagedWorktree),
                  ),
                  PopupMenuItem(
                    enabled: _writerModel != null,
                    value: 'draft',
                    child: Text(context.l10n.gitGeneratePrDraft),
                  ),
                  PopupMenuItem(
                    enabled: _writerModel != null,
                    value: 'pr',
                    child: Text(context.l10n.gitCreatePullRequest),
                  ),
                  PopupMenuItem(
                    value: 'commit_push',
                    child: Text(context.l10n.gitCommitAndPushMenu),
                  ),
                  PopupMenuItem(
                    enabled: _writerModel != null,
                    value: 'commit_push_pr',
                    child: Text(context.l10n.gitCommitPushCreatePrMenu),
                  ),
                  PopupMenuItem(
                    value: 'reset',
                    child: Text(context.l10n.gitDiscardAndReset),
                  ),
                ],
              ],
            ),
          ],
        ),
        body: SafeArea(
          child: RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                SelectableText(
                  widget.repository.cwd,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 16),
                if (c.loading || c.busy) const LinearProgressIndicator(),
                if (c.phase != null) Text(c.phase!),
                if (c.error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      c.error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                if (c.notice != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(c.notice!),
                  ),
                if (resultPath != null)
                  ListTile(
                    title: Text(context.l10n.gitWorktreeReady),
                    subtitle: SelectableText(resultPath),
                    trailing: TextButton(
                      onPressed: !_branchReady
                          ? null
                          : () {
                              if (_allowRouting(branchEpoch)) {
                                widget.onOpenWorktree(resultPath);
                              }
                            },
                      child: Text(context.l10n.gitOpenChat),
                    ),
                  ),
                if (url != null)
                  TextButton(
                    onPressed: () => launchUrl(
                      Uri.parse(url),
                      mode: LaunchMode.externalApplication,
                    ),
                    child: Text(context.l10n.gitOpenPullRequest),
                  ),
                if (s != null) ...[
                  Text(
                    s.isRepo
                        ? s.branch ?? context.l10n.gitDetachedHead
                        : context.l10n.gitNotRepository,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(s.tracking ?? context.l10n.gitNoUpstream),
                  Text(context.l10n.gitAheadBehind(s.ahead, s.behind)),
                  const SizedBox(height: 20),
                  if (s.isRepo)
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        FilledButton(
                          onPressed: c.busy || !s.dirty ? null : _commit,
                          child: Text(context.l10n.gitCommitChanges),
                        ),
                        OutlinedButton(
                          onPressed: c.busy || !s.canPush
                              ? null
                              : () async {
                                  if (await _confirm(
                                    context.l10n.gitPushTitle,
                                    context.l10n.gitPushBody,
                                  )) {
                                    await c.perform(widget.repository.push);
                                  }
                                },
                          child: Text(context.l10n.gitPush),
                        ),
                        OutlinedButton(
                          onPressed: c.busy || !s.hasRemote
                              ? null
                              : () async {
                                  if (await _confirm(
                                    context.l10n.gitPullTitle,
                                    context.l10n.gitPullBody,
                                  )) {
                                    await c.perform(widget.repository.pull);
                                  }
                                },
                          child: Text(context.l10n.gitPull),
                        ),
                        TextButton(
                          onPressed: c.busy ? null : _diff,
                          child: Text(context.l10n.gitViewDiff),
                        ),
                      ],
                    ),
                  if (s.isRepo)
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Builder(
                        builder: (buttonContext) => Semantics(
                          label: context.l10n.gitCurrentBranch,
                          child: TextButton.icon(
                            key: const Key('git.current-branch'),
                            onPressed: !_branchReady
                                ? null
                                : () {
                                    if (_allowRouting(branchEpoch)) {
                                      _openBranchPicker(buttonContext);
                                    }
                                  },
                            icon: SvgPicture.asset(
                              'assets/icons/command/git-branch.svg',
                              width: 16,
                              height: 16,
                              colorFilter: ColorFilter.mode(
                                Theme.of(context).colorScheme.onSurfaceVariant
                                    .withValues(alpha: _branchReady ? 1 : .38),
                                BlendMode.srcIn,
                              ),
                            ),
                            label: Text(
                              branchSnapshot.currentBranch.isNotEmpty
                                  ? branchSnapshot.currentBranch
                                  : branchSnapshot.defaultBranch ??
                                        context.l10n.gitBranchFallback,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'GeistMono',
                                fontSize: 15,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  Text(
                    context.l10n.gitWriterModel,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  if (widget.writerModels.isEmpty)
                    Text(context.l10n.gitConnectCodexModel)
                  else
                    DropdownButton<String>(
                      key: const Key('git-operation-writer'),
                      isExpanded: true,
                      itemHeight: null,
                      value: _writerModel,
                      items: [
                        for (final model in widget.writerModels)
                          DropdownMenuItem(
                            value: model,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              child: Text(
                                model,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                      ],
                      onChanged: c.busy
                          ? null
                          : (value) => setState(() => _writer = value),
                    ),
                  const Divider(height: 32),
                  Text(
                    context.l10n.gitChangedFilesCount(s.files.length),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  for (final file in s.files)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Text(file.status),
                      title: Text(file.path),
                    ),
                ],
              ],
            ),
          ),
        ),
      );
    },
  );
}
