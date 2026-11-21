import 'dart:async';
import 'dart:convert';
import '../../reasoning/domain/desktop_reasoning.dart';
import '../../plans/domain/desktop_plan.dart';
import '../../plans/domain/desktop_plan_questionnaire.dart';
import 'package:uuid/uuid.dart';
import '../../../app/desktop_deep_link.dart';
import 'package:flutter/foundation.dart';
import '../../../core/security/remote_crypto.dart';
import '../../pairing/data/pairing_repository.dart';
import '../data/remote_transport.dart';
import '../data/desktop_local_store.dart';
import '../domain/thread_local_state.dart';
import '../domain/desktop_overview.dart';
import '../domain/desktop_worktree_routing.dart';
import '../domain/desktop_response_footer.dart';
import '../domain/desktop_attention.dart';
import '../domain/desktop_composer.dart';
import '../domain/desktop_history_reconcile.dart';
import '../domain/desktop_queued_draft.dart';
import 'desktop_threads_controller.dart';
import '../domain/desktop_contract.dart';
import '../../workspace/data/workspace_repository.dart';
import '../../workspace/data/turn_checkpoints.dart';
import '../../workspace/domain/response_change_set.dart';
import '../../workspace/presentation/response_undo_controller.dart';
import '../../settings/presentation/settings_controller.dart';
import '../../settings/presentation/paired_usage_controller.dart';
import '../../settings/domain/runtime_defaults.dart';
import '../../guardian/domain/guardian_review.dart';
import '../../guardian/domain/guardian_reviews.dart';
import '../../activity/domain/desktop_activity.dart';
import '../../activity/domain/activity_reducer.dart';
import '../../subagents/domain/subagent_action.dart';
import '../../host/presentation/host_controller.dart';
import '../../status/domain/run_status.dart';
import '../../../l10n/l10n.dart';

part 'desktop_controller_reasoning.dart';
part 'desktop_controller_subagents.dart';
part 'desktop_controller_activity.dart';
part 'desktop_controller_queue.dart';
part 'desktop_controller_response_undo.dart';
part 'desktop_controller_runtime.dart';
part 'desktop_controller_switch.dart';
part 'desktop_controller_devices.dart';
part 'desktop_controller_history.dart';
part 'desktop_controller_plans.dart';
part 'desktop_controller_requests.dart';
part 'desktop_controller_timeline.dart';

typedef _ReasoningConnection = ({
  String mac,
  String pin,
  String session,
  int generation,
  ThreadLocalState cache,
});
typedef _ReasoningHistory = ({
  _ReasoningConnection connection,
  int watermark,
  Object? selected,
  int selectionRevision,
});

typedef _ResponseHistory = ({
  _ReasoningConnection connection,
  int watermark,
  Object? selected,
  int selectionRevision,
});

typedef _ActiveTurnSnapshot = ({
  String? activeTurnId,
  bool pending,
  String? latestTurnId,
});

typedef _CheckpointKey = ({
  (String?, String?, int) connection,
  String thread,
  String cwd,
  String turn,
});

typedef _StopContext = ({
  String? mac,
  String? pin,
  String? session,
  int generation,
  ThreadLocalState cache,
  String thread,
  Object? cwd,
});

enum DesktopDraftSource { generalChat, folderChat }

bool _shouldRefreshTurnTarget(RemoteRpcException error) {
  final message = error.message.trim().toLowerCase();
  if ([
    'turn not found',
    'no active turn',
    'invalid turn',
    'no such turn',
    'expected active turn',
  ].any(message.contains)) {
    return true;
  }
  const states = [
    'not in progress',
    'not running',
    'already completed',
    'already finished',
    'not active',
    'does not exist',
    'cannot interrupt',
  ];
  if (!states.any(message.contains)) return false;
  return states.contains(message.replaceFirst(RegExp(r'[.!]+$'), '')) ||
      [
        'turn ',
        'active turn ',
        'the turn ',
        'the active turn ',
        'cannot interrupt turn ',
      ].any(message.startsWith);
}

class _QueuedAttempt {
  _QueuedAttempt({required this.steer});
  final bool steer;
  bool requested = false, confirmed = false, received = false;
  String? messageId;
  Object? failure;
  bool get explicitlyRejected {
    final error = failure;
    return !requested ||
        error is RemoteRpcException &&
            ({-32601, -32602}.contains(error.code) ||
                _shouldRefreshTurnTarget(error));
  }
}

/// Local navigation/composer ownership only; never a remote thread identifier.
class DesktopNewChatDraft {
  DesktopNewChatDraft({
    required this.mac,
    required this.pin,
    required this.cwd,
    required this.source,
    required this.navigationRevision,
  });
  final String id = const Uuid().v4();
  String get storageKey => 'new-chat-draft:$id';
  final String mac, pin;
  final DesktopDraftSource source;
  String? cwd, createdThreadId;
  int navigationRevision;
}

class DesktopSwitchIntent {
  const DesktopSwitchIntent(
    this.target,
    this.source,
    this.session,
    this.generation,
    this.navigationRevision,
    this.selectionRevision,
    this.selectedThread,
    this.draft,
    this.navigation,
    this.preserveNavigation,
  );
  final TrustedDeviceEntry target;
  final Pairing source;
  final String? session;
  final int generation, navigationRevision, selectionRevision;
  final Object? selectedThread;
  final DesktopNewChatDraft? draft;
  final DesktopLinkTarget? navigation;
  final bool preserveNavigation;
}

class DesktopController extends ChangeNotifier {
  DesktopController(
    this.pairings, {
    RemoteTransport? connection,
    DesktopLocalStore? localStore,
    this.settings,
    DateTime Function()? guardianClock,
    DateTime Function()? runClock,
  }) : _runClock = runClock ?? DateTime.now,
       guardian = GuardianReviews(now: guardianClock),
       transport = connection ?? RemoteTransport(pairings) {
    host = HostController(transport, store: settings?.store);
    usage = PairedUsageController(
      (params) => params == null
          ? transport.requestNull('account/rateLimits/read')
          : transport.request('account/rateLimits/read', params),
    );
    host.addListener(_hostChanged);
    usage.addListener(_hostChanged);
    host.connectSaved = (device) async {
      final saved = (await pairings.trusted())
          .where(
            (p) => p.macDeviceId == device && p.publicKey == active?.publicKey,
          )
          .firstOrNull;
      if (saved == null || active?.macDeviceId != device) {
        throw RemoteSecurityException(appStrings.desktopVerifiedHostRequired);
      }
      await connect(saved);
    };
    unawaited(host.loadPreference());
    threadList = DesktopThreadsController(
      transport,
      localStore ?? DesktopLocalStore(pairings.credentials),
    );
    threadList.addListener(_threadListChanged);
    _subscription = transport.messages.listen(_incoming);
    transport.onDisconnected = _disconnected;
    transport.onProtocolWarning = (message) {
      error = message;
      _notify();
    };
  }
  late final HostController host;
  late final PairedUsageController usage;
  bool _hostConnecting = false;
  void _hostChanged() {
    if (!_disposed) notifyListeners();
  }

  void _bindHost() {
    final pair = active;
    host.bind(
      device: pair?.macDeviceId,
      generation: _connectGeneration,
      session: transport.sessionId,
      connected:
          connected &&
          state != 'desktop offline' &&
          !_hostConnecting &&
          pair != null &&
          transport.macDeviceId == pair.macDeviceId,
      trusted:
          pair != null &&
          trusted.any(
            (p) =>
                p.macDeviceId == pair.macDeviceId &&
                p.publicKey == pair.publicKey,
          ),
    );
    final pin = pair?.data['macIdentityPublicKey'];
    usage.bind(
      mac: pair?.macDeviceId,
      pin: pin is String ? pin : null,
      session: transport.sessionId,
      generation: _connectGeneration,
      connected:
          host.live &&
          host.trusted &&
          state == 'connected' &&
          !_requestsSuspended &&
          !_suspended &&
          automaticConnectionAllowed,
    );
  }

  Future<void> refreshHost() async {
    _bindHost();
    final revision = host.connectionRevision;
    await host.refresh();
    if (_disposed || host.connectionRevision != revision) return;
    if (!host.preferenceLoaded) await host.loadPreference();
    if (!_disposed && host.connectionRevision == revision) {
      await host.syncPreference(automatic: true);
    }
  }

  final PairingRepository pairings;
  RunStatusProjector? _runStatus;
  String? _statusSession;
  bool _statusHostOffline = false,
      _statusTransportLost = false,
      _statusSecurityBlocked = false;
  void attachRunStatus(RunStatusProjector? projector) {
    _runStatus = projector;
    _syncRunStatus();
  }

  void _syncRunStatus() {
    final projector = _runStatus;
    if (projector == null) return;
    final pair = active;
    final verified =
        !_statusSecurityBlocked &&
        pair != null &&
        trusted.any(
          (p) =>
              p.macDeviceId == pair.macDeviceId &&
              p.publicKey == pair.publicKey,
        );
    if (_statusSession != transport.sessionId) {
      _statusSession = transport.sessionId;
      _statusHostOffline = false;
    }
    final data = threadList.data;
    projector.setContext(
      mac: verified ? pair.macDeviceId : null,
      fingerprint: verified
          ? DesktopLinkTarget.keyFingerprint(pair.publicKey)
          : null,
      session: transport.sessionId,
      connected:
          connected &&
          !_suspended &&
          !_hostConnecting &&
          !_statusTransportLost &&
          !_statusHostOffline &&
          transport.macDeviceId == pair?.macDeviceId &&
          threadList.macDeviceId == pair?.macDeviceId,
      selectedThread: thread?['id'] as String?,
      threads: {
        if (threadList.macDeviceId == pair?.macDeviceId)
          for (final value in data.snapshots)
            if (value['id'] is String &&
                !data.deleted.contains(value['id']) &&
                !data.isArchived(value['id'] as String))
              value['id'] as String: StatusThread(
                threadTitle(value),
                value['cwd'] as String? ?? '',
              ),
      },
    );
  }

  void _captureRunStatus(String method, RemoteJson params, RemoteJson rpc) {
    if (_runStatus == null ||
        !connected ||
        _suspended ||
        _hostConnecting ||
        active?.macDeviceId != transport.macDeviceId ||
        threadList.macDeviceId != active?.macDeviceId ||
        !requestMatchesConnection(rpc) ||
        !trusted.any(
          (p) =>
              p.macDeviceId == active?.macDeviceId &&
              p.publicKey == active?.publicKey,
        )) {
      return;
    }
    if (method == 'djl/hostPresence' && params['online'] is bool) {
      _statusHostOffline = params['online'] == false;
    }
    _syncRunStatus();
    final closing = desktopResponseIdentity(params);
    if (method == 'turn/completed' &&
        closing != null &&
        closing.turn != null &&
        _reversibleClosure(closing.thread, closing.turn!, params)) {
      _runStatus!.rememberTurn(closing.thread, closing.turn!);
    }
    _runStatus!.observe(
      method,
      params,
      replayed: rpc['djlReplayedEvent'] == true,
    );
  }

  _ReasoningConnection? _responseConnection;
  DesktopResponseLifecycle? _responseLifecycle;
  final DateTime Function() _runClock;
  int? _responseAttempt;
  final _attentionUnread = <String, DesktopResponseOutcome>{};
  final _attentionTerminals = <(String, String)>{};

  List<DesktopAttentionItem> get attentionItems {
    final pair = active;
    final pin = pair?.data['macIdentityPublicKey'];
    if (pair == null ||
        pin is! String ||
        pin.isEmpty ||
        threadList.macDeviceId != pair.macDeviceId ||
        !trusted.any(
          (p) =>
              p.macDeviceId == pair.macDeviceId &&
              p.data['macIdentityPublicKey'] == pin,
        )) {
      return [];
    }
    final live = _responseCurrent && !_requestsSuspended;
    final unread = live
        ? _attentionUnread
        : const <String, DesktopResponseOutcome>{};
    return projectDesktopAttention(
      threadList.data,
      activeThreadId: thread?['id'] as String?,
      approvals: live ? approvals.where(requestMatchesConnection).toList() : [],
      userInputs: userInputs
          .where(
            (request) =>
                request['_macDeviceId'] == null ||
                request['_macDeviceId'] == pair.macDeviceId,
          )
          .toList(),
      ready: unread.keys
          .where((id) => unread[id] == DesktopResponseOutcome.completed)
          .toSet(),
      failed: unread.keys
          .where((id) => unread[id] == DesktopResponseOutcome.failed)
          .toSet(),
    );
  }

  bool get _responseCurrent {
    final binding = _responseConnection;
    return binding != null &&
        !_disposed &&
        !_suspended &&
        connected &&
        binding.generation == _connectGeneration &&
        binding.pin.isNotEmpty &&
        active?.macDeviceId == binding.mac &&
        active?.publicKey == binding.pin &&
        transport.macDeviceId == binding.mac &&
        transport.sessionId == binding.session &&
        threadList.macDeviceId == binding.mac &&
        identical(threadList.data, binding.cache) &&
        (_responseAttempt == binding.generation ||
            trusted.any(
              (p) => p.macDeviceId == binding.mac && p.publicKey == binding.pin,
            ));
  }

  DesktopResponseFooterFacts get selectedResponseFooter =>
      _responseCurrent &&
          thread?['id'] is String &&
          !threadList.data.deleted.contains(thread!['id'])
      ? _responseLifecycle!.facts(thread!['id'] as String)
      : DesktopResponseFooterFacts();

  // Cached facts govern local Copy only; they never restore live authority.
  DesktopResponseFooterFacts get selectedResponseCopyFacts {
    if (_responseCurrent) return selectedResponseFooter;
    final id = thread?['id'];
    if (id is! String || threadList.macDeviceId != active?.macDeviceId) {
      return DesktopResponseFooterFacts();
    }
    final saved = threadList.data.find(id)?['djlCopyFacts'];
    if (saved is! Map || saved['pin'] != active?.data['macIdentityPublicKey']) {
      return DesktopResponseFooterFacts();
    }
    return DesktopResponseFooterFacts(
      outcomes: {
        for (final entry in (saved['outcomes'] as Map? ?? {}).entries)
          if (entry.key is String)
            entry.key as String: DesktopResponseOutcome.values.firstWhere(
              (outcome) => outcome.name == entry.value,
              orElse: () => DesktopResponseOutcome.unknown,
            ),
      },
      pending: saved['pending'] == true,
      latestTurn: saved['latestTurn'] as String?,
    );
  }

  _ResponseHistory? _captureResponseHistory() => !_responseCurrent
      ? null
      : (
          connection: _responseConnection!,
          watermark: _responseLifecycle!.revision,
          selected: thread?['id'],
          selectionRevision: selectionRevision,
        );

  void _acceptResponseHistory(
    RemoteJson value,
    _ResponseHistory? request, {
    bool selected = true,
    bool confirmedIdle = false,
  }) {
    if (request == null ||
        !_responseCurrent ||
        request.connection != _responseConnection ||
        (selected &&
            (request.selected != thread?['id'] ||
                request.selectionRevision != selectionRevision)) ||
        value['id'] is! String ||
        threadList.data.deleted.contains(value['id'])) {
      return;
    }
    final historyThread = value['id'] as String;
    final fresh = request.watermark == _responseLifecycle!.revision;
    final turns = (desktopOwnedHistory(value)['turns'] as List)
        .whereType<Map>()
        .map((turn) => Map<String, dynamic>.from(turn))
        .toList();
    final before = _responseLifecycle!.facts(historyThread);
    final guessedStop = _responseLifecycle!.history(
      value['id'] as String,
      turns,
      request.watermark,
      confirmedIdle: confirmedIdle,
    );
    if (guessedStop != null) {
      _retireObservedRun(historyThread, guessedStop, guessed: true);
    }
    final after = _responseLifecycle!.facts(historyThread);
    final latest = after.latestTurn;
    if (selected &&
        fresh &&
        historyThread == thread?['id'] &&
        latest != null &&
        after.outcome(latest) == DesktopResponseOutcome.failed) {
      final failed = turns.where((turn) => turn['id'] == latest).lastOrNull;
      if (failed != null &&
          desktopResponseHistoryOutcome(failed) ==
              DesktopResponseOutcome.failed) {
        error =
            activityString(activityObject(failed['error'])?['message']) ??
            appStrings.desktopResponseFailed;
      }
    }
    for (final entry in after.outcomes.entries) {
      if (entry.key != guessedStop &&
          before.outcome(entry.key) == DesktopResponseOutcome.running &&
          {
            DesktopResponseOutcome.completed,
            DesktopResponseOutcome.failed,
            DesktopResponseOutcome.stopped,
          }.contains(entry.value)) {
        _retireObservedRun(historyThread, entry.key, guessed: false);
      }
    }
    _syncSubagentLifecycle(historyThread, history: value);
    _observeSwitchHistory(value);
  }

