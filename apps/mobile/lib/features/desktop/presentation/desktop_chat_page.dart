import '../../reasoning/domain/desktop_reasoning.dart';
import '../../reasoning/presentation/thinking_timeline_row.dart';
import '../../../app/desktop_deep_link.dart';
import 'desktop_focus_timeline.dart';
import 'desktop_conversation_view.dart';
import 'desktop_draft_toolbar.dart';
import 'desktop_thread_menu.dart';
import 'desktop_thread_location_sheet.dart';
import '../../../core/presentation/djl_glass.dart';
import '../domain/desktop_markdown_media.dart';
import '../domain/desktop_worktree_routing.dart';
import 'desktop_markdown_image.dart';
import '../../host/presentation/host_controls.dart';
import '../../subagents/domain/subagent_action.dart';
import '../../subagents/presentation/subagent_card.dart';
import '../../guardian/domain/guardian_review.dart';
import '../../activity/domain/desktop_activity.dart';
import '../../activity/domain/activity_preview.dart';
import '../../activity/presentation/activity_card.dart';
import '../../guardian/presentation/guardian_review_card.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart'
    show MarkdownImageBuilder;
import 'package:flutter/cupertino.dart' show CupertinoColors;
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter/scheduler.dart';
import '../../voice/presentation/voice_controller.dart';
import '../../voice/data/native_voice_driver.dart';
import '../../voice/data/voice_driver.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../chat/presentation/assistant_code_block.dart';
import '../domain/desktop_response_footer.dart';
import 'desktop_response_footer.dart';
import '../domain/desktop_timeline_projection.dart';
import 'desktop_timeline_group.dart';
import 'desktop_controller.dart';
import '../../plans/domain/desktop_plan.dart';
import '../../plans/domain/desktop_plan_questionnaire.dart';
import '../../plans/presentation/desktop_plan_card.dart';
import 'worktree_flow_controller.dart';
import 'desktop_phone_drawer.dart';
import 'desktop_navigation_menu.dart';
import '../../status/domain/run_status.dart';
import '../../settings/domain/appearance.dart';
import '../data/desktop_composer_repository.dart';
import '../domain/desktop_composer.dart';
import '../domain/desktop_overview.dart';
import 'desktop_composer_controller.dart';
import 'desktop_composer_widgets.dart';
import 'desktop_composer_panel.dart';
import 'desktop_project_controls.dart';
import 'desktop_queued_drafts_sheet.dart';
import 'desktop_composer_options_menu.dart';
import 'desktop_context_picker.dart';
import 'desktop_thread_actions.dart';
import '../../goals/data/goal_repository.dart';
import '../../goals/domain/thread_goal.dart';
import '../../goals/presentation/goal_controller.dart';
import '../../goals/presentation/goal_page.dart';
import '../../workspace/presentation/project_picker_page.dart';
import 'structured_question_card.dart';
import 'desktop_runtime_menu.dart';
import 'desktop_access_control.dart';
import '../../git/data/git_repository.dart';
import '../../git/presentation/git_page.dart';
import '../../git/presentation/git_branch_picker.dart';
import '../../git/presentation/git_toolbar_menu.dart';
import '../../git/presentation/worktree_flow_dialog.dart';
import '../../git/domain/git_models.dart';
import '../../workspace/data/workspace_repository.dart';
import '../../workspace/presentation/workspace_file_page.dart';
import '../../workspace/presentation/workspace_linked_file_page.dart';
import '../../workspace/presentation/checkpoint_page.dart';
import '../../workspace/presentation/response_undo_sheet.dart';
import '../../workspace/domain/workspace_reference.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

String desktopItemText(RemoteJson item) {
  if (item['text'] is String) return item['text'] as String;
  final content = item['content'];
  if (content is List) {
    return content
        .map(
          (p) => p is Map
              ? desktopIsImage(p) || {'skill', 'mention'}.contains(p['type'])
                    ? ''
                    : activityText(p['text'] ?? p['path'] ?? p['name'])
              : activityText(p),
        )
        .join('\n');
  }
  final output = activityText(item['aggregatedOutput'] ?? item['output']);
  return output.isNotEmpty
      ? output
      : activityCommand(item) ??
            activityString(item['name']) ??
            activityString(item['type']) ??
            '';
}

class DesktopChatPage extends StatefulWidget {
  const DesktopChatPage({
    super.key,
    required this.controller,
    this.imagePicker,
    this.voiceDriver,
    this.focusTarget,
    this.draft,
    this.onSettings,
    this.onCloud,
    this.runStatus,
  });
  final DesktopController controller;
  final VoidCallback? onSettings, onCloud;
  final RunStatusProjector? runStatus;
  final DesktopNewChatDraft? draft;
  final DesktopComposerImagePicker? imagePicker;
  final VoiceDriver? voiceDriver;
  final DesktopLinkTarget? focusTarget;
  @override
  State<DesktopChatPage> createState() => _DesktopChatPageState();
}