  void _captureResponseOutcome(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (!_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        rpc['id'] != null ||
        !{
          'turn/started',
          'turn/completed',
          'turn/failed',
          'thread/status/changed',
        }.contains(method)) {
      return;
    }
    final identity = desktopResponseIdentity(params);
    if (identity == null || threadList.data.deleted.contains(identity.thread)) {
      return;
    }
    final replay =
        rpc['djlReplayedEvent'] == true || params['djlReplayedEvent'] == true;
    final outcome = desktopResponseLiveOutcome(params);
    if (replay && outcome != DesktopResponseOutcome.stopped) return;
    if (method == 'thread/status/changed') {
      if (!replay && outcome == DesktopResponseOutcome.running) {
        _responseLifecycle!.runningStatus(identity.thread, identity.turn);
      }
    } else if (method == 'turn/started') {
      if (!replay) _responseLifecycle!.starting(identity.thread, identity.turn);
    } else if (identity.turn != null) {
      _responseLifecycle!.terminal(
        identity.thread,
        identity.turn!,
        method == 'turn/failed' ? DesktopResponseOutcome.failed : outcome,
        backgroundGuess: outcome == DesktopResponseOutcome.stopped,
      );
    }
    final known = threadList.data.find(identity.thread);
    if (!replay &&
        known != null &&
        !threadList.data.isArchived(identity.thread) &&
        known['syncState'] != 'archivedLocal' &&
        known['sync_state'] != 'archivedLocal') {
      final facts = _responseLifecycle!.facts(identity.thread);
      if ((method == 'turn/started' || method == 'thread/status/changed') &&
          (facts.pending ||
              facts.latestTurn == identity.turn &&
                  facts.latestOutcome == DesktopResponseOutcome.running)) {
        _attentionUnread.remove(identity.thread);
      } else if ((method == 'turn/completed' || method == 'turn/failed') &&
          identity.turn != null &&
          facts.latestTurn == identity.turn &&
          !facts.suppressesLatest &&
          {
            DesktopResponseOutcome.completed,
            DesktopResponseOutcome.failed,
            DesktopResponseOutcome.stopped,
          }.contains(facts.latestOutcome) &&
          _attentionTerminals.add((identity.thread, identity.turn!))) {
        _attentionUnread.remove(identity.thread);
        if (thread?['id'] != identity.thread &&
            facts.latestOutcome != DesktopResponseOutcome.stopped) {
          _attentionUnread[identity.thread] = facts.latestOutcome;
        }
      }
    }
    _notify();
  }

  _ReasoningConnection? _reasoningConnection;
  int? _reasoningAttempt;
  ReasoningReducer? _reasoning;

  final SettingsController? settings;
  final GuardianReviews guardian;
  final subagents = SubagentActions();
  ThreadLocalState? _subagentCache;
  String? _subagentMac, _subagentSession;
  int _subagentNavigationIntent = 0;
  final _subagentLoads = <String, Future<void>>{};
  final _subagentLoadStates = <String, String>{};
  final _subagentFinishedTurns = <(String, String)>{};
  ({String mac, String child, RemoteJson parent})? _subagentReturn;

  Future<void> returnToSubagentParent() async {
    final parent = subagentParent;
    if (parent == null) return;
    _subagentReturn = null;
    await openThread(parent);
  }

  final activity = ActivityReducer();
  ThreadLocalState? _hydratedActivityCache;

  DesktopRuntime get newChatRuntime =>
      (settings?.runtimeDefaults ?? const RuntimeDefaults()).resolve(models);
  RemoteJson? get gitWriterModel =>
      (settings?.runtimeDefaults ?? const RuntimeDefaults()).resolveGitWriter(
        models,
      );
  final RemoteTransport transport;
  StreamSubscription<RemoteJson>? _subscription;
  Pairing? active;
  List<Pairing> trusted = [];
  late final DesktopThreadsController threadList;
  List<RemoteJson> get threads =>
      threadList.macDeviceId == active?.macDeviceId ? threadList.visible : [];
  List<RemoteJson> models = [], timeline = [], approvals = [];
  bool supportsFork = true, _requestsSuspended = false;
  Completer<bool>? _runtimeReady;
  Object? _projectMoveOwner, _projectMoveContext;
  Object get _currentProjectMoveContext => (
    active?.macDeviceId,
    active?.publicKey,
    transport.macDeviceId,
    transport.sessionId,
    transport.connectionRevision,
    threadList.data,
  );
  bool get projectMoveBusy =>
      _projectMoveOwner != null &&
      _projectMoveContext == _currentProjectMoveContext;
  bool ownsProjectMove(Object? owner) =>
      owner != null && identical(owner, _projectMoveOwner) && projectMoveBusy;
  Object reserveProjectMove() {
    if (!runtimeReady || turnId != null) {
      throw StateError(appStrings.desktopWaitBeforeMovingProject);
    }
    final owner = Object();
    _projectMoveOwner = owner;
    _projectMoveContext = _currentProjectMoveContext;
    _notify();
    return owner;
  }

  void releaseProjectMove(Object owner) {
    if (!identical(owner, _projectMoveOwner)) return;
    _projectMoveOwner = _projectMoveContext = null;
    _notify();
  }

  bool get runtimeReady =>
      connected && !busy && state == 'connected' && !projectMoveBusy;
  String titleOf(RemoteJson value) =>
      threadTitle(threadList.data.find(value['id'] as String) ?? value);
  RemoteJson? thread;
  DesktopNewChatDraft? newChatDraft;

  bool isCurrentNewChatDraft(DesktopNewChatDraft draft) =>
      identical(newChatDraft, draft) &&
      navigationRevision == draft.navigationRevision &&
      active?.macDeviceId == draft.mac &&
      active?.publicKey == draft.pin &&
      thread?['id'] == draft.createdThreadId &&
      trusted.any(
        (p) => p.macDeviceId == draft.mac && p.publicKey == draft.pin,
      );

  DesktopNewChatDraft? beginNewChatDraft({
    String? cwd,
    DesktopDraftSource? source,
  }) {
    final pair = active;
    if (!runtimeReady ||
        pair == null ||
        pair.publicKey.isEmpty ||
        !trusted.any(
          (p) =>
              p.macDeviceId == pair.macDeviceId &&
              p.publicKey == pair.publicKey,
        )) {
      return null;
    }
    _rememberCurrent();
    cancelNavigation();
    _subagentNavigationIntent++;
    _subagentReturn = null;
    _passiveSelection = null;
    thread = null;
    timeline = [];
    turnId = null;
    error = null;
    _applyRuntime(newChatRuntime);
    final draft = newChatDraft = DesktopNewChatDraft(
      mac: pair.macDeviceId,
      pin: pair.publicKey,
      cwd: cwd,
      source:
          source ??
          (cwd == null
              ? DesktopDraftSource.generalChat
              : DesktopDraftSource.folderChat),
      navigationRevision: navigationRevision,
    );
    _notify();
    return draft;
  }

  void cancelNewChatDraft(DesktopNewChatDraft draft) {
    if (!isCurrentNewChatDraft(draft)) return;
    newChatDraft = null;
    cancelNavigation();
  }

  void completeNewChatDraft(DesktopNewChatDraft draft) {
    if (!isCurrentNewChatDraft(draft) || draft.createdThreadId == null) return;
    newChatDraft = null;
    _notify();
  }

  void updateNewChatDraftCwd(DesktopNewChatDraft draft, String cwd) {
    if (!isCurrentNewChatDraft(draft) ||
        thread != null ||
        busy ||
        draft.cwd == cwd) {
      return;
    }
    draft.cwd = cwd;
    draft.navigationRevision = ++navigationRevision;
    _notify();
  }

  final List<RemoteJson> userInputs = [];
  void _threadListChanged() {
    final selected = thread;
    if (selected != null) {
      final cached = threadList.data.find(selected['id'] as String);
      if (cached != null) thread = {...selected, ...cached};
    }
    _notify();
  }

  void _rememberRuntime() {
    final id = thread?['id'];
    if (id is! String || threadList.data.deleted.contains(id)) return;
    threadList.data.runtimes[id] = {
      'model': model,
      'wireModel': runtime.modelName,
      'provider': selectedModel?['djlProvider'],
      'effort': effort,
      'access': access,
      'plan': plan,
      'serviceTier': serviceTier,
      'revision': thread?['runtimeSettingsRevision'],
    };
    threadList.scheduleSave();
  }

  void _rememberCurrent() {
    if (threadList.macDeviceId != active?.macDeviceId) return;
    if (!_requestsSuspended) {
      threadList.data.approvals = [];
      threadList.data.userInputs = userInputs.map((request) {
        final saved = Map<String, dynamic>.from(request);
        if (saved['_submitted'] == true || saved['_submitting'] == true) {
          saved['_responseUnknown'] = true;
        }
        saved.remove('_submitted');
        saved.remove('_submitting');
        return saved;
      }).toList();
    }
    final selected = thread;
    if (selected != null) {
      final cached = Map<String, dynamic>.from(selected);
      if (_responseCurrent) {
        final facts = selectedResponseFooter;
        cached['djlCopyFacts'] = {
          'pin': active!.publicKey,
          'outcomes': facts.outcomes.map(
            (id, outcome) => MapEntry(id, outcome.name),
          ),
          'pending': facts.pending || facts.interrupting.isNotEmpty,
          'latestTurn': facts.latestTurn,
        };
      }
      threadList.cacheTimeline(
        cached,
        timeline,
        approvals: threadList.data.approvals,
        userInputs: threadList.data.userInputs,
      );
      _rememberRuntime();
    } else {
      threadList.scheduleSave();
    }
  }

  void _restoreRuntime(RemoteJson value) {
    var saved = threadList.data.runtimes[value['id']];
    final revision = value['runtimeSettingsRevision'];
    if (saved != null &&
        revision is num &&
        revision > ((saved['revision'] as num?) ?? -1)) {
      saved = null;
    }
    final wire = saved?['wireModel'] ?? value['model'];
    final provider =
        saved?['provider'] ?? value['modelProvider'] ?? value['djlProvider'];
    final match = models
        .where(
          (m) =>
              m['id'] == saved?['model'] ||
              ((provider == null || m['djlProvider'] == provider) &&
                  (m['model'] == wire || m['id'] == wire)),
        )
        .firstOrNull;
    final fallback = provider == null
        ? null
        : models.where((m) => m['djlProvider'] == provider).firstOrNull;
    final selected = match ?? fallback;
    if (selected != null) {
      effort = null;
      serviceTier = 'default';
      setModel(selected['id'] as String, remember: false);
    } else if (provider != null && connected && models.isNotEmpty) {
      model = null;
      error = appStrings.desktopProviderUnavailable;
    } else if (!connected && saved?['model'] is String) {
      model = saved!['model'] as String;
    }
    effort =
        saved?['effort'] as String? ??
        value['reasoningEffort'] as String? ??
        effort;
    final appliedMode = {
      'approval-required': 'on-request',
      'auto-approval': 'auto-review',
      'full-access': 'full-access',
    }[value['runtimeMode']];
    access = saved?['access'] as String? ?? appliedMode ?? access;
    plan = supportsPlan && (saved?['plan'] as bool? ?? false);
    serviceTier =
        saved?['serviceTier'] as String? ??
        value['serviceTier'] as String? ??
        'default';
  }

  bool _requestForCurrentThread(RemoteJson request) {
    final id = (request['params'] as RemoteJson?)?['threadId'];
    return id == null || id == thread?['id'];
  }

  List<RemoteJson> get pendingApprovals =>
      approvals.where(_requestForCurrentThread).toList();
  List<RemoteJson> get pendingUserInputs =>
      userInputs.where(_requestForCurrentThread).toList();
  String? model, error, turnId, effort;
  String access = 'on-request', serviceTier = 'default';
  bool plan = false, supportsPlan = true;
  ({String? mac, Object? pin})? _queuedOwner;
  final _queuedByThread = <String, List<DesktopQueuedDraft>>{};
  final _queuePausedByThread = <String, String>{};
  Object? _queuedDelivery;
  ({String thread, String id})? _queuedSteering;
  int _queuedOwnerEpoch = 0;
  int _queuedSequence = 0;

  Future<void> flushQueuedDrafts() async {
    final drafts = queuedDrafts;
    if (!_queuedCommandReady ||
        _selectedRunBusy ||
        queuePauseMessage != null ||
        drafts.isEmpty) {
      return;
    }
    await _deliverQueuedDraft(drafts.first, steer: false);
  }

  bool _supportsModeSync = false;

  /// The paired desktop can serve Multi agents groups to this phone.
  bool supportsGroups = false;

  /// The Mac's bridge takes files and images in group chats.
  bool supportsGroupAttachments = false;

  /// Threads that belong to group chats. The groups feature reads their events
  /// straight from the transport, so this controller leaves them alone.
  final groupThreads = <String>{};
  bool _supportsTurnPagination = true;
  final _checkpointsByTurn = <_CheckpointKey, TurnCheckpoints>{};
  final _checkpointEnds = <_CheckpointKey, Future<void>>{};
  final _unverifiedCheckpointOwners = <_CheckpointKey>{};
  _CheckpointKey _checkpointKey(WorkspaceRepository workspace, String turn) => (
    connection: workspace.connectionIdentity,
    thread: workspace.threadId,
    cwd: workspace.cwd,
    turn: turn,
  );
  Future<void> waitForCheckpoint(
    String turn, {
    WorkspaceRepository? workspace,
  }) {
    final owner = workspace ?? _workspace();
    if (owner == null || !owner.isCurrent) return Future<void>.value();
    final key = _checkpointKey(owner, turn);
    return (_checkpointEnds[key] ?? Future<void>.value()).then((_) {
      if (owner.isCurrent && _unverifiedCheckpointOwners.contains(key)) {
        throw StateError(appStrings.desktopReopenBeforeRestore);
      }
    });
  }

  final _finishedTurns = <(String?, String)>{};
  WorkspaceRepository? _workspace() {
    final cwd = thread?['cwd'];
    final id = thread?['id'];
    return cwd is String && cwd.trim().isNotEmpty && id is String
        ? WorkspaceRepository(transport, cwd: cwd, threadId: id)
        : null;
  }

  int _responseRunRevision = 0;
  int _timelineRevision = 0;
  final _liveTimelineRevisions = <(String, String), int>{};
  final _historyReplacements = <String, int>{};
  final _sourceContinuity =
      <
        String,
        ({
          _ReasoningConnection connection,
          String turn,
          int revision,
          Set<String> excludedIds,
          bool currentOnly,
        })
      >{};

  RemoteJson? responseUndoGitStatus;

  Object? _modelRefreshOwner;
  Future<void>? _modelRefreshFuture;

  void setModel(String id, {bool remember = true}) {
    model = id;
    final supported = reasoningEfforts;
    final modelDefault =
        selectedModel?['defaultReasoningEffort'] as String? ??
        selectedModel?['default_reasoning_effort'] as String?;
    if (!supported.contains(effort)) {
      effort = supported.contains(modelDefault)
          ? modelDefault
          : supported.contains('medium')
          ? 'medium'
          : supported.firstOrNull;
    }
    if (!supportsFastMode) {
      serviceTier = 'default';
    }
    if (remember) {
      _passiveSelection = null;
      _rememberRuntime();
    }
    _notify();
  }

  Pairing? previousDevice;
  TrustedDeviceEntry? switchingDevice;
  String? switchNotice;
  bool cancellingSwitch = false, _automaticConnectionPaused = false;
  bool _connectingRecovery = false, _pairingSubmission = false;
  int _switchRevision = 0;
  int? _switchOwnedNavigationRevision;

  final _liveSwitchRuns = <String, Set<String>>{};
  final _switchRunCaution = <String>{};
  ({String mac, String pin, String? session, int generation})? _switchRunScope;

  Future<void> cancelSavedSwitch() async {
    if (switchingDevice == null || cancellingSwitch) return;
    final previous = previousDevice ?? active;
    ++_switchRevision;
    final generation = ++_connectGeneration;
    cancellingSwitch = true;
    _automaticConnectionPaused = true;
    _intent = false;
    _retry?.cancel();
    _clearGuardianAuthority();
    _clearReasoningAuthority();
    selectionRevision++;
    if (navigationRevision == _switchOwnedNavigationRevision) {
      cancelNavigation();
    }
    // Save the source owner before clearing it; staged targets never persist.
    _rememberCurrent();
    final saving = threadList.saveNow();
    threadList.discardSwitch(clear: true);
    _clearSwitchPresentation();
    previousDevice = previous;
    active = null;
    state = 'disconnected';
    error = null;
    switchNotice = appStrings.desktopSwitchCancelled;
    final closing = transport.disconnect();
    _notify();
    try {
      await closing;
      await saving;
      await pairings.clearActive();
    } catch (_) {
      if (!_disposed && generation == _connectGeneration) {
        error = appStrings.desktopSelectionClearUnconfirmed;
      }
    } finally {
      if (!_disposed && generation == _connectGeneration) {
        switchingDevice = null;
        cancellingSwitch = false;
        busy = false;
        _hostConnecting = false;
        _notify();
      }
    }
  }

  String state = 'disconnected';
  bool busy = false, _disposed = false, _suspended = false, _intent = false;
  Timer? _retry;
  Timer? _hostPresenceRecovery;
  int _failures = 0;
  int _connectGeneration = 0;
  bool get connected => transport.connected;
  void _notify() {
    if (!_disposed) {
      _bindQueuedOwner();
      _bindHost();
      _syncRunStatus();
      _syncHostPresenceRecovery();
      notifyListeners();
    }
  }

  ({String? mac, Object? pin, Object? thread})? _passiveSelection;
  ({String? mac, Object? pin, Object? thread}) _selectionContext(Object? id) =>
      (
        mac: active?.macDeviceId,
        pin: active?.data['macIdentityPublicKey'],
        thread: id,
      );
  bool _routingAllowed = true;
  void setRoutingAllowed(bool value) {
    _routingAllowed = value;
    if (!value && switchingDevice != null) unawaited(cancelSavedSwitch());
    _syncHostPresenceRecovery();
  }

  bool get _needsHostPresenceRecovery =>
      state == 'desktop offline' &&
      connected &&
      !_disposed &&
      !_suspended &&
      !_hostConnecting &&
      _routingAllowed &&
      automaticConnectionAllowed &&
      _intent &&
      hasReconnectCandidate &&
      transport.macDeviceId == active?.macDeviceId;

  void _syncHostPresenceRecovery() {
    if (!_needsHostPresenceRecovery) {
      _hostPresenceRecovery?.cancel();
      _hostPresenceRecovery = null;
      return;
    }
    if (_hostPresenceRecovery != null) return;
    final generation = _connectGeneration, pair = active!;
    _hostPresenceRecovery = Timer(const Duration(seconds: 30), () {
      _hostPresenceRecovery = null;
      if (!_needsHostPresenceRecovery) return;
      if (generation != _connectGeneration ||
          active?.macDeviceId != pair.macDeviceId ||
          active?.publicKey != pair.publicKey ||
          active?.sessionId != pair.sessionId ||
          busy) {
        _syncHostPresenceRecovery();
        return;
      }
      // The relay socket may outlive the host's session. Resolve through the
      // existing authenticated reconnect path; never replay a mutation here.
      unawaited(reconnect());
    });
  }

  DesktopLinkTarget? navigationTarget, navigationDisplayTarget;
  String? navigationError;
  ({String mac, String pin})? _navigationHost;
  int navigationRevision = 0, selectionRevision = 0;
  int? _navigationAttempt;
  bool _navigationReading = false;
  bool get navigationNeedsAttempt =>
      _routingAllowed &&
      automaticConnectionAllowed &&
      !busy &&
      !_navigationReading &&
      navigationTarget != null &&
      _navigationHost != null &&
      _navigationAttempt != _connectGeneration;
  bool get navigationNeedsHost =>
      navigationTarget != null && _navigationHost == null;
  bool get hasReconnectCandidate =>
      active != null &&
      (active!.data['macIdentityPublicKey'] as String? ?? '').isNotEmpty &&
      (active!.data['relay'] as String? ?? '').isNotEmpty &&
      trusted.any(
        (pair) =>
            pair.macDeviceId == active!.macDeviceId &&
            pair.publicKey == active!.publicKey,
      );

  bool navigationForcesHostChoice = false;

  void queueNavigation(
    DesktopLinkTarget target, {
    Pairing? selectedHost,
    bool useActive = true,
    bool forceHostChoice = false,
  }) {
    if (!forceHostChoice &&
        (target == navigationTarget ||
            target == navigationDisplayTarget &&
                navigationTarget == null &&
                thread?['id'] == target.thread)) {
      return;
    }
    navigationRevision++;
    navigationForcesHostChoice = forceHostChoice;
    navigationTarget = target;
    navigationDisplayTarget = null;
    navigationError = null;
    _navigationAttempt = null;
    final pair = forceHostChoice
        ? null
        : useActive
        ? (hasReconnectCandidate ? active : null)
        : selectedHost;
    final eligible =
        pair != null &&
        target.matchesHost(pair.macDeviceId, pair.publicKey) &&
        (!target.qualified ||
            active?.macDeviceId == pair.macDeviceId &&
                active?.publicKey == pair.publicKey) &&
        (!target.qualified ||
            trusted.any(
              (p) =>
                  p.macDeviceId == pair.macDeviceId &&
                  p.publicKey == pair.publicKey,
            ));
    _navigationHost = !eligible
        ? null
        : (mac: pair.macDeviceId, pin: pair.publicKey);
    if (target.qualified &&
        !trusted.any((p) => target.matchesHost(p.macDeviceId, p.publicKey))) {
      navigationError = appStrings.desktopLinkIdentityUnavailable;
    }
    _notify();
  }

  void cancelNavigation() {
    navigationRevision++;
    navigationTarget = null;
    navigationDisplayTarget = null;
    navigationError = null;
    _navigationHost = null;
    _navigationAttempt = null;
    _notify();
  }

  Future<void> selectSaved(Pairing pair) async {
    if (busy) return;
    final target = navigationTarget;
    if (navigationNeedsHost &&
        target?.qualified == true &&
        (!target!.matchesHost(pair.macDeviceId, pair.publicKey) ||
            !trusted.any(
              (p) =>
                  p.macDeviceId == pair.macDeviceId &&
                  p.publicKey == pair.publicKey,
            ))) {
      navigationError = appStrings.desktopChooseMatchingMac;
      _notify();
      return;
    }
    if (connected && !isActiveDevice(pair)) {
      final intent = prepareSavedSwitch(pair);
      if (intent != null) await switchSaved(intent);
      return;
    }
    if (connected && !navigationNeedsHost) return;
    _automaticConnectionPaused = false;
    selectionRevision++;
    if (navigationNeedsHost) {
      _navigationHost = (mac: pair.macDeviceId, pin: pair.publicKey);
      _navigationAttempt = null;
      navigationError = null;
    } else {
      cancelNavigation();
    }
    if (connected) {
      _notify();
    } else {
      await connect(pair);
    }
  }

  Future<void> routeNavigation({bool retry = false}) async {
    final target = navigationTarget, host = _navigationHost;
    if (!_routingAllowed ||
        !automaticConnectionAllowed ||
        target == null ||
        host == null ||
        _navigationReading ||
        busy) {
      return;
    }
    if (active?.macDeviceId != host.mac ||
        active?.publicKey != host.pin ||
        !target.matchesHost(host.mac, host.pin) ||
        !trusted.any(
          (pair) => pair.macDeviceId == host.mac && pair.publicKey == host.pin,
        )) {
      cancelNavigation();
      return;
    }
    if (!retry && _navigationAttempt == _connectGeneration) return;
    if (retry) {
      navigationRevision++;
      navigationDisplayTarget = null;
    }
    _navigationReading = true;
    _navigationAttempt = _connectGeneration;
    final revision = navigationRevision, generation = _connectGeneration;
    bool current() =>
        !_disposed &&
        revision == navigationRevision &&
        generation == _connectGeneration &&
        active?.macDeviceId == host.mac &&
        active?.publicKey == host.pin;
    try {
      await openThread(
        {'id': target.thread},
        readOnlyNavigation: true,
        isCurrent: current,
      );
      if (!current()) return;
      navigationDisplayTarget = target;
      if (connected && error == null) {
        navigationTarget = null;
        navigationError = null;
      } else {
        navigationError = appStrings.desktopWaitingForMac;
      }
    } on RemoteRpcException catch (failure) {
      if (!current()) return;
      final message = failure.message.toLowerCase();
      if (!message.contains('not materialized') &&
          !message.contains('not yet materialized') &&
          (message.contains('thread not found') ||
              message.contains('unknown thread'))) {
        navigationTarget = null;
        navigationError = appStrings.desktopLinkedConversationUnavailable;
      } else {
        navigationError = appStrings.desktopLinkedConversationLoadFailed;
      }
    } catch (_) {
      if (current()) {
        navigationError = appStrings.desktopLinkedConversationLoadFailed;
      }
    } finally {
      _navigationReading = false;
      if (current()) _notify();
    }
  }

  List<TrustedDeviceEntry> _devicePreferences = [];
  bool devicePreferencesReady = false;
  bool devicePreferencesLoading = false;
  bool devicePreferencesSaving = false;
  String? devicePreferencesError;
  int _devicePreferencesRevision = 0;

  bool isActiveDevice(Pairing pair) =>
      active?.macDeviceId == pair.macDeviceId &&
      active?.publicKey == pair.publicKey;

  Future<void> loadDevicePreferences() async {
    if (_disposed || devicePreferencesSaving) return;
    final revision = ++_devicePreferencesRevision;
    devicePreferencesLoading = true;
    devicePreferencesError = null;
    _notify();
    try {
      final entries = await pairings.trustedEntries();
      if (_disposed || revision != _devicePreferencesRevision) return;
      _devicePreferences = entries;
      devicePreferencesReady = true;
    } catch (_) {
      if (_disposed || revision != _devicePreferencesRevision) return;
      devicePreferencesReady = false;
      devicePreferencesError = appStrings.desktopDevicePreferencesLoadFailed;
    } finally {
      if (!_disposed && revision == _devicePreferencesRevision) {
        devicePreferencesLoading = false;
        _notify();
      }
    }
  }

  void restoreSelection(List<Pairing> records, String? preferred) {
    trusted = records;
    if (!_automaticConnectionPaused &&
        (active == null ||
            !records.any(
              (pair) =>
                  pair.macDeviceId == active!.macDeviceId &&
                  pair.data['macIdentityPublicKey'] ==
                      active!.data['macIdentityPublicKey'],
            ))) {
      active = records
          .where((pair) => pair.macDeviceId == preferred)
          .firstOrNull;
    }
  }

  Future<void> restore() async {
    try {
      trusted = await pairings.trusted();
      if (!connected &&
          !_automaticConnectionPaused &&
          (active == null || threadList.macDeviceId != active!.macDeviceId)) {
        final preferred = await pairings.credentials.read('desktop.active');
        final selected = trusted
            .where((p) => p.macDeviceId == (active?.macDeviceId ?? preferred))
            .firstOrNull;
        if (selected != null) {
          active = selected;
          await threadList.attach(selected.macDeviceId);
          guardian.bind(selected.macDeviceId, null);
          _bindActivityDevice(selected.macDeviceId);
          approvals = List.of(threadList.data.approvals);
          userInputs
            ..clear()
            ..addAll(threadList.data.userInputs);
          _requestsSuspended = true;
        }
      }
    } catch (_) {
      error = appStrings.desktopSavedDesktopsOpenFailed;
    }
    await loadDevicePreferences();
    _notify();
  }

  Future<void> pair(String payload) async {
    if (busy) return;
    final pair = Pairing.parse(payload, allowLocal: pairings.allowLocal);
    await connect(pair, bootstrap: true);
  }

  Future<void> pairCode(String code, String relay) async {
    if (busy) return;
    final generation = ++_connectGeneration;
    _pairingSubmission = true;
    _automaticConnectionPaused = false;
    busy = true;
    error = null;
    state = 'resolving';
    _notify();
    try {
      final pair = await pairings.resolveCode(code, relay);
      if (generation != _connectGeneration) return;
      busy = false;
      await connect(pair, bootstrap: true);
    } catch (e) {
      if (generation != _connectGeneration) return;
      error = e.toString();
      state = 'disconnected';
    } finally {
      if (generation == _connectGeneration) {
        _pairingSubmission = false;
        busy = false;
        _notify();
      }
    }
  }

  Future<void> connect(
    Pairing pair, {
    bool bootstrap = false,
    bool resolve = true,
  }) => _connect(pair, bootstrap: bootstrap, resolve: resolve);

  Future<void> _connect(
    Pairing pair, {
    bool bootstrap = false,
    bool resolve = true,
    TrustedDeviceEntry? switchTarget,
  }) async {
    if (busy && switchTarget == null) return;
    if (switchTarget == null) _automaticConnectionPaused = false;
    _connectingRecovery = !bootstrap && switchTarget == null;
    _pairingSubmission = bootstrap;
    if (active?.macDeviceId != pair.macDeviceId ||
        active?.data['macIdentityPublicKey'] !=
            pair.data['macIdentityPublicKey']) {
      selectionRevision++;
    }
    if (_navigationHost != null &&
        (_navigationHost!.mac != pair.macDeviceId ||
            _navigationHost!.pin != pair.publicKey)) {
      cancelNavigation();
    }
    _clearGuardianAuthority();
    _clearReasoningAuthority();
    _hostConnecting = true;
    final identityFailureRevision = pairings.identityReadFailureRevision;
    final generation = ++_connectGeneration;
    _supportsTurnPagination = true;
    if (_runtimeReady?.isCompleted == false) _runtimeReady!.complete(false);
    final ready = _runtimeReady = Completer<bool>();
    var authenticated = false;
    busy = true;
    error = null;
    state = 'connecting';
    _intent = switchTarget == null;
    _retry?.cancel();
    try {
      if (active?.macDeviceId != pair.macDeviceId ||
          threadList.macDeviceId != pair.macDeviceId) {
        _rememberCurrent();
        await transport.disconnect();
        if (generation != _connectGeneration) return;
        _checkpointsByTurn.clear();
        _unverifiedCheckpointOwners.clear();
        _liveTimelineRevisions.clear();
        _historyReplacements.clear();
        _sourceContinuity.clear();
        _checkpointEnds.clear();
        _finishedTurns.clear();
        thread = null;
        timeline = [];
        models = [];
        approvals.clear();
        userInputs.clear();
        turnId = null;
        active = pair;
        await threadList.attach(pair.macDeviceId);
        guardian.bind(pair.macDeviceId, null);
        _bindActivityDevice(pair.macDeviceId);
        if (generation != _connectGeneration) {
          if (!ready.isCompleted) ready.complete(false);
          return;
        }
        approvals = List.of(threadList.data.approvals);
        userInputs.addAll(threadList.data.userInputs);
      }
      active = pair;
      if (approvals.isEmpty) approvals = List.of(threadList.data.approvals);
      if (userInputs.isEmpty) userInputs.addAll(threadList.data.userInputs);
      _requestsSuspended = false;
      _notify();
      if (!bootstrap && resolve) pair = await pairings.resolveTrusted(pair);
      if (generation != _connectGeneration) return;
      active = pair;
      _beginReasoningConnection(pair, generation);
      if (switchTarget == null) {
        await transport.connect(pair, bootstrap: bootstrap);
      } else {
        await transport.connectSaved(pair, switchTarget);
      }
      if (generation != _connectGeneration) return;
      authenticated = true;
      _liveSwitchRuns.clear();
      _switchRunCaution.clear();
      _switchRunScope = (
        mac: pair.macDeviceId,
        pin: pair.publicKey,
        session: transport.sessionId,
        generation: generation,
      );
      _hostConnecting = false;
      _statusTransportLost = false;
      _statusSecurityBlocked = false;
      active = pair;
      _bindGuardianConnection();
      unawaited(refreshHost());
      try {
        final initialized = await transport.request('initialize', {
          'clientInfo': {
            'name': 'djl_flutter',
            'title': 'DJL Mobile',
            'version': '0.1.0',
          },
          'capabilities': {'experimentalApi': true},
        });
        if (generation != _connectGeneration) return;
        _learnTurnPagination(initialized);
        supportsPlan = true;
        _supportsModeSync =
            (initialized['capabilities']
                as RemoteJson?)?['djlThreadRuntimeModeSync'] ==
            true;
        supportsGroups =
            (initialized['capabilities'] as RemoteJson?)?['djlGroups'] == true;
        supportsGroupAttachments =
            (initialized['capabilities']
                as RemoteJson?)?['djlGroupAttachments'] ==
            true;
      } on RemoteRpcException catch (e) {
        if (generation != _connectGeneration) return;
        if (e.code != -32602 ||
            !RegExp(
              'capabilit|experimental',
              caseSensitive: false,
            ).hasMatch(e.message)) {
          rethrow;
        }
        final initialized = await transport.request('initialize', {
          'clientInfo': {
            'name': 'djl_flutter',
            'title': 'DJL Mobile',
            'version': '0.1.0',
          },
        });
        if (generation != _connectGeneration) return;
        _learnTurnPagination(initialized);
        supportsPlan = false;
        plan = false;
      }
      if (generation != _connectGeneration) return;
      await transport.send({'method': 'initialized', 'params': {}});
      if (generation != _connectGeneration) return;
      state = 'connected';
      supportsFork = true;
      threadList.supportsGoals = true;
      final records = await pairings.trusted();
      if (generation != _connectGeneration) return;
      trusted = records;
      unawaited(loadDevicePreferences());
      _reasoningAttempt = null;
      _responseAttempt = null;
      await refreshThreads(throwOnError: true);
      if (generation != _connectGeneration) return;
      final catalog = await transport.request('model/list', {});
      if (generation != _connectGeneration) return;
      models =
          ((catalog['data'] ?? catalog['items'] ?? catalog['models'] ?? [])
                  as List)
              .cast<RemoteJson>();
      await settings?.setRuntimeCatalog(models);
      if (generation != _connectGeneration) return;
      if (thread == null &&
          !(newChatDraft != null && isCurrentNewChatDraft(newChatDraft!))) {
        _applyRuntime(newChatRuntime);
      } else if (thread == null && selectedModel == null) {
        error = appStrings.desktopModelUnavailable;
      }
      if (thread != null && navigationTarget == null) {
        await openThread(thread!, userSelection: false);
      }
      if (generation != _connectGeneration) return;
      _failures = 0;
      if (switchTarget == null) {
        previousDevice = null;
        if (switchNotice != appStrings.desktopStopRunsUnconfirmed) {
          switchNotice = null;
        }
      }
      unawaited(threadList.hydrateGoals());
    } catch (e) {
      if (generation != _connectGeneration) return;
      error = e.toString();
      state = 'disconnected';
      _clearReasoningAuthority();
      await transport.disconnect().catchError((Object _) {});
      if (generation != _connectGeneration) return;
      if (bootstrap && !authenticated) _intent = false;
      if (pairings.isIdentityReadFailure(e, after: identityFailureRevision)) {
        error = appStrings.desktopPairingIdentityReadFailed;
        _scheduleRecovery(
          const RemoteSecurityException(
            'Secure pairing identity is unavailable.',
          ),
          null,
        );
      } else {
        _scheduleRecovery(e, null);
      }
    } finally {
      if (generation == _connectGeneration) {
        _hostConnecting = false;
        _connectingRecovery = false;
        _pairingSubmission = false;
        if (switchTarget == null) busy = false;
      }
      if (!ready.isCompleted) {
        ready.complete(
          generation == _connectGeneration && state == 'connected' && connected,
        );
      }
      if (generation == _connectGeneration) _notify();
    }
  }