class _DesktopChatPageState extends State<DesktopChatPage>
    with WidgetsBindingObserver {
  final _text = TextEditingController();
  final _options = GlobalKey();
  final _requestFocus = GlobalKey();
  Object? _lastRequestFocus;
  ({Object owner, Object request})? _questionComposerFocus;
  bool Function()? _optionsOwner;
  late final VoiceController _voice;
  late final DesktopComposerController _composer;
  GoalController? _goal;
  String? _boundThread, _boundMac, _boundCwd, _boundDraft, _boundPin;
  bool _closing = false, _promoted = false, _sending = false;
  bool _navigationOpen = false, _menuNavigating = false;
  bool _gitMenuOpen = false, _gitBusy = false;
  WorktreeFlowController? _worktreeFlow;
  int _gitEpoch = 0;
  GitStatus? _gitStatus;
  Object? _gitStatusOwner;
  Object? _draftToolbarOwner;
  Key _draftToolbarKey = UniqueKey();
  final _drawer = GlobalKey<DesktopPhoneDrawerState>();
  ModalRoute<dynamic>? _route;
  ModalRoute<dynamic>? _queuedSheetRoute;
  bool get _ownsPage =>
      !_closing &&
      _route?.isActive != false &&
      (_promoted ||
          widget.draft == null ||
          widget.controller.isCurrentNewChatDraft(widget.draft!));
  int _bindingEpoch = 0, _timelineSendRevision = 0;
  DesktopComposerScope get _scope => (
    mac: widget.controller.active?.macDeviceId,
    thread: widget.controller.thread?['id'] as String?,
    cwd: widget.controller.thread == null
        ? widget.draft?.cwd
        : widget.controller.thread?['cwd'] as String?,
  );
  Object get _gitOwner => (
    _scope,
    _bindingEpoch,
    widget.controller.threadList.data,
    widget.controller.active?.data['macIdentityPublicKey'],
    widget.controller.transport.sessionId,
    widget.controller.transport.connectionRevision,
  );
  bool get _gitContextReady {
    final desktop = widget.controller, active = desktop.active;
    final pin = active?.data['macIdentityPublicKey'];
    return desktop.connected &&
        active != null &&
        pin is String &&
        pin.isNotEmpty &&
        desktop.transport.macDeviceId == active.macDeviceId &&
        desktop.threadList.macDeviceId == active.macDeviceId &&
        desktop.trusted.any(
          (pair) =>
              pair.macDeviceId == active.macDeviceId &&
              pair.data['macIdentityPublicKey'] == pin,
        );
  }

  List<String> get _gitWriterModels => widget.controller.models
      .where((m) => m['djlProvider'] == 'codex' || m['djlProvider'] == null)
      .map((m) => m['model'] as String? ?? m['id'] as String)
      .toList();
  String? get _gitInitialWriter =>
      widget.controller.gitWriterModel?['model'] as String? ??
      widget.controller.gitWriterModel?['id'] as String?;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _voice = VoiceController(
      widget.voiceDriver ?? NativeVoiceDriver(),
      onDraft: (value) {
        if (mounted) {
          _text.value = TextEditingValue(
            text: value,
            selection: TextSelection.collapsed(offset: value.length),
          );
        }
      },
    );
    _voice.setForeground(
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed,
    );
    _composer = DesktopComposerController(picker: widget.imagePicker);
    _composer.addListener(_composerChanged);
    _text.addListener(_saveDraft);
    widget.controller.addListener(_desktopChanged);
    _bindThread();
    _scheduleQueuedFlush();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route == _route) {
      _scheduleQueuedFlush();
      return;
    }
    _route = route;
    _scheduleQueuedFlush();
    // removeRoute completes without invoking PopScope. Fence the route's
    // ownership as soon as it closes, while its animation may still be mounted.
    unawaited(
      route?.popped.then((_) {
        if (mounted) _closeDraft();
      }),
    );
  }

  void _saveDraft() {
    _composer.setText(_text.text);
    _persistComposer();
  }

  void _composerChanged() {
    if (_text.text != _composer.text) {
      _text.value = TextEditingValue(
        text: _composer.text,
        selection: TextSelection.collapsed(offset: _composer.text.length),
      );
    }
    _persistComposer();
    if (mounted) setState(() {});
  }

  void _persistComposer() {
    final desktop = widget.controller, id = _boundThread ?? _boundDraft;
    if (id != null &&
        _ownsPage &&
        desktop.active?.data['macIdentityPublicKey'] == _boundPin &&
        desktop.active?.macDeviceId == _boundMac &&
        desktop.threadList.macDeviceId == _boundMac) {
      desktop.threadList.data.setComposerDraft(id, _composer.draft);
      desktop.threadList.scheduleSave();
    }
  }

  void _bindThread({bool createdForSend = false}) {
    if (!_ownsPage) {
      _bindingEpoch++;
      _composer.bind((
        mac: null,
        thread: null,
        cwd: null,
      ), DesktopComposerDraft());
      return;
    }
    final oldDraft = _boundDraft;
    final desktop = widget.controller,
        id = widget.controller.thread?['id'] as String?,
        mac = widget.controller.active?.macDeviceId,
        cwd = _scope.cwd,
        pin = widget.controller.active?.data['macIdentityPublicKey'] as String?,
        draftId = widget.controller.thread == null
            ? widget.draft?.storageKey
            : null;
    if (id == _boundThread &&
        mac == _boundMac &&
        cwd == _boundCwd &&
        draftId == _boundDraft &&
        pin == _boundPin) {
      _goal?.connectionChanged();
      return;
    }
    _bindingEpoch++;
    if (_boundMac != null && pin != _boundPin) {
      // A pin replacement is a new picker/voice owner even for the same route.
      // Reset before rebinding so the composer's scope equality cannot adopt
      // work started under the previous identity. The cache remains authority.
      _composer.bind((
        mac: null,
        thread: null,
        cwd: null,
      ), DesktopComposerDraft());
    }
    unawaited(_voice.suspend());
    _goal?.dispose();
    _boundThread = id;
    _boundMac = mac;
    _boundCwd = cwd;
    _boundDraft = draftId;
    _boundPin = pin;
    if (createdForSend) {
      _composer.adoptCreatedThread(_scope);
      if (oldDraft != null) {
        desktop.threadList.data.drafts.remove(oldDraft);
        desktop.threadList.data.composerDrafts.remove(oldDraft);
        desktop.threadList.scheduleSave();
      }
    } else {
      _composer.bind(
        _scope,
        id == null && draftId == null
            ? DesktopComposerDraft()
            : desktop.threadList.data.composerDraft(id ?? draftId!),
        draftId: draftId,
      );
    }
    if (id == null) {
      _goal = null;
      return;
    }
    ThreadGoal? cached;
    try {
      final value = desktop.threadList.data.goals[id];
      if (value != null) cached = ThreadGoal.fromJson(value);
    } catch (_) {}
    _goal = GoalController(
      GoalRepository(desktop.transport, threadId: id, macDeviceId: mac),
      goal: cached,
      onChange: (goal) => desktop.threadList.setGoal(id, goal),
      onUnsupported: desktop.threadList.markGoalsUnsupported,
      isRunning: () => desktop.thread?['id'] == id && desktop.turnId != null,
      isReady: () => desktop.runtimeReady,
    );
    _goal!.connectionChanged();
  }

  void _desktopChanged() {
    _bindThread();
    if (widget.controller.pendingUserInputs.isNotEmpty ||
        _questionComposerFocus?.owner != _gitOwner) {
      _questionComposerFocus = null;
    }
    _scheduleQueuedFlush();
  }

  Future<void> _cancelQuestion(RemoteJson request) async {
    if (!_ownsPage || _route?.isCurrent != true || _navigationOpen) return;
    final desktop = widget.controller, owner = _gitOwner;
    final accepted = await desktop.cancelQuestion(request);
    if (!accepted ||
        !mounted ||
        !_ownsPage ||
        _gitOwner != owner ||
        _route?.isCurrent != true ||
        _navigationOpen ||
        desktop.pendingUserInputs.isNotEmpty) {
      return;
    }
    setState(() => _questionComposerFocus = (owner: owner, request: Object()));
  }

  void _scheduleQueuedFlush() {
    final desktop = widget.controller;
    if (!mounted ||
        !_ownsPage ||
        desktop.shouldQueueComposer ||
        desktop.busy ||
        desktop.queuedActionInProgress ||
        !desktop.runtimeReady ||
        desktop.queuedDrafts.isEmpty) {
      return;
    }
    final owner = _gitOwner;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted &&
          _ownsPage &&
          _gitOwner == owner &&
          (_route?.isCurrent == true || _queuedSheetRoute?.isCurrent == true)) {
        unawaited(desktop.flushQueuedDrafts());
      }
    });
  }

  Future<void> _openQueuedDrafts() async {
    if (!_ownsPage ||
        _route?.isCurrent != true ||
        widget.controller.queuedDrafts.isEmpty) {
      return;
    }
    final desktop = widget.controller, owner = _gitOwner;
    FocusScope.of(context).unfocus();
    ModalRoute<dynamic>? shown;
    try {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        builder: (sheetContext) {
          shown = ModalRoute.of(sheetContext);
          _queuedSheetRoute = shown;
          return DesktopQueuedDraftsSheet(
            controller: desktop,
            composer: _composer,
            onVisible: _scheduleQueuedFlush,
            isCurrent: () => mounted && _ownsPage && _gitOwner == owner,
          );
        },
      );
    } finally {
      if (identical(_queuedSheetRoute, shown)) _queuedSheetRoute = null;
      if (mounted) _scheduleQueuedFlush();
    }
  }

  Future<void> _openGoal({String? draft, String? composerCommand}) async {
    final controller = _goal;
    if (controller == null) return;
    await Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => GoalPage(
          controller: controller,
          initialDraft: draft,
          isRunning: () => widget.controller.turnId != null,
          onObjectiveSubmitted: (_) {
            if (composerCommand != null && _text.text == composerCommand) {
              _text.clear();
            }
          },
        ),
      ),
    );
  }

  Future<void> _fork({bool chooseFolder = false}) async {
    if (_worktreeFlow != null || widget.controller.projectMoveBusy) return;
    final desktop = widget.controller,
        source = widget.controller.thread?['id'],
        mac = widget.controller.active?.macDeviceId;
    if (_voice.listening) await _voice.stop();
    if (!mounted) return;
    String? cwd;
    if (chooseFolder) {
      cwd = await Navigator.push<String>(
        context,
        MaterialPageRoute(
          builder: (_) => ProjectPickerPage(
            repository: ProjectRepository(desktop.transport),
            initialPath: desktop.thread?['cwd'] as String?,
          ),
        ),
      );
      if (cwd == null || !mounted) return;
    }
    if (desktop.thread?['id'] != source || desktop.active?.macDeviceId != mac) {
      return;
    }
    await desktop.forkThread(cwd: cwd);
  }

  void _worktreeFlowChanged() {
    if (!mounted) return;
    if (SchedulerBinding.instance.schedulerPhase ==
        SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
    } else {
      setState(() {});
    }
  }

  Future<void> _openWorktreeFlow(WorktreeFlowMode mode) async {
    final desktop = widget.controller, owner = _gitOwner;
    bool canStart() =>
        mounted &&
        _ownsPage &&
        _route?.isCurrent == true &&
        _worktreeFlow == null &&
        _gitContextReady &&
        desktop.runtimeReady &&
        desktop.turnId == null &&
        !_sending &&
        desktop.thread != null &&
        desktopConversationPath(desktop.thread?['cwd']) != null &&
        _gitOwner == owner;
    if (!canStart()) return;
    if (_voice.listening) await _voice.stop();
    if (!canStart()) return;
    _persistComposer();
    late final WorktreeFlowController flow;
    flow = WorktreeFlowController(
      desktop,
      mode: mode,
      isCurrent: () =>
          mounted &&
          _ownsPage &&
          _route?.isActive == true &&
          identical(_worktreeFlow, flow),
    );
    setState(() => _worktreeFlow = flow);
    flow.addListener(_worktreeFlowChanged);
    var reportFailure = false;
    Future<void> review() async {
      if (!mounted || _route?.isCurrent != true || !flow.isCurrent) return;
      await showWorktreeFlowDialog(context: context, controller: flow);
      reportFailure = flow.submitting;
    }

    try {
      final path = desktop.thread?['cwd'];
      final associated = desktop
          .threadList
          .data
          .associatedWorktreePaths[desktop.thread?['id']];
      if (mode == WorktreeFlowMode.handoff && isManagedWorktreePath(path)) {
        reportFailure = !await flow.handoffToLocal();
      } else if (mode == WorktreeFlowMode.handoff && associated != null) {
        final moved = await flow.handoffAssociated(associated);
        if (flow.missingAssociatedWorktree && flow.isCurrent) {
          await review();
        } else {
          reportFailure = !moved;
        }
      } else {
        await review();
      }
      await flow.settled;
      if (mounted &&
          _route?.isCurrent == true &&
          reportFailure &&
          flow.isCurrent &&
          flow.error != null) {
        await showDialog<void>(
          context: context,
          builder: (dialog) => AlertDialog(
            title: Text(flow.errorTitle ?? 'Worktree Handoff Failed'),
            content: Text(flow.error!),
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
    } finally {
      await flow.settled;
      flow.removeListener(_worktreeFlowChanged);
      flow.dispose();
      if (mounted && identical(_worktreeFlow, flow)) {
        setState(() => _worktreeFlow = null);
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _voice.setForeground(state == AppLifecycleState.resumed);
    if (state != AppLifecycleState.resumed) {
      unawaited(_voice.suspend());
    }
  }

  @override
  void dispose() {
    final worktree = _worktreeFlow;
    _worktreeFlow = null;
    worktree?.removeListener(_worktreeFlowChanged);
    if (worktree != null) {
      unawaited(worktree.settled.whenComplete(worktree.dispose));
    }
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.removeListener(_desktopChanged);
    _text.removeListener(_saveDraft);
    _goal?.dispose();
    _voice.dispose();
    _composer.removeListener(_composerChanged);
    _composer.dispose();
    _text.dispose();
    super.dispose();
  }

  void _closeDraft() {
    if (_closing) return;
    _persistComposer();
    _closing = true;
    _bindingEpoch++;
    if (widget.draft case final draft?) {
      widget.controller.cancelNewChatDraft(draft);
    }
  }

  bool get _canNavigateMenu =>
      _ownsPage &&
      !_menuNavigating &&
      _route?.isCurrent == true &&
      widget.controller.navigationTarget == null;

  void _replaceWithChat({DesktopNewChatDraft? draft}) {
    final navigator = Navigator.of(context), previous = _route!;
    final destination = DesktopPhoneRoute<void>(
      builder: (_) => DesktopChatPage(
        controller: widget.controller,
        draft: draft,
        imagePicker: widget.imagePicker,
        onSettings: widget.onSettings,
        onCloud: widget.onCloud,
        runStatus: widget.runStatus,
      ),
    );
    if (previous.isCurrent) {
      navigator.pushReplacement(destination);
    } else {
      // Settings remains current; only the captured selection owner's route
      // is replaced, so Done reveals a usable destination instead of that owner.
      navigator.replace(oldRoute: previous, newRoute: destination);
    }
  }

  void _newMenuChat({String? cwd}) {
    final desktop = widget.controller;
    if (!_canNavigateMenu || !desktop.runtimeReady) return;
    _drawer.currentState?.close();
    _closeDraft(); // Persist and fence the old owner before creating its successor.
    final draft = desktop.beginNewChatDraft(cwd: cwd);
    if (draft != null) _replaceWithChat(draft: draft);
  }

  Future<void> _menuThread(
    RemoteJson thread, {
    bool readOnlyNavigation = false,
  }) async {
    if (!_canNavigateMenu) return;
    _drawer.currentState?.close();
    final desktop = widget.controller;
    if (desktop.thread?['id'] == thread['id']) return;
    _menuNavigating = true;
    _closeDraft();
    final ownerRoute = _route,
        mac = desktop.active?.macDeviceId,
        pin = desktop.active?.publicKey,
        revision = desktop.navigationRevision,
        selection = desktop.selectionRevision,
        data = desktop.threadList.data;
    bool current() =>
        mounted &&
        identical(_route, ownerRoute) &&
        ownerRoute?.isActive == true &&
        desktop.active?.macDeviceId == mac &&
        desktop.active?.publicKey == pin &&
        desktop.trusted.any(
          (pair) => pair.macDeviceId == mac && pair.publicKey == pin,
        ) &&
        desktop.navigationRevision == revision &&
        desktop.selectionRevision == selection &&
        identical(data, desktop.threadList.data);
    try {
      await desktop.openThread(
        thread,
        readOnlyNavigation: readOnlyNavigation,
        isCurrent: current,
      );
    } catch (_) {
      if (!readOnlyNavigation) rethrow;
      // The qualified cached destination presents the retained history error.
    }
    if (current() && desktop.thread?['id'] == thread['id']) _replaceWithChat();
  }

  void _menuRemote() {
    if (!_canNavigateMenu) return;
    _drawer.currentState?.close();
    _closeDraft();
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  Future<void> _chooseDraftProject() async {
    final desktop = widget.controller, draft = widget.draft;
    if (draft == null || !_ownsPage || desktop.busy) return;
    final epoch = _bindingEpoch, revision = desktop.navigationRevision;
    final path = await showProjectPicker(
      context,
      repository: ProjectRepository(desktop.transport),
      initialPath: draft.cwd,
    );
    if (path != null &&
        mounted &&
        _ownsPage &&
        epoch == _bindingEpoch &&
        revision == desktop.navigationRevision &&
        desktop.connected) {
      desktop.updateNewChatDraftCwd(draft, path);
    }
  }

  Widget _draftFolderPicker() {
    final desktop = widget.controller, draft = widget.draft!;
    final owner = _gitOwner, revision = desktop.navigationRevision;
    final choices = projectDesktopOverview(
      desktop.threadList.data.visible(),
      scope: DesktopOverviewScope.projects,
      projectlessRoots: desktop.threadList.data.projectlessChatRoots,
    ).where((group) => group.path != null).toList();
    bool current() =>
        mounted &&
        _ownsPage &&
        !_sending &&
        desktop.runtimeReady &&
        !desktop.busy &&
        _gitOwner == owner &&
        desktop.navigationRevision == revision;
    return Semantics(
      button: true,
      value: desktopConversationPathLabel(draft.cwd!),
      child: PopupMenuButton<String>(
        tooltip: 'Select folder',
        requestFocus: false,
        enabled: current(),
        onSelected: (path) {
          if (!current()) return;
          if (path == 'browse') {
            _chooseDraftProject();
          } else if (choices.any((choice) => choice.path == path)) {
            desktop.updateNewChatDraftCwd(draft, path);
          }
        },
        itemBuilder: (_) => [
          const PopupMenuItem(
            value: 'browse',
            child: Text('Browse local folders…'),
          ),
          for (final choice in choices)
            CheckedPopupMenuItem(
              value: choice.path!,
              checked: draft.cwd == choice.path,
              child: Text(choice.label),
            ),
        ],
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset(
                'assets/icons/command/central-folder-2.svg',
                width: 22,
                height: 22,
                colorFilter: ColorFilter.mode(
                  Theme.of(context).colorScheme.onSurfaceVariant,
                  BlendMode.srcIn,
                ),
                excludeFromSemantics: true,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  desktopConversationPathLabel(draft.cwd!),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w400,
                    height: 1.2,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              const Icon(DjlIcons.expandVertical, size: 18),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openGit(BuildContext buttonContext, String cwd) async {
    final desktop = widget.controller;
    final draft = desktop.thread == null ? widget.draft : null;
    if (!_ownsPage ||
        _route?.isCurrent != true ||
        !_gitContextReady ||
        cwd.trim().isEmpty ||
        _gitMenuOpen ||
        _worktreeFlow != null ||
        desktop.projectMoveBusy ||
        draft != null && (!desktop.runtimeReady || desktop.busy || _sending)) {
      return;
    }
    final owner = _gitOwner, epoch = ++_gitEpoch;
    bool current() =>
        mounted &&
        _ownsPage &&
        _gitContextReady &&
        _gitOwner == owner &&
        _gitEpoch == epoch;
    void remember({GitStatus? status, bool? busy}) {
      if (!current()) return;
      setState(() {
        if (_gitStatusOwner != owner) {
          _gitStatus = null;
          _gitBusy = false;
          _gitStatusOwner = owner;
        }
        if (status != null) _gitStatus = status;
        if (busy != null) _gitBusy = busy;
      });
    }

    _gitMenuOpen = true;
    try {
      await showGitToolbarMenu(
        context: buttonContext,
        repository: GitRepository(
          desktop.transport,
          cwd: cwd,
          isCurrent: current,
        ),
        isCurrent: current,
        scopeChanges: desktop,
        initialWriter: _gitInitialWriter,
        writerModels: _gitWriterModels,
        onStatus: (status) => remember(status: status),
        onBusy: (busy) => remember(busy: busy),
      );
    } finally {
      if (mounted && _gitEpoch == epoch) {
        setState(() {
          _gitMenuOpen = false;
          _gitBusy = false;
        });
      }
    }
  }

  Future<void> _checkedOutBranch(
    BuildContext gitContext,
    String branch,
    String path,
    bool Function() isCurrent,
  ) async {
    if (!gitContext.mounted ||
        ModalRoute.of(gitContext)?.isCurrent != true ||
        !isCurrent()) {
      return;
    }
    final desktop = widget.controller, source = desktop.thread?['id'];
    if (source is! String) return;
    final targetPath = comparableWorktreePath(path);
    if (targetPath != null &&
        comparableWorktreePath(desktop.thread?['cwd']) == targetPath) {
      return;
    }
    final revision = desktop.navigationRevision,
        selection = desktop.selectionRevision;
    bool current() =>
        mounted &&
        gitContext.mounted &&
        isCurrent() &&
        desktop.navigationRevision == revision &&
        desktop.selectionRevision == selection &&
        desktop.thread?['id'] == source;
    final target = liveWorktreeChats(
      desktop.threadList.data,
      path,
    ).where((thread) => thread['id'] != source).firstOrNull;
    final id = target?['id'] as String?;
    final open =
        await showDialog<bool>(
          context: gitContext,
          builder: (dialog) => AlertDialog(
            title: const Text('Branch already open elsewhere'),
            content: Text(
              id != null
                  ? "'$branch' is already checked out in another worktree. Open that chat to continue there."
                  : "'$branch' is already checked out in another worktree. Open that chat from the sidebar to continue there.",
            ),
            actions: [
              TextButton(
                onPressed: () {
                  if (dialog.mounted &&
                      ModalRoute.of(dialog)?.isCurrent == true) {
                    Navigator.pop(dialog, false);
                  }
                },
                child: const Text('Close'),
              ),
              if (id != null)
                TextButton(
                  onPressed: () {
                    if (dialog.mounted &&
                        ModalRoute.of(dialog)?.isCurrent == true) {
                      Navigator.pop(dialog, true);
                    }
                  },
                  child: const Text('Open Chat'),
                ),
            ],
          ),
        ) ??
        false;
    if (!gitContext.mounted ||
        !open ||
        id == null ||
        !current() ||
        ModalRoute.of(gitContext)?.isCurrent != true) {
      return;
    }
    final latest = liveWorktreeChats(
      desktop.threadList.data,
      path,
    ).where((thread) => thread['id'] == id).firstOrNull;
    if (latest == null) {
      ScaffoldMessenger.of(gitContext).showSnackBar(
        const SnackBar(
          content: Text(
            'The worktree chat is no longer available. Open it from the sidebar.',
          ),
        ),
      );
      return;
    }
    Navigator.pop(gitContext);
    await _menuThread(latest, readOnlyNavigation: true);
  }

  bool get _projectRoutingAvailable =>
      _ownsPage &&
      _route?.isActive == true &&
      _gitContextReady &&
      widget.controller.runtimeReady &&
      widget.controller.turnId == null &&
      !_sending &&
      !_gitMenuOpen &&
      _worktreeFlow == null;

  bool get _projectRoutingReady =>
      _projectRoutingAvailable && _route?.isCurrent == true;

  Future<void> _readProjectStatus() async {
    final desktop = widget.controller, owner = _gitOwner;
    final cwd = desktopConversationPath(_scope.cwd);
    if (!_ownsPage ||
        _route?.isCurrent != true ||
        !_gitContextReady ||
        _gitMenuOpen ||
        _worktreeFlow != null ||
        cwd == null) {
      return;
    }
    final epoch = ++_gitEpoch;
    bool current() =>
        mounted &&
        _ownsPage &&
        _route?.isActive == true &&
        _gitContextReady &&
        _gitOwner == owner &&
        _gitEpoch == epoch;
    setState(() {
      if (_gitStatusOwner != owner) _gitStatus = null;
      _gitStatusOwner = owner;
      _gitBusy = true;
    });
    try {
      final status = await GitRepository(
        desktop.transport,
        cwd: cwd,
        isCurrent: current,
      ).status();
      if (current()) setState(() => _gitStatus = status);
    } catch (_) {
      if (current()) setState(() => _gitStatus = null);
    } finally {
      if (current()) setState(() => _gitBusy = false);
    }
  }

  Future<void> _openComposerGit(
    BuildContext anchor,
    GitComposerAction action,
  ) async {
    final desktop = widget.controller, owner = _gitOwner;
    final cwd = desktopConversationPath(_scope.cwd);
    bool canStart() =>
        mounted &&
        anchor.mounted &&
        _projectRoutingReady &&
        cwd != null &&
        _gitOwner == owner;
    if (!canStart()) return;
    if (_voice.listening) await _voice.stop();
    if (!mounted || !anchor.mounted || !canStart()) return;
    _persistComposer();
    final operation = desktop.reserveProjectMove();
    final epoch = ++_gitEpoch;
    final draft = desktop.thread == null ? widget.draft : null;
    _gitMenuOpen = true;
    Future<void> settled = Future.value();
    bool current() =>
        mounted &&
        _ownsPage &&
        _route?.isActive == true &&
        _gitContextReady &&
        _gitOwner == owner &&
        _gitEpoch == epoch &&
        desktop.ownsProjectMove(operation);
    bool canRoute() =>
        current() &&
        !desktop.busy &&
        desktop.state == 'connected' &&
        desktop.turnId == null &&
        !_sending &&
        _worktreeFlow == null;
    final child = Builder(
      builder: (gitContext) => GitPage(
        composerAction: action,
        repository: GitRepository(
          desktop.transport,
          cwd: cwd!,
          isCurrent: current,
        ),
        scopeChanges: desktop,
        canChangeBranch: canRoute,
        onRoutingOperation: (value) => settled = value,
        onStatus: (status) {
          if (current()) {
            setState(() {
              _gitStatus = status;
              _gitStatusOwner = owner;
            });
          }
        },
        onBusy: (busy) {
          if (current()) {
            setState(() {
              _gitBusy = busy;
              _gitStatusOwner = owner;
            });
          }
        },
        onCheckedOutBranch: draft != null
            ? null
            : (branch, path, branchCurrent) => _checkedOutBranch(
                gitContext,
                branch,
                path,
                () => current() && branchCurrent(),
              ),
        onOpenWorktree: (path) {
          if (canRoute() &&
              draft != null &&
              desktop.thread == null &&
              desktop.isCurrentNewChatDraft(draft) &&
              desktopConversationPath(path) != null) {
            desktop.updateNewChatDraftCwd(draft, path);
          }
        },
      ),
    );
    try {
      if (action == GitComposerAction.branch) {
        await showGitBranchSurface<void>(context: anchor, child: child);
      } else {
        await showDialog<void>(context: context, builder: (_) => child);
      }
    } finally {
      await settled;
      desktop.releaseProjectMove(operation);
      if (mounted && _gitEpoch == epoch) {
        setState(() {
          _gitMenuOpen = false;
          _gitBusy = false;
        });
      }
    }
  }

  void _openGitTools(String cwd) {
    final desktop = widget.controller;
    final draft = desktop.thread == null ? widget.draft : null;
    if (!_ownsPage ||
        _route?.isCurrent != true ||
        !_gitContextReady ||
        cwd.trim().isEmpty ||
        _gitMenuOpen ||
        _worktreeFlow != null ||
        desktop.projectMoveBusy) {
      return;
    }
    if (draft != null && (!desktop.runtimeReady || desktop.busy || _sending)) {
      return;
    }
    final epoch = _bindingEpoch,
        gitEpoch = ++_gitEpoch,
        owner = _gitOwner,
        mac = desktop.active?.macDeviceId,
        pin = desktop.active?.publicKey,
        thread = desktop.thread?['id'];
    bool current() =>
        mounted &&
        _ownsPage &&
        _bindingEpoch == epoch &&
        _gitEpoch == gitEpoch &&
        _gitOwner == owner &&
        _gitContextReady &&
        desktop.active?.macDeviceId == mac &&
        desktop.active?.publicKey == pin &&
        desktop.thread?['id'] == thread;
    Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (gitContext) => GitPage(
          repository: GitRepository(
            desktop.transport,
            cwd: cwd,
            isCurrent: current,
          ),
          scopeChanges: desktop,
          canChangeBranch: () =>
              !desktop.busy &&
              !desktop.projectMoveBusy &&
              desktop.turnId == null &&
              !_sending,
          onCheckedOutBranch: draft != null
              ? null
              : (branch, path, branchCurrent) => _checkedOutBranch(
                  gitContext,
                  branch,
                  path,
                  () => current() && branchCurrent(),
                ),
          initialWriter: _gitInitialWriter,
          writerModels: _gitWriterModels,
          onStatus: (status) {
            if (!current()) return;
            setState(() {
              _gitStatus = status;
              _gitStatusOwner = owner;
            });
          },
          onOpenWorktree: (path) async {
            if (!gitContext.mounted ||
                ModalRoute.of(gitContext)?.isCurrent != true ||
                !current() ||
                desktop.busy ||
                desktop.turnId != null ||
                _sending) {
              return;
            }
            Navigator.pop(gitContext);
            if (draft != null) {
              desktop.updateNewChatDraftCwd(draft, path);
            } else {
              await desktop.forkThread(cwd: path);
            }
          },
        ),
      ),
    );
  }

  Future<void> _send() async {
    if (!_ownsPage ||
        _sending ||
        _worktreeFlow != null ||
        widget.controller.projectMoveBusy) {
      return;
    }
    if (_voice.listening) await _voice.stop();
    if (!mounted ||
        !_ownsPage ||
        _sending ||
        _worktreeFlow != null ||
        widget.controller.projectMoveBusy) {
      return;
    }
    final value = _text.text;
    final trimmed = value.trim();
    if (trimmed == '/goal' || trimmed.startsWith('/goal ')) {
      await _openGoal(
        draft: trimmed.length > 5 ? trimmed.substring(6).trim() : null,
        composerCommand: value,
      );
      return;
    }
    if (trimmed == '/fork') {
      await _fork();
      return;
    }
    if (!_composer.canSend) return;
    final snapshot = _composer.draft;
    var intendedScope = _scope, epoch = _bindingEpoch, latestDraft = snapshot;
    bool canContinue() =>
        mounted &&
        _ownsPage &&
        _scope == intendedScope &&
        _bindingEpoch == epoch;
    void captureLatest() {
      if (canContinue()) latestDraft = _composer.draft;
    }

    _composer.addListener(captureLatest);
    final queueing = widget.controller.shouldQueueComposer;
    setState(() {
      _sending = true;
      if (!queueing) _timelineSendRevision++;
    });
    try {
      if (await widget.controller.submitComposerDraft(
            snapshot,
            newThreadCwd: widget.draft?.cwd,
            latestDraft: () => latestDraft,
            canContinue: canContinue,
            onThreadCreated: (_) {
              _bindThread(createdForSend: true);
              intendedScope = _scope;
              epoch = _bindingEpoch;
            },
          ) &&
          canContinue()) {
        _composer.clearSent(snapshot);
      }
    } finally {
      _composer.removeListener(captureLatest);
      if (mounted) setState(() => _sending = false);
      final draft = widget.draft;
      if (mounted &&
          _ownsPage &&
          draft?.createdThreadId != null &&
          !_promoted) {
        // The first-send fences have finished; this route now owns an ordinary real chat.
        _promoted = true;
        widget.controller.completeNewChatDraft(draft!);
      }
    }
  }

  void _openThreadLocation(
    RemoteJson thread,
    String path,
    bool Function() isCurrent,
  ) {
    if (!mounted || !isCurrent() || _route?.isCurrent != true) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => DesktopThreadLocationSheet(
        controller: widget.controller,
        thread: thread,
        path: path,
        isCurrent: isCurrent,
      ),
    );
  }

  Widget _accessControl() {
    final desktop = widget.controller, scope = _scope, epoch = _bindingEpoch;
    final pin = desktop.active?.data['macIdentityPublicKey'];
    return DesktopAccessControl(
      controller: desktop,
      isCurrent: () =>
          mounted &&
          _ownsPage &&
          epoch == _bindingEpoch &&
          scope == _scope &&
          pin == desktop.active?.data['macIdentityPublicKey'],
    );
  }

  Widget _runtimeControl() {
    final desktop = widget.controller, owner = _gitOwner;
    return DesktopRuntimeControl(
      controller: desktop,
      isCurrent: () =>
          mounted &&
          _ownsPage &&
          identical(widget.controller, desktop) &&
          owner == _gitOwner,
    );
  }

  Widget _composerOptions() {
    final desktop = widget.controller, scope = _scope, epoch = _bindingEpoch;
    final pin = desktop.active?.data['macIdentityPublicKey'];
    return DesktopComposerOptionsMenu(
      key: _options,
      onOpened: () {
        _optionsOwner = () =>
            mounted &&
            _ownsPage &&
            epoch == _bindingEpoch &&
            scope == _scope &&
            pin == desktop.active?.data['macIdentityPublicKey'];
      },
      onSelected: (value) {
        if (_optionsOwner?.call() != true ||
            !mounted ||
            !_ownsPage ||
            epoch != _bindingEpoch ||
            scope != _scope ||
            pin != desktop.active?.data['macIdentityPublicKey']) {
          return;
        }
        switch (value) {
          case 'photo':
          case 'camera':
            if (desktop.connected && _composer.canPick) {
              _composer.pickImage(camera: value == 'camera');
            }
          case 'context':
            if (desktop.connected && !desktop.busy) _pickContext();
          case 'plan':
            if (desktop.supportsPlan && desktop.turnId == null) {
              desktop.setPlan(!desktop.plan);
            }
          case 'fast':
            if (desktop.supportsFastMode && desktop.turnId == null) {
              desktop.setServiceTier(
                desktop.serviceTier == 'fast' ? 'default' : 'fast',
              );
            }
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          value: 'photo',
          enabled: desktop.connected && _composer.canPick,
          child: const Text('Photo library'),
        ),
        PopupMenuItem(
          value: 'camera',
          enabled: desktop.connected && _composer.canPick,
          child: const Text('Take a photo'),
        ),
        PopupMenuItem(
          value: 'context',
          enabled: desktop.connected && !desktop.busy,
          child: const Text('Add desktop context'),
        ),
        const PopupMenuDivider(),
        CheckedPopupMenuItem(
          value: 'plan',
          checked: desktop.plan,
          enabled: desktop.supportsPlan && desktop.turnId == null,
          child: const Text('Plan mode'),
        ),
        if (desktop.supportsFastMode)
          CheckedPopupMenuItem(
            value: 'fast',
            checked: desktop.serviceTier == 'fast',
            enabled: desktop.turnId == null,
            child: const Text('Fast mode'),
          ),
      ],
    );
  }

  Future<void> _pickContext() async {
    final desktop = widget.controller, scope = _scope, epoch = _bindingEpoch;
    final selected = await showModalBottomSheet<DesktopComposerContext>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DesktopContextPicker(
        repository: DesktopComposerRepository(
          desktop.transport,
          cwd: scope.cwd,
        ),
        isCurrent: () =>
            mounted &&
            _ownsPage &&
            epoch == _bindingEpoch &&
            _scope == scope &&
            desktop.connected,
        scopeChanges: desktop,
      ),
    );
    if (selected != null &&
        mounted &&
        _ownsPage &&
        epoch == _bindingEpoch &&
        _scope == scope &&
        desktop.connected) {
      _composer.addContext(selected);
    }
  }

  Future<void> _openLink(String href) async {
    final desktop = widget.controller;
    final uri = Uri.tryParse(href);
    if (uri != null && {'https', 'http'}.contains(uri.scheme)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      return;
    }
    final reference = workspaceReference(href), cwd = desktop.thread?['cwd'];
    if (reference == null || cwd is! String) return;
    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => WorkspaceLinkedFilePage(
          repository: WorkspaceRepository(
            desktop.transport,
            cwd: cwd,
            threadId: desktop.thread!['id'] as String,
          ),
          path: reference.path,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.controller, _voice, ?_goal]),
    builder: (context, _) {
      final desktop = widget.controller;
      final media = MediaQuery.of(context);
      final isDraft = desktop.thread == null && widget.draft != null;
      final queuedCount = desktop.queuedDrafts.length;
      final showQueued =
          queuedCount > 0 && MediaQuery.viewInsetsOf(context).bottom == 0;
      final draftPath = desktopConversationPath(widget.draft?.cwd);
      final folderDraft =
          desktop.thread == null &&
          widget.draft?.source == DesktopDraftSource.folderChat &&
          draftPath != null;
      final draftPathReady =
          desktop.thread == null &&
          widget.draft != null &&
          draftPath != null &&
          _ownsPage &&
          !_sending;
      final draftGitReady =
          draftPathReady && desktop.runtimeReady && _gitContextReady;
      final toolbarThread = desktop.thread;
      final toolbarDraft = widget.draft;
      final toolbarGitOwner = _gitOwner;
      if (_draftToolbarOwner != toolbarGitOwner) {
        _draftToolbarOwner = toolbarGitOwner;
        _draftToolbarKey = UniqueKey();
      }
      final toolbarEpoch = _bindingEpoch;
      final toolbarMac = desktop.active?.macDeviceId;
      final toolbarPin = desktop.active?.data['macIdentityPublicKey'];
      final toolbarSession = desktop.transport.sessionId;
      final toolbarCache = desktop.threadList.data;
      final toolbarId = toolbarThread?['id'];
      final toolbarCwd = toolbarThread?['cwd'];
      bool ownsToolbarContext() =>
          mounted &&
          _ownsPage &&
          _route?.isActive == true &&
          _bindingEpoch == toolbarEpoch &&
          desktop.active?.macDeviceId == toolbarMac &&
          desktop.active?.data['macIdentityPublicKey'] == toolbarPin &&
          desktop.transport.sessionId == toolbarSession &&
          identical(desktop.threadList.data, toolbarCache) &&
          desktop.thread?['id'] == toolbarId &&
          desktop.thread?['cwd'] == toolbarCwd;
      bool ownsToolbar() => _route?.isCurrent == true && ownsToolbarContext();
      final pinnedPlan = desktopPinnedPlan(
        desktop.timeline,
        activeTurn: desktop.turnId,
      );
      AssistantCodeScope planCodeScope(DesktopPlan plan) => AssistantCodeScope(
        mac: toolbarMac,
        pin: toolbarPin as String?,
        thread: toolbarId as String?,
        item: plan.row['id'],
      );
      Widget buildInferredQuestions(
        RemoteJson row,
        DesktopPlanQuestionnaire questionnaire, {
        DesktopPlan? plan,
        MarkdownImageBuilder? imageBuilder,
        required bool Function() canContinue,
      }) {
        final intro = questionnaire.intro ?? plan?.explanation;
        return DesktopConversationMessage(
          item: row,
          text: intro ?? '',
          user: false,
          imageBuilder: imageBuilder,
          codeScope: AssistantCodeScope(
            mac: toolbarMac,
            pin: toolbarPin as String?,
            thread: toolbarId as String?,
            item: row['id'],
          ),
          onTapLink: (_, href, _) {
            if (href != null && canContinue()) unawaited(_openLink(href));
          },
          accessories: [
            if (intro != null) const SizedBox(height: 8),
            InferredPlanQuestionCard(
              key: ValueKey((
                'inferred-plan',
                _bindingEpoch,
                row['id'],
                desktopPlanBody(row),
              )),
              questions: questionnaire.questions,
              enabled: desktop.runtimeReady && canContinue(),
              onAnswer: (answers) => desktop.answerInferredPlanQuestionnaire(
                row['id'] as String,
                answers,
                canContinue: canContinue,
              ),
            ),
            if (questionnaire.outro != null) ...[
              const SizedBox(height: 8),
              Text(
                questionnaire.outro!,
                style: TextStyle(
                  fontSize: 13,
                  color: DjlColors.of(context).inkMuted,
                ),
              ),
            ],
          ],
        );
      }

      void openPlanDetails(DesktopPlan plan) {
        Widget image(Uri uri, String? title, String? alt) {
          final cwd = toolbarCwd is String ? toolbarCwd : null;
          final path = desktopMarkdownImagePath(uri.toString(), cwd: cwd);
          if (path == null || cwd == null || toolbarId is! String) {
            return Text(alt ?? title ?? 'Image');
          }
          bool current() =>
              ownsToolbarContext() &&
              desktop.timeline.any((row) => row['id'] == plan.row['id']);
          bool canLoad() =>
              current() &&
              desktop.connected &&
              desktop.state == 'connected' &&
              desktop.transport.macDeviceId == toolbarMac;
          return DesktopMarkdownImage(
            path: path,
            alt: alt ?? '',
            scope: (planCodeScope(plan), toolbarCache),
            scopeChanges: desktop,
            isCurrent: current,
            canLoad: canLoad,
            load: () async {
              if (!canLoad()) throw StateError('Image owner changed.');
              final lease = (
                desktop.transport.sessionId,
                desktop.host.connectionRevision,
              );
              final value = await WorkspaceRepository(
                desktop.transport,
                cwd: cwd,
                threadId: toolbarId,
              ).readImage(path);
              if (!canLoad() ||
                  lease !=
                      (
                        desktop.transport.sessionId,
                        desktop.host.connectionRevision,
                      )) {
                throw StateError('Image owner changed.');
              }
              return value;
            },
          );
        }

        unawaited(
          showDesktopPlanDetails(
            context,
            changes: desktop,
            readPlan: () {
              if (!ownsToolbarContext()) return null;
              final row = desktop.timeline
                  .where((row) => row['id'] == plan.row['id'])
                  .firstOrNull;
              return row == null ? null : DesktopPlan.fromRow(row);
            },
            codeScope: planCodeScope(plan),
            bodyBuilder: (sheetContext, latest) {
              final questionnaire = desktop.inferredPlanQuestionnaire(
                latest.row,
              );
              return questionnaire == null
                  ? null
                  : buildInferredQuestions(
                      latest.row,
                      questionnaire,
                      plan: latest,
                      imageBuilder: image,
                      canContinue: () =>
                          ownsToolbarContext() &&
                          ModalRoute.of(sheetContext)?.isCurrent == true,
                    );
            },
            imageBuilder: image,
            onLink: (href) {
              if (ownsToolbarContext()) unawaited(_openLink(href));
            },
          ),
        );
      }

      final savedPath = desktopConversationPath(toolbarCwd);
      final projectPath = isDraft ? draftPath : savedPath;
      final projectStatus = _gitStatusOwner == toolbarGitOwner
          ? _gitStatus
          : null;
      final projectRoutingReady =
          _projectRoutingAvailable &&
          !_gitBusy &&
          projectStatus?.isRepo == true;
      Set<int> hiddenTimelineRows() => {
        for (var i = 0; i < desktop.timeline.length; i++)
          if (desktopIsPlanItem(desktop.timeline[i]) &&
                  DesktopPlan.fromRow(desktop.timeline[i])?.inlineResult !=
                      true ||
              desktop.timeline[i].containsKey(reasoningMetadataKey) &&
                  (!desktop.reasoningRowMatchesHost(desktop.timeline[i]) ||
                      desktopTimelineEmptyReasoning(desktop.timeline[i])) ||
              desktop.timeline[i]['type'] == 'agentMessage' &&
                  desktop.usesNativePlanPresentation &&
                  desktop.timeline[i]['isStreaming'] != true &&
                  desktopProposedPlan(
                        desktopItemText(desktop.timeline[i]),
                      )?.prose.isEmpty ==
                      true)
            i,
      };
      DesktopTimelineProjection projectTimeline() {
        final facts = desktop.selectedResponseFooter;
        return projectDesktopTimeline(
          desktop.timeline,
          activities: desktop.activity.items,
          hiddenRows: hiddenTimelineRows(),
          completedTurns: {
            for (final entry in facts.outcomes.entries)
              if (entry.value == DesktopResponseOutcome.completed) entry.key,
          },
          activeTurn: desktop.turnId,
          isThreadRunning:
              _sending || desktop.turnId != null || facts.suppressesLatest,
        );
      }

      Map<int, String> projectResponseCopies([
        DesktopTimelineProjection? projection,
      ]) => desktopResponseCopies(
        desktop.timeline,
        facts: desktop.selectedResponseCopyFacts,
        sending: _sending || desktop.turnId != null,
        available: _ownsPage,
        hiddenRows: (projection ?? projectTimeline()).hiddenRows,
      );
      AssistantCodeScope responseScope(int index) => AssistantCodeScope(
        mac: desktop.active?.macDeviceId,
        pin: desktop.active?.data['macIdentityPublicKey'] as String?,
        thread: desktop.thread?['id'] as String?,
        item: (
          desktop.timeline[index]['id'],
          desktop.timeline[index]['turnId'],
          desktop.transport.sessionId,
          _bindingEpoch,
        ),
      );
      final timeline = projectTimeline();
      final responseCopies = projectResponseCopies(timeline);
      final rawFocus = widget.focusTarget?.thread == desktop.thread?['id']
          ? widget.focusTarget?.focusIndex(desktop.timeline)
          : null;
      final focusedRaw = timeline.focusRawFor(rawFocus);
      final reviewTarget = widget.focusTarget;
      final requestId = reviewTarget?.thread == desktop.thread?['id']
          ? reviewTarget?.request
          : null;
      final focusedRequest = requestId == null
          ? null
          : [
              ...desktop.pendingUserInputs,
              ...desktop.pendingApprovals,
            ].where((request) => request['id'] == requestId).firstOrNull;
      Widget requestCard(RemoteJson request, Widget child) =>
          identical(request, focusedRequest)
          ? KeyedSubtree(key: _requestFocus, child: child)
          : child;
      if (focusedRequest != null) {
        final epoch = _bindingEpoch, session = desktop.transport.sessionId;
        final stamp = (epoch, session, reviewTarget, focusedRequest);
        if (_lastRequestFocus != stamp) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted ||
                !_ownsPage ||
                _route?.isCurrent != true ||
                epoch != _bindingEpoch ||
                session != desktop.transport.sessionId ||
                widget.focusTarget != reviewTarget ||
                _lastRequestFocus == stamp ||
                ![
                  ...desktop.pendingUserInputs,
                  ...desktop.pendingApprovals,
                ].any((request) => identical(request, focusedRequest))) {
              return;
            }
            final targetContext = _requestFocus.currentContext;
            if (targetContext == null) return;
            _lastRequestFocus = stamp;
            unawaited(Scrollable.ensureVisible(targetContext, alignment: .05));
          });
        }
      }

      final idleEmpty =
          desktop.timeline.isEmpty &&
          (desktop.thread != null || widget.draft != null) &&
          desktop.connected &&
          desktop.state == 'connected' &&
          !desktop.busy &&
          !_sending &&
          desktop.turnId == null &&
          desktop.pendingUserInputs.isEmpty &&
          desktop.pendingApprovals.isEmpty &&
          desktop.error == null &&
          desktop.navigationError == null &&
          _voice.error == null &&
          widget.focusTarget?.hasFocus != true;
      // Keep oversized accessibility content scrollable above the keyboard.
      final composerMaxHeight =
          (media.size.height -
                  media.viewInsets.bottom -
                  media.padding.vertical -
                  kToolbarHeight)
              .clamp(0.0, double.infinity) *
          .8;
      final page = Scaffold(
        appBar: AppBar(
          centerTitle: true,
          clipBehavior: Clip.none,
          leadingWidth: 64,
          leading: Padding(
            padding: const EdgeInsetsDirectional.only(start: 16),
            child: Center(
              child: DjlGlassSurface(
                radius: 22,
                child: IconButton(
                  tooltip: 'Open navigation',
                  onPressed: () => _drawer.currentState?.toggle(),
                  constraints: const BoxConstraints.tightFor(
                    width: 44,
                    height: 44,
                  ),
                  icon: SizedBox(
                    width: 20,
                    height: 14,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          height: 2,
                          width: 20,
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.onSurface,
                            borderRadius: BorderRadius.circular(1),
                          ),
                        ),
                        const SizedBox(height: 5),
                        Container(
                          height: 2,
                          width: 10,
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.onSurface,
                            borderRadius: BorderRadius.circular(1),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          toolbarHeight: (media.textScaler.scale(30) + 1).clamp(
            44.0,
            double.infinity,
          ),
          title: DesktopConversationTitle(
            onTap: toolbarThread != null && savedPath != null && ownsToolbar()
                ? () => _openThreadLocation(
                    toolbarThread,
                    (toolbarCwd as String).trim(),
                    ownsToolbarContext,
                  )
                : folderDraft &&
                      _ownsPage &&
                      desktop.runtimeReady &&
                      !desktop.busy
                ? _chooseDraftProject
                : null,
            accessibilityHint: toolbarThread != null && savedPath != null
                ? 'Opens thread location'
                : null,
            subtitle: desktop.thread != null
                ? desktopConversationFolder(desktop.thread)
                : draftPath != null
                ? desktopConversationPathLabel(draftPath)
                : widget.draft == null
                ? null
                : desktop.selectedDeviceName,
            title: desktop.thread == null
                ? (widget.draft == null ? 'Desktop chat' : 'New thread')
                : desktop.titleOf(desktop.thread!),
          ),
          actions: [
            if (isDraft)
              DesktopDraftActions(
                key: _draftToolbarKey,
                showGit: draftPath != null,
                gitStatus: _gitContextReady && _gitStatusOwner == _gitOwner
                    ? _gitStatus
                    : null,
                gitBusy: _gitStatusOwner == _gitOwner && _gitBusy,
                onGit: draftGitReady
                    ? (buttonContext) {
                        final draft = toolbarDraft;
                        if (_gitOwner == toolbarGitOwner &&
                            identical(widget.draft, draft) &&
                            draft != null &&
                            desktop.thread == null &&
                            desktop.isCurrentNewChatDraft(draft) &&
                            desktopConversationPath(draft.cwd) != null) {
                          unawaited(_openGit(buttonContext, draft.cwd!));
                        }
                      }
                    : null,
                onGitTools: draftGitReady
                    ? () {
                        final draft = toolbarDraft;
                        if (_gitOwner == toolbarGitOwner &&
                            identical(widget.draft, draft) &&
                            draft != null &&
                            desktop.thread == null &&
                            desktop.isCurrentNewChatDraft(draft)) {
                          _openGitTools(draft.cwd!);
                        }
                      }
                    : null,
              )
            else
              DesktopToolbarActions(
                showGit: savedPath != null,
                gitStatus: _gitContextReady && _gitStatusOwner == _gitOwner
                    ? _gitStatus
                    : null,
                gitBusy: _gitStatusOwner == _gitOwner && _gitBusy,
                onGit: _gitContextReady && savedPath != null && ownsToolbar()
                    ? (buttonContext) {
                        if (ownsToolbar()) {
                          unawaited(
                            _openGit(buttonContext, toolbarCwd as String),
                          );
                        }
                      }
                    : null,
                threadActions: DesktopThreadMenu(
                  enabled: toolbarThread != null,
                  isCurrent: ownsToolbar,
                  onSelected: (action) async {
                    if (!ownsToolbar()) return;
                    final selected = toolbarThread;
                    if (selected == null) return;
                    if (action == 'worktree-handoff' ||
                        action == 'worktree-fork') {
                      await _openWorktreeFlow(
                        action == 'worktree-handoff'
                            ? WorktreeFlowMode.handoff
                            : WorktreeFlowMode.fork,
                      );
                      return;
                    }
                    if (action == 'handoff') {
                      await confirmHostContinue(
                        context,
                        desktop.host,
                        selected['id'] as String,
                        isCurrent: ownsToolbar,
                      );
                      return;
                    }
                    if (action == 'refresh') {
                      try {
                        await desktop.openThread(
                          selected,
                          readOnlyNavigation: true,
                          isCurrent: ownsToolbar,
                        );
                      } catch (_) {
                        // The controller presents the history read failure.
                      }
                      return;
                    }
                    if (action == 'new-chat') {
                      _newMenuChat(
                        cwd: savedPath == null ? null : toolbarCwd as String,
                      );
                      return;
                    }
                    if (localThreadActions.contains(action)) {
                      await performDesktopThreadAction(
                        context,
                        desktop,
                        selected,
                        action,
                        isCurrent: ownsToolbar,
                        closeChat: () {
                          if (mounted) Navigator.pop(context);
                        },
                      );
                      return;
                    }
                    if (action == 'goal') {
                      await _openGoal();
                      return;
                    }
                    if (action == 'fork-current' || action == 'fork-folder') {
                      await _fork(chooseFolder: action == 'fork-folder');
                      return;
                    }
                    final cwd = selected['cwd'];
                    if (!desktop.connected || cwd is! String) return;
                    if (action == 'git-tools') {
                      _openGitTools(cwd);
                      return;
                    }
                    if (action == 'files' || action == 'checkpoints') {
                      final repository = WorkspaceRepository(
                        desktop.transport,
                        cwd: cwd,
                        threadId: desktop.thread!['id'] as String,
                      );
                      final turns = (desktop.thread!['turns'] as List? ?? [])
                          .map((t) => (t as Map)['id'])
                          .whereType<String>()
                          .toList();
                      Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => action == 'files'
                              ? WorkspaceFilePage(repository: repository)
                              : CheckpointPage(
                                  repository: repository,
                                  desktop: desktop,
                                  turns: turns,
                                ),
                        ),
                      );
                    }
                  },
                  primaryBuilder: (_) => [
                    PopupMenuItem(
                      value: 'handoff',
                      enabled: ownsToolbar() && desktop.host.canHandoff,
                      child: const DesktopThreadMenuLabel(
                        title: 'Hand off to Desktop',
                        icon: DjlIcons.swap,
                      ),
                    ),
                    PopupMenuItem(
                      value: 'worktree-handoff',
                      enabled:
                          ownsToolbar() &&
                          _gitContextReady &&
                          savedPath != null &&
                          desktop.runtimeReady &&
                          desktop.turnId == null &&
                          !_sending &&
                          _worktreeFlow == null,
                      child: WorktreeMenuLabel(
                        title: isManagedWorktreePath(toolbarCwd)
                            ? 'Hand off to Local'
                            : 'Hand off to Worktree',
                      ),
                    ),
                    PopupMenuItem(
                      value: 'new-chat',
                      enabled: ownsToolbar() && desktop.runtimeReady,
                      child: const DesktopThreadMenuLabel(
                        title: 'New chat',
                        icon: DjlIcons.compose,
                      ),
                    ),
                  ],
                  secondaryBuilder: (_) => [
                    PopupMenuItem(value: 'goal', child: const Text('Goal')),
                    PopupMenuItem(
                      value: 'fork-current',
                      enabled: desktop.runtimeReady && desktop.supportsFork,
                      child: const Text('Fork this chat'),
                    ),
                    PopupMenuItem(
                      value: 'fork-folder',
                      enabled: desktop.runtimeReady && desktop.supportsFork,
                      child: const Text('Fork into another folder'),
                    ),
                    PopupMenuItem(
                      value: 'worktree-fork',
                      enabled:
                          ownsToolbar() &&
                          _gitContextReady &&
                          savedPath != null &&
                          desktop.runtimeReady &&
                          desktop.supportsFork &&
                          desktop.turnId == null &&
                          !_sending &&
                          _worktreeFlow == null,
                      child: const WorktreeMenuLabel(
                        title: 'Fork into new worktree',
                        fork: true,
                      ),
                    ),
                    const PopupMenuDivider(),
                    PopupMenuItem(
                      value: 'git-tools',
                      enabled:
                          ownsToolbar() &&
                          _gitContextReady &&
                          savedPath != null,
                      child: const Text('Branches & worktrees'),
                    ),
                    PopupMenuItem(
                      value: 'files',
                      enabled:
                          desktop.connected && desktop.thread?['cwd'] is String,
                      child: const Text('Workspace files'),
                    ),
                    PopupMenuItem(
                      value: 'checkpoints',
                      enabled:
                          desktop.connected && desktop.thread?['cwd'] is String,
                      child: const Text('Turn changes and restore'),
                    ),
                    PopupMenuItem(
                      value: 'refresh',
                      enabled: ownsToolbar() && desktop.connected,
                      child: const Text('Refresh from desktop'),
                    ),
                    const PopupMenuDivider(),
                    if (toolbarThread != null)
                      ...desktopThreadActions(desktop, toolbarThread),
                  ],
                ),
              ),
          ],
        ),
        body: SafeArea(
          child: LayoutBuilder(
            builder: (context, bodyConstraints) => Column(
              children: [
                if (_voice.error != null)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(_voice.error!),
                  ),
                if (widget.focusTarget?.thread == desktop.thread?['id'] &&
                    desktop.navigationError != null)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(desktop.navigationError!),
                  ),
                if (!desktop.connected)
                  MaterialBanner(
                    content: Text(
                      desktop.error ??
                          'Desktop disconnected. Your message has not been resent.',
                    ),
                    actions: [
                      TextButton(
                        onPressed: desktop.reconnect,
                        child: const Text('Reconnect'),
                      ),
                    ],
                  ),
                if (widget.focusTarget?.hasFocus == true &&
                    widget.focusTarget?.thread == desktop.thread?['id'] &&
                    timeline.renderIndexFor(rawFocus) == null &&
                    focusedRequest == null)
                  const Padding(
                    padding: EdgeInsets.all(8),
                    child: Text(
                      'Linked position is not available in the loaded history.',
                    ),
                  ),
                Expanded(
                  child: idleEmpty
                      ? DesktopConversationHero(
                          draft: desktop.thread == null,
                          generalDraft:
                              desktop.thread == null &&
                              widget.draft?.source ==
                                  DesktopDraftSource.generalChat,
                          folderPicker:
                              isDraft &&
                                  widget.draft?.source ==
                                      DesktopDraftSource.generalChat &&
                                  draftPath != null
                              ? _draftFolderPicker()
                              : null,
                          folder: desktop.thread != null
                              ? desktopConversationFolder(desktop.thread)
                              : draftPath == null
                              ? null
                              : desktopConversationPathLabel(draftPath),
                        )
                      : DesktopFocusTimeline(
                          key: ValueKey((
                            _boundMac,
                            _boundPin,
                            _boundThread,
                            _boundDraft,
                            widget.focusTarget,
                          )),
                          followRevision: _timelineSendRevision,
                          tailAnchor: timeline.renderIndexFor(
                            desktop.timeline.lastIndexWhere(
                              (row) => row['type'] == 'userMessage',
                            ),
                          ),
                          target: timeline.renderIndexFor(rawFocus),
                          count: timeline.items.length,
                          itemBuilder: (context, renderIndex) {
                            final entry = timeline.items[renderIndex];
                            final index = entry.accessoryHost;
                            final copy =
                                entry.kind == DesktopTimelineKind.previous
                                ? null
                                : responseCopies[index];
                            final scope = copy == null
                                ? null
                                : responseScope(index);
                            Widget buildRow(int index) {
                              final item = desktop.timeline[index];
                              final type = item['type'];
                              final user = type == 'userMessage';
                              final review = isGuardianRow(item)
                                  ? GuardianReview.fromRow(item)
                                  : null;
                              if (review != null) {
                                return GuardianReviewCard(
                                  key: ValueKey(item['id']),
                                  review: review,
                                  onRetry: () => desktop.approveGuardianRetry(
                                    item['threadId'] as String? ??
                                        desktop.thread!['id'] as String,
                                    review.reviewId,
                                  ),
                                );
                              }
                              final subagent = SubagentAction.decode(
                                item,
                                mac: desktop.active?.macDeviceId ?? '',
                                thread: desktop.thread?['id'] as String? ?? '',
                                turn: subagentString(item['turnId']) ?? '',
                              );
                              if (subagent != null) {
                                return SubagentActionCard(
                                  key: ValueKey(subagent.id),
                                  action:
                                      desktop.subagents.items[subagent.id] ??
                                      subagent,
                                  changes: desktop,
                                  resolve: desktop.resolvedSubagent,
                                  metadataState: desktop.subagentMetadataState,
                                  hydrate: () =>
                                      desktop.hydrateSubagents(subagent),
                                  onOpen: (child) =>
                                      desktop.openSubagent(subagent, child),
                                );
                              }
                              final savedActivity = DesktopActivity.fromRow(
                                item,
                              );
                              if (savedActivity != null) {
                                final activity =
                                    timeline.activityOverrides[index] ??
                                    desktop.activity.items[savedActivity.id] ??
                                    savedActivity;
                                final cwd =
                                    activity.cwd ??
                                    activityString(desktop.thread?['cwd']);
                                return ActivityCard(
                                  key: ValueKey(activity.id),
                                  activity: activity,
                                  changes: desktop,
                                  onOpenFile: cwd == null
                                      ? null
                                      : (path, image) {
                                          if (!desktop.connected ||
                                              desktop.transport.macDeviceId !=
                                                  activity.mac ||
                                              desktop.active?.macDeviceId !=
                                                  activity.mac ||
                                              desktop.thread?['id'] !=
                                                  activity.thread) {
                                            ScaffoldMessenger.of(
                                              context,
                                            ).showSnackBar(
                                              const SnackBar(
                                                content: Text(
                                                  'Reopen the activity from its paired workspace to preview this file.',
                                                ),
                                              ),
                                            );
                                            return;
                                          }
                                          final resolved =
                                              activityWorkspacePath(
                                                path,
                                                cwd: cwd,
                                              );
                                          if (resolved == null) return;
                                          Navigator.push(
                                            context,
                                            MaterialPageRoute<void>(
                                              fullscreenDialog: true,
                                              builder: (_) =>
                                                  WorkspaceLinkedFilePage(
                                                    repository:
                                                        WorkspaceRepository(
                                                          desktop.transport,
                                                          cwd: cwd,
                                                          threadId:
                                                              activity.thread,
                                                        ),
                                                    path: resolved,
                                                  ),
                                            ),
                                          );
                                        },
                                );
                              }
                              if (item.containsKey(reasoningMetadataKey)) {
                                if (!desktop.reasoningRowMatchesHost(item)) {
                                  return const SizedBox.shrink();
                                }
                                return ThinkingTimelineRow(
                                  key: ValueKey(item['id']),
                                  messageId: item['id'] as String,
                                  text: DesktopReasoning.fromRow(item)!.text,
                                );
                              }
                              final text = desktopItemText(item);
                              final inferred = desktop
                                  .inferredPlanQuestionnaire(item);
                              if (type == 'systemMessage') {
                                return Padding(
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 2,
                                  ),
                                  child: SelectableText(
                                    text,
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: DjlColors.of(context).inkMuted,
                                    ),
                                  ),
                                );
                              }
                              final nativePlan = DesktopPlan.fromRow(item);
                              final envelope =
                                  !user && item['isStreaming'] != true
                                  ? desktopProposedPlan(text)
                                  : null;
                              final assistantPlan = envelope == null
                                  ? null
                                  : desktop.responsePlanProposal(item);
                              final displayText = envelope?.prose ?? text;
                              if (!{
                                    'agentMessage',
                                    'userMessage',
                                  }.contains(type) &&
                                  nativePlan?.inlineResult != true &&
                                  inferred == null) {
                                return ExpansionTile(
                                  leading: const Icon(DjlIcons.tool, size: 18),
                                  title: Text(
                                    activityString(type) ?? 'Activity',
                                  ),
                                  children: [
                                    Padding(
                                      padding: const EdgeInsets.all(12),
                                      child: SelectableText(text),
                                    ),
                                  ],
                                );
                              }
                              final imageEpoch = _bindingEpoch,
                                  imageScope = _scope,
                                  imagePin =
                                      desktop
                                              .active
                                              ?.data['macIdentityPublicKey']
                                          as String?,
                                  imageData = desktop.threadList.data;
                              bool currentImage() =>
                                  mounted &&
                                  _ownsPage &&
                                  identical(widget.controller, desktop) &&
                                  imageScope.mac != null &&
                                  imageScope.thread != null &&
                                  imagePin != null &&
                                  desktop.trusted.any(
                                    (pair) =>
                                        pair.macDeviceId == imageScope.mac &&
                                        pair.data['macIdentityPublicKey'] ==
                                            imagePin,
                                  ) &&
                                  imageEpoch == _bindingEpoch &&
                                  imageScope == _scope &&
                                  imagePin ==
                                      desktop
                                          .active
                                          ?.data['macIdentityPublicKey'] &&
                                  identical(
                                    imageData,
                                    desktop.threadList.data,
                                  ) &&
                                  item['id'] != null &&
                                  desktop.timeline.any(
                                    (row) => row['id'] == item['id'],
                                  );
                              bool canReadImage() =>
                                  currentImage() &&
                                  desktop.connected &&
                                  desktop.state == 'connected' &&
                                  imageScope.cwd?.startsWith('/') == true &&
                                  desktop.transport.macDeviceId ==
                                      imageScope.mac &&
                                  desktop.threadList.macDeviceId ==
                                      imageScope.mac;
                              Widget buildImage(
                                Uri uri,
                                String? title,
                                String? alt,
                              ) {
                                final path = desktopMarkdownImagePath(
                                  uri.toString(),
                                  cwd: imageScope.cwd,
                                );
                                if (path == null) {
                                  return Text(alt ?? title ?? 'Image');
                                }
                                return DesktopMarkdownImage(
                                  path: path,
                                  alt: alt ?? '',
                                  scope: (
                                    AssistantCodeScope(
                                      mac: imageScope.mac,
                                      pin: imagePin,
                                      thread: imageScope.thread,
                                      item: (
                                        item['id'],
                                        item['turnId'],
                                        imageEpoch,
                                      ),
                                    ),
                                    imageData,
                                  ),
                                  scopeChanges: desktop,
                                  isCurrent: currentImage,
                                  canLoad: canReadImage,
                                  load: () async {
                                    if (!canReadImage()) {
                                      throw StateError('Image owner changed.');
                                    }
                                    final lease = (
                                      desktop.transport.sessionId,
                                      desktop.host.connectionRevision,
                                    );
                                    final result = await WorkspaceRepository(
                                      desktop.transport,
                                      cwd: imageScope.cwd!,
                                      threadId: imageScope.thread!,
                                    ).readImage(path);
                                    if (!canReadImage() ||
                                        lease !=
                                            (
                                              desktop.transport.sessionId,
                                              desktop.host.connectionRevision,
                                            )) {
                                      throw StateError('Image owner changed.');
                                    }
                                    return result;
                                  },
                                );
                              }

                              if (inferred != null) {
                                final content = buildInferredQuestions(
                                  item,
                                  inferred,
                                  plan: nativePlan,
                                  imageBuilder: buildImage,
                                  canContinue: ownsToolbar,
                                );
                                return nativePlan == null
                                    ? content
                                    : DesktopPlanDetailsCard(
                                        plan: nativePlan,
                                        body: content,
                                      );
                              }
                              final media = user
                                  ? (
                                      markdown: text,
                                      images:
                                          const <
                                            DesktopMarkdownImageReference
                                          >[],
                                    )
                                  : desktopMarkdownMedia(
                                      displayText,
                                      cwd: imageScope.cwd,
                                    );
                              if (nativePlan case final plan?
                                  when plan.inlineResult) {
                                return DesktopPlanResultCard(
                                  key: ValueKey(item['id']),
                                  plan: plan,
                                  codeScope: planCodeScope(plan),
                                  proposed: plan.presentation == 'resultReady',
                                  imageBuilder: buildImage,
                                  onLink: (href) {
                                    if (ownsToolbarContext()) {
                                      unawaited(_openLink(href));
                                    }
                                  },
                                  onImplement:
                                      desktop.canImplementPlan(
                                        item['id'] as String,
                                        plan.body,
                                      )
                                      ? () => desktop.implementPlan(
                                          item['id'] as String,
                                          body: plan.body,
                                          canContinue: ownsToolbar,
                                        )
                                      : null,
                                );
                              }
                              return DesktopConversationMessage(
                                key: ValueKey(item['id']),
                                item: item,
                                text: media.markdown,
                                user: user,
                                imageBuilder: buildImage,
                                trailingImages: [
                                  for (final image in media.images)
                                    buildImage(
                                      Uri.file(image.path),
                                      null,
                                      image.alt,
                                    ),
                                ],
                                codeScope: AssistantCodeScope(
                                  mac: desktop.active?.macDeviceId,
                                  pin:
                                      desktop
                                              .active
                                              ?.data['macIdentityPublicKey']
                                          as String?,
                                  thread: desktop.thread?['id'] as String?,
                                  item: item['id'],
                                ),
                                onTapLink: (_, href, _) {
                                  if (href != null) unawaited(_openLink(href));
                                },
                                accessories: [
                                  if (assistantPlan != null)
                                    DesktopPlanResultCard(
                                      key: ValueKey((
                                        'assistant-plan',
                                        item['id'],
                                      )),
                                      plan: assistantPlan,
                                      codeScope: planCodeScope(assistantPlan),
                                      imageBuilder: buildImage,
                                      onLink: (href) {
                                        if (ownsToolbarContext()) {
                                          unawaited(_openLink(href));
                                        }
                                      },
                                      onImplement:
                                          desktop.canImplementPlan(
                                            item['id'] as String,
                                            assistantPlan.body,
                                          )
                                          ? () => desktop.implementPlan(
                                              item['id'] as String,
                                              body: assistantPlan.body,
                                              canContinue: ownsToolbar,
                                            )
                                          : null,
                                    ),
                                  if (!user &&
                                      item['id'] is String &&
                                      desktop.responseChangesFor(
                                            item['id'] as String,
                                          ) !=
                                          null)
                                    Builder(
                                      builder: (context) {
                                        final changes = desktop
                                            .responseChangesFor(
                                              item['id'] as String,
                                            )!;
                                        if (changes.evidence.isEmpty &&
                                            changes.aggregate == null &&
                                            changes.batches.isEmpty &&
                                            changes
                                                .incompleteOperations
                                                .isEmpty) {
                                          return const SizedBox.shrink();
                                        }
                                        final reason = desktop
                                            .responseUndoBlocked(changes);
                                        return Tooltip(
                                          message:
                                              reason ??
                                              'Review exact response changes',
                                          child: TextButton.icon(
                                            icon: const Icon(
                                              DjlIcons.undo,
                                              size: 18,
                                            ),
                                            label: Text(
                                              changes.reverted
                                                  ? 'Response undone'
                                                  : 'Undo this response',
                                            ),
                                            onPressed: reason != null
                                                ? null
                                                : () async {
                                                    final controller =
                                                        await desktop
                                                            .responseUndo(
                                                              item['id']
                                                                  as String,
                                                            );
                                                    final overlap = desktop
                                                        .responseUndoOverlap(
                                                          changes,
                                                        );
                                                    if (!context.mounted ||
                                                        controller == null) {
                                                      controller?.dispose();
                                                      return;
                                                    }
                                                    try {
                                                      await showModalBottomSheet<
                                                        void
                                                      >(
                                                        context: context,
                                                        isScrollControlled:
                                                            true,
                                                        builder: (_) =>
                                                            ResponseUndoSheet(
                                                              controller:
                                                                  controller,
                                                              overlap: overlap,
                                                              scope: desktop,
                                                            ),
                                                      );
                                                    } finally {
                                                      controller.dispose();
                                                    }
                                                  },
                                          ),
                                        );
                                      },
                                    ),
                                ],
                              );
                            }

                            final footer = copy == null
                                ? null
                                : DesktopResponseFooter(
                                    scope: scope!,
                                    text: copy,
                                    readText: () {
                                      if (!mounted ||
                                          !_ownsPage ||
                                          index >= desktop.timeline.length ||
                                          responseScope(index) != scope) {
                                        return null;
                                      }
                                      return projectResponseCopies()[index];
                                    },
                                  );
                            if (entry.kind != DesktopTimelineKind.message) {
                              final first =
                                  entry.kind == DesktopTimelineKind.previous
                                  ? entry.finalIndex!
                                  : entry.indices.first;
                              return DesktopTimelineGroup(
                                key: ValueKey((
                                  'timeline-group',
                                  _bindingEpoch,
                                  entry.kind,
                                  desktop.timeline[first]['id'] ?? first,
                                )),
                                item: entry,
                                itemBuilder: (_, rawIndex) =>
                                    buildRow(rawIndex),
                                focusedRawIndex:
                                    timeline.renderIndexFor(rawFocus) ==
                                        renderIndex
                                    ? entry.indices
                                          .where(
                                            (index) => index <= focusedRaw!,
                                          )
                                          .lastOrNull
                                    : null,
                                footer: footer,
                              );
                            }
                            return Column(
                              key: ValueKey((
                                'response-row',
                                desktop.timeline[index]['id'] ?? index,
                              )),
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [buildRow(index), ?footer],
                            );
                          },
                        ),
                ),
                if (desktop.pendingUserInputs.isNotEmpty ||
                    desktop.pendingApprovals.isNotEmpty)
                  Flexible(
                    child: SingleChildScrollView(
                      child: Column(
                        children: [
                          for (final request in desktop.pendingUserInputs)
                            requestCard(
                              request,
                              StructuredQuestionCard(
                                key: ValueKey((
                                  desktop.active?.macDeviceId,
                                  desktop.active?.sessionId,
                                  (request['params'] as Map?)?['turnId'],
                                  request['id'],
                                )),
                                request: request,
                                enabled:
                                    desktop.runtimeReady &&
                                    desktop.requestMatchesConnection(request),
                                submitted:
                                    request['_submitted'] == true ||
                                    request['_submitting'] == true,
                                responseUnknown:
                                    request['_responseUnknown'] == true,
                                cancelling: desktop.isClosingQuestion(request),
                                onAnswer: (answers) =>
                                    desktop.answer(request, answers),
                                onCancel: () => _cancelQuestion(request),
                              ),
                            ),
                          for (final request in desktop.pendingApprovals)
                            requestCard(
                              request,
                              Card(
                                margin: const EdgeInsets.all(12),
                                child: Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'Approval required',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      switch (request['params']) {
                                        {'command': final String command}
                                            when command.isNotEmpty =>
                                          Container(
                                            width: double.infinity,
                                            padding: const EdgeInsets.all(8),
                                            decoration: BoxDecoration(
                                              color: CupertinoColors
                                                  .quaternarySystemFill
                                                  .resolveFrom(context),
                                              borderRadius:
                                                  BorderRadius.circular(8),
                                            ),
                                            child: SelectableText(
                                              command,
                                              style: TextStyle(
                                                fontFamily: DjlAppearance.of(
                                                  context,
                                                ).font.codeFamily,
                                              ),
                                            ),
                                          ),
                                        {'reason': final String reason}
                                            when reason.isNotEmpty =>
                                          SelectableText(reason),
                                        _ => SelectableText(
                                          request['method'] as String,
                                        ),
                                      },
                                      if (request['_submitted'] == true)
                                        const Text(
                                          'Response sent. Waiting for the desktop.',
                                        ),
                                      Wrap(
                                        spacing: 12,
                                        children: [
                                          OutlinedButton(
                                            onPressed:
                                                !desktop.canRespond(request)
                                                ? null
                                                : () => desktop.approve(
                                                    request,
                                                    'decline',
                                                  ),
                                            child: const Text('Decline'),
                                          ),
                                          FilledButton(
                                            onPressed:
                                                !desktop.canRespond(request)
                                                ? null
                                                : () => desktop.approve(
                                                    request,
                                                    'accept',
                                                  ),
                                            child: const Text('Approve once'),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                if (desktop.error != null && desktop.connected)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      desktop.error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                // Keep the existing bottom controls together when accessibility
                // text and the keyboard leave less room than their natural height.
                if (desktop.pendingUserInputs.isEmpty)
                  ConstrainedBox(
                    key: const Key('desktop_bottom_controls'),
                    constraints: BoxConstraints(
                      maxHeight: bodyConstraints.maxHeight * .8,
                    ),
                    child: SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (projectPath != null ||
                              pinnedPlan != null ||
                              _goal?.goal != null ||
                              showQueued)
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 4,
                              ),
                              child: Row(
                                children: [
                                  if (projectPath != null)
                                    DesktopProjectControls(
                                      key: ValueKey((
                                        toolbarGitOwner,
                                        _navigationOpen,
                                      )),
                                      branchLabel: projectStatus?.isRepo == true
                                          ? projectStatus?.branch ?? 'Branch'
                                          : null,
                                      worktree:
                                          !isDraft &&
                                          isManagedWorktreePath(projectPath),
                                      branchEnabled: projectRoutingReady,
                                      handoffEnabled: projectRoutingReady,
                                      handoffLabel: _worktreeFlow != null
                                          ? 'Preparing worktree...'
                                          : !isDraft &&
                                                isManagedWorktreePath(
                                                  projectPath,
                                                )
                                          ? 'Hand off to Local'
                                          : isDraft
                                          ? 'New worktree'
                                          : 'Hand off to Worktree',
                                      onExpand: () {
                                        if (_gitOwner == toolbarGitOwner &&
                                            ownsToolbar()) {
                                          _readProjectStatus();
                                        }
                                      },
                                      onBranch: (anchor) {
                                        if (_gitOwner == toolbarGitOwner &&
                                            ownsToolbar()) {
                                          _openComposerGit(
                                            anchor,
                                            GitComposerAction.branch,
                                          );
                                        }
                                      },
                                      onHandoff: () {
                                        if (_gitOwner != toolbarGitOwner ||
                                            !ownsToolbar()) {
                                          return;
                                        }
                                        if (isDraft) {
                                          _openComposerGit(
                                            context,
                                            GitComposerAction.worktree,
                                          );
                                        } else {
                                          _openWorktreeFlow(
                                            WorktreeFlowMode.handoff,
                                          );
                                        }
                                      },
                                    ),
                                  if (pinnedPlan != null) ...[
                                    if (projectPath != null)
                                      const SizedBox(width: 6),
                                    Flexible(
                                      child: DesktopPlanAccessory(
                                        plan: pinnedPlan,
                                        onTap: () =>
                                            openPlanDetails(pinnedPlan),
                                      ),
                                    ),
                                  ],
                                  if (showQueued) ...[
                                    if (projectPath != null)
                                      const SizedBox(width: 6),
                                    Flexible(
                                      child: DesktopQueuedStatus(
                                        count: queuedCount,
                                        onTap: _openQueuedDrafts,
                                      ),
                                    ),
                                  ],
                                  if (_goal?.goal != null)
                                    Expanded(
                                      child: Align(
                                        alignment: Alignment.centerRight,
                                        child: ActionChip(
                                          avatar: const Icon(
                                            DjlIcons.goal,
                                            size: 18,
                                          ),
                                          label: Text(
                                            'Goal ${_goal!.goal!.status.label.toLowerCase()} · ${_goal!.elapsed(running: desktop.turnId != null)}',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                          onPressed: () => _openGoal(),
                                        ),
                                      ),
                                    )
                                  else
                                    const Spacer(),
                                ],
                              ),
                            ),
                          if (desktop.subagentParent case final parent?)
                            Tooltip(
                              message: 'Return to parent chat',
                              child: TextButton.icon(
                                onPressed: desktop.returnToSubagentParent,
                                icon: const Icon(DjlIcons.arrowBendLeft),
                                label: Text(
                                  'Return to ${desktop.titleOf(parent)}',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ConstrainedBox(
                            key: const Key('desktop_composer_viewport'),
                            constraints: BoxConstraints(
                              maxHeight: composerMaxHeight,
                            ),
                            child: SingleChildScrollView(
                              child: DesktopComposerPanel(
                                controller: _text,
                                focusRequest:
                                    _questionComposerFocus?.owner ==
                                            _gitOwner &&
                                        _route?.isCurrent == true &&
                                        !_navigationOpen
                                    ? _questionComposerFocus?.request
                                    : null,
                                autofocus: widget.draft != null,
                                placeholder: desktop.timeline.isEmpty
                                    ? 'Ask DJL'
                                    : 'Follow up',
                                hasAccessories:
                                    _composer.slots.isNotEmpty ||
                                    _composer.contexts.isNotEmpty ||
                                    _composer.contextScopeError != null ||
                                    desktop.plan ||
                                    (desktop.supportsFastMode &&
                                        desktop.serviceTier == 'fast'),
                                accessories: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    DesktopComposerAttachments(
                                      controller: _composer,
                                    ),
                                    if (desktop.plan ||
                                        (desktop.supportsFastMode &&
                                            desktop.serviceTier == 'fast'))
                                      Wrap(
                                        spacing: 6,
                                        children: [
                                          if (desktop.plan)
                                            const Chip(
                                              label: Text('Plan mode'),
                                            ),
                                          if (desktop.supportsFastMode &&
                                              desktop.serviceTier == 'fast')
                                            const Chip(
                                              label: Text('Fast mode'),
                                            ),
                                        ],
                                      ),
                                  ],
                                ),
                                options: _composerOptions(),
                                runtimeControl: _runtimeControl(),
                                accessControl: _accessControl(),
                                onVoice: () {
                                  if (_voice.listening) {
                                    _voice.stop();
                                  } else {
                                    _voice.start(_text.text);
                                  }
                                },
                                listening: _voice.listening,
                                voiceInitializing: _voice.initializing,
                                starting: _sending && desktop.turnId == null,
                                stoppingTurn: desktop.stoppingTurn,
                                queuePaused:
                                    desktop.queuePauseMessage != null &&
                                    queuedCount > 0,
                                onResumeQueued: desktop.queuedActionInProgress
                                    ? null
                                    : () {
                                        if (_ownsPage) {
                                          unawaited(
                                            desktop.resumeQueuedDrafts(),
                                          );
                                        }
                                      },
                                onSend:
                                    !desktop.connected ||
                                        desktop.busy ||
                                        desktop.projectMoveBusy ||
                                        _worktreeFlow != null ||
                                        _sending ||
                                        !_composer.canSend
                                    ? null
                                    : _send,
                                onStop:
                                    desktop.canStopTurn || desktop.stoppingTurn
                                    ? () {
                                        if (_ownsPage &&
                                            _gitOwner == toolbarGitOwner) {
                                          unawaited(desktop.stop());
                                        }
                                      }
                                    : null,
                              ),
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
      );
      return PopScope(
        canPop: !_navigationOpen && desktop.subagentParent == null,
        onPopInvokedWithResult: (didPop, result) {
          if (didPop) {
            _closeDraft();
          } else if (_navigationOpen) {
            _drawer.currentState?.close();
          } else if (desktop.subagentParent != null) {
            desktop.returnToSubagentParent();
          }
        },
        child: DesktopPhoneDrawer(
          key: _drawer,
          handlesBack: false,
          onChanged: (open) => setState(() => _navigationOpen = open),
          menu: DesktopNavigationMenu(
            controller: desktop,
            visible: _navigationOpen,
            runStatus: widget.runStatus,
            selectedThreadId: desktop.thread?['id'] as String?,
            isCurrent: () => _canNavigateMenu,
            onThread: _menuThread,
            onReview: () => _drawer.currentState?.close(),
            onNewChat: _newMenuChat,
            onRemote: _menuRemote,
            onSettings: widget.onSettings,
            onCloud: widget.onCloud == null
                ? null
                : () {
                    if (!_canNavigateMenu) return;
                    _drawer.currentState?.close();
                    _closeDraft();
                    widget.onCloud!();
                  },
          ),
          child: page,
        ),
      );
    },
  );
}