  Future<void> refreshThreads({
    bool throwOnError = false,
    bool Function()? isCurrent,
  }) async {
    final generation = _connectGeneration;
    if (isCurrent?.call() == false) return;
    try {
      final mac = active?.macDeviceId ?? transport.macDeviceId;
      if (mac != null) await threadList.attach(mac);
      if (generation != _connectGeneration || isCurrent?.call() == false) {
        return;
      }
      await threadList.refresh(isCurrent: isCurrent);
    } catch (e) {
      if (generation != _connectGeneration || isCurrent?.call() == false) {
        return;
      }
      error = e.toString();
      _notify();
      if (throwOnError) rethrow;
    }
  }

  Future<RemoteJson> _readRemoteThread(
    RemoteJson value, {
    String? cwd,
    String? preferredModel,
    String? preferredProvider,
    bool requireSelected = true,
    bool Function()? isCurrent,
  }) async {
    final generation = _connectGeneration, mac = transport.macDeviceId;
    if (isCurrent?.call() == false) {
      throw StateError('The conversation changed while loading.');
    }
    final response = await _runtimeRequest(
      'thread/resume',
      {
        'threadId': value['id'],
        'cwd': ?(cwd ?? threadList.data.projectBindings[value['id']]),
        'model': ?preferredModel,
        'djlProvider': ?preferredProvider,
        if (preferredProvider != null) 'serviceTier': serviceTier,
      },
      includeModel: false,
      isCurrent: isCurrent,
    );
    if (generation != _connectGeneration ||
        isCurrent?.call() == false ||
        mac != transport.macDeviceId ||
        (requireSelected && thread?['id'] != value['id'])) {
      throw StateError('The conversation changed while loading.');
    }
    final history = await transport.request('thread/read', {
      'threadId': value['id'],
      'includeTurns': true,
    });
    if (isCurrent?.call() == false) {
      throw StateError('The conversation changed while loading.');
    }
    final resolved = normalizeThread({
      ...value,
      ...(response['thread'] as RemoteJson? ?? {}),
      ...(history['thread'] as RemoteJson? ?? {}),
    });
    if (resolved['id'] != value['id']) {
      throw StateError(appStrings.desktopRuntimeOtherHistory);
    }
    if (generation == _connectGeneration && mac == transport.macDeviceId) {
      _observeSwitchHistory(resolved);
    }
    return resolved;
  }

  Future<void> openThread(
    RemoteJson value, {
    bool subagentSelection = false,
    bool userSelection = true,
    bool readOnlyNavigation = false,
    bool preserveError = false,
    bool Function()? isCurrent,
  }) async {
    if (isCurrent?.call() == false) return;
    if (userSelection) {
      newChatDraft = null;
      _attentionUnread.remove(value['id']);
    }
    final passiveRead =
        readOnlyNavigation ||
        !userSelection && _passiveSelection == _selectionContext(value['id']);
    if (userSelection) {
      _passiveSelection = readOnlyNavigation
          ? _selectionContext(value['id'])
          : null;
      _subagentNavigationIntent++;
    } else if (thread?['id'] != value['id']) {
      return;
    }
    final generation = _connectGeneration;
    _rememberCurrent();
    if (subagentSelection ||
        value['parentThreadId'] != null ||
        value['isSubagent'] == true ||
        threadList.data.find(value['id'] as String)?['isSubagent'] == true) {
      _applyRuntime(newChatRuntime);
      plan = false;
    }
    if (!preserveError) error = null;
    thread = normalizeThread({
      ...?threadList.data.find(value['id'] as String),
      ...value,
    });
    timeline = (threadList.data.timelines[value['id']] ?? [])
        .where(
          (row) =>
              !row.containsKey(reasoningMetadataKey) ||
              reasoningRowMatchesHost(row),
        )
        .toList();
    turnId = null;
    if (passiveRead && threadList.data.runtimes[value['id']] == null) {
      // A navigation request must not copy the previous chat or global defaults
      // into a thread whose runtime metadata has not been read yet.
      model = null;
      access = 'on-request';
      effort = null;
      serviceTier = 'default';
      plan = false;
    }
    _restoreRuntime(thread!);
    _notify();
    if (!connected) return;
    final reasoningHistory = _captureReasoningHistory();
    final responseHistory = _captureResponseHistory();
    final timelineWatermark = _timelineRevision;
    final historyCwd = thread?['cwd'],
        historyBinding = threadList.data.projectBindings[value['id']];
    try {
      final RemoteJson resolved;
      if (passiveRead) {
        final response = await transport.request('thread/read', {
          'threadId': value['id'],
          'includeTurns': true,
        });
        final remote = response['thread'];
        if (remote is! Map || remote['id'] != value['id']) {
          throw StateError(appStrings.desktopLinkedHistoryUnverified);
        }
        resolved = normalizeThread({
          ...thread!,
          ...Map<String, dynamic>.from(remote),
        });
      } else {
        resolved = await _readRemoteThread(thread!);
      }
      if (resolved['id'] != value['id']) {
        throw StateError(appStrings.desktopRuntimeOtherHistory);
      }
      if (isCurrent?.call() == false ||
          generation != _connectGeneration ||
          thread?['id'] != value['id'] ||
          thread?['cwd'] != historyCwd ||
          threadList.data.projectBindings[value['id']] != historyBinding ||
          !_reasoningHistoryCurrent(reasoningHistory)) {
        return;
      }
      _observeSwitchHistory(resolved);
      _acceptResponseHistory(resolved, responseHistory);
      threadList.data.upsert(resolved, fromServer: true);
      thread = {...resolved, ...?threadList.data.find(value['id'] as String)};
      _history(
        thread!,
        reasoningHistory: reasoningHistory,
        timelineWatermark: timelineWatermark,
      );
      _restoreRuntime(thread!);
      _rememberCurrent();
    } catch (e) {
      if (isCurrent?.call() == false ||
          generation != _connectGeneration ||
          thread?['id'] != value['id'] ||
          thread?['cwd'] != historyCwd ||
          threadList.data.projectBindings[value['id']] != historyBinding ||
          !_reasoningHistoryCurrent(reasoningHistory)) {
        return;
      }
      error = e.toString();
      if (readOnlyNavigation) rethrow;
    }
    _notify();
  }

  Future<RemoteJson> moveThreadToProjectPath(
    String projectPath, {
    bool Function()? isCurrent,
    Object? operationOwner,
  }) async {
    final path = desktopConversationPath(projectPath);
    final source = thread == null ? null : Map<String, dynamic>.from(thread!);
    final pair = active;
    if (path == null ||
        source?['id'] is! String ||
        (!runtimeReady &&
            !(ownsProjectMove(operationOwner) &&
                connected &&
                !busy &&
                state == 'connected')) ||
        turnId != null ||
        isCurrent?.call() == false ||
        pair == null ||
        pair.publicKey.isEmpty ||
        transport.macDeviceId != pair.macDeviceId ||
        threadList.macDeviceId != pair.macDeviceId ||
        !trusted.any(
          (p) =>
              p.macDeviceId == pair.macDeviceId &&
              p.publicKey == pair.publicKey,
        )) {
      throw StateError(appStrings.desktopIdleChatAndProjectRequired);
    }
    final id = source!['id'] as String;
    final mac = pair.macDeviceId, pin = pair.publicKey;
    final generation = _connectGeneration,
        connection = transport.connectionRevision,
        session = transport.sessionId,
        cache = threadList.data,
        navigation = navigationRevision,
        selection = selectionRevision;
    final settings = (
      model,
      selectedModel?['djlProvider'],
      effort,
      access,
      plan,
      serviceTier,
    );
    final snapshot = runtime;
    final originalProjectBinding = cache.projectBindings[id];
    bool current() =>
        !_disposed &&
        connected &&
        state == 'connected' &&
        generation == _connectGeneration &&
        transport.macDeviceId == mac &&
        transport.connectionRevision == connection &&
        transport.sessionId == session &&
        active?.macDeviceId == mac &&
        active?.publicKey == pin &&
        trusted.any((p) => p.macDeviceId == mac && p.publicKey == pin) &&
        threadList.macDeviceId == mac &&
        identical(threadList.data, cache) &&
        cache.projectBindings[id] == originalProjectBinding &&
        navigationRevision == navigation &&
        selectionRevision == selection &&
        thread?['id'] == id &&
        thread?['cwd'] == source['cwd'] &&
        turnId == null &&
        settings ==
            (
              model,
              selectedModel?['djlProvider'],
              effort,
              access,
              plan,
              serviceTier,
            ) &&
        isCurrent?.call() != false;
    _rememberCurrent();
    busy = true;
    error = null;
    _notify();
    try {
      RemoteJson resumed;
      try {
        final response = await _runtimeRequest(
          'thread/resume',
          {'threadId': id, 'cwd': path},
          includeModel: false,
          snapshot: snapshot,
          isCurrent: current,
        );
        final value = response['thread'];
        if (value is! Map || value['id'] != id) {
          throw StateError(appStrings.desktopProjectChangeUnverified);
        }
        resumed = Map<String, dynamic>.from(value);
      } on RemoteRpcException catch (e) {
        final message = e.message.toLowerCase();
        if (!message.contains('no rollout found') &&
            !message.contains('no rollout file found')) {
          rethrow;
        }
        resumed = source;
      }
      if (!current()) {
        throw StateError('The conversation changed while moving its project.');
      }
      final moved = normalizeThread({...source, ...resumed, 'cwd': path});
      cache.bindProject(id, path);
      if (isManagedWorktreePath(path)) {
        cache.associatedWorktreePaths[id] = path;
      } else if (isManagedWorktreePath(source['cwd'])) {
        cache.associatedWorktreePaths[id] = source['cwd'] as String;
      }
      cache.upsert(moved);
      thread = {...moved, ...?cache.find(id)};
      _passiveSelection = null;
      _rememberCurrent();
      return Map<String, dynamic>.from(thread!);
    } catch (e) {
      if (current()) error = e.toString();
      rethrow;
    } finally {
      if (generation == _connectGeneration && !_disposed) {
        busy = false;
        _notify();
      }
    }
  }

  Future<bool> forkThread({
    String? cwd,
    Object? operationOwner,
    bool Function()? isCurrent,
  }) async {
    final source = thread == null ? null : Map<String, dynamic>.from(thread!);
    final mac = active?.macDeviceId;
    final barrier = _runtimeReady;
    if (busy && state == 'connecting' && barrier != null) await barrier.future;
    if (!supportsFork ||
        isCurrent?.call() == false ||
        !connected ||
        busy ||
        projectMoveBusy && !ownsProjectMove(operationOwner) ||
        source == null ||
        mac != active?.macDeviceId) {
      return false;
    }
    _subagentNavigationIntent++;
    final generation = _connectGeneration;
    final connection = (
      active?.macDeviceId,
      active?.publicKey,
      transport.macDeviceId,
      transport.sessionId,
      transport.connectionRevision,
      threadList.data,
    );
    bool sameConnection() =>
        generation == _connectGeneration &&
        connection ==
            (
              active?.macDeviceId,
              active?.publicKey,
              transport.macDeviceId,
              transport.sessionId,
              transport.connectionRevision,
              threadList.data,
            );
    bool current() => sameConnection() && isCurrent?.call() != false;
    busy = true;
    error = null;
    _rememberCurrent();
    _notify();
    try {
      var reasoningHistory = _captureReasoningHistory();
      var timelineWatermark = _timelineRevision;
      final responseHistory = _captureResponseHistory();
      final response = await _runtimeRequest(
        'thread/fork',
        {'threadId': source['id']},
        includeModel: false,
        isCurrent: current,
      );
      if (!current()) return false;
      if (!_reasoningHistoryCurrent(reasoningHistory, selection: false)) {
        return false;
      }
      if (response['thread'] is! Map ||
          (response['thread'] as Map)['id'] is! String) {
        throw StateError(appStrings.desktopForkUnidentified);
      }
      final seed = normalizeThread({
        ...Map<String, dynamic>.from(response['thread'] as Map),
        'model': (response['thread'] as Map)['model'] ?? source['model'],
        'modelProvider':
            (response['thread'] as Map)['modelProvider'] ??
            source['modelProvider'] ??
            source['djlProvider'],
        'forkedFromThreadId':
            (response['thread'] as Map)['forkedFromThreadId'] ?? source['id'],
      });
      // The source history is not presented as new-server history when the fork response omitted it.
      if (!(response['thread'] as Map).containsKey('turns')) seed['turns'] = [];
      final id = seed['id'] as String;
      if (id == source['id']) {
        throw StateError(appStrings.desktopForkNotSeparate);
      }
      _acceptResponseHistory(seed, responseHistory, selected: false);
      final target = cwd?.trim().isNotEmpty == true
          ? cwd!.trim()
          : source['cwd'] as String?;
      threadList.data.noteCreated(seed);
      if (target != null) threadList.data.bindProject(id, target);
      final inherited = threadList.data.runtimes[source['id']];
      if (inherited != null) threadList.data.runtimes[id] = Map.of(inherited);
      var hydrated = {...seed, ...?threadList.data.find(id)};
      if (thread?['id'] == source['id']) {
        thread = hydrated;
        if (reasoningHistory != null) {
          reasoningHistory = (
            connection: reasoningHistory.connection,
            watermark: reasoningHistory.watermark,
            selected: thread?['id'],
            selectionRevision: selectionRevision,
          );
        }
        _history(
          hydrated,
          reasoningHistory: reasoningHistory,
          timelineWatermark: timelineWatermark,
        );
        _rememberCurrent();
      }
      for (final delay in [
        Duration.zero,
        const Duration(milliseconds: 250),
        const Duration(milliseconds: 800),
      ]) {
        if (delay != Duration.zero) await Future<void>.delayed(delay);
        if (!current()) return false;
        try {
          final hydrationReasoningHistory = _captureReasoningHistory();
          final hydrationResponseHistory = _captureResponseHistory();
          final hydrationTimelineWatermark = _timelineRevision;
          final loaded = await _readRemoteThread(
            seed,
            cwd: target,
            preferredModel: source['model'] as String?,
            preferredProvider:
                source['modelProvider'] as String? ??
                source['djlProvider'] as String?,
            requireSelected: false,
            isCurrent: current,
          );
          if (!current()) return false;
          if (!_reasoningHistoryCurrent(
            hydrationReasoningHistory,
            selection: false,
          )) {
            return false;
          }
          _acceptResponseHistory(
            loaded,
            hydrationResponseHistory,
            selected: false,
          );
          threadList.data.upsert(loaded, fromServer: true);
          final knownTurns = hydrated['turns'] as List? ?? [];
          if ((loaded['turns'] as List? ?? []).isNotEmpty ||
              knownTurns.isEmpty) {
            reasoningHistory = hydrationReasoningHistory;
            timelineWatermark = hydrationTimelineWatermark;
          }
          hydrated = {
            ...hydrated,
            ...loaded,
            ...?threadList.data.find(id),
            if ((loaded['turns'] as List? ?? []).isEmpty &&
                knownTurns.isNotEmpty)
              'turns': knownTurns,
          };
          if ((hydrated['turns'] as List? ?? []).isNotEmpty) break;
        } on RemoteRpcException catch (e) {
          if (!e.message.toLowerCase().contains('no rollout found') &&
              !e.message.toLowerCase().contains('no rollout file found')) {
            rethrow;
          }
        }
      }
      if (!current()) return false;
      if (thread?['id'] == id) {
        thread = hydrated;
        _history(
          hydrated,
          reasoningHistory: reasoningHistory,
          timelineWatermark: timelineWatermark,
        );
        _restoreRuntime(hydrated);
        _rememberCurrent();
      } else {
        final rows = _reconcileOwnedHistory(
          hydrated,
          List<RemoteJson>.of(threadList.data.timelines[id] ?? []),
          reasoningHistory: reasoningHistory,
          timelineWatermark: timelineWatermark,
        );
        threadList.cacheTimeline(
          hydrated,
          rows,
          approvals: threadList.data.approvals,
          userInputs: threadList.data.userInputs,
        );
      }
      await refreshThreads(isCurrent: current);
      return current();
    } catch (e) {
      if (!current()) return false;
      final unsupported =
          e is RemoteRpcException &&
          (e.code == -32601 ||
              RegExp(
                'method not found|unknown method|not implemented|does not support|thread(?:/| )fork.*(?:unsupported|not supported)',
                caseSensitive: false,
              ).hasMatch(e.message));
      if (unsupported) supportsFork = false;
      error = unsupported
          ? appStrings.desktopForkUnsupported
          : appStrings.desktopForkResultUnknown(e.toString());
      return false;
    } finally {
      if (sameConnection()) {
        busy = false;
        _notify();
      }
    }
  }

  void _history(
    RemoteJson value, {
    _ReasoningHistory? reasoningHistory,
    int? timelineWatermark,
  }) {
    value = desktopOwnedHistory(value);
    final id = value['id'] as String;
    timeline = _reconcileOwnedHistory(
      value,
      timeline,
      reasoningHistory: reasoningHistory,
      timelineWatermark: timelineWatermark,
    );
    _syncSubagentRows();
    for (final action in subagents.items.values.where((a) => a.thread == id)) {
      unawaited(hydrateSubagents(action));
    }
    _syncGuardianRows();
    _syncActivityRows();
    _syncReasoningRows();
    final running =
        (value['turns'] as List? ?? [])
                .where(
                  (t) => {
                    'inProgress',
                    'running',
                  }.contains((t as RemoteJson)['status']),
                )
                .lastOrNull
            as RemoteJson?;
    final facts = _responseCurrent ? _responseLifecycle!.facts(id) : null;
    final stillRunning = facts == null
        ? running != null
        : facts.latestOutcome == DesktopResponseOutcome.running ||
              facts.pending;
    if (facts == null) {
      turnId = running?['id'] as String?;
    } else {
      turnId = facts.latestOutcome == DesktopResponseOutcome.running
          ? facts.latestTurn
          : null;
    }
    if (!stillRunning) {
      approvals.removeWhere(
        (p) => (p['params'] as Map?)?['threadId'] == value['id'],
      );
      userInputs.removeWhere(
        (p) => (p['params'] as Map?)?['threadId'] == value['id'],
      );
    }
  }

  Future<bool> createThread({
    String? cwd,
    DesktopComposerDraft Function()? draft,
    bool Function()? canSelect,
    void Function(String)? onCreated,
    DesktopRuntime? runtimeSnapshot,
  }) async {
    _subagentNavigationIntent++;
    final generation = _connectGeneration, sourceId = thread?['id'];
    final sourceMac = active?.macDeviceId,
        sourcePin = active?.data['macIdentityPublicKey'];
    final sourceData = threadList.data;
    // Explicit new chats use defaults; first sends supply the empty composer's choices.
    final requested =
        runtimeSnapshot ??
        (settings == null && models.isEmpty ? runtime : newChatRuntime);
    final requestedModelId = requested.model?['id'] as String? ?? model;
    error = null;
    _notify();
    try {
      if (settings != null && !settings!.ready) {
        throw StateError(appStrings.desktopReadSettingsFirst);
      }
      if (settings != null && requested.model == null) {
        throw StateError(appStrings.desktopConnectMacWithModels);
      }
      final result = await _runtimeRequest(
        'thread/start',
        {'djlScope': cwd == null ? 'studio' : 'project', 'cwd': ?cwd},
        snapshot: requested,
        isCurrent: () =>
            generation == _connectGeneration &&
            active?.macDeviceId == sourceMac &&
            active?.data['macIdentityPublicKey'] == sourcePin &&
            canSelect?.call() != false,
      );
      if (generation != _connectGeneration ||
          active?.macDeviceId != sourceMac ||
          active?.data['macIdentityPublicKey'] != sourcePin ||
          !identical(sourceData, threadList.data)) {
        return false;
      }
      final created = normalizeThread(result['thread'] as RemoteJson);
      sourceData.noteCreated(created);
      sourceData.runtimes[created['id'] as String] = {
        'model': requestedModelId,
        'wireModel': requested.modelName,
        'provider': requested.model?['djlProvider'],
        'effort': requested.effort,
        'access': requested.access,
        'plan': requested.plan,
        'serviceTier': requested.serviceTier,
        'revision': created['runtimeSettingsRevision'],
      };
      final latestDraft = draft?.call();
      if (latestDraft != null) {
        sourceData.setComposerDraft(created['id'] as String, latestDraft);
      }
      if (thread?['id'] != sourceId || canSelect?.call() == false) {
        threadList.scheduleSave();
        return false;
      }
      if (draft != null && cwd != null && created['cwd'] != cwd) {
        threadList.scheduleSave();
        throw StateError(appStrings.desktopChatCreatedElsewhere);
      }
      _rememberCurrent();
      thread = created;
      if (newChatDraft case final owner?) {
        owner.createdThreadId = created['id'] as String;
      }
      _applyRuntime(requested);
      model = requestedModelId;
      timeline = [];
      turnId = null;
      onCreated?.call(created['id'] as String);
      _rememberCurrent();
      await refreshThreads();
      _notify();
      return generation == _connectGeneration &&
          thread?['id'] == created['id'] &&
          canSelect?.call() != false;
    } catch (e) {
      if (generation != _connectGeneration ||
          active?.macDeviceId != sourceMac ||
          active?.data['macIdentityPublicKey'] != sourcePin ||
          canSelect?.call() == false) {
        return false;
      }
      error = e.toString();
    }
    _notify();
    return false;
  }

  Future<bool> send(String text) => sendDraft(DesktopComposerDraft(text: text));

  final _planImplementations = <(_StopContext, String, String)>{};
  final _inferredPlanAnswers = <(_StopContext, String, String)>{};

  Future<bool> submitComposerDraft(
    DesktopComposerDraft draft, {
    DesktopComposerDraft Function()? latestDraft,
    bool Function()? canContinue,
    void Function(String)? onThreadCreated,
    String? newThreadCwd,
  }) async {
    if (!shouldQueueComposer || newChatDraft != null) {
      return sendDraft(
        draft,
        latestDraft: latestDraft,
        canContinue: canContinue,
        onThreadCreated: onThreadCreated,
        newThreadCwd: newThreadCwd,
      );
    }
    if (draft.isEmpty ||
        !connected ||
        busy ||
        projectMoveBusy ||
        switchingDevice != null ||
        _suspended ||
        canContinue?.call() == false) {
      return false;
    }
    try {
      if (draft.contexts.isNotEmpty &&
          draft.cwd != null &&
          draft.cwd != thread?['cwd']) {
        throw StateError(appStrings.desktopDraftContextOtherFolder);
      }
      draft.input();
      _bindQueuedOwner();
      final resume = queuePauseMessage != null && turnId == null;
      final id = thread!['id'] as String;
      (_queuedByThread[id] ??= []).add(
        DesktopQueuedDraft(
          id: 'queued-${++_queuedSequence}',
          draft: draft,
          plan: plan,
        ),
      );
      threadList.data.setComposerDraft(
        id,
        threadList.data.composerDraft(id).without(draft),
      );
      error = null;
      threadList.scheduleSave();
      _notify();
      if (resume) unawaited(_resumeQueuedDrafts(waitForIdle: true));
      return true;
    } catch (e) {
      error = e.toString();
      _notify();
      return false;
    }
  }

  Future<bool> sendDraft(
    DesktopComposerDraft draft, {
    DesktopComposerDraft Function()? latestDraft,
    bool Function()? canContinue,
    void Function(String)? onThreadCreated,
    String? newThreadCwd,
  }) => _sendDraft(
    draft,
    latestDraft: latestDraft,
    canContinue: canContinue,
    onThreadCreated: onThreadCreated,
    newThreadCwd: newThreadCwd,
  );

  Future<bool> _sendDraft(
    DesktopComposerDraft draft, {
    DesktopComposerDraft Function()? latestDraft,
    bool Function()? canContinue,
    void Function(String)? onThreadCreated,
    String? newThreadCwd,
    _QueuedAttempt? queuedAttempt,
    DesktopRuntime? runtimeSnapshot,
    RemoteJson? collaborationMode,
  }) async {
    final fromQueue = queuedAttempt != null;
    if (draft.isEmpty || !connected || busy || projectMoveBusy) return false;
    final draftOwner = newChatDraft;
    if (draftOwner != null && !isCurrentNewChatDraft(draftOwner)) return false;
    if (draftOwner != null && selectedModel == null) {
      error = appStrings.desktopModelUnavailable;
      _notify();
      return false;
    }
    if (thread == null &&
        draftOwner == null &&
        model == null &&
        models.isNotEmpty) {
      _applyRuntime(newChatRuntime);
    }
    // Creation, post-create refresh and initial turn retries share this request policy.
    final expectedRuntime = runtimeSnapshot ?? runtime;
    final generation = _connectGeneration;
    final messageId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    queuedAttempt?.messageId = messageId;
    final mac = transport.macDeviceId, session = transport.sessionId;
    final ownerMac = active?.macDeviceId,
        ownerPin = active?.data['macIdentityPublicKey'];
    final requestedCwd = newThreadCwd;
    String? selectedThread = thread?['id'] as String?,
        selectedCwd = thread?['cwd'] as String?;
    var sourceData = threadList.data;
    final initialTurn = turnId;
    final initialPendingRevision = selectedThread == null || !_responseCurrent
        ? 0
        : _responseLifecycle!.pendingRevisionFor(selectedThread);
    bool ownsSend() =>
        generation == _connectGeneration &&
        mac == transport.macDeviceId &&
        session == transport.sessionId &&
        active?.macDeviceId == ownerMac &&
        active?.data['macIdentityPublicKey'] == ownerPin &&
        identical(sourceData, threadList.data) &&
        thread?['id'] == selectedThread &&
        thread?['cwd'] == selectedCwd &&
        (draftOwner == null || isCurrentNewChatDraft(draftOwner)) &&
        canContinue?.call() != false;
    List<RemoteJson>? sourceTimeline;
    bool current() =>
        generation == _connectGeneration &&
        mac == transport.macDeviceId &&
        thread?['id'] == selectedThread &&
        thread?['cwd'] == selectedCwd &&
        ownsSend();
    TurnCheckpoints? checkpoints;
    bool Function()? ownsSteerRun;
    final responseConnection = _responseConnection;
    void observeStarting(String? id, [String? turn]) {
      if (id != null &&
          _responseCurrent &&
          responseConnection == _responseConnection) {
        _responseLifecycle!.starting(id, turn);
      }
    }

    bool ownsInitialRun() =>
        turnId == initialTurn &&
        (selectedThread == null || !_responseCurrent
            ? initialPendingRevision == 0
            : _responseLifecycle!.pendingRevisionFor(selectedThread!) ==
                  initialPendingRevision);
    var requestDispatched = false;
    int? localStartRevision;
    Set<String>? priorRunRows;
    RemoteJson? dispatchedPlanSession;
    bool exitsPlanSession = false;
    RemoteJson? planSessionAtDispatch;
    var downgradedPlanMode = false;
    final queuedPendingRevision =
        fromQueue &&
            !queuedAttempt.steer &&
            _responseCurrent &&
            thread?['id'] is String
        ? _responseLifecycle!.pendingRevisionFor(thread!['id'] as String)
        : null;
    busy = true;
    error = null;
    _notify();
    try {
      if (!current() || !ownsInitialRun()) return false;
      if (thread == null) {
        final created = await createThread(
          cwd: requestedCwd,
          runtimeSnapshot: expectedRuntime,
          draft: latestDraft ?? () => draft,
          canSelect: ownsSend,
          onCreated: (id) {
            selectedThread = id;
            selectedCwd = thread?['cwd'] as String?;
            onThreadCreated?.call(id);
          },
        );
        if (!created || !current()) return false;
      }
      if (generation != _connectGeneration) return false;
      if (thread == null || !current() || !ownsInitialRun()) return false;
      sourceData = threadList.data;
      selectedThread = thread!['id'] as String;
      selectedCwd = thread!['cwd'] as String?;
      sourceTimeline = timeline;
      var sendingTurn = turnId;
      final pendingRevision =
          _responseCurrent && responseConnection == _responseConnection
          ? _responseLifecycle!.pendingRevisionFor(selectedThread!)
          : null;
      bool samePendingRun() =>
          pendingRevision == null ||
          _responseCurrent &&
              responseConnection == _responseConnection &&
              (!selectedResponseFooter.pending ||
                  _responseLifecycle!.pendingRevisionFor(selectedThread!) ==
                      pendingRevision);
      ownsSteerRun = () =>
          sendingTurn == null || turnId == sendingTurn && samePendingRun();
      if (fromQueue &&
          expectedRuntime.plan &&
          (!supportsPlan || expectedRuntime.modelName == null)) {
        throw StateError(appStrings.desktopQueuedPlanModelRequired);
      }
      if (draft.contexts.isNotEmpty &&
          draft.cwd != null &&
          draft.cwd != selectedCwd) {
        throw StateError(appStrings.desktopDraftContextOtherFolder);
      }
      final input = draft.input();
      if (model == null) {
        throw StateError(appStrings.desktopChooseModelFirst);
      }
      timeline.add({
        'id': messageId,
        'turnId': turnId,
        'type': 'userMessage',
        'delivery': 'pending',
        'content': input,
        'fileMentions': draft.contexts
            .where((c) => c.kind == DesktopContextKind.file)
            .map((c) => c.path)
            .toList(),
      });
      _noteTimelineLive(selectedThread!, timeline.last);
      _notify();
      _rememberCurrent();
      final workspace = _workspace();
      if (turnId == null && workspace != null) {
        checkpoints = TurnCheckpoints(workspace, messageId: messageId);
        await checkpoints.prepare();
        if (!current()) return false;
      }
      if (!current()) return false;
      if (!ownsInitialRun()) return false;
      if (queuedPendingRevision != null &&
          _responseCurrent &&
          responseConnection == _responseConnection &&
          selectedResponseFooter.pending &&
          _responseLifecycle!.pendingRevisionFor(selectedThread!) !=
              queuedPendingRevision) {
        error = appStrings.desktopRunChangedBeforeQueue;
        return false;
      }
      _passiveSelection = null;
      if (sendingTurn == null) _responseRunRevision++;
      Future<void> resolveExpectedTurn({bool requireDifferent = false}) async {
        final expected = sendingTurn;
        bool ownsRun() => current() && ownsSteerRun!();
        final resolved = await _steerActiveTurnId(selectedThread!, ownsRun);
        if (!ownsRun() ||
            resolved == null ||
            requireDifferent && resolved == expected) {
          throw StateError(appStrings.desktopRunChangedBeforeSteer);
        }
        sendingTurn = resolved;
        _adoptTurnTarget(selectedThread!, expected, resolved);
        final optimistic = sourceTimeline
            ?.where((item) => item['id'] == messageId)
            .firstOrNull;
        optimistic?['turnId'] = resolved;
      }

      Future<RemoteJson> submit() {
        dispatchedPlanSession = _planSession(selectedThread!);
        final mode =
            collaborationMode ??
            (!expectedRuntime.plan &&
                    supportsPlan &&
                    dispatchedPlanSession != null
                ? {
                    'mode': 'default',
                    'settings': {
                      'model': expectedRuntime.modelName,
                      'reasoning_effort': expectedRuntime.effort,
                      'developer_instructions': null,
                    },
                  }
                : null);
        if (mode != null && expectedRuntime.modelName == null) {
          throw StateError(appStrings.desktopModelBeforeLeavingPlan);
        }
        exitsPlanSession =
            mode?['mode'] == 'default' ||
            !expectedRuntime.plan && sendingTurn == null;
        return _composerRequest(
          sendingTurn == null ? 'turn/start' : 'turn/steer',
          {
            'threadId': selectedThread,
            'expectedTurnId': ?sendingTurn,
            if (mode != null)
              'collaborationMode': mode
            else if (queuedAttempt?.steer == true && expectedRuntime.plan)
              'collaborationMode': expectedRuntime.parameters(
                forTurn: true,
              )['collaborationMode'],
          },
          draft,
          () => current() && ownsSteerRun!(),
          expectedRuntime,
          () {
            if (!requestDispatched) {
              if (expectedRuntime.plan) {
                _recordPlanSession(selectedThread!, 'requested');
              }
            }
            planSessionAtDispatch = _planSession(selectedThread!);
            if (!requestDispatched && sendingTurn == null) {
              if (_responseCurrent &&
                  responseConnection == _responseConnection) {
                priorRunRows = {
                  for (final row in sourceTimeline!)
                    if (row['id'] is String && row['id'] != messageId)
                      row['id'] as String,
                };
                localStartRevision = _responseLifecycle!.beginLocalStart(
                  selectedThread!,
                );
                final handoff = _sourceContinuity[selectedThread];
                if (handoff != null &&
                    handoff.connection == responseConnection &&
                    localStartRevision! > handoff.revision) {
                  _sourceContinuity[selectedThread!] = (
                    connection: handoff.connection,
                    turn: handoff.turn,
                    revision: handoff.revision,
                    excludedIds: priorRunRows!,
                    currentOnly: true,
                  );
                }
              }
            }
            requestDispatched = true;
            queuedAttempt?.requested = true;
          },
          (wasPlan) {
            downgradedPlanMode = true;
            if (wasPlan &&
                identical(
                  sourceData.planSessions[selectedThread],
                  planSessionAtDispatch,
                )) {
              sourceData.planSessions.remove(selectedThread);
              threadList.scheduleSave();
            }
          },
        );
      }

      if (sendingTurn != null && _realTurnId(sendingTurn) == null) {
        await resolveExpectedTurn();
      }
      RemoteJson result;
      try {
        result = await submit();
      } on RemoteRpcException catch (e) {
        // This explicit precondition rejection proves the steer was not accepted.
        if (sendingTurn == null ||
            !_shouldRefreshTurnTarget(e) ||
            !current() ||
            !ownsSteerRun()) {
          rethrow;
        }
        await resolveExpectedTurn(requireDifferent: true);
        result = await submit();
      }
      final turn = result['turn'] as RemoteJson?;
      final legacyTurnId =
          !['type', 'item', 'content', 'output'].any(result.containsKey)
          ? result['id']
          : null;
      final responseTurnId =
          (turn?['id'] ??
                  (sendingTurn == null
                      ? null
                      : result['turnId'] ?? result['turn_id'] ?? legacyTurnId))
              as String?;
      if (generation != _connectGeneration || mac != transport.macDeviceId) {
        return false;
      }
      final sentThreadId = selectedThread!;
      if (exitsPlanSession &&
          (responseTurnId != null || sendingTurn != null) &&
          session == transport.sessionId &&
          active?.macDeviceId == ownerMac &&
          active?.data['macIdentityPublicKey'] == ownerPin &&
          identical(sourceData, threadList.data) &&
          identical(
            sourceData.planSessions[sentThreadId],
            dispatchedPlanSession,
          )) {
        sourceData.planSessions.remove(sentThreadId);
        threadList.scheduleSave();
      }
      queuedAttempt?.confirmed = true;
      var canObserveResult =
          current() &&
          (sendingTurn == null ||
              samePendingRun() &&
                  (turnId == sendingTurn ||
                      responseTurnId != null && turnId == responseTurnId));
      if (sendingTurn == null && canObserveResult) {
        canObserveResult =
            responseTurnId != null &&
            (localStartRevision != null
                ? _responseCurrent &&
                      responseConnection == _responseConnection &&
                      _responseLifecycle!.acknowledgeLocalStart(
                        sentThreadId,
                        responseTurnId,
                        localStartRevision!,
                      )
                : turnId == null || turnId == responseTurnId);
      }
      final priorSource = _sourceContinuity[sentThreadId];
      if (sendingTurn == null &&
          canObserveResult &&
          responseTurnId != null &&
          localStartRevision != null &&
          priorSource != null &&
          priorSource.connection == responseConnection &&
          localStartRevision! > priorSource.revision) {
        _sourceContinuity[sentThreadId] = (
          connection: responseConnection!,
          turn: responseTurnId,
          revision: localStartRevision!,
          excludedIds: priorRunRows ?? {},
          currentOnly: true,
        );
      }
      final startedTurn = responseTurnId;
      if (canObserveResult &&
          sendingTurn != null &&
          startedTurn is String &&
          startedTurn.trim().isNotEmpty) {
        observeStarting(sentThreadId, startedTurn);
      }
      if (!fromQueue) {
        sourceData.setComposerDraft(
          sentThreadId,
          sourceData.composerDraft(sentThreadId).without(draft),
        );
      }
      final optimistic = sourceTimeline
          .where((item) => item['id'] == messageId)
          .firstOrNull;
      optimistic?['delivery'] = responseTurnId != null || sendingTurn != null
          ? 'confirmed'
          : 'pending';
      optimistic?['turnId'] =
          responseTurnId ?? sendingTurn ?? (canObserveResult ? turnId : null);
      if (!canObserveResult) {
        threadList.scheduleSave();
        return true;
      }
      if (responseTurnId != null && checkpoints != null) {
        _bindCheckpoints(responseTurnId, checkpoints);
      }
      if (responseTurnId != null &&
          !(_responseCurrent &&
              _responseLifecycle!.isTurnTerminal(
                sentThreadId,
                responseTurnId,
              )) &&
          !_finishedTurns.contains((sentThreadId, responseTurnId))) {
        turnId = responseTurnId;
      }
      optimistic?['turnId'] = responseTurnId ?? sendingTurn ?? turnId;
      optimistic?['delivery'] = 'confirmed';
      if (downgradedPlanMode && sendingTurn == null && responseTurnId != null) {
        timeline.add({
          'id': 'djl-plan-mode:$messageId',
          'threadId': sentThreadId,
          'turnId': responseTurnId,
          'type': 'systemMessage',
          'text': appStrings.desktopPlanModeUnsupported,
        });
        _noteTimelineLive(sentThreadId, timeline.last);
      }
      return true;
    } catch (e) {
      queuedAttempt?.failure = e;
      if (generation != _connectGeneration) return false;
      final optimistic = sourceTimeline
          ?.where((item) => item['id'] == messageId)
          .firstOrNull;
      optimistic?['delivery'] = 'unknown';
      if (selectedThread != null &&
          (!current() || ownsSteerRun?.call() == false)) {
        return false;
      }
      error = requestDispatched
          ? appStrings.desktopSendResultUnknown(e.toString())
          : e.toString();
      return false;
    } finally {
      if (queuedAttempt != null &&
          !queuedAttempt.confirmed &&
          !queuedAttempt.received) {
        for (final rows in [
          sourceTimeline,
          sourceData.timelines[selectedThread],
        ]) {
          if (rows == null) continue;
          if (!queuedAttempt.requested || queuedAttempt.steer) {
            rows.removeWhere((item) => item['id'] == messageId);
          } else {
            for (final row in rows.where((item) => item['id'] == messageId)) {
              row['delivery'] = 'unknown';
            }
          }
        }
      }
      if (!fromQueue && !requestDispatched) {
        sourceTimeline?.removeWhere((item) => item['id'] == messageId);
        sourceData.timelines[selectedThread]?.removeWhere(
          (item) => item['id'] == messageId,
        );
      }
      busy = false;
      if (current()) _rememberCurrent();
      _notify();
    }
  }

  Future<String?> _steerActiveTurnId(
    String threadId,
    bool Function() current,
  ) async {
    final snapshot = await _resolveActiveTurnSnapshot(threadId, current);
    if (snapshot.pending) {
      throw StateError(appStrings.desktopRunIdPending);
    }
    final id = snapshot.activeTurnId;
    return id != null && !_finishedTurns.contains((threadId, id)) ? id : null;
  }

  Future<_ActiveTurnSnapshot> _resolveActiveTurnSnapshot(
    String threadId,
    bool Function() current,
  ) async {
    late _ActiveTurnSnapshot snapshot;
    for (var attempt = 0; attempt < 3; attempt++) {
      if (!current()) throw StateError('The active run changed.');
      snapshot = await _readActiveTurnSnapshot(threadId, current);
      if (!current()) throw StateError('The active run changed.');
      if (snapshot.activeTurnId != null || !snapshot.pending) return snapshot;
      if (attempt < 2) {
        await Future<void>.delayed(const Duration(milliseconds: 200));
      }
    }
    return snapshot;
  }

  Future<_ActiveTurnSnapshot> _readActiveTurnSnapshot(
    String threadId,
    bool Function() current,
  ) async {
    if (!current()) throw StateError('The active run changed.');
    if (_supportsTurnPagination) {
      try {
        final response = await transport.request('thread/turns/list', {
          'threadId': threadId,
          'limit': 8,
          'sortDirection': 'desc',
        });
        if (!current()) throw StateError('The active run changed.');
        if (['threadId', 'thread_id'].any(
              (key) => response.containsKey(key) && response[key] != threadId,
            ) ||
            (response.containsKey('cwd') &&
                response['cwd'] != thread?['cwd'])) {
          throw StateError(appStrings.desktopRuntimeOtherTurnPage);
        }
        for (final field in ['data', 'items', 'turns']) {
          final values = response[field];
          if (values is List) {
            return _activeTurnSnapshot(values, newestFirst: true);
          }
        }
        _supportsTurnPagination = false;
      } on RemoteRpcException catch (e) {
        if (!current()) throw StateError('The active run changed.');
        final message = e.message.toLowerCase();
        final materializing =
            message.contains('not materialized') ||
            message.contains('not yet materialized');
        final unsupported =
            e.code == -32601 ||
            RegExp(
              'method not found|unknown method|not implemented|unsupported|not supported',
            ).hasMatch(message);
        if (!materializing && !unsupported) rethrow;
        if (!materializing) _supportsTurnPagination = false;
      }
    }
    if (!current()) throw StateError('The active run changed.');
    RemoteJson response;
    try {
      response = await transport.request('thread/read', {
        'threadId': threadId,
        'includeTurns': true,
      });
    } on RemoteRpcException catch (e) {
      if (!current()) throw StateError('The active run changed.');
      if (!{-32600, -32602}.contains(e.code) ||
          !RegExp(
            'threadid|includeturns|thread_id|include_turns|unknown field|missing field|invalid',
          ).hasMatch(e.message.toLowerCase())) {
        rethrow;
      }
      response = await transport.request('thread/read', {
        'thread_id': threadId,
        'include_turns': true,
      });
    }
    if (!current()) throw StateError('The active run changed.');
    final value = response['thread'];
    if (value is! Map ||
        value['id'] != threadId ||
        value.containsKey('cwd') && value['cwd'] != thread?['cwd']) {
      throw StateError(appStrings.desktopRuntimeOtherHistory);
    }
    final turns = value['turns'];
    if (turns is! List) {
      throw StateError(appStrings.desktopRuntimeNoTurnState);
    }
    final snapshot = _activeTurnSnapshot(turns, newestFirst: false);
    return snapshot.activeTurnId == null && _runningStatus(value['status'])
        ? (
            activeTurnId: null,
            pending: true,
            latestTurnId: snapshot.latestTurnId,
          )
        : snapshot;
  }

  void _learnTurnPagination(RemoteJson initialized) {
    final agent = initialized['userAgent'] ?? initialized['user_agent'];
    if (agent is! String) return;
    final parts = agent.split('/');
    if (parts.length != 2 || parts.first != 'codex_cli_rs') return;
    final version = parts.last.split('.');
    if (version.length < 2) return;
    final major = int.tryParse(version[0]), minor = int.tryParse(version[1]);
    if (major == 0 && minor != null && minor >= 0 && minor < 125) {
      _supportsTurnPagination = false;
    }
  }

  void _adoptTurnTarget(String threadId, String? previous, String target) {
    if (previous != target) _retireTurnTarget(threadId, previous);
    turnId = target;
    if (_responseCurrent) _responseLifecycle!.starting(threadId, target);
  }

  void _retireTurnTarget(String threadId, String? previous) {
    if (previous != null) {
      _finishedTurns.add((threadId, previous));
      if (_responseCurrent) {
        final facts = _responseLifecycle!.facts(threadId);
        if (facts.outcome(previous) == DesktopResponseOutcome.running ||
            facts.interrupting.contains(previous)) {
          _responseLifecycle!.terminal(
            threadId,
            previous,
            DesktopResponseOutcome.unknown,
          );
        }
      }
    }
  }

  void _markSelectedThreadIdle() {
    if (_runningStatus(thread?['status'])) {
      thread!['status'] = thread!['status'] is Map
          ? <String, dynamic>{'type': 'idle'}
          : 'idle';
    }
  }

  _ActiveTurnSnapshot _activeTurnSnapshot(
    List values, {
    required bool newestFirst,
  }) {
    if (values.any((row) => row is! Map)) {
      throw StateError(appStrings.desktopRuntimeInvalidTurnState);
    }
    final ordered = newestFirst
        ? values.cast<Map>()
        : values.reversed.cast<Map>();
    String? latestTurnId;
    final turns = <Map>[];
    for (final row in ordered) {
      final raw = row['id'] ?? row['turnId'] ?? row['turn_id'];
      if (raw is String && raw.trim().startsWith('djl-history-compacted-')) {
        continue;
      }
      turns.add(row);
      latestTurnId ??= _realTurnId(raw);
    }
    if (turns.isEmpty) {
      return (activeTurnId: null, pending: false, latestTurnId: latestTurnId);
    }
    final latest = turns.first;
    final status =
        latest['status'] ?? latest['turnStatus'] ?? latest['turn_status'];
    final kind = status is Map
        ? status['type'] ?? status['statusType'] ?? status['status_type']
        : status;
    if (!_runningStatus(status) &&
        kind is String &&
        RegExp(
          'complete|failed|error|interrupt|cancel|stopped',
          caseSensitive: false,
        ).hasMatch(kind)) {
      return (activeTurnId: null, pending: false, latestTurnId: latestTurnId);
    }
    final id = _realTurnId(
      latest['id'] ?? latest['turnId'] ?? latest['turn_id'],
    );
    return (activeTurnId: id, pending: id == null, latestTurnId: latestTurnId);
  }

  Future<RemoteJson> _composerRequest(
    String method,
    RemoteJson base,
    DesktopComposerDraft draft,
    bool Function() current,
    DesktopRuntime snapshot,
    VoidCallback onDispatch,
    void Function(bool wasPlan) onPlanDowngrade,
  ) async {
    var imageKey = 'url', skills = true, plugins = true;
    var includeCollaborationMode = supportsPlan;
    final mode =
        base['collaborationMode'] ??
        (method == 'turn/start'
            ? snapshot.parameters(forTurn: true)['collaborationMode']
            : null);
    for (var attempt = 0; ; attempt++) {
      if (!current()) {
        throw StateError('The conversation changed before sending.');
      }
      try {
        final params = {
          ...base,
          'input': draft.input(
            imageUrlKey: imageKey,
            skills: skills,
            plugins: plugins,
          ),
        };
        if (!includeCollaborationMode) params.remove('collaborationMode');
        if (method == 'turn/start') {
          return await _runtimeRequest(
            method,
            params,
            isCurrent: current,
            snapshot: snapshot,
            onDispatch: onDispatch,
            includeCollaborationMode: includeCollaborationMode,
          );
        }
        onDispatch();
        return await transport.request(method, params);
      } on RemoteRpcException catch (e) {
        // Only explicit parameter rejection proves this mutation was not accepted.
        if (e.code != -32602 || attempt >= 4 || !current()) rethrow;
        final message = e.message.toLowerCase();
        if (includeCollaborationMode &&
            mode is Map &&
            RegExp('collaborationmode|collaboration_mode').hasMatch(message) &&
            RegExp(
              'experimentalapi|unsupported|unknown|unexpected|unrecognized|invalid|field',
            ).hasMatch(message)) {
          includeCollaborationMode = false;
          supportsPlan = false;
          plan = false;
          onPlanDowngrade(mode['mode'] == 'plan');
          continue;
        }
        if (!RegExp(
          'missing|unknown|unsupported|invalid|expected|unrecognized',
        ).hasMatch(message)) {
          rethrow;
        }
        if (imageKey == 'url' &&
            draft.images.isNotEmpty &&
            message.contains('image_url')) {
          imageKey = 'image_url';
        } else if (RegExp('input|item|type|field|variant').hasMatch(message) &&
            skills &&
            draft.contexts.any((c) => c.kind == DesktopContextKind.skill) &&
            message.contains('skill')) {
          skills = false;
        } else if (RegExp('input|item|type|field|variant').hasMatch(message) &&
            plugins &&
            draft.contexts.any((c) => c.kind == DesktopContextKind.plugin) &&
            message.contains('mention')) {
          plugins = false;
        } else if (message.contains('input') &&
            RegExp('item|type|array|schema').hasMatch(message) &&
            (skills &&
                    draft.contexts.any(
                      (c) => c.kind == DesktopContextKind.skill,
                    ) ||
                plugins &&
                    draft.contexts.any(
                      (c) => c.kind == DesktopContextKind.plugin,
                    ))) {
          skills = false;
          plugins = false;
        } else {
          rethrow;
        }
      }
    }
  }

  Future<RemoteJson> _runtimeRequest(
    String method,
    RemoteJson base, {
    bool includeModel = true,
    bool Function()? isCurrent,
    DesktopRuntime? snapshot,
    VoidCallback? onDispatch,
    bool includeCollaborationMode = true,
  }) async {
    final expected = snapshot ?? runtime;
    final options = expected.parameters(forTurn: method == 'turn/start');
    if (!includeModel) {
      options.remove('model');
      options.remove('djlProvider');
      options.remove('serviceTier');
    }
    var params = <String, dynamic>{...base, ...options};
    if (!includeCollaborationMode) params.remove('collaborationMode');
    for (var attempt = 0; ; attempt++) {
      if (isCurrent?.call() == false) {
        throw StateError('The conversation changed before sending.');
      }
      try {
        onDispatch?.call();
        final result = await transport.request(method, params);
        expected.validateApplied(result, context: method);
        return result;
      } on RemoteRpcException catch (e) {
        // Only a rejected parameter shape is safe to retry; transport failures have unknown outcomes.
        if (e.code != -32602 || attempt >= 4) rethrow;
        final message = e.message.toLowerCase();
        if (message.contains('sandboxpolicy') &&
            params.containsKey('sandboxPolicy')) {
          params = Map.of(params)..remove('sandboxPolicy');
          params['sandbox'] = expected.legacySandbox;
        } else if (message.contains('approvalsreviewer')) {
          if (params['approvalsReviewer'] == 'auto_review') {
            params['approvalsReviewer'] = 'guardian_subagent';
          } else if (params['approvalsReviewer'] == 'user') {
            params.remove('approvalsReviewer');
          } else {
            rethrow;
          }
        } else if (message.contains('approvalpolicy') &&
            params['approvalPolicy'] == 'on-request') {
          params['approvalPolicy'] = 'onRequest';
        } else {
          rethrow;
        }
      }
    }
  }

  final _stopAttempts =
      <_StopContext, ({Object token, bool Function() current})>{};

  _StopContext? get _stopContext {
    final id = thread?['id'];
    if (_disposed ||
        _suspended ||
        _requestsSuspended ||
        _hostConnecting ||
        _statusSecurityBlocked ||
        !connected ||
        !_routingAllowed ||
        switchingDevice != null ||
        id is! String ||
        transport.macDeviceId != active?.macDeviceId ||
        (threadList.macDeviceId != null &&
            threadList.macDeviceId != active?.macDeviceId)) {
      return null;
    }
    return (
      mac: active?.macDeviceId,
      pin: active?.data['macIdentityPublicKey'] as String?,
      session: transport.sessionId,
      generation: _connectGeneration,
      cache: threadList.data,
      thread: id,
      cwd: thread?['cwd'],
    );
  }

  bool get stoppingTurn {
    final scope = _stopContext;
    return scope != null && _stopAttempts[scope]?.current() == true;
  }

  bool get canStopTurn =>
      _stopContext != null &&
      _selectedRunBusy &&
      (turnId != null || !busy) &&
      !stoppingTurn;

  Future<void> stop() async {
    final scope = _stopContext;
    if (scope == null || !_selectedRunBusy || stoppingTurn) return;
    var expected = turnId;
    final binding = _responseConnection;
    final lifecycle = _responseCurrent ? _responseLifecycle : null;
    final pendingRevision = lifecycle?.pendingRevisionFor(scope.thread);
    bool current() =>
        _stopContext == scope &&
        turnId == expected &&
        (pendingRevision == null ||
            _responseCurrent &&
                binding == _responseConnection &&
                (!selectedResponseFooter.pending ||
                    lifecycle!.pendingRevisionFor(scope.thread) ==
                        pendingRevision));
    final token = Object();
    _stopAttempts[scope] = (token: token, current: current);
    ({String target, int revision})? marked;
    var packetSent = false, accepted = false, unpublished = false;
    Object? failure;
    error = null;
    _notify();

    Future<String?> resolveTarget() async {
      final snapshot = await _resolveActiveTurnSnapshot(scope.thread, current);
      if (!current()) throw StateError('The active run changed.');
      unpublished = snapshot.pending;
      if (unpublished) {
        throw StateError(appStrings.desktopRunIdPending);
      }
      final target = snapshot.activeTurnId;
      return target != null && !_finishedTurns.contains((scope.thread, target))
          ? target
          : null;
    }

    Future<void> interrupt(String target) async {
      if (!current()) throw StateError('The active run changed.');
      if (lifecycle != null) {
        lifecycle.interrupt(scope.thread, target);
        marked = (target: target, revision: lifecycle.revision);
        packetSent = false;
      }
      _notify();
      if (!current()) throw StateError('The active run changed.');
      try {
        packetSent = true;
        await transport.request('turn/interrupt', {
          'threadId': scope.thread,
          'turnId': target,
        });
        accepted = true;
      } on RemoteRpcException catch (e) {
        if (!current() ||
            !{-32600, -32602}.contains(e.code) ||
            !RegExp(
              'turnid|threadid|turn_id|thread_id|unknown field|missing field|invalid',
            ).hasMatch(e.message.toLowerCase())) {
          rethrow;
        }
        packetSent = true;
        await transport.request('turn/interrupt', {
          'thread_id': scope.thread,
          'turn_id': target,
        });
        accepted = true;
      }
    }

    try {
      if (!current()) return;
      var target = _realTurnId(expected);
      if (target == null ||
          selectedResponseFooter.pending ||
          _finishedTurns.contains((scope.thread, target))) {
        target = await resolveTarget();
        if (!current()) return;
      }
      if (target == null) {
        throw StateError(appStrings.desktopRunIdPending);
      }
      final previous = expected;
      expected = target;
      if (previous != target || selectedResponseFooter.pending) {
        _adoptTurnTarget(scope.thread, previous, target);
      }
      try {
        await interrupt(target);
      } on RemoteRpcException catch (e) {
        if (!current() || !_shouldRefreshTurnTarget(e)) rethrow;
        final refreshed = await resolveTarget();
        if (!current()) return;
        if (refreshed == null || refreshed == target) rethrow;
        expected = refreshed;
        _adoptTurnTarget(scope.thread, target, refreshed);
        await interrupt(refreshed);
      }
      if (current()) error = null;
    } catch (e) {
      failure = e;
      if (current()) {
        if (unpublished) {
          _retireTurnTarget(scope.thread, expected);
          expected = null;
          turnId = null;
          lifecycle?.starting(scope.thread);
          error = e.toString();
        } else {
          final message = e is RemoteRpcException && _shouldRefreshTurnTarget(e)
              ? e.message.toLowerCase()
              : '';
          final completed = message.contains('already completed');
          final terminal =
              completed ||
              [
                'turn not found',
                'no active turn',
                'not in progress',
                'not running',
                'already finished',
                'not active',
              ].any(message.contains);
          if (terminal) {
            final old = expected;
            _retireTurnTarget(scope.thread, old);
            if (lifecycle != null) {
              lifecycle.history(
                scope.thread,
                const [],
                lifecycle.revision,
                confirmedIdle: true,
              );
              if (old != null) {
                lifecycle.terminal(
                  scope.thread,
                  old,
                  completed
                      ? DesktopResponseOutcome.completed
                      : DesktopResponseOutcome.unknown,
                );
              }
            }
            _markSelectedThreadIdle();
            expected = null;
            turnId = null;
            error = null;
            _rememberCurrent();
          } else {
            error = e.toString();
          }
        }
      }
    } finally {
      final mark = marked, cause = failure;
      if (!accepted &&
          mark != null &&
          (!packetSent ||
              cause is RemoteRpcException &&
                  ({-32600, -32601, -32602}.contains(cause.code) ||
                      _shouldRefreshTurnTarget(cause)))) {
        lifecycle?.cancelInterrupt(scope.thread, mark.target, mark.revision);
      }
      if (identical(_stopAttempts[scope]?.token, token)) {
        _stopAttempts.remove(scope);
      }
      _notify();
    }
  }

  bool requestMatchesConnection(RemoteJson request) {
    final mac = request['_macDeviceId'], session = request['_sessionId'];
    return (mac == null ||
            mac == transport.macDeviceId && mac == active?.macDeviceId) &&
        (session == null || session == transport.sessionId);
  }

  Future<void> approve(
    RemoteJson request,
    String decision, {
    bool forSession = false,
  }) async {
    try {
      await _respond(
        request,
        approvalResult(
          request['method'] as String,
          request['params'] as RemoteJson? ?? {},
          accept: decision == 'accept',
          forSession: forSession,
        ),
      );
    } catch (e) {
      error = e.toString();
      _notify();
    }
  }

  final _closingQuestions = <RemoteJson, _StopContext>{};

  Future<void> answer(
    RemoteJson request,
    Map<String, List<String>> answers,
  ) async {
    if (serverRequestKind(request['method'] as String) !=
        ServerRequestKind.userInput) {
      return;
    }
    await _respond(request, userInputResult(answers));
  }

  void _incoming(RemoteJson rpc) {
    var method = rpc['method'] as String?;
    final params = rpc['params'] is Map
        ? Map<String, dynamic>.from(rpc['params'] as Map)
        : <String, dynamic>{};
    if (rpc['djlReplayedEvent'] == true) params['djlReplayedEvent'] = true;
    if (method == null) return;
    // The bridge's five-second presence heartbeat changes nothing on screen;
    // falling through would rebuild the page and rewrite the chat cache.
    if (method == 'djl/presence/heartbeat' ||
        method.startsWith('djl/groups/') ||
        groupThreads.contains(params['threadId'])) {
      return;
    }
    if (method == 'codex/event/user_message') {
      final identity = desktopResponseIdentity(params);
      final text = [
        params['message'],
        params['text'],
      ].whereType<String>().where((s) => s.trim().isNotEmpty).firstOrNull;
      if (rpc['id'] != null ||
          !connected ||
          transport.macDeviceId != active?.macDeviceId ||
          !requestMatchesConnection(rpc) ||
          identity == null ||
          text == null) {
        return;
      }
      final source = [
        params['itemId'],
        params['id'],
      ].whereType<String>().where((s) => s.trim().isNotEmpty).firstOrNull;
      params['threadId'] = identity.thread;
      if (identity.turn != null) params['turnId'] = identity.turn;
      params['item'] = {
        'id': source ?? '_djl-local-history:${const Uuid().v4()}',
        'type': 'userMessage',
        'delivery': 'confirmed',
        'content': [
          {'type': 'text', 'text': text},
        ],
      };
      method = 'item/completed';
    }
    final rawItem = params['item'];
    final ordinaryItem =
        rawItem is Map &&
        {'userMessage', 'agentMessage'}.contains(rawItem['type']);
    if (method == 'item/agentMessage/delta' ||
        ordinaryItem && {'item/started', 'item/completed'}.contains(method)) {
      if (!requestMatchesConnection(rpc)) return;
      var identity = desktopResponseIdentity(params);
      if (identity == null &&
          !params.containsKey('threadId') &&
          !params.containsKey('thread_id')) {
        identity = desktopResponseIdentity({
          ...params,
          'threadId': thread?['id'],
        });
      }
      if (identity == null) return;
      params['threadId'] = identity.thread;
      if (identity.turn != null) params['turnId'] = identity.turn;
    }
    if (rpc['id'] == null &&
        {
          'turn/started',
          'turn/completed',
          'turn/failed',
          'thread/status/changed',
        }.contains(method)) {
      final envelopes = [
        params,
        ?activityObject(params['turn']),
        ?activityObject(params['event']),
      ];
      final hasThread = envelopes.any(
        (value) =>
            activityObject(value['thread'])?['id'] != null ||
            [
              'threadId',
              'thread_id',
              'conversationId',
              'conversation_id',
            ].any((key) => value[key] != null),
      );
      if (!hasThread && thread?['id'] is String) {
        params['threadId'] = thread!['id'];
      }
      var identity = desktopResponseIdentity(params);
      if (identity != null &&
          identity.turn == null &&
          method != 'thread/status/changed' &&
          params['id'] != null) {
        params['turnId'] = params['id'];
        identity = desktopResponseIdentity(params);
      }
      if (identity == null) return;
      params['threadId'] = identity.thread;
      if (identity.turn != null) params['turnId'] = identity.turn;
    }
    if (method == 'thread/replaced' && rpc['id'] == null) {
      final identity = desktopResponseIdentity(params);
      if (identity == null ||
          !connected ||
          !requestMatchesConnection(rpc) ||
          transport.macDeviceId != active?.macDeviceId ||
          threadList.data.deleted.contains(identity.thread)) {
        return;
      }
      _resetProjectedSource(identity.thread);
      _historyReplacements[identity.thread] = ++_timelineRevision;
      if (thread?['id'] == identity.thread) {
        unawaited(
          openThread(thread!, userSelection: false, readOnlyNavigation: true),
        );
      } else {
        unawaited(_loadSubagent(identity.thread));
      }
      return;
    }
    if (_ignoreClosedRunActivity(method, params, rpc)) return;
    _adoptSourceContinuity(method, params, rpc);
    _reviveBackgroundGuess(method, params, rpc);
    if (method == 'turn/started' && rpc['id'] == null && _responseCurrent) {
      final identity = desktopResponseIdentity(params);
      if (identity == null) return;
      final turn = identity.turn;
      if (turn != null &&
          (_finishedTurns.contains((identity.thread, turn)) ||
              _responseLifecycle!.isTurnTerminal(identity.thread, turn))) {
        return;
      }
    }
    _observeSwitchRuns(method, params, rpc);
    _captureResponseOutcome(method, params, rpc);
    _noteMirroredRunActivity(method, params, rpc);
    if (method == 'account/rateLimits/updated' && rpc['id'] == null) {
      _bindHost();
      if (rpc['params'] is Map &&
          connected &&
          requestMatchesConnection(rpc) &&
          transport.macDeviceId == active?.macDeviceId) {
        usage.applyUpdate(params);
      }
      return;
    }
    if (method == 'account/updated' &&
        rpc['id'] == null &&
        connected &&
        requestMatchesConnection(rpc) &&
        transport.macDeviceId == active?.macDeviceId) {
      usage.accountChanged();
      unawaited(host.refresh());
      return;
    }
    if (rpc['id'] != null) {
      switch (serverRequestKind(method)) {
        case ServerRequestKind.userInput:
          _enqueueRequest(userInputs, rpc);
          final questions = params['questions'];
          if (_responseCurrent &&
              requestMatchesConnection(rpc) &&
              questions is List &&
              questions.whereType<Map>().any(
                (q) =>
                    activityString(q['id']) != null &&
                    q['question'] is String &&
                    q['header'] is String,
              )) {
            final identity = _planIdentity(params);
            if (identity != null) _recordPlanSession(identity.thread, 'native');
          }
        case ServerRequestKind.approval:
        case ServerRequestKind.permissions:
          _enqueueRequest(approvals, rpc);
        case ServerRequestKind.unsupported:
          unawaited(_rejectUnknown(rpc));
      }
      _rememberCurrent();
      _notify();
      return;
    }
    if (method.startsWith('djl/bufferedReplay/')) {
      if (method.endsWith('/gap') || method.endsWith('/reset')) {
        if (thread != null) {
          unawaited(openThread(thread!, userSelection: false));
        }
      }
      return;
    }
    if (_capturePlan(method, params, rpc)) return;
    if (_captureReasoning(method, params, rpc)) return;
    _captureRunStatus(method, params, rpc);
    _captureResponseChanges(method, params, rpc);
    final event =
        activityObject(params['msg']) ?? activityObject(params['event']);
    final legacyType = method.startsWith('codex/event/')
        ? method.substring('codex/event/'.length)
        : subagentString(event?['type']);
    final subagentItem =
        activityObject(params['item']) ??
        activityObject(event?['item']) ??
        (legacyType != null ? {...?event, 'type': legacyType} : null);
    if (subagentItem != null && isSubagentItem(subagentItem)) {
      if (!connected ||
          transport.macDeviceId == null ||
          active?.macDeviceId != transport.macDeviceId ||
          !requestMatchesConnection(rpc) ||
          threadList.macDeviceId != null &&
              threadList.macDeviceId != active?.macDeviceId) {
        return;
      }
      final parent =
          subagentString(params['threadId']) ??
          subagentString(params['thread_id']) ??
          subagentString(params['conversationId']) ??
          subagentString(params['conversation_id']);
      final turn =
          subagentString(params['turnId']) ??
          subagentString(params['turn_id']) ??
          subagentString(activityObject(params['turn'])?['id']) ??
          subagentString(subagentItem['turnId']) ??
          subagentString(subagentItem['turn_id']) ??
          (legacyType != null ? subagentString(params['id']) : null);
      if (parent == null ||
          turn == null ||
          threadList.data.deleted.contains(parent)) {
        return;
      }
      _bindSubagents();
      final action = SubagentAction.decode(
        {
          ...subagentItem,
          if (subagentItem['id'] == null &&
              subagentItem['call_id'] == null &&
              subagentItem['callId'] == null)
            'id': params['itemId'] ?? params['item_id'],
          if (subagentItem['status'] == null)
            'status':
                method == 'item/completed' ||
                    legacyType?.endsWith('_end') == true
                ? 'completed'
                : 'running',
        },
        mac: active!.macDeviceId,
        thread: parent,
        turn: turn,
      );
      if (action != null) {
        final merged = subagents.merge(action);
        if (params['djlReplayedEvent'] != true) {
          _noteTimelineLive(parent, merged.toRow());
        }
        _syncSubagentRows();
        _notify();
        unawaited(hydrateSubagents(merged));
      }
      return;
    }
    if ((method == 'turn/started' || method == 'turn/completed') &&
        connected &&
        requestMatchesConnection(rpc) &&
        transport.macDeviceId == active?.macDeviceId) {
      final child = subagentString(params['threadId']);
      final turn = activityObject(params['turn']);
      final id =
          subagentString(turn?['id']) ?? subagentString(params['turnId']);
      final metadata = child == null ? null : threadList.data.find(child);
      if (child != null && id != null && metadata?['isSubagent'] == true) {
        _bindSubagents();
        if (method == 'turn/completed') {
          final superseded =
              metadata?['subagentTurnId'] != null &&
              metadata?['subagentTurnId'] != id &&
              (metadata?['subagentStatus'] == 'running' ||
                  _subagentFinishedTurns.contains((child, id)));
          _subagentFinishedTurns.add((child, id));
          if (!superseded) {
            metadata!['subagentStatus'] = subagentStatus(
              turn?['status'] ?? 'completed',
            );
            metadata['subagentTurnId'] = id;
          }
        } else if (!_subagentFinishedTurns.contains((child, id)) &&
            !(metadata?['subagentTurnId'] == id &&
                {
                  'completed',
                  'failed',
                  'stopped',
                }.contains(metadata?['subagentStatus'])) &&
            params['djlReplayedEvent'] != true) {
          metadata!['subagentStatus'] = 'running';
          metadata['subagentTurnId'] = id;
        }
        threadList.scheduleSave();
        _notify();
      }
    }
    if ((method == 'turn/started' ||
            method == 'turn/completed' ||
            isActivityNotification(method, params)) &&
        connected &&
        transport.macDeviceId != null &&
        active?.macDeviceId == transport.macDeviceId &&
        requestMatchesConnection(rpc)) {
      _bindActivityDevice(transport.macDeviceId!);
      if (method == 'turn/started' || method == 'turn/completed') {
        final backgroundTurn = desktopResponseIdentity(params);
        activity.observeTurn(
          method,
          params,
          knownThreads: _knownActivityThreads,
          selectedThread: thread?['id'] as String?,
          backgroundGuess:
              backgroundTurn != null &&
              backgroundTurn.turn != null &&
              _reversibleClosure(
                backgroundTurn.thread,
                backgroundTurn.turn!,
                params,
              ),
        );
        _syncActivityRows();
      } else {
        final projected = activity.ingest(
          method,
          params,
          knownThreads: _knownActivityThreads,
          selectedThread: thread?['id'] as String?,
          selectedTurn: turnId,
        );
        if (projected != null &&
            !threadList.data.deleted.contains(projected.thread)) {
          if (params['djlReplayedEvent'] != true) {
            _noteTimelineLive(projected.thread, projected.toRow());
          }
          _syncActivityRows();
          _notify();
        }
        return;
      }
    } else if (isActivityNotification(method, params)) {
      return;
    }
    if (method == 'item/autoApprovalReview/started' ||
        method == 'item/autoApprovalReview/completed') {
      if (!_bindGuardianConnection() ||
          !requestMatchesConnection(rpc) ||
          threadList.data.deleted.contains(params['threadId'])) {
        return;
      }
      final review = GuardianReview.decode(params);
      if (review == null) return;
      final threadId = params['threadId'] as String;
      // A cached terminal row is a tombstone, never a fresh grant on duplicate delivery.
      if (guardian.find(threadId, review.reviewId) == null) {
        final cached = [
          ...?threadList.data.timelines[threadId],
          if (thread?['id'] == threadId) ...timeline,
        ];
        for (final row in cached) {
          final previous = GuardianReview.fromRow(row);
          if (previous?.reviewId == review.reviewId) {
            guardian.upsert(threadId, previous!, live: false);
          }
        }
      }
      guardian.upsert(
        threadId,
        review,
        live:
            params['djlReplayedEvent'] != true &&
            rpc['djlReplayedEvent'] != true,
      );
      if (params['djlReplayedEvent'] != true) {
        _noteTimelineLive(threadId, review.toRow(threadId));
      }
      _syncGuardianRows();
      _notify();
      return;
    }
    if (threadList.data.deleted.contains(params['threadId'])) return;
    if (params['threadId'] != null && params['threadId'] != thread?['id']) {
      if (method == 'item/agentMessage/delta' ||
          {'item/started', 'item/completed'}.contains(method) &&
              params['item'] is Map &&
              desktopOrdinaryHistoryRow(
                Map<String, dynamic>.from(params['item'] as Map),
              )) {
        final owner = params['threadId'] as String;
        threadList.data.timelines[owner] = _applyOrdinaryTimelineEvent(
          owner,
          threadList.data.timelines[owner] ?? [],
          method,
          params,
          rpc,
        );
        threadList.scheduleSave();
        _notify();
      }
      return;
    }
    var textOnly = false;
    switch (method) {
      case 'turn/started':
        final id =
            (params['turn'] as RemoteJson?)?['id'] as String? ??
            params['turnId'] as String?;
        if (params['djlReplayedEvent'] != true &&
            id != null &&
            !_finishedTurns.contains((thread?['id'] as String?, id))) {
          turnId = id;
          final identity = desktopResponseIdentity(params);
          if (identity?.thread == thread?['id'] &&
              identity?.turn == id &&
              selectedResponseFooter.latestTurn == id &&
              selectedResponseFooter.outcome(id) ==
                  DesktopResponseOutcome.running) {
            error = null;
          }
        }
      case 'turn/completed':
        final turn = params['turn'] as RemoteJson?;
        final id =
            turn?['id'] as String? ?? params['turnId'] as String? ?? turnId;
        final identity = desktopResponseIdentity(params);
        final failedCurrent =
            id != null &&
            identity?.thread == thread?['id'] &&
            identity?.turn == id &&
            selectedResponseFooter.latestTurn == id &&
            selectedResponseFooter.outcome(id) == DesktopResponseOutcome.failed;
        if (failedCurrent) {
          error =
              activityString(
                activityObject(turn?['error'] ?? params['error'])?['message'],
              ) ??
              appStrings.desktopResponseFailed;
        }
        if (id != null) {
          _finishedTurns.add((thread?['id'] as String?, id));
          final outcome = desktopResponseLiveOutcome(params);
          final event = activityObject(params['event']);
          final status =
              turn?['status'] ?? params['status'] ?? event?['status'];
          final successful =
              outcome == DesktopResponseOutcome.completed ||
              outcome == DesktopResponseOutcome.unknown &&
                  status == null &&
                  turn?['error'] == null &&
                  params['error'] == null &&
                  event?['error'] == null;
          if (params['djlReplayedEvent'] != true && successful) {
            final workspace = _workspace();
            if (workspace != null) {
              final key = _checkpointKey(workspace, id);
              var checkpoints = _checkpointsByTurn[key];
              checkpoints ??= TurnCheckpoints(workspace);
              _checkpointsByTurn[key] = checkpoints;
              final captured = checkpoints;
              final end = captured.completed(id);
              _checkpointEnds[key] = end;
              if (captured.messageId != null) {
                unawaited(
                  end.then((_) {
                    if (captured.repository.isCurrent &&
                        captured.warning == null &&
                        identical(_checkpointsByTurn[key], captured)) {
                      _unverifiedCheckpointOwners.remove(key);
                    }
                  }),
                );
              }
            }
          }
        }
        if (id == null || id == turnId) {
          turnId = null;
          if (!selectedResponseFooter.pending) _markSelectedThreadIdle();
        }
        if (thread != null) {
          unawaited(
            openThread(
              thread!,
              userSelection: false,
              preserveError: failedCurrent,
            ),
          );
        }
      case 'item/agentMessage/delta':
      case 'item/started':
      case 'item/completed':
        bool streaming(RemoteJson row) =>
            row['type'] == 'agentMessage' &&
            row['isStreaming'] == true &&
            desktopHistorySourceId(row) == params['itemId'];
        final appends =
            method == 'item/agentMessage/delta' && timeline.any(streaming);
        timeline = _applyOrdinaryTimelineEvent(
          thread!['id'] as String,
          timeline,
          method,
          params,
          rpc,
        );
        textOnly = appends && timeline.any(streaming);
      case 'serverRequest/resolved':
        approvals.removeWhere((a) => a['id'] == params['requestId']);
        userInputs.removeWhere((a) => a['id'] == params['requestId']);
      case 'error':
      case 'turn/failed':
        error =
            (params['error'] as RemoteJson?)?['message'] as String? ??
            params['message'] as String? ??
            appStrings.desktopRequestFailed;
      case 'djl/hostPresence':
        if (rpc['id'] == null &&
            connected &&
            !_suspended &&
            !_hostConnecting &&
            transport.macDeviceId == active?.macDeviceId &&
            requestMatchesConnection(rpc) &&
            params['online'] is bool) {
          state = params['online'] == true ? 'connected' : 'desktop offline';
        }
    }
    // A streaming reply is cached when it completes. Caching every delta
    // re-encrypted the whole chat cache several times a second.
    if (method != 'item/agentMessage/delta') _rememberCurrent();
    if (textOnly) {
      // More words for an answer already on screen: only that answer
      // redraws now; everything else catches up a few times a second.
      liveText.value++;
      _textCatchUp ??= Timer(const Duration(milliseconds: 250), () {
        _textCatchUp = null;
        _notify();
      });
      return;
    }
    _textCatchUp?.cancel();
    _textCatchUp = null;
    _notify();
  }

  /// Bumped for each streamed word of an answer already on screen. Only the
  /// streaming answer listens, so the rest of the chat does not rebuild.
  final liveText = ValueNotifier<int>(0);
  Timer? _textCatchUp;

  void _disconnected(Object? failure, int? code) {
    _statusTransportLost = true;
    if ({4001, 4005, 4009}.contains(code) ||
        failure is RemoteSecurityException) {
      _statusSecurityBlocked = true;
    }
    _subagentNavigationIntent++;
    _clearGuardianAuthority();
    _clearReasoningAuthority();
    _rememberCurrent();
    approvals.clear();
    _resetSubmittedQuestions();
    _requestsSuspended = true;
    unawaited(threadList.saveNow());
    state = 'disconnected';
    error = failure?.toString();
    _notify();
    _scheduleRecovery(failure, code);
  }

  void _scheduleRecovery(Object? failure, int? code) {
    _retry?.cancel();
    if ({4001, 4005, 4009}.contains(code) ||
        failure is RemoteSecurityException) {
      _statusSecurityBlocked = true;
      _intent = false;
      return;
    }
    if (!_routingAllowed ||
        !automaticConnectionAllowed ||
        !_intent ||
        _suspended ||
        _disposed ||
        active == null) {
      return;
    }
    final seconds = (1 << _failures.clamp(0, 5));
    _failures++;
    _retry = Timer(Duration(seconds: seconds), () {
      if (_routingAllowed && active != null) unawaited(connect(active!));
    });
  }

  void suspend() {
    if (switchingDevice != null) {
      unawaited(cancelSavedSwitch());
      _suspended = true;
      return;
    }
    if (_connectingRecovery || _pairingSubmission) {
      busy = false;
      _connectingRecovery = false;
      _pairingSubmission = false;
      _hostConnecting = false;
    }
    _clearGuardianAuthority();
    _clearReasoningAuthority();
    _rememberCurrent();
    approvals.clear();
    _resetSubmittedQuestions();
    _requestsSuspended = true;
    unawaited(threadList.saveNow());
    _connectGeneration++;
    _suspended = true;
    _retry?.cancel();
    unawaited(transport.disconnect());
    state = 'suspended';
    _notify();
  }

  void resume() {
    if (!_routingAllowed) return;
    _suspended = false;
    if (connected) unawaited(refreshHost());
    if (automaticConnectionAllowed && _intent && active != null && !connected) {
      unawaited(connect(active!));
    }
  }

  void closeThread(String id) {
    if (thread?['id'] != id) return;
    _subagentNavigationIntent++;
    _rememberCurrent();
    thread = null;
    _applyRuntime(newChatRuntime);
    timeline = [];
    turnId = null;
    _notify();
  }

  Future<void> reconnect() async {
    final pair = active;
    if (pair != null) await connect(pair);
  }

  Future<void> disconnect() async {
    _statusTransportLost = true;
    selectionRevision++;
    cancelNavigation();
    _clearGuardianAuthority();
    _clearReasoningAuthority();
    _rememberCurrent();
    approvals.clear();
    _resetSubmittedQuestions();
    _requestsSuspended = true;
    _connectGeneration++;
    _intent = false;
    _retry?.cancel();
    state = 'disconnected';
    final closing = transport.disconnect();
    _notify();
    await closing;
    await threadList.saveNow();
    approvals.clear();
    userInputs.clear();
    _notify();
  }

  Future<void> forget(Pairing pair) async {
    // Older versions could save a ChatGPT sign-in record per Mac; drop it.
    await pairings.credentials.write(
      'codex.gpt.pendingLoginState.'
      '${base64Url.encode(utf8.encode(jsonEncode([pair.macDeviceId, pair.publicKey])))}',
      null,
    );
    if (isActiveDevice(pair)) {
      await disconnect();
      active = null;
      thread = null;
      timeline = [];
    }
    await pairings.forget(pair);
    await restore();
  }

  @override
  void dispose() {
    _textCatchUp?.cancel();
    liveText.dispose();
    if (switchingDevice != null) unawaited(cancelSavedSwitch());
    _connectGeneration++;
    _clearGuardianAuthority();
    _clearReasoningAuthority();
    _rememberCurrent();
    unawaited(threadList.saveNow());
    threadList.removeListener(_threadListChanged);
    threadList.dispose();
    host.removeListener(_hostChanged);
    usage.removeListener(_hostChanged);
    usage.dispose();
    host.dispose();
    _disposed = true;
    _retry?.cancel();
    _hostPresenceRecovery?.cancel();
    unawaited(_subscription?.cancel());
    unawaited(transport.dispose());
    super.dispose();
  }
}
