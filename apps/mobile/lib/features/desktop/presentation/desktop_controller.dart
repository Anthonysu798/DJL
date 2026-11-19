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
import '../../host/presentation/paired_login_controller.dart';
import '../../host/data/paired_login_store.dart';
import '../../host/domain/paired_login.dart';
import '../../status/domain/run_status.dart';

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
    pairedLogin = PairedLoginController(
      host,
      PairedLoginStore(pairings.credentials, allowLocal: pairings.allowLocal),
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
        throw const RemoteSecurityException(
          'A saved verified host is required.',
        );
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
  late final PairedLoginController pairedLogin;
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
    pairedLogin.bind(
      host.trusted && pair != null
          ? LoginIdentity(pair.macDeviceId, pair.publicKey)
          : null,
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
            'The desktop could not complete this response. Check its provider settings and retry.';
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

  void _clearReasoningAuthority() {
    _attentionUnread.clear();
    _attentionTerminals.clear();
    _responseConnection = null;
    _responseLifecycle = null;
    _responseAttempt = null;
    _reasoningConnection = null;
    _reasoningAttempt = null;
    _reasoning = null;
  }

  void _beginReasoningConnection(Pairing pair, int generation) {
    _reasoningConnection = (
      mac: pair.macDeviceId,
      pin: pair.publicKey,
      session: pair.sessionId,
      generation: generation,
      cache: threadList.data,
    );
    _responseConnection = _reasoningConnection;
    _responseAttempt = generation;
    _responseLifecycle = DesktopResponseLifecycle(now: _runClock);
    _reasoningAttempt = generation;
    _reasoning = ReasoningReducer(pair.macDeviceId, pair.publicKey);
    for (final rows in threadList.data.timelines.values) {
      for (final row in rows) {
        _reasoning!.restore(row);
      }
    }
  }

  bool _reasoningCurrent() {
    final binding = _reasoningConnection;
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
        // RemoteTransport starts decrypted reads only after trust(pair) succeeds.
        // The exact captured attempt bridges early replay until the normal trust refresh.
        (_reasoningAttempt == binding.generation ||
            trusted.any(
              (p) => p.macDeviceId == binding.mac && p.publicKey == binding.pin,
            ));
  }

  bool reasoningRowMatchesHost(RemoteJson row) =>
      _reasoningRowMatchesThread(row, thread?['id'] as String?);

  bool _reasoningRowMatchesThread(RemoteJson row, String? threadId) {
    final value = DesktopReasoning.fromRow(row);
    return value != null &&
        value.mac == active?.macDeviceId &&
        value.pin == active?.publicKey &&
        value.thread == threadId &&
        !threadList.data.deleted.contains(value.thread);
  }

  _ReasoningHistory? _captureReasoningHistory() => !_reasoningCurrent()
      ? null
      : (
          connection: _reasoningConnection!,
          watermark: _reasoning!.revision,
          selected: thread?['id'],
          selectionRevision: selectionRevision,
        );

  bool _reasoningHistoryCurrent(
    _ReasoningHistory? request, {
    bool selection = true,
  }) =>
      request == null ||
      _reasoningCurrent() &&
          request.connection == _reasoningConnection &&
          (!selection ||
              request.selected == thread?['id'] &&
                  request.selectionRevision == selectionRevision);

  void _syncReasoningRows() {
    if (!_reasoningCurrent()) return;
    for (final item in _reasoning!.items.values) {
      if (threadList.data.deleted.contains(item.thread)) continue;
      final rows = thread?['id'] == item.thread
          ? timeline
          : threadList.data.timelines.putIfAbsent(item.thread, () => []);
      final index = rows.indexWhere((row) => row['id'] == item.id);
      if (index < 0) {
        rows.add(item.toRow());
      } else {
        rows[index] = item.toRow();
      }
      threadList.data.timelines[item.thread] = List.of(rows);
    }
    threadList.scheduleSave();
  }

  bool _reversibleClosure(String thread, String turn, RemoteJson params) =>
      _responseCurrent &&
      (_responseLifecycle!.facts(thread).outcome(turn) ==
              DesktopResponseOutcome.stopped ||
          turn.startsWith('ipc-turn-') &&
              (params['djlDesktopMirror'] == true ||
                  params['djlRolloutLiveMirror'] == true));

  bool _captureReasoning(String method, RemoteJson params, RemoteJson rpc) {
    final reasoning = isReasoningNotification(method, params);
    if (!reasoning && method != 'turn/started' && method != 'turn/completed') {
      return false;
    }
    if (!_reasoningCurrent() || !requestMatchesConnection(rpc)) {
      return reasoning;
    }
    final identity = reasoningTurn(params);
    if (identity == null || threadList.data.deleted.contains(identity.thread)) {
      return reasoning;
    }
    final replay =
        rpc['djlReplayedEvent'] == true || params['djlReplayedEvent'] == true;
    if (reasoning) {
      final projected = _reasoning!.ingest(method, params, replay: replay);
      if (!replay && projected != null) {
        _noteTimelineLive(projected.thread, projected.toRow());
      }
    } else {
      _reasoning!.observeTurn(
        method,
        params,
        replay: replay,
        backgroundGuess: _reversibleClosure(
          identity.thread,
          identity.turn,
          params,
        ),
      );
    }
    _syncReasoningRows();
    if (reasoning) _notify();
    return reasoning;
  }

  RemoteJson? _reasoningHistoryRow(
    RemoteJson item,
    String threadId,
    RemoteJson turn,
    _ReasoningHistory? request,
  ) {
    if (request == null ||
        !_reasoningHistoryCurrent(request) ||
        item.containsKey(reasoningMetadataKey) ||
        threadList.data.deleted.contains(threadId)) {
      return null;
    }
    final identity = reasoningIdentity({
      'threadId': threadId,
      'turn': turn,
      'item': item,
    });
    if (identity == null) return null;
    final projected = _reasoning!.history(
      item,
      thread: threadId,
      turn: identity.turn,
      status: turn['status'],
      watermark: request.watermark,
    );
    if (projected != null) {
      // Only fresh trusted history may replace an unbound legacy cache identity.
      threadList.data.timelines[threadId]?.removeWhere(
        (row) =>
            row['type'] == 'reasoning' &&
            !row.containsKey(reasoningMetadataKey) &&
            row['id'] == identity.item &&
            (row['turnId'] ?? row['turn_id']) == identity.turn,
      );
    }
    return projected?.toRow();
  }

  void _reasoningHistoryTurn(
    RemoteJson turn,
    String threadId,
    _ReasoningHistory? request,
  ) {
    if (request == null ||
        !_reasoningHistoryCurrent(request) ||
        threadList.data.deleted.contains(threadId)) {
      return;
    }
    final identity = reasoningTurn({'threadId': threadId, 'turn': turn});
    if (identity != null) {
      _reasoning!.historyTurn(
        threadId,
        identity.turn,
        turn['status'],
        watermark: request.watermark,
        canonicalItems: [
          for (final raw in (turn['items'] as List? ?? []).whereType<Map>())
            if (raw['type'] == 'reasoning' &&
                !raw.containsKey(reasoningMetadataKey))
              Map<String, dynamic>.from(raw),
        ],
      );
    }
  }

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

  void _bindSubagents() {
    final mac = active?.macDeviceId;
    final data = threadList.data;
    if (_subagentMac != mac || !identical(_subagentCache, data)) {
      subagents.items.clear();
      _subagentFinishedTurns.clear();
      _subagentLoads.clear();
      _subagentLoadStates.clear();
      _subagentCache = data;
      _subagentMac = mac;
      for (final entry in data.timelines.entries) {
        if (data.deleted.contains(entry.key)) continue;
        for (final row in entry.value) {
          final action = SubagentAction.decode(
            row,
            mac: mac ?? '',
            thread: entry.key,
            turn: subagentString(row['turnId']) ?? '',
          );
          if (action != null) {
            subagents.merge(action);
          }
        }
      }
    }
    if (_subagentSession != transport.sessionId) {
      _subagentSession = transport.sessionId;
      _subagentLoads.clear();
      _subagentLoadStates.clear();
    }
  }

  void _registerSubagents(SubagentAction action) {
    for (final child in action.children) {
      if (child.thread == action.thread ||
          threadList.data.deleted.contains(child.thread)) {
        continue;
      }
      final prior = threadList.data.find(child.thread);
      threadList.data.upsert({
        'id': child.thread,
        'isSubagent': true,
        if (child.agentId != null && prior?['agentId'] == null)
          'agentId': child.agentId,
        if (child.nickname != null && prior?['agentNickname'] == null)
          'agentNickname': child.nickname,
        if (child.role != null && prior?['agentRole'] == null)
          'agentRole': child.role,
        // A wait/update reference is not evidence of parentage or inherited runtime.
        if (action.tool == 'spawnagent' &&
            prior?['parentThreadId'] == null &&
            prior?['forkedFromThreadId'] == null)
          'parentThreadId': action.thread,
      });
    }
  }

  void _syncSubagentRows() {
    for (final action in subagents.items.values) {
      if (action.mac != active?.macDeviceId ||
          threadList.macDeviceId != null &&
              threadList.macDeviceId != action.mac ||
          threadList.data.deleted.contains(action.thread)) {
        continue;
      }
      final rows = thread?['id'] == action.thread
          ? timeline
          : threadList.data.timelines.putIfAbsent(action.thread, () => []);
      final index = rows.indexWhere(
        (row) =>
            row['id'] == action.id ||
            SubagentAction.decode(
                  row,
                  mac: action.mac,
                  thread: action.thread,
                  turn: subagentString(row['turnId']) ?? '',
                )?.id ==
                action.id,
      );
      if (index < 0) {
        rows.add(action.toRow());
      } else {
        rows[index] = action.toRow();
      }
      threadList.data.timelines[action.thread] = List.of(rows);
      _registerSubagents(action);
    }
    threadList.scheduleSave();
  }

  String? subagentMetadataState(String id) =>
      !connected ? 'Offline · cached details' : _subagentLoadStates[id];
  SubagentChild resolvedSubagent(SubagentChild child) {
    final metadata = threadList.data.find(child.thread);
    final resolved = SubagentChild.decode(
      child.thread,
      child.toJson(),
      requested: child.requestedModel,
      cached: true,
    );
    if (metadata != null) {
      resolved.merge(SubagentChild.fromThread(child.thread, metadata));
      final status = subagentString(metadata['subagentStatus']);
      if (status != null) resolved.status = status;
    }
    return resolved;
  }

  Future<void> hydrateSubagents(SubagentAction action) async {
    if (action.mac.isNotEmpty && action.mac != active?.macDeviceId) return;
    _bindSubagents();
    await Future.wait(
      action.children
          .where((child) => !resolvedSubagent(child).hasIdentity)
          .map((child) => _loadSubagent(child.thread)),
    );
  }

  Future<void> _loadSubagent(String id) {
    if (!connected ||
        transport.macDeviceId != active?.macDeviceId ||
        threadList.macDeviceId != null &&
            threadList.macDeviceId != active?.macDeviceId ||
        threadList.data.deleted.contains(id)) {
      return Future.value();
    }
    final pending = _subagentLoads[id];
    if (pending != null) return pending;
    // Loading state is presentation only. A later reference/open can retry an
    // unmaterialized child; only concurrent reads are coalesced above.
    final data = threadList.data,
        mac = active!.macDeviceId,
        session = transport.sessionId,
        generation = _connectGeneration,
        pin = active?.data['macIdentityPublicKey'],
        connectionRevision = transport.connectionRevision,
        originalBinding = data.projectBindings[id],
        originalCwd = data.find(id)?['cwd'];
    bool sameFolder() =>
        data.projectBindings[id] == originalBinding &&
        data.find(id)?['cwd'] == originalCwd;
    bool current() =>
        !_disposed &&
        connected &&
        generation == _connectGeneration &&
        transport.macDeviceId == mac &&
        active?.macDeviceId == mac &&
        active?.data['macIdentityPublicKey'] == pin &&
        transport.connectionRevision == connectionRevision &&
        transport.sessionId == session &&
        identical(data, threadList.data) &&
        !data.deleted.contains(id);
    _subagentLoadStates[id] = 'Loading agent details';
    final future = () async {
      final timelineWatermark = _timelineRevision;
      try {
        final reasoningHistory = _captureReasoningHistory();
        final responseHistory = _captureResponseHistory();
        // Display-only hydration must never resume or install any runtime settings.
        final response = await transport.request('thread/read', {
          'threadId': id,
          'includeTurns': true,
        });
        if (!current()) return;
        if (!sameFolder()) {
          _subagentLoadStates.remove(id);
          return;
        }
        final raw = activityObject(response['thread']);
        if (raw == null || raw['id'] != id) {
          throw StateError('Mismatched child metadata');
        }
        _observeSwitchHistory(raw);
        _acceptResponseHistory(raw, responseHistory, selected: false);
        final metadata = normalizeThread(
          subagentThreadMetadata(normalizeThread(raw), id),
        );
        final turns = raw['turns'] is List ? raw['turns'] as List : const [];
        if (turns.isNotEmpty && turns.last is Map) {
          final last = turns.last as Map;
          final prior = data.find(id);
          final priorTurn = prior?['subagentTurnId'];
          final status = subagentStatus(last['status']);
          if (priorTurn == null ||
              priorTurn == last['id'] &&
                  !{
                    'completed',
                    'failed',
                    'stopped',
                  }.contains(prior?['subagentStatus'])) {
            metadata['subagentStatus'] = status;
            metadata['subagentTurnId'] = last['id'];
          }
        }
        data.upsert(metadata, fromServer: true);
        // Cache read-only history without touching the selected timeline, composer or runtime.
        data.timelines[id] = _reconcileOwnedHistory(
          raw,
          List<RemoteJson>.of(data.timelines[id] ?? []),
          reasoningHistory: reasoningHistory,
          timelineWatermark: timelineWatermark,
        );
        _syncReasoningRows();
        _subagentLoadStates[id] =
            SubagentChild.fromThread(id, metadata).hasIdentity
            ? 'Details loaded'
            : 'Agent identity unknown';
        threadList.scheduleSave();
      } catch (_) {
        if (current()) _subagentLoadStates[id] = 'Could not load agent details';
      } finally {
        if (current()) {
          _subagentLoads.remove(id);
          if ((_historyReplacements[id] ?? 0) > timelineWatermark) {
            unawaited(_loadSubagent(id));
          }
          _notify();
        }
      }
    }();
    _subagentLoads[id] = future;
    return future;
  }

  RemoteJson? get subagentParent {
    final route = _subagentReturn;
    if (route != null &&
        route.mac == active?.macDeviceId &&
        route.child == thread?['id']) {
      return threadList.data.deleted.contains(route.parent['id'])
          ? null
          : threadList.data.find(route.parent['id'] as String) ?? route.parent;
    }
    final id = subagentString(thread?['parentThreadId']);
    return id == null ? null : threadList.data.find(id);
  }

  Future<void> openSubagent(SubagentAction action, SubagentChild child) async {
    if (thread?['id'] != action.thread ||
        action.mac.isNotEmpty && action.mac != active?.macDeviceId ||
        threadList.data.deleted.contains(child.thread) ||
        child.thread == action.thread) {
      return;
    }
    final parent = Map<String, dynamic>.from(thread!),
        mac = active?.macDeviceId,
        connectionMac = transport.macDeviceId,
        session = transport.sessionId,
        generation = _connectGeneration,
        data = threadList.data,
        wasConnected = connected,
        intent = ++_subagentNavigationIntent;
    // Explicit selection can use normal chat resume, after loading the child's policy read-only.
    _bindSubagents();
    if (connected && threadList.data.runtimes[child.thread] == null) {
      await _loadSubagent(child.thread);
    }
    if (_disposed ||
        intent != _subagentNavigationIntent ||
        generation != _connectGeneration ||
        session != transport.sessionId ||
        connectionMac != transport.macDeviceId ||
        !identical(data, threadList.data) ||
        connected != wasConnected ||
        thread?['id'] != parent['id'] ||
        active?.macDeviceId != mac) {
      return;
    }
    _subagentReturn = (mac: mac ?? '', child: child.thread, parent: parent);
    await openThread(
      threadList.data.find(child.thread) ?? {'id': child.thread},
      subagentSelection: true,
    );
  }

  Future<void> returnToSubagentParent() async {
    final parent = subagentParent;
    if (parent == null) return;
    _subagentReturn = null;
    await openThread(parent);
  }

  final activity = ActivityReducer();
  ThreadLocalState? _hydratedActivityCache;
  void _bindActivityDevice(String device) {
    if (activity.mac != device) {
      activity.bind(device);
      _hydratedActivityCache = null;
    }
    final data = threadList.data;
    if (threadList.macDeviceId != device ||
        active?.macDeviceId != device ||
        identical(_hydratedActivityCache, data)) {
      return;
    }
    // Hydrate once per loaded device cache, before live updates can replace rich rows.
    for (final entry in data.timelines.entries) {
      if (data.deleted.contains(entry.key)) continue;
      for (final row in entry.value) {
        final saved = DesktopActivity.fromRow(row);
        if (saved == null ||
            saved.thread != entry.key ||
            saved.mac.isNotEmpty && saved.mac != device) {
          continue;
        }
        activity.restore(row, thread: entry.key, turn: saved.turn);
      }
    }
    _hydratedActivityCache = data;
  }

  Set<String> get _knownActivityThreads => threadList.data.snapshots
      .map((row) => activityString(row['id']))
      .whereType<String>()
      .toSet();
  void _syncActivityRows() {
    if (activity.mac != active?.macDeviceId ||
        threadList.macDeviceId != null &&
            activity.mac != threadList.macDeviceId) {
      return;
    }
    for (final a in activity.items.values) {
      if (threadList.data.deleted.contains(a.thread)) continue;
      final rows = thread?['id'] == a.thread
          ? timeline
          : threadList.data.timelines.putIfAbsent(a.thread, () => []);
      final row = a.toRow();
      final index = rows.indexWhere(
        (old) =>
            old['id'] == row['id'] ||
            activityKind(old) != null &&
                old['id'] == a.item &&
                old['turnId'] == a.turn,
      );
      if (index < 0) {
        rows.add(row);
      } else {
        rows[index] = row;
      }
      threadList.data.timelines[a.thread] = List.of(rows);
    }
    threadList.scheduleSave();
  }

  bool _bindGuardianConnection() {
    final mac = transport.macDeviceId, session = transport.sessionId;
    final valid =
        connected &&
        mac != null &&
        mac.isNotEmpty &&
        session != null &&
        session.isNotEmpty &&
        active?.macDeviceId == mac;
    guardian.bind(valid ? mac : null, valid ? session : null);
    return valid;
  }

  void _syncGuardianRows() {
    final device = guardian.deviceId;
    if (device != null &&
        (active?.macDeviceId != device ||
            threadList.macDeviceId != null &&
                threadList.macDeviceId != device)) {
      return;
    }
    for (final entry in guardian.reviews.entries) {
      final id = entry.key.$1;
      if (threadList.data.deleted.contains(id)) continue;
      final rows = thread?['id'] == id
          ? timeline
          : threadList.data.timelines.putIfAbsent(id, () => []);
      final row = entry.value.toRow(id);
      final index = rows.indexWhere((item) => item['id'] == row['id']);
      if (index < 0) {
        rows.add(row);
      } else {
        rows[index] = row;
      }
      threadList.data.timelines[id] = List.of(rows);
    }
    threadList.scheduleSave();
  }

  void _clearGuardianAuthority() {
    guardian.bind(null, null);
    _syncGuardianRows();
  }

  Future<bool> approveGuardianRetry(String threadId, String reviewId) async {
    if (!_bindGuardianConnection()) {
      _syncGuardianRows();
      _notify();
      return false;
    }
    final mac = transport.macDeviceId!, session = transport.sessionId!;
    final generation = _connectGeneration,
        epoch = guardian.epoch,
        data = threadList.data;
    final event = guardian.consume(threadId, reviewId, mac, session);
    _syncGuardianRows();
    _notify();
    if (event == null) return false;
    bool current() =>
        !_disposed &&
        generation == _connectGeneration &&
        guardian.epoch == epoch &&
        connected &&
        transport.macDeviceId == mac &&
        active?.macDeviceId == mac &&
        transport.sessionId == session &&
        identical(threadList.data, data);
    try {
      final result = await transport.request(
        'thread/approveGuardianDeniedAction',
        {'threadId': threadId, 'event': event},
      );
      if (!current()) return false;
      if (result['success'] == false) {
        throw StateError('Desktop did not acknowledge retry approval.');
      }
      final applied = guardian.finish(
        threadId,
        reviewId,
        event: event,
        acknowledged: true,
      );
      _syncGuardianRows();
      _notify();
      return applied;
    } catch (_) {
      if (current()) {
        guardian.finish(threadId, reviewId, event: event, acknowledged: false);
        _syncGuardianRows();
        _notify();
      }
      return false;
    }
  }

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
      throw StateError(
        'Wait for the current chat operation before moving its project.',
      );
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
      error =
          'The provider for this conversation is unavailable. Connect it on your desktop or choose another provider.';
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

  void _bindQueuedOwner() {
    final owner = (
      mac: active?.macDeviceId,
      pin: active?.data['macIdentityPublicKey'],
    );
    if (_queuedOwner != owner) {
      _queuedByThread.clear();
      _queuePausedByThread.clear();
      _queuedDelivery = null;
      _queuedSteering = null;
      _queuedOwnerEpoch++;
      _queuedOwner = owner;
    }
  }

  List<DesktopQueuedDraft> get queuedDrafts {
    _bindQueuedOwner();
    return List.unmodifiable(_queuedByThread[thread?['id']] ?? []);
  }

  String? get queuePauseMessage {
    _bindQueuedOwner();
    return _queuePausedByThread[thread?['id']];
  }

  String? get steeringQueuedDraftId {
    _bindQueuedOwner();
    return _queuedSteering?.thread == thread?['id']
        ? _queuedSteering?.id
        : null;
  }

  bool get queuedActionInProgress => _queuedDelivery != null;
  bool get canSteerQueuedDrafts =>
      _queuedCommandReady && _selectedRunBusy && turnId != null;

  bool get _queuedCommandReady =>
      !_disposed &&
      !_suspended &&
      connected &&
      state == 'connected' &&
      _responseCurrent &&
      !busy &&
      !projectMoveBusy &&
      switchingDevice == null &&
      _queuedDelivery == null &&
      _routingAllowed &&
      thread?['id'] is String;
  bool get _selectedRunBusy =>
      thread?['id'] is String &&
      (turnId != null ||
          selectedResponseFooter.suppressesLatest ||
          _runningStatus(thread?['status']));

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

  Future<void> resumeQueuedDrafts() => _resumeQueuedDrafts();

  Future<void> _resumeQueuedDrafts({bool waitForIdle = false}) async {
    _bindQueuedOwner();
    final id = thread?['id'];
    if (id is! String ||
        _disposed ||
        _suspended ||
        !_routingAllowed ||
        _queuedDelivery != null ||
        busy) {
      return;
    }
    if (!_queuePausedByThread.containsKey(id) || !connected) {
      _queuePausedByThread.remove(id);
      if (error?.startsWith('Queue paused:') == true) error = null;
      await flushQueuedDrafts();
      _notify();
      return;
    }
    if (!_queuedCommandReady) return;
    final request = _captureResponseHistory();
    if (request == null) return;
    final epoch = _queuedOwnerEpoch,
        owner = _queuedOwner,
        cache = threadList.data;
    final generation = _connectGeneration,
        mac = transport.macDeviceId,
        session = transport.sessionId,
        cwd = thread?['cwd'];
    bool current() =>
        !_disposed &&
        !_suspended &&
        epoch == _queuedOwnerEpoch &&
        owner == _queuedOwner &&
        owner?.mac == active?.macDeviceId &&
        owner?.pin == active?.data['macIdentityPublicKey'] &&
        generation == _connectGeneration &&
        mac == transport.macDeviceId &&
        session == transport.sessionId &&
        identical(cache, threadList.data) &&
        thread?['id'] == id &&
        thread?['cwd'] == cwd;
    final token = Object();
    _queuedDelivery = token;
    var refreshed = false;
    try {
      final response = await transport.request('thread/read', {
        'threadId': id,
        'includeTurns': true,
      });
      if (!current()) return;
      final value = response['thread'];
      if (value is! Map ||
          value['id'] != id ||
          (value.containsKey('cwd') && value['cwd'] != cwd) ||
          value['turns'] is! List ||
          (value['turns'] as List).any((row) => row is! Map)) {
        throw StateError('The runtime did not return this chat’s turn state.');
      }
      final turns = (value['turns'] as List).cast<Map>().where(
        (row) => !('${row['id'] ?? row['turnId'] ?? row['turn_id'] ?? ''}')
            .startsWith('djl-history-compacted-'),
      );
      final latest = turns.lastOrNull;
      final outcome = latest == null
          ? DesktopResponseOutcome.completed
          : desktopResponseHistoryOutcome({
              ...Map<String, dynamic>.from(latest),
              'status':
                  latest['status'] ??
                  latest['turnStatus'] ??
                  latest['turn_status'],
            });
      if (outcome == DesktopResponseOutcome.unknown) return;
      final idle = outcome != DesktopResponseOutcome.running;
      _acceptResponseHistory(
        Map<String, dynamic>.from(value),
        request,
        confirmedIdle: idle,
      );
      final facts = selectedResponseFooter;
      if (idle && !facts.suppressesLatest) {
        turnId = null;
      } else if (!idle && latest != null) {
        final live = _realTurnId(
          latest['id'] ?? latest['turnId'] ?? latest['turn_id'],
        );
        if (live != null &&
            facts.latestTurn == live &&
            facts.outcome(live) == DesktopResponseOutcome.running &&
            !_finishedTurns.contains((id, live))) {
          _responseLifecycle!.starting(id, live);
          turnId = live;
        }
      }
      if (waitForIdle && _selectedRunBusy) return;
      _queuePausedByThread.remove(id);
      if (error?.startsWith('Queue paused:') == true) error = null;
      refreshed = true;
    } catch (e) {
      if (current()) {
        _queuePausedByThread[id] = e.toString();
        error = 'Queue paused: $e';
      }
    } finally {
      if (identical(_queuedDelivery, token)) _queuedDelivery = null;
      _notify();
    }
    if (refreshed && current()) await flushQueuedDrafts();
  }

  Future<bool> steerQueuedDraft(String id) async {
    final draft = queuedDrafts.where((row) => row.id == id).firstOrNull;
    if (draft == null ||
        !_queuedCommandReady ||
        !_selectedRunBusy ||
        turnId == null) {
      return false;
    }
    return _deliverQueuedDraft(draft, steer: true);
  }

  bool removeQueuedDraft(String id) {
    _bindQueuedOwner();
    if (_disposed || steeringQueuedDraftId == id) return false;
    final drafts = _queuedByThread[thread?['id']];
    if (drafts == null || !drafts.any((row) => row.id == id)) return false;
    drafts.removeWhere((row) => row.id == id);
    _notify();
    return true;
  }

  bool restoreQueuedDraft(
    String id,
    bool Function(DesktopQueuedDraft) restore,
  ) {
    final draft = queuedDrafts.where((row) => row.id == id).firstOrNull;
    if (_disposed || busy || _queuedDelivery != null || draft == null) {
      return false;
    }
    final epoch = _queuedOwnerEpoch, selected = thread?['id'];
    if (!restore(draft) ||
        epoch != _queuedOwnerEpoch ||
        selected != thread?['id']) {
      return false;
    }
    return removeQueuedDraft(id);
  }

  Future<bool> _deliverQueuedDraft(
    DesktopQueuedDraft draft, {
    required bool steer,
  }) async {
    final id = thread!['id'] as String, cwd = thread?['cwd'];
    final epoch = _queuedOwnerEpoch, owner = _queuedOwner;
    final generation = _connectGeneration,
        mac = transport.macDeviceId,
        session = transport.sessionId;
    final token = _QueuedAttempt(steer: steer);
    _queuedDelivery = token;
    _queuedSteering = steer ? (thread: id, id: draft.id) : null;
    if (!steer) _queuedByThread[id]!.removeWhere((row) => row.id == draft.id);
    bool ownsNamespace() =>
        !_disposed &&
        epoch == _queuedOwnerEpoch &&
        owner == _queuedOwner &&
        owner?.mac == active?.macDeviceId &&
        owner?.pin == active?.data['macIdentityPublicKey'];
    bool ownsSelection() =>
        ownsNamespace() &&
        generation == _connectGeneration &&
        mac == transport.macDeviceId &&
        session == transport.sessionId &&
        thread?['id'] == id &&
        thread?['cwd'] == cwd &&
        !_suspended;
    final currentRuntime = runtime;
    final snapshot = DesktopRuntime(
      model: currentRuntime.model,
      effort: currentRuntime.effort,
      access: currentRuntime.access,
      plan: draft.plan,
      serviceTier: currentRuntime.serviceTier,
    );
    _notify();
    try {
      final sent = await _sendDraft(
        draft.draft,
        queuedAttempt: token,
        runtimeSnapshot: snapshot,
        canContinue: () => ownsSelection() && (steer || turnId == null),
      );
      final accepted = sent || token.received;
      if (ownsNamespace()) {
        if (accepted && steer) {
          _queuedByThread[id]?.removeWhere((row) => row.id == draft.id);
        }
        if (!sent) {
          if (!accepted && !steer) {
            (_queuedByThread[id] ??= []).insert(0, draft);
          }
          if (!steer || !token.explicitlyRejected || token.received) {
            final message = token.received
                ? 'The message arrived. Review its result before resuming queued messages.'
                : ownsSelection() && error != null
                ? error!
                : 'Queued delivery was not confirmed. Reopen this chat before retrying.';
            _queuePausedByThread[id] = message;
            if (thread?['id'] == id) error = 'Queue paused: $message';
          }
        }
      }
      return accepted;
    } finally {
      if (identical(_queuedDelivery, token)) {
        _queuedDelivery = null;
        _queuedSteering = null;
      }
      _notify();
    }
  }

  bool get shouldQueueComposer => _selectedRunBusy || queuePauseMessage != null;

  bool _supportsModeSync = false;

  /// The paired desktop can serve Multi agents groups to this phone.
  bool supportsGroups = false;

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
        throw StateError(
          'Reopen this chat to verify the turn before restoring changes.',
        );
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
  void _noteTimelineLive(String thread, RemoteJson row) {
    if (row['id'] is String) {
      _liveTimelineRevisions[(thread, row['id'] as String)] =
          ++_timelineRevision;
    }
  }

  RemoteJson? responseUndoGitStatus;
  ResponseChangeSet? responseChangesFor(String assistant) => threadList
      .data
      .responseChanges
      .forAssistant(thread?['id'] as String? ?? '', assistant);
  bool _insideRepo(String path, String root) =>
      path == root ||
      path.startsWith('${root.replaceFirst(RegExp(r'/+$'), '')}/');
  String? responseUndoBlocked(ResponseChangeSet entry, {String? repoRoot}) {
    if (!connected ||
        active?.macDeviceId != transport.macDeviceId ||
        _requestsSuspended) {
      return 'Reconnect to your desktop before reviewing undo.';
    }
    if (!identical(threadList.data.responseChanges.entries[entry.id], entry)) {
      return 'Reopen this chat to verify the response before undoing changes.';
    }
    if (entry.unavailable != null) return entry.unavailable;
    final root = repoRoot ?? entry.repoRoot ?? entry.cwd;
    for (final row in threadList.data.snapshots) {
      final id = row['id'] as String?, cwd = row['cwd'] as String?;
      if (id == null || threadList.data.deleted.contains(id)) continue;
      final running =
          threadList.data.responseChanges.running.containsKey(id) ||
          (id == thread?['id'] && (turnId != null || busy)) ||
          {'inProgress', 'running', 'active'}.contains(row['status']) ||
          row['subagentStatus'] == 'running';
      if (running &&
          (cwd == null || _insideRepo(cwd, root) || _insideRepo(root, cwd))) {
        return 'A chat in this repository is running. Wait before undoing a response.';
      }
    }
    if ((turnId != null || busy) && thread?['id'] == entry.thread) {
      return 'Wait for the active response before undoing changes.';
    }
    return null;
  }

  bool responseUndoOverlap(ResponseChangeSet entry) =>
      threadList.data.responseChanges.entries.values.any(
        (other) =>
            other.id != entry.id &&
            !other.reverted &&
            (_insideRepo(other.cwd, entry.repoRoot ?? entry.cwd) ||
                _insideRepo(entry.cwd, other.repoRoot ?? other.cwd)) &&
            other.files.intersection(entry.files).isNotEmpty,
      );
  Future<ResponseUndoController?> responseUndo(String assistant) async {
    final entry = responseChangesFor(assistant);
    if (entry == null || responseUndoBlocked(entry) != null) return null;
    final data = threadList.data,
        generation = _connectGeneration,
        revision = _responseRunRevision;
    final device = active?.macDeviceId,
        pin = active?.publicKey,
        session = transport.sessionId;
    final selected = thread?['id'], cwd = thread?['cwd'];
    var hash = entry.hash;
    bool current() =>
        !_disposed &&
        identical(data, threadList.data) &&
        generation == _connectGeneration &&
        revision == _responseRunRevision &&
        device == active?.macDeviceId &&
        device == transport.macDeviceId &&
        pin == active?.publicKey &&
        session == transport.sessionId &&
        connected &&
        selected == thread?['id'] &&
        cwd == thread?['cwd'] &&
        entry.hash == hash &&
        identical(data.responseChanges.entries[entry.id], entry) &&
        !data.deleted.contains(entry.thread);
    try {
      final status = await transport.request('git/status', {'cwd': entry.cwd});
      final root = status['repoRoot'];
      if (!current() ||
          status['isRepo'] != true ||
          root is! String ||
          !root.startsWith('/') ||
          !_insideRepo(entry.cwd, root) ||
          responseUndoBlocked(entry, repoRoot: root) != null) {
        return null;
      }
      responseUndoGitStatus = status;
      entry.repoRoot = root;
      hash = entry.hash;
      Future<void> changed() async {
        if (identical(data, threadList.data)) {
          await threadList.saveNow();
          _notify();
          if (threadList.localError != null) {
            throw StateError('Could not persist the undo result.');
          }
        }
      }

      return ResponseUndoController(
        WorkspaceRepository(transport, cwd: entry.cwd, threadId: entry.thread),
        entry,
        isCurrent: current,
        blocked: () => responseUndoBlocked(entry, repoRoot: root),
        onChanged: changed,
        verifyRepository: () async {
          final fresh = await transport.request('git/status', {
            'cwd': entry.cwd,
          });
          return current() &&
              fresh['isRepo'] == true &&
              fresh['repoRoot'] == root &&
              responseUndoBlocked(entry, repoRoot: root) == null;
        },
        onSuccess: () async {
          // The success tombstone changes the ledger hash, so use the original connection scope here.
          if (identical(data, threadList.data) &&
              generation == _connectGeneration &&
              device == transport.macDeviceId &&
              session == transport.sessionId) {
            try {
              final fresh = await transport.request('git/status', {
                'cwd': entry.cwd,
              });
              if (identical(data, threadList.data) &&
                  generation == _connectGeneration &&
                  device == transport.macDeviceId &&
                  session == transport.sessionId) {
                responseUndoGitStatus = fresh;
              }
            } catch (_) {
              /* Undo succeeded even if metadata refresh failed. */
            }
            await changed();
          }
        },
      );
    } catch (_) {
      if (current()) {
        error =
            'Could not verify the response repository. Reconnect and review it again.';
        _notify();
      }
      return null;
    }
  }

  void _captureResponseChanges(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (!connected ||
        active?.macDeviceId != transport.macDeviceId ||
        !requestMatchesConnection(rpc) ||
        threadList.macDeviceId != null &&
            threadList.macDeviceId != active?.macDeviceId) {
      return;
    }
    final known = {
      ..._knownActivityThreads,
      if (thread?['id'] is String) thread!['id'] as String,
    }..removeAll(threadList.data.deleted);
    final ledger = threadList.data.responseChanges;
    final before = Map<String, String>.from(ledger.running);
    if (ledger.ingest(
      method,
      params,
      knownThreads: known,
      cwdFor: (id) =>
          (id == thread?['id'] ? thread : threadList.data.find(id))?['cwd']
              as String?,
    )) {
      if (!mapEquals(before, ledger.running) &&
          ledger.running.entries.any((e) => before[e.key] != e.value)) {
        _responseRunRevision++;
      }
      threadList.scheduleSave();
      _notify();
    }
  }

  void _bindCheckpoints(String id, TurnCheckpoints checkpoints) {
    if (!checkpoints.repository.isCurrent) return;
    _checkpointsByTurn[_checkpointKey(checkpoints.repository, id)] =
        checkpoints;
    unawaited(checkpoints.started(id));
  }

  RemoteJson? get selectedModel =>
      models.where((m) => m['id'] == model).firstOrNull;
  Object? _modelRefreshOwner;
  Future<void>? _modelRefreshFuture;
  Object get _modelCatalogOwner => (
    _connectGeneration,
    active?.macDeviceId,
    active?.publicKey,
    transport.macDeviceId,
    transport.sessionId,
    transport.connectionRevision,
  );
  bool get isLoadingModels =>
      !_disposed &&
      (state == 'connecting' ||
          _modelRefreshFuture != null &&
              _modelRefreshOwner == _modelCatalogOwner);

  Future<void> refreshModels() {
    if (_disposed || !connected || state != 'connected') {
      return Future.error(
        StateError('Reconnect the desktop to refresh models.'),
      );
    }
    final owner = _modelCatalogOwner;
    if (_modelRefreshOwner == owner && _modelRefreshFuture != null) {
      return _modelRefreshFuture!;
    }
    _modelRefreshOwner = owner;
    late final Future<void> request;
    request = _refreshModels(owner).whenComplete(() {
      if (identical(_modelRefreshFuture, request)) {
        _modelRefreshOwner = _modelRefreshFuture = null;
        _notify();
      }
    });
    _modelRefreshFuture = request;
    _notify();
    return request;
  }

  Future<void> _refreshModels(Object owner) async {
    bool current() =>
        !_disposed &&
        connected &&
        state == 'connected' &&
        owner == _modelCatalogOwner;
    try {
      final catalog = await transport.request('model/list', {});
      if (!current()) return;
      models =
          ((catalog['data'] ?? catalog['items'] ?? catalog['models'] ?? [])
                  as List)
              .cast<RemoteJson>();
      if (selectedModel != null) {
        setModel(model!, remember: false);
      } else {
        _notify();
      }
      await settings?.setRuntimeCatalog(models);
    } catch (_) {
      if (current()) rethrow;
    }
  }

  DesktopRuntime get runtime => DesktopRuntime(
    model: selectedModel,
    effort: effort,
    access: access,
    plan: plan,
    serviceTier: serviceTier,
  );
  List<String> get reasoningEfforts => modelReasoningEfforts(selectedModel);
  void _applyRuntime(DesktopRuntime value) {
    model = value.model?['id'] as String?;
    effort = value.effort;
    access = value.access;
    plan = supportsPlan && value.plan;
    serviceTier = value.serviceTier;
  }

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

  void setEffort(String value) {
    if (reasoningEfforts.contains(value)) {
      _passiveSelection = null;
      effort = value;
      _rememberRuntime();
      _notify();
    }
  }

  Future<void> setAccess(String value) async {
    if (!{'on-request', 'auto-review', 'full-access'}.contains(value)) return;
    _passiveSelection = null;
    final generation = _connectGeneration, selectedThread = thread?['id'];
    final previous = access;
    access = value;
    _notify();
    if (!_supportsModeSync || !connected || thread == null) {
      _rememberRuntime();
      return;
    }
    final mode = {
      'on-request': 'approval-required',
      'auto-review': 'auto-approval',
      'full-access': 'full-access',
    }[value];
    try {
      final result = await transport.request('djl/thread/runtimeMode/set', {
        'threadId': thread!['id'],
        'runtimeMode': mode,
      });
      if (generation != _connectGeneration || thread?['id'] != selectedThread) {
        return;
      }
      if (result['runtimeMode'] != mode) {
        throw StateError('Desktop did not apply the requested access mode.');
      }
      _rememberRuntime();
    } catch (e) {
      if (generation != _connectGeneration || thread?['id'] != selectedThread) {
        return;
      }
      access = previous;
      error = e.toString();
      _notify();
    }
  }

  bool get supportsFastMode => modelSupportsFast(selectedModel);

  void setServiceTier(String value) {
    if (value == 'default' || value == 'fast' && supportsFastMode) {
      _passiveSelection = null;
      serviceTier = value;
      _rememberRuntime();
      _notify();
    }
  }

  void setPlan(bool value) {
    if (!value || supportsPlan) {
      _passiveSelection = null;
      plan = value;
      _rememberRuntime();
      _notify();
    }
  }

  Pairing? previousDevice;
  TrustedDeviceEntry? switchingDevice;
  String? switchNotice;
  bool cancellingSwitch = false, _automaticConnectionPaused = false;
  bool _connectingRecovery = false, _pairingSubmission = false;
  int _switchRevision = 0;
  int? _switchOwnedNavigationRevision;
  bool get automaticConnectionAllowed =>
      !_automaticConnectionPaused && switchingDevice == null;
  bool get canEnterManualPairing =>
      switchingDevice == null &&
      !cancellingSwitch &&
      !_pairingSubmission &&
      (!busy || _connectingRecovery) &&
      !approvals.any((r) => r['_submitting'] == true) &&
      !userInputs.any((r) => r['_submitting'] == true) &&
      !threadList.data.responseChanges.entries.values.any((e) => e.applying);

  final _liveSwitchRuns = <String, Set<String>>{};
  final _switchRunCaution = <String>{};
  ({String mac, String pin, String? session, int generation})? _switchRunScope;
  bool get _liveSwitchScope =>
      connected &&
      !_hostConnecting &&
      !_suspended &&
      transport.macDeviceId == active?.macDeviceId &&
      _switchRunScope?.mac == active?.macDeviceId &&
      _switchRunScope?.pin == active?.publicKey &&
      _switchRunScope?.session == transport.sessionId &&
      _switchRunScope?.generation == _connectGeneration;
  String? _realTurnId(Object? value) {
    if (value is! String) return null;
    final id = value.trim();
    if (id.isEmpty ||
        id.startsWith('turn-line-') ||
        id.startsWith('rollout-') ||
        id.startsWith('djl-history-compacted-')) {
      return null;
    }
    return id;
  }

  bool _runningStatus(Object? value) {
    final status = value is Map
        ? value['type'] ?? value['statusType'] ?? value['status_type']
        : value;
    return status is String &&
        {
          'inprogress',
          'running',
          'active',
          'starting',
          'started',
          'pending',
          'processing',
        }.contains(status.toLowerCase().replaceAll(RegExp(r'[_-]'), ''));
  }

  Set<String> get _knownSwitchThreads => {
    ..._liveSwitchRuns.keys,
    ..._switchRunCaution,
    ...threadList.data.responseChanges.running.keys,
    if (thread?['id'] is String && turnId != null) thread!['id'] as String,
    for (final row in threadList.data.snapshots)
      if (row['id'] is String &&
          (_runningStatus(row['status']) ||
              _runningStatus(row['subagentStatus']) ||
              (row['turns'] as List? ?? []).whereType<Map>().any(
                (t) => _runningStatus(t['status']),
              )))
        row['id'] as String,
  };
  bool get switchNeedsConfirmation => _knownSwitchThreads.isNotEmpty;

  void _observeSwitchRuns(String method, RemoteJson params, RemoteJson rpc) {
    if (!_liveSwitchScope || !requestMatchesConnection(rpc)) return;
    final id = params['threadId'] ?? params['thread_id'];
    if (id is! String || id.isEmpty) return;
    final observedTurn = desktopResponseIdentity(params)?.turn;
    if (_responseCurrent &&
        observedTurn != null &&
        _responseLifecycle!.isTurnTerminal(id, observedTurn) &&
        method != 'turn/completed' &&
        method != 'turn/failed') {
      return;
    }
    final raw = params['turn'];
    final turn = raw is Map ? raw : const <String, dynamic>{};
    final turnId = _realTurnId(turn['id'] ?? params['turnId']);
    if (method == 'thread/status/changed') {
      if (_runningStatus(params['status'])) _switchRunCaution.add(id);
      return;
    }
    if (method == 'turn/started' ||
        method == 'item/started' ||
        method == 'item/agentMessage/delta') {
      _switchRunCaution.add(id);
      if (rpc['djlReplayedEvent'] != true &&
          params['djlReplayedEvent'] != true &&
          turnId != null) {
        (_liveSwitchRuns[id] ??= {}).add(turnId);
      }
    } else if ((method == 'turn/completed' || method == 'turn/failed') &&
        rpc['djlReplayedEvent'] != true &&
        params['djlReplayedEvent'] != true) {
      if (turnId != null) _liveSwitchRuns[id]?.remove(turnId);
      if (_liveSwitchRuns[id]?.isEmpty == true) _liveSwitchRuns.remove(id);
      _switchRunCaution.remove(id);
    }
  }

  void _observeSwitchHistory(RemoteJson value) {
    if (!_liveSwitchScope || value['id'] is! String) return;
    final id = value['id'] as String;
    if (_responseCurrent) {
      final facts = _responseLifecycle!.facts(id);
      final running = facts.latestOutcome == DesktopResponseOutcome.running;
      final active = running ? _realTurnId(facts.latestTurn) : null;
      if (active != null) {
        _liveSwitchRuns[id] = {active};
      } else {
        _liveSwitchRuns.remove(id);
      }
      if (running || facts.pending) {
        _switchRunCaution.add(id);
      } else {
        _switchRunCaution.remove(id);
      }
      return;
    }
    final running = (value['turns'] as List? ?? []).whereType<Map>().where(
      (turn) => _runningStatus(turn['status']),
    );
    final ids = running
        .map((turn) => _realTurnId(turn['id']))
        .whereType<String>()
        .toSet();
    if (ids.isEmpty) {
      _liveSwitchRuns.remove(id);
    } else {
      _liveSwitchRuns[id] = ids;
    }
    if (running.isNotEmpty) {
      _switchRunCaution.add(id);
    } else {
      _switchRunCaution.remove(id);
    }
  }

  DesktopSwitchIntent? prepareSavedSwitch(Pairing pair) {
    if (navigationNeedsHost &&
        navigationTarget?.qualified == true &&
        !navigationTarget!.matchesHost(pair.macDeviceId, pair.publicKey)) {
      navigationError =
          'Choose the saved Mac matching this link. Its verified identity must match.';
      _notify();
      return null;
    }
    final source = active, target = devicePreferences(pair);
    if (!connected ||
        busy ||
        !_routingAllowed ||
        _suspended ||
        source == null ||
        target == null ||
        isActiveDevice(pair) ||
        approvals.any((r) => r['_submitting'] == true) ||
        userInputs.any((r) => r['_submitting'] == true) ||
        threadList.data.responseChanges.entries.values.any((e) => e.applying)) {
      return null;
    }
    return DesktopSwitchIntent(
      target,
      source,
      transport.sessionId,
      _connectGeneration,
      navigationRevision,
      selectionRevision,
      thread?['id'],
      newChatDraft,
      navigationTarget,
      navigationNeedsHost &&
          navigationTarget?.matchesHost(pair.macDeviceId, pair.publicKey) ==
              true,
    );
  }

  bool _switchSourceCurrent(DesktopSwitchIntent intent) =>
      !_disposed &&
      _routingAllowed &&
      !_suspended &&
      connected &&
      _connectGeneration == intent.generation &&
      navigationRevision == intent.navigationRevision &&
      selectionRevision == intent.selectionRevision &&
      thread?['id'] == intent.selectedThread &&
      identical(newChatDraft, intent.draft) &&
      active?.macDeviceId == intent.source.macDeviceId &&
      active?.publicKey == intent.source.publicKey &&
      transport.macDeviceId == intent.source.macDeviceId &&
      transport.sessionId == intent.session;

  Future<void> _verifySwitchTarget(TrustedDeviceEntry target) async {
    final entries = await pairings.trustedEntries();
    if (!entries.any(
      (entry) =>
          entry.matches(target.pairing) && entry.trustId == target.trustId,
    )) {
      throw const RemoteSecurityException(
        'This saved device changed. Choose it again.',
      );
    }
  }

  Future<bool> _interruptSwitchRuns(bool Function() current) async {
    var open = true, certain = true;
    final attempted = <(String, String)>{}, visited = <String>{};
    Future<void> stopKnown() async {
      while (open && current()) {
        final pending =
            _knownSwitchThreads
                .where(
                  (id) =>
                      !visited.contains(id) ||
                      (_liveSwitchRuns[id] ?? {}).any(
                        (turn) => !attempted.contains((id, turn)),
                      ),
                )
                .toList()
              ..sort();
        if (pending.isEmpty) return;
        final id = pending.first;
        visited.add(id);
        var turns = Set<String>.of(_liveSwitchRuns[id] ?? {});
        try {
          if (turns.isEmpty) {
            final read = await transport.request('thread/read', {
              'threadId': id,
              'includeTurns': true,
            });
            if (!open || !current()) return;
            final value = read['thread'];
            if (value is! Map || value['id'] != id) {
              certain = false;
              continue;
            }
            final running = (value['turns'] as List? ?? [])
                .whereType<Map>()
                .where((turn) => _runningStatus(turn['status']));
            turns = running
                .map((turn) => _realTurnId(turn['id']))
                .whereType<String>()
                .toSet();
            if ((running.isNotEmpty || _runningStatus(value['status'])) &&
                turns.isEmpty) {
              certain = false;
            }
          }
          final sorted = turns.toList()..sort();
          for (final turn in sorted) {
            if (!open || !current()) return;
            if (!attempted.add((id, turn))) continue;
            await transport.request('turn/interrupt', {
              'threadId': id,
              'turnId': turn,
            });
            if (!open || !current()) return;
          }
        } catch (_) {
          certain = false;
        }
      }
    }

    try {
      await stopKnown().timeout(const Duration(milliseconds: 1500));
    } catch (_) {
      certain = false;
    } finally {
      open = false;
    }
    return certain;
  }

  Future<void> switchSaved(
    DesktopSwitchIntent intent, {
    bool confirmed = false,
  }) async {
    if (busy ||
        !_switchSourceCurrent(intent) ||
        (switchNeedsConfirmation && !confirmed)) {
      return;
    }
    final revision = ++_switchRevision;
    final source = intent.source, target = intent.target;
    switchingDevice = target;
    _switchOwnedNavigationRevision = navigationRevision;
    switchNotice = null;
    busy = true;
    _automaticConnectionPaused = true;
    _intent = false;
    _retry?.cancel();
    var tornDown = false;
    bool owned() =>
        !_disposed && revision == _switchRevision && switchingDevice != null;
    bool sourceCurrent() => owned() && _switchSourceCurrent(intent);
    _notify();
    try {
      await _verifySwitchTarget(target);
      if (!sourceCurrent()) return;
      final resolved = await pairings.resolveTrusted(target.pairing);
      if (!sourceCurrent()) return;
      if (!target.matches(resolved)) {
        throw const RemoteSecurityException(
          'The selected Mac identity did not match.',
        );
      }
      await _verifySwitchTarget(target);
      if (!sourceCurrent()) return;
      final certain = await _interruptSwitchRuns(sourceCurrent);
      if (!sourceCurrent()) return;
      if (!certain) {
        switchNotice =
            'Stopping runs could not be confirmed; they may still be running on the other Mac.';
      }
      _rememberCurrent();
      await threadList.saveNow();
      if (!sourceCurrent()) return;
      if (threadList.localError != null) {
        throw StateError(threadList.localError!);
      }
      await _verifySwitchTarget(target);
      if (!sourceCurrent()) return;
      previousDevice = source;
      tornDown = true;
      ++_connectGeneration;
      ++selectionRevision;
      if (intent.preserveNavigation &&
          navigationTarget == intent.navigation &&
          navigationRevision == intent.navigationRevision) {
        _navigationHost = (mac: resolved.macDeviceId, pin: resolved.publicKey);
        _navigationAttempt = null;
        navigationError = null;
      } else {
        cancelNavigation();
      }
      _switchOwnedNavigationRevision = navigationRevision;
      _clearGuardianAuthority();
      _clearReasoningAuthority();
      _clearSwitchPresentation();
      active = resolved;
      // Establish B's empty/cache owner before any teardown or pointer await.
      await Future.wait<void>([
        transport.disconnect(),
        threadList.stageSwitch(resolved.macDeviceId),
      ]);
      if (!owned()) return;
      await pairings.selectTrustedActive(target, isCurrent: owned);
      if (!owned()) return;
      guardian.bind(resolved.macDeviceId, null);
      _bindActivityDevice(resolved.macDeviceId);
      await _connect(resolved, resolve: false, switchTarget: target);
      if (!owned()) return;
      if (state == 'connected' && connected) {
        previousDevice = null;
        _automaticConnectionPaused = false;
        _intent = true;
        switchingDevice = null;
        busy = false;
        _notify();
        await threadList.commitSwitch();
      } else {
        threadList.discardSwitch();
        _clearSwitchPresentation();
      }
    } catch (failure) {
      if (!owned()) return;
      if (tornDown) {
        await transport.disconnect();
        if (!owned()) return;
        threadList.discardSwitch();
        _clearSwitchPresentation();
        state = 'disconnected';
        error = failure.toString();
      } else {
        switchNotice = failure.toString();
      }
    } finally {
      if (owned()) {
        switchingDevice = null;
        busy = false;
        _hostConnecting = false;
        if (!tornDown) {
          _automaticConnectionPaused = false;
          _intent = connected;
        }
        _notify();
      }
    }
  }

  void _clearSwitchPresentation() {
    thread = null;
    timeline = [];
    models = [];
    model = null;
    effort = null;
    access = 'on-request';
    plan = false;
    serviceTier = 'default';
    turnId = null;
    approvals.clear();
    userInputs.clear();
    _requestsSuspended = true;
    _checkpointsByTurn.clear();
    _unverifiedCheckpointOwners.clear();
    _liveTimelineRevisions.clear();
    _historyReplacements.clear();
    _sourceContinuity.clear();
    _checkpointEnds.clear();
    _finishedTurns.clear();
    _liveSwitchRuns.clear();
    _switchRunCaution.clear();
    _switchRunScope = null;
  }

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
    switchNotice = 'Switch cancelled. Choose a device to reconnect.';
    final closing = transport.disconnect();
    _notify();
    try {
      await closing;
      await saving;
      await pairings.clearActive();
    } catch (_) {
      if (!_disposed && generation == _connectGeneration) {
        error =
            'Could not confirm the saved selection was cleared. Unlock your device and choose a saved Mac to recover.';
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

  void pauseForManualPairing() {
    if (!canEnterManualPairing) return;
    _automaticConnectionPaused = true;
    _intent = false;
    _retry?.cancel();
    if (_connectingRecovery || connected) {
      _statusTransportLost = true;
      selectionRevision++;
      cancelNavigation();
      _rememberCurrent();
      approvals.clear();
      _resetSubmittedQuestions();
      userInputs.clear();
      _requestsSuspended = true;
      unawaited(threadList.saveNow());
      ++_connectGeneration;
      _connectingRecovery = false;
      _hostConnecting = false;
      busy = false;
      _clearGuardianAuthority();
      _clearReasoningAuthority();
      unawaited(transport.disconnect());
    }
    state = 'disconnected';
    _notify();
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
      navigationError =
          'The saved Mac identity for this link is unavailable. Open the chat from a verified Mac.';
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
      navigationError =
          'Choose the saved Mac matching this link. Its verified identity must match.';
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
        navigationError =
            'Waiting for the selected Mac. Retry when it is available.';
      }
    } on RemoteRpcException catch (failure) {
      if (!current()) return;
      final message = failure.message.toLowerCase();
      if (!message.contains('not materialized') &&
          !message.contains('not yet materialized') &&
          (message.contains('thread not found') ||
              message.contains('unknown thread'))) {
        navigationTarget = null;
        navigationError = 'The linked desktop conversation is unavailable.';
      } else {
        navigationError =
            'Could not load the linked conversation. Retry on the selected Mac.';
      }
    } catch (_) {
      if (current()) {
        navigationError =
            'Could not load the linked conversation. Retry on the selected Mac.';
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

  TrustedDeviceEntry? devicePreferences(Pairing pair) =>
      _devicePreferences.where((entry) => entry.matches(pair)).firstOrNull;

  bool isActiveDevice(Pairing pair) =>
      active?.macDeviceId == pair.macDeviceId &&
      active?.publicKey == pair.publicKey;

  String deviceName(Pairing pair) {
    final nickname = devicePreferences(pair)?.nickname.trim() ?? '';
    final system = pair.displayName.trim();
    return nickname.isNotEmpty
        ? nickname
        : system.isNotEmpty
        ? system
        : 'Device';
  }

  String? get selectedDeviceName => active == null ? null : deviceName(active!);

  List<Pairing> get managedDevices => [
    ...trusted.where(isActiveDevice),
    ...trusted.where((pair) => !isActiveDevice(pair)),
  ];

  List<Pairing> get menuDevices => devicePreferencesReady
      ? managedDevices
            .where(
              (pair) =>
                  isActiveDevice(pair) ||
                  devicePreferences(pair)?.visibleInMenu == true,
            )
            .toList()
      : [];

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
      devicePreferencesError =
          'Could not load local device preferences. Unlock your device and retry.';
    } finally {
      if (!_disposed && revision == _devicePreferencesRevision) {
        devicePreferencesLoading = false;
        _notify();
      }
    }
  }

  Future<bool> setDeviceNickname(TrustedDeviceEntry target, String nickname) =>
      _saveDevicePreferences(target, nickname: nickname);

  Future<bool> setDeviceMenuVisibility(
    TrustedDeviceEntry target,
    bool visible,
  ) {
    if (isActiveDevice(target.pairing)) return Future.value(false);
    return _saveDevicePreferences(target, visibleInMenu: visible);
  }

  Future<bool> _saveDevicePreferences(
    TrustedDeviceEntry target, {
    String? nickname,
    bool? visibleInMenu,
  }) async {
    if (_disposed ||
        !devicePreferencesReady ||
        devicePreferencesLoading ||
        devicePreferencesSaving) {
      return false;
    }
    devicePreferencesSaving = true;
    devicePreferencesError = null;
    ++_devicePreferencesRevision;
    _notify();
    try {
      await pairings.updateDevicePreferences(
        target,
        nickname: nickname,
        visibleInMenu: visibleInMenu,
      );
      final entries = await pairings.trustedEntries();
      if (_disposed) return false;
      _devicePreferences = entries;
      final saved = entries
          .where(
            (e) => e.matches(target.pairing) && e.trustId == target.trustId,
          )
          .firstOrNull;
      if (saved == null ||
          (nickname != null && saved.nickname != nickname.trim()) ||
          (visibleInMenu != null && saved.visibleInMenu != visibleInMenu)) {
        throw StateError('The saved device changed.');
      }
      return true;
    } catch (_) {
      // A native write can persist before throwing. Never claim success from
      // the attempted write; reread and retain the editor's draft and error.
      try {
        final entries = await pairings.trustedEntries();
        if (_disposed) return false;
        _devicePreferences = entries;
        devicePreferencesReady = true;
      } catch (_) {
        if (_disposed) return false;
        devicePreferencesReady = false;
      }
      if (_disposed) return false;
      devicePreferencesError = devicePreferencesReady
          ? 'Could not confirm the change. Review the saved name and retry. If this device was forgotten or replaced, close and reopen the editor.'
          : 'Could not confirm or reload local preferences. Unlock your device and retry before saving again.';
      return false;
    } finally {
      if (!_disposed) {
        devicePreferencesSaving = false;
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
      error =
          'Could not open saved desktops. Unlock your device and try again.';
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
        error =
            'The selected desktop model is unavailable. Choose an available model.';
      }
      if (thread != null && navigationTarget == null) {
        await openThread(thread!, userSelection: false);
      }
      if (generation != _connectGeneration) return;
      _failures = 0;
      if (switchTarget == null) {
        previousDevice = null;
        if (switchNotice !=
            'Stopping runs could not be confirmed; they may still be running on the other Mac.') {
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
        error =
            'Could not read your secure pairing identity. Unlock your device, then choose Reconnect.';
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
      throw StateError('The runtime returned another chat’s history.');
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
          throw StateError('Could not verify the linked conversation history.');
        }
        resolved = normalizeThread({
          ...thread!,
          ...Map<String, dynamic>.from(remote),
        });
      } else {
        resolved = await _readRemoteThread(thread!);
      }
      if (resolved['id'] != value['id']) {
        throw StateError('The runtime returned another chat’s history.');
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
      throw StateError(
        'The current idle chat and a valid project are required.',
      );
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
          throw StateError(
            'The runtime did not verify this chat’s project change.',
          );
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
        throw StateError(
          'The runtime did not identify the created fork. Refresh before trying again.',
        );
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
        throw StateError('The runtime did not create a separate conversation.');
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
          ? 'This runtime does not support conversation forks. Update DJL on your desktop and retry.'
          : '$e The fork result may be unknown. Refresh before trying again.';
      return false;
    } finally {
      if (sameConnection()) {
        busy = false;
        _notify();
      }
    }
  }

  String? _historyStructuredSignature(
    RemoteJson row,
    String thread,
    String turn,
  ) {
    if (desktopIsPlanItem(row) && desktopIsProgressPlan(row)) {
      return 'plan-progress';
    }
    if (row['type'] == 'reasoning' || row['type'] == 'plan') {
      final text = row['type'] == 'plan'
          ? row['text'] as String? ?? ''
          : DesktopReasoning.fromRow(row)?.text ??
                decodeReasoningText(row, history: true);
      if (text.trim().isEmpty ||
          text.length > 64000 ||
          utf8.encode(text).length > 64000) {
        return null;
      }
      return jsonEncode([row['type'], text.trim()]);
    }
    if (isSubagentItem(row)) {
      final action = SubagentAction.decode(
        row,
        mac: active?.macDeviceId ?? '',
        thread: thread,
        turn: turn,
      );
      if (action == null || action.children.isEmpty) return null;
      final children = action.children.map((child) => child.thread).toList()
        ..sort();
      final signature = jsonEncode([
        'subagent',
        action.tool,
        action.prompt,
        children,
      ]);
      return utf8.encode(signature).length <= 64000 ? signature : null;
    }
    final command = DesktopActivity.fromItem(
      row,
      mac: active?.macDeviceId ?? '',
      thread: thread,
      turn: turn,
    );
    if (command?.kind != 'command' || command!.command.trim().isEmpty) {
      return null;
    }
    final signature = jsonEncode([
      'command',
      command.command,
      command.cwd,
      command.outputTail,
    ]);
    return signature.length <= 64000 && utf8.encode(signature).length <= 64000
        ? signature
        : null;
  }

  Map<String, String> _historyStructuredItemMappings(
    String thread,
    List<RemoteJson> previous,
    List<RemoteJson> canonical,
    Map<String, String> turnMappings,
    Set<String> protectedIds,
  ) {
    final oldGroups = <(String, String), List<RemoteJson>>{},
        newGroups = <(String, String), List<RemoteJson>>{};
    for (final pair in [(previous, oldGroups), (canonical, newGroups)]) {
      for (final row in pair.$1) {
        if (desktopIsPlanItem(row) && desktopIsProgressPlan(row)) continue;
        final turn = row['turnId'];
        if (turn is! String) continue;
        final canonicalTurn = turnMappings[turn] ?? turn;
        if (desktopProvisionalHistoryTurn(canonicalTurn)) continue;
        final signature = _historyStructuredSignature(
          row,
          thread,
          canonicalTurn,
        );
        if (signature != null) {
          (pair.$2[(canonicalTurn, signature)] ??= []).add(row);
        }
      }
    }
    final mappings = <String, String>{};
    for (final entry in oldGroups.entries) {
      final incoming = newGroups[entry.key];
      if (entry.value.length != 1 || incoming?.length != 1) continue;
      final old = entry.value.single, real = incoming!.single;
      final source =
          DesktopActivity.fromRow(old)?.item ??
          DesktopReasoning.fromRow(old)?.identity.item ??
          (old['subagent'] as Map?)?['item'] as String? ??
          desktopHistorySourceId(old);
      final target = desktopHistorySourceId(real);
      if (!protectedIds.contains(old['id']) &&
          desktopProvisionalHistoryItem(source) &&
          target != null &&
          !desktopProvisionalHistoryItem(target)) {
        mappings[old['id'] as String] = target;
      }
    }
    return mappings;
  }

  List<RemoteJson> _reconcileOwnedHistory(
    RemoteJson value,
    List<RemoteJson> cached, {
    _ReasoningHistory? reasoningHistory,
    int? timelineWatermark,
  }) {
    value = desktopOwnedHistory(value);
    final id = value['id'] as String;
    for (final turn
        in (value['turns'] as List? ?? []).whereType<RemoteJson>()) {
      final observed = _responseCurrent && turn['id'] is String
          ? _responseLifecycle!.facts(id).outcome(turn['id'] as String)
          : DesktopResponseOutcome.unknown;
      final outcome = observed == DesktopResponseOutcome.unknown
          ? desktopResponseHistoryOutcome(turn)
          : observed;
      turn['items'] = [
        for (final raw
            in (turn['items'] as List? ?? []).whereType<RemoteJson>())
          if (!desktopIsPlanItem(raw))
            raw
          else
            ?desktopHistoryPlanItem(
              raw,
              completed: outcome == DesktopResponseOutcome.completed,
            ),
      ];
    }
    final pendingReplacement = _historyReplacements[id];
    final replacement =
        pendingReplacement != null &&
            pendingReplacement <= (timelineWatermark ?? _timelineRevision)
        ? pendingReplacement
        : null;
    final previous = cached
        .where((row) => desktopHistoryOwnedRow(row, id, row['turnId']))
        .map(
          (row) =>
              SubagentAction.decode(
                row,
                mac: active?.macDeviceId ?? '',
                thread: id,
                turn: subagentString(row['turnId']) ?? '',
              )?.toRow() ??
              row,
        )
        .toList();
    _bindSubagents();
    for (final row in previous) {
      final action = SubagentAction.decode(
        row,
        mac: active?.macDeviceId ?? '',
        thread: id,
        turn: subagentString(row['turnId']) ?? '',
      );
      if (action != null) subagents.merge(action);
    }
    _bindActivityDevice(
      active?.macDeviceId ??
          threadList.macDeviceId ??
          transport.macDeviceId ??
          '',
    );
    for (final row in previous.where(
      (row) => DesktopActivity.fromRow(row)?.thread == id,
    )) {
      activity.restore(row, thread: id);
    }
    for (final item in previous.where(
      (item) => isGuardianRow(item) && item['threadId'] == id,
    )) {
      final review = GuardianReview.fromRow(item);
      if (review != null) guardian.upsert(id, review, live: false);
    }
    final protectedHistoryIds = <String>{
      for (final entry in _liveTimelineRevisions.entries)
        if (entry.key.$1 == id &&
            entry.value > (timelineWatermark ?? _timelineRevision))
          entry.key.$2,
    };
    final protectedTurns = {
      for (final row in previous)
        if (protectedHistoryIds.contains(row['id'])) row['turnId'],
    };
    protectedHistoryIds.addAll(
      previous
          .where((row) => protectedTurns.contains(row['turnId']))
          .map((row) => row['id'])
          .whereType<String>(),
    );
    final canonicalRows = <RemoteJson>[
      for (final turn in (value['turns'] as List? ?? []).whereType<Map>())
        for (final raw in (turn['items'] as List? ?? []).whereType<Map>())
          {...Map<String, dynamic>.from(raw), 'turnId': turn['id']},
    ];
    final turnMappings = desktopHistoryTurnMappings(
      previous,
      canonicalRows,
      protectedIds: protectedHistoryIds,
    );

    turnMappings.removeWhere((oldTurn, canonical) {
      if (threadList.data.responseChanges.canRebindHistoryTurn(
        id,
        oldTurn,
        canonical,
      )) {
        return false;
      }
      protectedHistoryIds.addAll(
        previous
            .where((row) => row['turnId'] == oldTurn)
            .map((row) => row['id'])
            .whereType<String>(),
      );
      return true;
    });
    final idle =
        !(value['turns'] as List? ?? []).whereType<Map>().any(
          (turn) =>
              desktopResponseHistoryOutcome(Map<String, dynamic>.from(turn)) ==
              DesktopResponseOutcome.running,
        ) &&
        (!_responseCurrent || !_responseLifecycle!.facts(id).suppressesLatest);
    if (replacement != null || idle) {
      // Ambiguous details can have a counterpart without proof for an ID rebind.
      final canonicalDetails = <(String, String)>{
        for (final row in canonicalRows)
          if (row['turnId'] case final String turn)
            if (_historyStructuredSignature(row, id, turn)
                case final signature?)
              (turn, signature),
      };
      final retainedDetails = <String>{...protectedHistoryIds};
      for (final row in previous) {
        final turn = turnMappings[row['turnId']] ?? row['turnId'];
        if (turn is! String || row['id'] is! String) continue;
        final signature = _historyStructuredSignature(row, id, turn);
        if (signature != null && canonicalDetails.contains((turn, signature))) {
          retainedDetails.add(row['id'] as String);
        }
      }
      final removed = desktopHistoryReplacementRemovals(
        [
          for (final row in previous)
            {
              ...row,
              if (row[reasoningMetadataKey] is Map)
                'sourceItemId': (row[reasoningMetadataKey] as Map)['item'],
              if (row['subagent'] is Map)
                'sourceItemId': (row['subagent'] as Map)['item'],
            },
        ],
        canonicalRows,
        turnMappings: turnMappings,
        protectedIds: retainedDetails,
      );
      previous.removeWhere((row) => removed.contains(row['id']));
      activity.items.removeWhere((key, _) => removed.contains(key));
      subagents.items.removeWhere((key, _) => removed.contains(key));
      _reasoning?.items.removeWhere((key, _) => removed.contains(key));
    }
    final itemMappings = _historyStructuredItemMappings(
      id,
      previous,
      canonicalRows,
      turnMappings,
      protectedHistoryIds,
    );
    final migrations = {
      ...turnMappings,
      for (final row in previous)
        if (itemMappings.containsKey(row['id']) && row['turnId'] is String)
          row['turnId'] as String:
              turnMappings[row['turnId']] ?? row['turnId'] as String,
    };
    final replacements = <String, RemoteJson>{};
    for (final entry in migrations.entries) {
      if (entry.key != entry.value) {
        threadList.data.responseChanges.rebindHistoryTurn(
          id,
          entry.key,
          entry.value,
        );
      }
      replacements.addAll({
        ...activity.rebindHistoryTurn(
          id,
          entry.key,
          entry.value,
          itemMappings: itemMappings,
        ),
        ...subagents.rebindHistoryTurn(
          id,
          entry.key,
          entry.value,
          itemMappings: itemMappings,
        ),
        if (entry.key != entry.value)
          ...guardian.rebindHistoryTurn(id, entry.key, entry.value),
        if (_reasoningCurrent())
          ..._reasoning!.rebindHistoryTurn(
            id,
            entry.key,
            entry.value,
            itemMappings: itemMappings,
          ),
      });
      if (_responseCurrent && entry.key != entry.value) {
        _responseLifecycle!.rebindHistoryTurn(id, entry.key, entry.value);
      }
    }
    for (var i = 0; i < previous.length; i++) {
      final old = previous[i], turn = migrations[previous[i]['turnId']];
      previous[i] =
          replacements[old['id']] ??
          (turn != null
              ? {
                  ...old,
                  'id': ?itemMappings[old['id']],
                  'sourceItemId': ?itemMappings[old['id']],
                  'turnId': turn,
                  if (old.containsKey('turn_id')) 'turn_id': turn,
                }
              : old);
    }
    final items = <RemoteJson>[];
    for (final rawTurn in (value['turns'] as List? ?? [])) {
      final turn = rawTurn as RemoteJson;
      _reasoningHistoryTurn(turn, id, reasoningHistory);
      for (final rawItem in (turn['items'] as List? ?? [])) {
        final item = Map<String, dynamic>.from(rawItem as Map);
        if (item['type'] == 'reasoning' && reasoningHistory != null) {
          final row = _reasoningHistoryRow(item, id, turn, reasoningHistory);
          if (row != null && !items.any((old) => old['id'] == row['id'])) {
            items.add(row);
          }
          continue;
        }
        item['turnId'] =
            turn['id'] ??
            turn['turnId'] ??
            turn['turn_id'] ??
            item['turnId'] ??
            item['turn_id'];
        if (desktopIsPlanItem(item)) {
          final progress = desktopIsProgressPlan(item);
          final matches = previous
              .where(
                (row) =>
                    item['turnId'] is String &&
                    row['turnId'] == item['turnId'] &&
                    desktopIsPlanItem(row) &&
                    desktopIsProgressPlan(row) == progress &&
                    (progress ||
                        desktopHistorySourceId(row) ==
                            desktopHistorySourceId(item)),
              )
              .toList();
          var row = item;
          if (matches.length == 1) {
            final old = matches.single, source = desktopHistorySourceId(item);
            row = {
              ...(protectedHistoryIds.contains(old['id']) ? old : item),
              'id': old['id'],
              'sourceItemId': ?source,
            };
            if (row['sourceItemId'] == row['id']) row.remove('sourceItemId');
          }
          final existing = items.indexWhere((old) => old['id'] == row['id']);
          if (existing < 0) {
            items.add(desktopHistoryItem(row));
          } else {
            items[existing] = desktopHistoryItem(row);
          }
          continue;
        }
        if (item['type'] == 'agentMessage' &&
            item['id'] is String &&
            item['turnId'] is String) {
          // History associates existing raw provenance; it never supplies patches.
          final ledger = threadList.data.responseChanges;
          final existing = ledger.entries.values
              .where((e) => e.thread == id && e.turn == item['turnId'])
              .firstOrNull;
          if (existing != null) {
            ledger.noteAssistant(
              id,
              item['turnId'] as String,
              item['id'] as String,
            );
            if ({
              'completed',
              'failed',
              'stopped',
              'interrupted',
            }.contains(turn['status'])) {
              existing.terminal = true;
            }
          }
        }
        final subagent = SubagentAction.decode(
          item,
          mac: active?.macDeviceId ?? '',
          thread: id,
          turn: subagentString(item['turnId']) ?? '',
        );
        if (subagent != null) {
          final row = subagents.merge(subagent).toRow();
          final index = items.indexWhere((item) => item['id'] == row['id']);
          if (index < 0) {
            items.add(row);
          } else {
            items[index] = row;
          }
        } else if (isGuardianRow(item)) {
          final review = GuardianReview.decode({...item, 'threadId': id});
          if (review == null) continue;
          guardian.upsert(id, review, live: false);
          final row = guardian.find(id, review.reviewId)!.toRow(id);
          final index = items.indexWhere((item) => item['id'] == row['id']);
          if (index < 0) {
            items.add(row);
          } else {
            items[index] = row;
          }
        } else {
          final activityTurn =
              activityString(turn['id']) ??
              activityString(turn['turnId']) ??
              activityString(turn['turn_id']) ??
              activityString(item['turnId']) ??
              activityString(item['turn_id']) ??
              '';
          final candidate = DesktopActivity.fromItem(
            item,
            mac: active?.macDeviceId ?? '',
            thread: id,
            turn: activityTurn,
          );
          final newer =
              candidate != null && protectedHistoryIds.contains(candidate.id)
              ? activity.items[candidate.id]
              : null;
          final projected =
              newer ?? activity.restore(item, thread: id, turn: activityTurn);
          if (projected == null) {
            items.add(desktopHistoryItem(item));
          } else {
            final row = projected.toRow();
            final index = items.indexWhere((item) => item['id'] == row['id']);
            if (index < 0) {
              items.add(row);
            } else {
              items[index] = row;
            }
          }
        }
      }
    }
    final reconciled = desktopReconcileHistory(
      previous.where(desktopOrdinaryHistoryRow).toList(),
      items,
      protectedLiveIds: protectedHistoryIds,
      runningTurns: {
        if (_responseCurrent)
          for (final entry in _responseLifecycle!.facts(id).outcomes.entries)
            if (entry.value == DesktopResponseOutcome.running) entry.key,
      },
      canonicalSnapshot: true,
    );
    items
      ..clear()
      ..addAll(reconciled.rows);
    // Notification-only reviews may be absent from server history. Retain their prior anchors.
    for (var i = 0; i < previous.length; i++) {
      final old = previous[i];
      if (desktopOrdinaryHistoryRow(old) ||
          old['type'] == 'reasoning' && !_reasoningRowMatchesThread(old, id) ||
          old['threadId'] != null && old['threadId'] != id ||
          items.any((item) => item['id'] == old['id'])) {
        continue;
      }
      final next = previous
          .skip(i + 1)
          .map((item) => item['id'])
          .where((next) => items.any((item) => item['id'] == next))
          .firstOrNull;
      final index = next == null
          ? items.length
          : items.indexWhere((item) => item['id'] == next);
      items.insert(index, old);
    }
    if (replacement != null && _historyReplacements[id] == replacement) {
      _historyReplacements.remove(id);
    }
    _syncSubagentLifecycle(id, history: value);
    return items;
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
        throw StateError('Read saved settings before creating a new chat.');
      }
      if (settings != null && requested.model == null) {
        throw StateError(
          'Connect a Mac with available models before creating a new chat.',
        );
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
        throw StateError(
          'The desktop created the chat in another project folder. Your local draft was retained.',
        );
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
  RemoteJson? _planSession(String id) {
    final mac = active?.macDeviceId, pin = active?.data['macIdentityPublicKey'];
    final saved = threadList.data.planSessions[id];
    return mac != null &&
            threadList.macDeviceId == mac &&
            pin is String &&
            pin.isNotEmpty &&
            saved?['identityPin'] == pin
        ? saved
        : null;
  }

  void _recordPlanSession(String id, String source) {
    final mac = active?.macDeviceId, pin = active?.data['macIdentityPublicKey'];
    if (mac == null ||
        threadList.macDeviceId != mac ||
        pin is! String ||
        pin.isEmpty ||
        id.trim().isEmpty ||
        threadList.data.deleted.contains(id)) {
      return;
    }
    final previous = _planSession(id);
    threadList.data.planSessions[id] = {
      'identityPin': pin,
      'source': source == 'requested'
          ? (previous?['source'] ?? source)
          : source,
    };
    threadList.scheduleSave();
  }

  bool get usesNativePlanPresentation {
    final id = thread?['id'];
    return id is String &&
        {'requested', 'native'}.contains(_planSession(id)?['source']);
  }

  DesktopPlanQuestionnaire? inferredPlanQuestionnaire(RemoteJson row) {
    final id = thread?['id'];
    if (id is! String ||
        _planSession(id)?['source'] != 'compatibilityFallback' ||
        !desktopHistoryOwnedRow(row, id, row['turnId']) ||
        row['type'] != 'agentMessage' && !desktopIsPlanItem(row) ||
        row['type'] == 'agentMessage' && row['isStreaming'] == true) {
      return null;
    }
    final questionnaire = DesktopPlanQuestionnaire.parse(
      desktopPlanBody(row),
      assistant: row['type'] == 'agentMessage',
    );
    if (questionnaire == null) return null;
    String normalized(Object? value) =>
        value is String ? value.trim().toLowerCase() : '';
    String signature(List questions) => jsonEncode([
      for (final q in questions.whereType<Map>())
        [
          normalized(q['question']),
          for (final o in (q['options'] as List? ?? []).whereType<Map>())
            normalized(o['label']),
        ],
    ]);
    final expected = signature(questionnaire.questions);
    for (final request in pendingUserInputs) {
      final params = request['params'] as Map? ?? {};
      final turn = params['turnId'];
      if (turn != null && row['turnId'] != null
          ? turn == row['turnId']
          : signature(params['questions'] as List? ?? []) == expected) {
        return null;
      }
    }
    final index = timeline.indexWhere((item) => item['id'] == row['id']);
    var end = timeline.length;
    if (desktopIsPlanItem(row)) {
      for (var i = index + 1; i < timeline.length; i++) {
        if (desktopIsPlanItem(timeline[i])) {
          end = i;
          break;
        }
      }
    }
    for (var i = 0; i < timeline.length; i++) {
      final candidate = timeline[i];
      if (candidate['type'] != 'userInputPrompt' ||
          !desktopHistoryOwnedRow(candidate, id, candidate['turnId'])) {
        continue;
      }
      final raw = candidate['structuredUserInputRequest'];
      final questions =
          (raw is Map ? raw['questions'] : candidate['questions']) as List? ??
          [];
      if (row['turnId'] != null && candidate['turnId'] != null
          ? row['turnId'] == candidate['turnId']
          : i >= index && i < end && signature(questions) == expected) {
        return null;
      }
    }
    return questionnaire;
  }

  Future<bool> answerInferredPlanQuestionnaire(
    String item,
    Map<String, List<String>> answers, {
    bool Function()? canContinue,
  }) async {
    final scope = _stopContext;
    final row = timeline.where((row) => row['id'] == item).firstOrNull;
    final questionnaire = row == null ? null : inferredPlanQuestionnaire(row);
    if (scope == null || busy || row == null || questionnaire == null) {
      return false;
    }
    final body = desktopPlanBody(row);
    bool current() {
      final session = _planSession(scope.thread);
      return _stopContext == scope &&
          canContinue?.call() != false &&
          timeline.any((r) => r['id'] == item && desktopPlanBody(r) == body) &&
          (session?['source'] == 'compatibilityFallback' ||
              !supportsPlan && session == null);
    }

    if (!current() || answers.length != questionnaire.questions.length) {
      return false;
    }
    final sections = <String>[];
    for (final q in questionnaire.questions.indexed) {
      final values = (answers[q.$2['id']] ?? [])
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      final limit =
          q.$2['selectionLimit'] as int? ??
          ((q.$2['options'] as List).isEmpty ? null : 1);
      if (values.isEmpty || limit != null && values.length > limit) {
        return false;
      }
      sections.add(
        '${q.$1 + 1}. ${q.$2['question']}\n${values.length == 1 ? values.single : values.map((s) => '- $s').join('\n')}',
      );
    }
    final token = (scope, item, body);
    if (!_inferredPlanAnswers.add(token)) return false;
    try {
      if (turnId == null) {
        final revision = _responseRunRevision, binding = _responseConnection;
        bool lookupCurrent() =>
            current() &&
            turnId == null &&
            revision == _responseRunRevision &&
            binding == _responseConnection;
        final active = await _resolveActiveTurnSnapshot(
          scope.thread,
          lookupCurrent,
        );
        if (!lookupCurrent()) return false;
        if (active.pending) {
          throw StateError(
            'The active run has not published its ID yet. Try again in a moment.',
          );
        }
        if (active.activeTurnId case final target?) {
          _adoptTurnTarget(scope.thread, null, target);
        }
      }
      if (!current()) return false;
      if (selectedModel == null) {
        throw StateError('Choose an available desktop model first.');
      }
      final snapshot = DesktopRuntime(
        model: selectedModel,
        effort: effort,
        access: access,
        plan: true,
        serviceTier: serviceTier,
      );
      return await _sendDraft(
        DesktopComposerDraft(text: 'Answers:\n\n${sections.join('\n\n')}'),
        runtimeSnapshot: snapshot,
        collaborationMode:
            snapshot.parameters(forTurn: true)['collaborationMode']
                as RemoteJson?,
        canContinue: current,
      );
    } catch (e) {
      if (current()) error = e.toString();
      return false;
    } finally {
      _inferredPlanAnswers.remove(token);
      _notify();
    }
  }

  DesktopPlan? responsePlanProposal(RemoteJson row) {
    final id = thread?['id'];
    if (id is! String || !desktopHistoryOwnedRow(row, id, row['turnId'])) {
      return null;
    }
    final native = DesktopPlan.fromRow(row);
    if (native != null) return native;
    if (row['type'] != 'agentMessage' ||
        row['isStreaming'] == true ||
        usesNativePlanPresentation) {
      return null;
    }
    final text = desktopPlanBody(row);
    final parsed = desktopProposedPlan(text);
    final body =
        parsed?.body ??
        (_planSession(id)?['source'] == 'compatibilityFallback' &&
                inferredPlanQuestionnaire(row) == null
            ? desktopLegacyProposedPlan(text)
            : null);
    if (body == null) return null;
    final turn = row['turnId'];
    final outcome = _responseCurrent && turn is String
        ? _responseLifecycle!.facts(id).outcome(turn)
        : DesktopResponseOutcome.unknown;
    final completed =
        turn is String &&
        (outcome == DesktopResponseOutcome.completed ||
            outcome == DesktopResponseOutcome.unknown &&
                (thread?['turns'] as List? ?? []).whereType<Map>().any(
                  (t) =>
                      t['id'] == turn &&
                      desktopResponseHistoryOutcome(
                            Map<String, dynamic>.from(t),
                          ) ==
                          DesktopResponseOutcome.completed,
                ));
    return DesktopPlan({
      ...row,
      'type': 'plan',
      'text': body,
      'plan': <RemoteJson>[],
      'djlProgressPlan': false,
      'djlJsonlProgressPlan': false,
      'planPresentation': completed ? 'resultReady' : 'resultClosed',
      'isStreaming': false,
    });
  }

  bool canImplementPlan(String item, String body) {
    if (_stopContext == null ||
        busy ||
        projectMoveBusy ||
        selectedModel == null) {
      return false;
    }
    final row = timeline.where((row) => row['id'] == item).firstOrNull;
    final proposal = row == null ? null : responsePlanProposal(row);
    return proposal != null &&
        proposal.inlineResult &&
        !proposal.streaming &&
        proposal.presentation == 'resultReady' &&
        proposal.body == body;
  }

  Future<bool> implementPlan(
    String item, {
    required String body,
    bool Function()? canContinue,
  }) async {
    final scope = _stopContext;
    if (scope == null ||
        !canImplementPlan(item, body) ||
        canContinue?.call() == false) {
      return false;
    }
    final token = (scope, item, body);
    if (!_planImplementations.add(token)) return false;
    bool ownsPlan() {
      if (_stopContext != scope || canContinue?.call() == false) return false;
      final row = timeline.where((row) => row['id'] == item).firstOrNull;
      final proposal = row == null ? null : responsePlanProposal(row);
      return proposal?.presentation == 'resultReady' && proposal?.body == body;
    }

    final selected = runtime;
    final execution = DesktopRuntime(
      model: selected.model,
      effort: selected.effort,
      access: selected.access,
      plan: false,
      serviceTier: selected.serviceTier,
    );
    try {
      if (turnId == null) {
        final runRevision = _responseRunRevision;
        bool current() =>
            ownsPlan() && _responseRunRevision == runRevision && turnId == null;
        final snapshot = await _resolveActiveTurnSnapshot(
          scope.thread,
          current,
        );
        if (!current()) return false;
        if (snapshot.pending) {
          throw StateError(
            'The active run has not published its ID yet. Try again in a moment.',
          );
        }
        if (snapshot.activeTurnId case final target?) {
          if (_finishedTurns.contains((scope.thread, target))) {
            throw StateError(
              'The active run changed. Refresh before implementing this plan.',
            );
          }
          _adoptTurnTarget(scope.thread, null, target);
        }
      }
      if (!ownsPlan()) return false;
      final accepted = await _sendDraft(
        DesktopComposerDraft(text: 'Implement plan.'),
        runtimeSnapshot: execution,
        canContinue: ownsPlan,
        collaborationMode: {
          'mode': 'default',
          'settings': {
            'model': execution.modelName,
            'reasoning_effort': execution.effort,
            'developer_instructions': null,
          },
        },
      );
      if (accepted && ownsPlan()) {
        plan = false;
        _passiveSelection = null;
        _rememberCurrent();
        _notify();
      }
      return accepted;
    } catch (failure) {
      if (ownsPlan()) {
        error = failure.toString();
        _notify();
      }
      return false;
    } finally {
      _planImplementations.remove(token);
    }
  }

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
        throw StateError(
          'The draft context belongs to another project folder. Remove it and select context again.',
        );
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
      error =
          'The selected desktop model is unavailable. Choose an available model.';
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
        throw StateError(
          'Choose an available model that supports Plan mode before sending this queued draft.',
        );
      }
      if (draft.contexts.isNotEmpty &&
          draft.cwd != null &&
          draft.cwd != selectedCwd) {
        throw StateError(
          'The draft context belongs to another project folder. Remove it and select context again.',
        );
      }
      final input = draft.input();
      if (model == null) {
        throw StateError('Choose an available desktop model first.');
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
        error =
            'The active run changed before queued delivery. Refresh before resuming.';
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
          throw StateError(
            'The active run changed. Refresh before steering again.',
          );
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
          throw StateError(
            'Choose an available model before leaving Plan mode.',
          );
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
          'text':
              'Plan mode is not supported by this runtime. Sent as a normal turn instead.',
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
          ? '$e The send result may be unknown. Refresh the conversation before trying again.'
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
      throw StateError(
        'The active run has not published its ID yet. Try again in a moment.',
      );
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
          throw StateError('The runtime returned another chat’s turn page.');
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
      throw StateError('The runtime returned another chat’s history.');
    }
    final turns = value['turns'];
    if (turns is! List) {
      throw StateError('The runtime did not return this chat’s turn state.');
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
      throw StateError('The runtime returned an invalid turn state.');
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
        throw StateError(
          'The active run has not published its ID yet. Try again in a moment.',
        );
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
        throw StateError(
          'The active run has not published its ID yet. Try again in a moment.',
        );
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

  bool canRespond(RemoteJson request) =>
      runtimeReady &&
      requestMatchesConnection(request) &&
      !isClosingQuestion(request) &&
      request['_submitted'] != true &&
      request['_submitting'] != true;
  Future<void> _respond(RemoteJson request, RemoteJson result) async {
    if (_closingQuestions.containsKey(request)) return;
    if (request['_submitted'] == true || request['_submitting'] == true) return;
    if (!requestMatchesConnection(request)) {
      error =
          'This request belongs to an earlier desktop session. Refresh the chat.';
      _notify();
      return;
    }
    final generation = _connectGeneration;
    request['_submitting'] = true;
    _rememberCurrent();
    _notify();
    try {
      await transport.send({'id': request['id'], 'result': result});
      if (generation == _connectGeneration) request['_submitted'] = true;
    } catch (e) {
      if (generation == _connectGeneration) error = e.toString();
    } finally {
      request.remove('_submitting');
      if (generation == _connectGeneration) {
        _rememberCurrent();
        _notify();
      }
    }
  }

  void _resetSubmittedQuestions() {
    for (final request in userInputs) {
      if (request.remove('_submitted') == true ||
          request.remove('_submitting') == true) {
        request['_responseUnknown'] = true;
      }
    }
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

  bool isClosingQuestion(RemoteJson request) =>
      _closingQuestions[request] == _stopContext &&
      _closingQuestions.containsKey(request);

  Future<bool> cancelQuestion(RemoteJson request) async {
    final scope = _stopContext;
    if (scope == null ||
        !canRespond(request) ||
        !_requestForCurrentThread(request) ||
        !userInputs.any((q) => identical(q, request)) ||
        _closingQuestions.containsKey(request)) {
      return false;
    }
    final params = request['params'] as RemoteJson? ?? {};
    final prompts = userInputs
        .where(
          (q) => _requestForCurrentThread(q) && requestMatchesConnection(q),
        )
        .toList();
    final session = _planSession(scope.thread);
    bool current() =>
        _stopContext == scope &&
        requestMatchesConnection(request) &&
        !userInputs.any(
          (q) => q['id'] == request['id'] && !identical(q, request),
        );
    _closingQuestions[request] = scope;
    error = null;
    setPlan(false);
    try {
      var target = _realTurnId(params['turnId']) ?? _realTurnId(turnId);
      target ??= await _steerActiveTurnId(scope.thread, current);
      if (!current()) return false;
      if (target != null) {
        await transport.request('turn/interrupt', {
          'threadId': scope.thread,
          'turnId': target,
        });
      }
      if (!current()) return false;
      userInputs.removeWhere((q) => prompts.any((p) => identical(p, q)));
      if (!userInputs.any(_requestForCurrentThread) &&
          identical(_planSession(scope.thread), session)) {
        threadList.data.planSessions.remove(scope.thread);
        threadList.scheduleSave();
      }
      _rememberCurrent();
      return true;
    } catch (e) {
      if (current()) error = e.toString();
      return false;
    } finally {
      _closingQuestions.remove(request);
      if (_stopContext == scope) {
        _notify();
      }
    }
  }

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

  void _enqueueRequest(List<RemoteJson> list, RemoteJson rpc) {
    final index = list.indexWhere((old) => old['id'] == rpc['id']);
    rpc = {
      ...rpc,
      '_macDeviceId': transport.macDeviceId ?? active?.macDeviceId,
      '_sessionId': transport.sessionId ?? active?.sessionId,
      '_receivedAt':
          (index < 0 ? null : list[index]['_receivedAt']) ??
          DateTime.now().millisecondsSinceEpoch,
    };
    if (index < 0) {
      list.add(rpc);
    } else {
      list[index] = rpc;
    }
  }

  Future<void> _rejectUnknown(RemoteJson rpc) async {
    try {
      await transport.send({
        'id': rpc['id'],
        'error': {
          'code': -32601,
          'message': 'Unsupported request method: ${rpc['method']}',
        },
      });
    } catch (e) {
      error = e.toString();
      _notify();
    }
  }

  List<RemoteJson> _applyOrdinaryTimelineEvent(
    String owner,
    List<RemoteJson> rows,
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    switch (method) {
      case 'item/agentMessage/delta':
        final id = params['itemId'];
        var item = rows
            .where(
              (i) =>
                  i['type'] == 'agentMessage' &&
                  desktopHistorySourceId(i) == id,
            )
            .firstOrNull;
        if (item == null) {
          item = desktopHistoryNewRow({
            'id': id,
            'type': 'agentMessage',
            'text': '',
            'turnId': params['turnId'],
          }, rows.map((r) => r['id']).whereType<String>().toSet());
          rows.add(item);
        }
        item['text'] = '${item['text'] ?? ''}${params['delta'] ?? ''}';
        final knownClosed =
            _responseCurrent &&
            params['turnId'] is String &&
            _responseLifecycle!.isTurnTerminal(
              owner,
              params['turnId'] as String,
            );
        item['isStreaming'] =
            params['djlReplayedEvent'] != true && !knownClosed;
        if (params['djlReplayedEvent'] != true) {
          _noteTimelineLive(owner, item);
        }
      case 'item/started':
      case 'item/completed':
        final item = params['item'] as RemoteJson?;
        if (item != null) {
          final itemTurn = item['turnId'] ?? params['turnId'];
          final knownClosed =
              _responseCurrent &&
              itemTurn is String &&
              _responseLifecycle!.isTurnTerminal(owner, itemTurn);
          final resolved = desktopHistoryItem(<String, dynamic>{
            ...item,
            'turnId': item['turnId'] ?? params['turnId'],
            if (item['type'] == 'agentMessage')
              'isStreaming':
                  method == 'item/started' &&
                  params['djlReplayedEvent'] != true &&
                  !knownClosed,
          });
          final index = desktopOrdinaryHistoryRow(resolved)
              ? desktopHistoryMatchIndex(rows, resolved)
              : rows.indexWhere((i) => i['id'] == item['id']);
          final attempt = _queuedDelivery;
          if (item['type'] == 'userMessage' &&
              item['id'] is String &&
              (item['id'] as String).trim().isNotEmpty &&
              desktopHistorySourceId(resolved) != null &&
              _realTurnId(item['turnId'] ?? params['turnId']) != null &&
              index >= 0 &&
              attempt is _QueuedAttempt &&
              attempt.requested &&
              rows[index]['id'] == attempt.messageId &&
              _responseCurrent &&
              requestMatchesConnection(rpc) &&
              rpc['djlReplayedEvent'] != true &&
              params['djlReplayedEvent'] != true) {
            attempt.received = true;
          }
          RemoteJson? edited;
          if (item['type'] == 'userMessage') {
            final old = index < 0 ? null : rows[index];
            final oldLength = rows.length;
            final reconciliation = desktopReconcileHistory(
              rows,
              [resolved],
              protectedLiveIds: {},
              runningTurns: {},
              canonicalSnapshot: false,
            );
            rows = reconciliation.rows;
            edited = old == null
                ? rows.length > oldLength
                      ? rows.last
                      : null
                : rows.where((r) => r['id'] == old['id']).firstOrNull;
            // Preserve the established optimistic-to-provider UI handoff. History
            // aliases and projected collisions keep their separate display IDs.
            if (edited != null &&
                old?['sourceItemId'] == null &&
                (old?['id'] as String? ?? '').startsWith('local-') &&
                !desktopProvisionalHistoryItem(
                  desktopHistorySourceId(resolved),
                )) {
              edited['id'] = resolved['id'];
              if (edited['sourceItemId'] == edited['id']) {
                edited.remove('sourceItemId');
              }
            }
          } else if (index < 0) {
            edited = desktopHistoryNewRow(
              resolved,
              rows.map((r) => r['id']).whereType<String>().toSet(),
            );
            rows.add(edited);
          } else {
            edited = desktopMergeHistoryRow(
              rows[index],
              resolved,
              protectLive: false,
              snapshot: false,
              runningTurns: {},
            );
            rows[index] = edited;
          }
          if (edited != null && params['djlReplayedEvent'] != true) {
            _noteTimelineLive(owner, edited);
          }
        }
    }
    return rows;
  }

  void _syncSubagentLifecycle(String id, {RemoteJson? history}) {
    if (!_responseCurrent) return;
    final metadata = threadList.data.find(id);
    if (metadata?['isSubagent'] != true && history?['isSubagent'] != true) {
      return;
    }
    final facts = _responseLifecycle!.facts(id),
        turn = _responseLifecycle!.facts(id).latestTurn;
    if (turn == null) return;
    final status = switch (facts.latestOutcome) {
      DesktopResponseOutcome.running => 'running',
      DesktopResponseOutcome.completed => 'completed',
      DesktopResponseOutcome.failed => 'failed',
      DesktopResponseOutcome.stopped => 'stopped',
      DesktopResponseOutcome.unknown => null,
    };
    if (status == null) return;
    for (final value in [metadata, history, if (thread?['id'] == id) thread]) {
      if (value != null) {
        value['subagentStatus'] = status;
        value['subagentTurnId'] = turn;
      }
    }
  }

  void _retireObservedRun(String thread, String turn, {required bool guessed}) {
    if (!_responseCurrent) return;
    _settlePlans(
      thread,
      turn,
      completed:
          _responseLifecycle!.facts(thread).outcome(turn) ==
          DesktopResponseOutcome.completed,
    );
    final params = <String, dynamic>{'threadId': thread, 'turnId': turn};
    _finishedTurns.add((thread, turn));
    // Canonical reasoning closes in historyTurn under this read's watermark,
    // so its own final snapshot can still replace streamed text.
    if (_reasoningCurrent() && guessed) {
      _reasoning!.observeTurn(
        'turn/completed',
        params,
        backgroundGuess: guessed,
      );
    }
    _bindActivityDevice(active!.macDeviceId);
    activity.observeTurn(
      'turn/completed',
      params,
      knownThreads: _knownActivityThreads,
      selectedThread: this.thread?['id'] as String?,
      backgroundGuess: guessed,
    );
    _syncRunStatus();
    if (guessed) _runStatus?.rememberTurn(thread, turn);
    _runStatus?.retireTurn(thread, turn);
    final ledger = threadList.data.responseChanges;
    if (ledger.running[thread] == turn) ledger.running.remove(thread);
    for (final entry in ledger.entries.values.where(
      (e) => e.thread == thread && e.turn == turn,
    )) {
      if (!guessed) entry.terminal = true;
      entry.reviewRevision++;
    }
    _syncReasoningRows();
    _syncActivityRows();
  }

  void _reviveBackgroundGuess(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (method != 'turn/started' ||
        rpc['id'] != null ||
        !_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        params['djlBackgroundDiscovery'] != true ||
        params['djlReplayedEvent'] == true ||
        rpc['djlReplayedEvent'] == true) {
      return;
    }
    final identity = desktopResponseIdentity(params);
    if (identity == null ||
        identity.turn == null ||
        threadList.data.deleted.contains(identity.thread) ||
        !_responseLifecycle!.reviveBackgroundGuess(
          identity.thread,
          identity.turn!,
        )) {
      return;
    }
    final turn = identity.turn!, thread = identity.thread;
    _finishedTurns.remove((thread, turn));
    _subagentFinishedTurns.remove((thread, turn));
    _syncSubagentLifecycle(thread);
    if (_reasoningCurrent()) _reasoning!.reviveBackgroundGuess(thread, turn);
    _bindActivityDevice(active!.macDeviceId);
    activity.reviveBackgroundGuess(thread, turn);
    _syncRunStatus();
    _runStatus?.reviveBackgroundGuess(thread, turn);
    for (final entry in threadList.data.responseChanges.entries.values.where(
      (e) => e.thread == thread && e.turn == turn,
    )) {
      entry.terminal = false;
      entry.reviewRevision++;
    }
    _syncReasoningRows();
    _syncActivityRows();
  }

  void _adoptSourceContinuity(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (method != 'turn/started' ||
        rpc['id'] != null ||
        !_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        params['djlReplayedEvent'] == true ||
        rpc['djlReplayedEvent'] == true) {
      return;
    }
    final identity = desktopResponseIdentity(params);
    if (identity == null || identity.turn == null) return;
    final prior = _sourceContinuity.remove(identity.thread);
    if (params['djlTurnIdentityContinuity'] != true ||
        prior == null ||
        prior.connection != _responseConnection) {
      return;
    }
    final thread = identity.thread, turn = identity.turn!;
    final previousOutcome = _responseLifecycle!
        .facts(thread)
        .outcome(prior.turn);
    if (!prior.turn.startsWith('ipc-turn-') &&
        _responseLifecycle!.isTurnTerminal(thread, prior.turn) &&
        (previousOutcome != DesktopResponseOutcome.stopped ||
            !_responseLifecycle!.isBackgroundGuess(thread, prior.turn))) {
      return;
    }
    final outcome = _responseLifecycle!.facts(thread).outcome(turn);
    if (_responseLifecycle!.isTurnTerminal(thread, turn) &&
        outcome != DesktopResponseOutcome.stopped) {
      return;
    }
    _bindSubagents();
    _bindActivityDevice(active!.macDeviceId);
    final rows = this.thread?['id'] == thread
        ? timeline
        : threadList.data.timelines[thread] ?? <RemoteJson>[];
    final rowIds = prior.currentOnly
        ? {
            for (final row in rows)
              if (!prior.excludedIds.contains(row['id']) && row['id'] is String)
                row['id'] as String,
          }
        : null;
    final replacements = <String, RemoteJson>{
      ...activity.rebindHistoryTurn(thread, prior.turn, turn, rowIds: rowIds),
      ...subagents.rebindHistoryTurn(thread, prior.turn, turn, rowIds: rowIds),
      if (prior.turn != turn)
        ...guardian.rebindHistoryTurn(thread, prior.turn, turn, rowIds: rowIds),
      if (_reasoningCurrent())
        ..._reasoning!.rebindHistoryTurn(
          thread,
          prior.turn,
          turn,
          rowIds: rowIds,
        ),
    };
    final ledger = threadList.data.responseChanges;
    if (ledger.canRebindHistoryTurn(
      thread,
      prior.turn,
      turn,
      currentOnly: prior.currentOnly,
    )) {
      ledger.rebindHistoryTurn(
        thread,
        prior.turn,
        turn,
        currentOnly: prior.currentOnly,
      );
    }
    for (final entry in ledger.entries.values.where(
      (e) => e.thread == thread && e.turn == turn,
    )) {
      entry.terminal = false;
      entry.reviewRevision++;
    }
    _responseLifecycle!.rebindHistoryTurn(thread, prior.turn, turn);
    _responseLifecycle!.reviveBackgroundGuess(thread, turn);
    if (_responseLifecycle!.facts(thread).outcome(turn) ==
        DesktopResponseOutcome.running) {
      _finishedTurns.remove((thread, turn));
    }
    if (_reasoningCurrent()) _reasoning!.reviveBackgroundGuess(thread, turn);
    activity.reviveBackgroundGuess(thread, turn);
    _runStatus?.rebindTurn(
      thread,
      prior.turn,
      turn,
      resume: !prior.currentOnly,
    );
    for (var i = 0; i < rows.length; i++) {
      final row = rows[i];
      rows[i] =
          replacements[row['id']] ??
          (row['turnId'] == prior.turn &&
                  (rowIds == null || rowIds.contains(row['id']))
              ? {
                  ...row,
                  'turnId': turn,
                  if (row.containsKey('turn_id')) 'turn_id': turn,
                }
              : row);
    }
    threadList.data.timelines[thread] = List.of(rows);
    _syncReasoningRows();
    _syncActivityRows();
    _syncSubagentRows();
    _syncGuardianRows();
  }

  void _resetProjectedSource(String thread) {
    if (!_responseCurrent) return;
    final previous = _responseLifecycle!.facts(thread).latestTurn;
    if (previous != null) {
      _sourceContinuity[thread] = (
        connection: _responseConnection!,
        turn: previous,
        revision: _responseLifecycle!.revision,
        excludedIds: <String>{},
        currentOnly: false,
      );
    }
    _responseLifecycle!.resetProjectedTerminals(thread);
    _subagentFinishedTurns.removeWhere(
      (key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'),
    );
    final metadata = threadList.data.find(thread);
    if ((metadata?['subagentTurnId'] as String? ?? '').startsWith(
      'ipc-turn-',
    )) {
      metadata?.remove('subagentTurnId');
    }
    _finishedTurns.removeWhere(
      (key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'),
    );
    if (_reasoningCurrent()) _reasoning!.resetProjectedTerminals(thread);
    _bindActivityDevice(active!.macDeviceId);
    activity.resetProjectedTerminals(thread);
    _syncRunStatus();
    _runStatus?.resetProjectedTerminals(thread);
    threadList.data.responseChanges.archiveProjectedTerminals(thread);
    final connection = (
      transport.macDeviceId,
      transport.sessionId,
      transport.connectionRevision,
    );
    final old = {..._checkpointsByTurn.keys, ..._checkpointEnds.keys}
        .where(
          (key) =>
              key.connection == connection &&
              key.thread == thread &&
              key.turn.startsWith('ipc-turn-'),
        )
        .toList();
    for (final key in old) {
      _unverifiedCheckpointOwners.add(key);
      _checkpointsByTurn.remove(key);
      _checkpointEnds.remove(key);
    }
    _responseRunRevision++;
  }

  void _settlePlans(
    String owner,
    String turn, {
    required bool completed,
    bool live = false,
    bool allowReady = true,
  }) {
    final selected = thread?['id'] == owner;
    final rows = selected ? timeline : threadList.data.timelines[owner];
    if (rows == null) return;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]['turnId'] != turn || !desktopIsPlanItem(rows[i])) continue;
      rows[i] = desktopClosedPlan(
        rows[i],
        completed: completed,
        allowReady: allowReady,
      );
      if (live) _noteTimelineLive(owner, rows[i]);
    }
    if (!selected) threadList.scheduleSave();
  }

  ({String thread, String? turn})? _planIdentity(RemoteJson params) {
    var scoped = params;
    final envelopes = [
      params,
      ?activityObject(params['turn']),
      ?activityObject(params['event']),
      ?activityObject(params['msg']),
    ];
    final hasThread = envelopes.any(
      (map) =>
          map['thread'] != null ||
          [
            'threadId',
            'thread_id',
            'conversationId',
            'conversation_id',
          ].any((key) => map[key] != null),
    );
    if (!hasThread) {
      final turns = [
        for (final map in envelopes) ...[map['turnId'], map['turn_id']],
        activityObject(params['turn'])?['id'],
      ].where((v) => v != null).toSet();
      if (turns.length != 1 || turns.single is! String) return null;
      final turn = turns.single as String;
      final owners = <String>{
        for (final id in {
          ..._knownActivityThreads,
          ...threadList.data.timelines.keys,
          if (thread?['id'] is String) thread!['id'] as String,
        })
          if (_responseLifecycle!.facts(id).outcomes.containsKey(turn) ||
              (thread?['id'] == id
                      ? timeline
                      : threadList.data.timelines[id] ?? <RemoteJson>[])
                  .any((row) => row['turnId'] == turn))
            id,
      };
      if (owners.length != 1) return null;
      scoped = {...params, 'threadId': owners.single};
    }
    return desktopResponseIdentity(scoped);
  }

  bool _capturePlan(String method, RemoteJson params, RemoteJson rpc) {
    if ({'turn/completed', 'turn/failed'}.contains(method)) {
      final identity = desktopResponseIdentity(params);
      if (_responseCurrent &&
          requestMatchesConnection(rpc) &&
          identity?.turn != null &&
          _responseLifecycle!.isTurnTerminal(
            identity!.thread,
            identity.turn!,
          )) {
        final replay =
            params['djlReplayedEvent'] == true ||
            rpc['djlReplayedEvent'] == true;
        _settlePlans(
          identity.thread,
          identity.turn!,
          completed:
              _responseLifecycle!
                  .facts(identity.thread)
                  .outcome(identity.turn!) ==
              DesktopResponseOutcome.completed,
          live: !replay,
          allowReady: !replay,
        );
      }
      return false;
    }
    final item = activityObject(params['item']);
    final handles =
        method == 'turn/plan/updated' ||
        method == 'item/plan/delta' ||
        {'item/started', 'item/completed'}.contains(method) &&
            item != null &&
            desktopIsPlanItem(item);
    if (!handles) return false;
    if (!_responseCurrent ||
        !connected ||
        !requestMatchesConnection(rpc) ||
        transport.macDeviceId != active?.macDeviceId) {
      return true;
    }
    final identity = _planIdentity(params);
    if (identity == null ||
        identity.turn == null ||
        threadList.data.deleted.contains(identity.thread) ||
        item != null &&
            !desktopHistoryOwnedRow(item, identity.thread, identity.turn)) {
      return true;
    }
    final scoped = {
      ...params,
      'threadId': identity.thread,
      'turnId': identity.turn,
    };
    final owner = identity.thread, turn = identity.turn!;
    final selected = thread?['id'] == owner;
    final rows = selected
        ? timeline
        : threadList.data.timelines[owner] ?? <RemoteJson>[];
    final handoff = _sourceContinuity[owner];
    final excluded =
        handoff != null &&
            handoff.currentOnly &&
            handoff.connection == _responseConnection &&
            handoff.turn == turn
        ? handoff.excludedIds
        : const <String>{};
    final changed = desktopPlanNotification(
      excluded.isEmpty
          ? rows
          : rows.where((row) => !excluded.contains(row['id'])).toList(),
      thread: owner,
      turn: turn,
      method: method,
      params: scoped,
      closed: _responseLifecycle!.isTurnTerminal(owner, turn),
      completed:
          _responseLifecycle!.facts(owner).outcome(turn) ==
          DesktopResponseOutcome.completed,
      replay:
          params['djlReplayedEvent'] == true || rpc['djlReplayedEvent'] == true,
    );
    if (changed == null) return true;
    if (desktopResponseIdentity(params) == null) {
      _noteMirroredRunActivity(method, scoped, rpc);
    }
    final index = rows.indexWhere(
      (row) =>
          row['id'] == changed['id'] &&
          row['turnId'] == turn &&
          desktopIsPlanItem(row) &&
          !excluded.contains(row['id']),
    );
    if (index < 0) {
      rows.add(
        desktopHistoryNewRow(
          changed,
          rows.map((row) => row['id']).whereType<String>().toSet(),
        ),
      );
    } else {
      rows[index] = changed;
    }
    if (params['djlReplayedEvent'] != true && rpc['djlReplayedEvent'] != true) {
      _noteTimelineLive(owner, index < 0 ? rows.last : rows[index]);
    }
    if (selected) {
      _rememberCurrent();
    } else {
      threadList.data.timelines[owner] = rows;
      threadList.scheduleSave();
    }
    _notify();
    return true;
  }

  bool _ignoreClosedRunActivity(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (!_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        rpc['id'] != null ||
        rpc['djlReplayedEvent'] == true ||
        params['djlReplayedEvent'] == true) {
      return false;
    }
    final item = activityObject(params['item']);
    if (method != 'item/agentMessage/delta' &&
        !(method == 'item/started' && item?['type'] != 'userMessage')) {
      return false;
    }
    final identity = desktopResponseIdentity(params);
    return identity != null &&
        identity.turn != null &&
        _finishedTurns.contains((identity.thread, identity.turn!));
  }

  void _noteMirroredRunActivity(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    final planItem = activityObject(params['item']);
    if (method == 'turn/plan/updated' &&
            desktopPlanSteps(params['plan']).isEmpty &&
            activityString(params['explanation']) == null ||
        method == 'item/plan/delta' &&
            (params['delta'] is! String ||
                (params['delta'] as String).isEmpty) ||
        method == 'item/started' &&
            planItem != null &&
            desktopIsPlanItem(planItem) &&
            DesktopPlan.fromRow(planItem) == null) {
      return;
    }
    if (!_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        rpc['id'] != null ||
        params['djlReplayedEvent'] == true ||
        rpc['djlReplayedEvent'] == true ||
        !(method == 'turn/started' ||
            method == 'item/started' ||
            method == 'turn/plan/updated' ||
            method.startsWith('item/') &&
                (method.endsWith('Delta') || method.endsWith('/delta')))) {
      return;
    }
    final identity = desktopResponseIdentity(params);
    if (identity == null) return;
    final item = activityObject(params['item']);
    if (item != null &&
        !desktopHistoryOwnedRow(item, identity.thread, identity.turn)) {
      return;
    }
    final mirrored =
        params['djlDesktopMirror'] == true ||
        params['djlRolloutLiveMirror'] == true;
    final facts = _responseLifecycle!.facts(identity.thread);
    if (mirrored &&
        facts.latestOutcome != DesktopResponseOutcome.running &&
        !threadList.data.deleted.contains(identity.thread)) {
      final turn = identity.turn;
      if (turn == null) {
        _responseLifecycle!.runningStatus(identity.thread, null);
      } else if (!_responseLifecycle!.isTurnTerminal(identity.thread, turn)) {
        _responseLifecycle!.starting(identity.thread, turn);
        if (_reasoningCurrent()) {
          _reasoning!.observeTurn('turn/started', params);
        }
        _bindActivityDevice(active!.macDeviceId);
        activity.observeTurn(
          'turn/started',
          params,
          knownThreads: _knownActivityThreads,
          selectedThread: thread?['id'] as String?,
        );
        _syncRunStatus();
        _runStatus?.observe('turn/started', params);
        _captureResponseChanges('turn/started', params, rpc);
        if (thread?['id'] == identity.thread) turnId = turn;
      }
    }
    _responseLifecycle!.noteActivity(
      identity.thread,
      identity.turn,
      _runClock(),
      mirrored: mirrored,
    );
  }

  void _incoming(RemoteJson rpc) {
    var method = rpc['method'] as String?;
    final params = rpc['params'] is Map
        ? Map<String, dynamic>.from(rpc['params'] as Map)
        : <String, dynamic>{};
    if (rpc['djlReplayedEvent'] == true) params['djlReplayedEvent'] = true;
    if (method == null) return;
    if (method.startsWith('djl/groups/') ||
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
    if ((method == 'account/updated' || method == 'account/login/completed') &&
        rpc['id'] == null &&
        connected &&
        requestMatchesConnection(rpc) &&
        transport.macDeviceId == active?.macDeviceId) {
      usage.accountChanged();
      if (method == 'account/login/completed') {
        unawaited(
          pairedLogin.handleEvent(method, params, refreshStatus: false),
        );
      }
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
              'The desktop could not complete this response. Check its provider settings and retry.';
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
        timeline = _applyOrdinaryTimelineEvent(
          thread!['id'] as String,
          timeline,
          method,
          params,
          rpc,
        );
      case 'serverRequest/resolved':
        approvals.removeWhere((a) => a['id'] == params['requestId']);
        userInputs.removeWhere((a) => a['id'] == params['requestId']);
      case 'error':
      case 'turn/failed':
        error =
            (params['error'] as RemoteJson?)?['message'] as String? ??
            params['message'] as String? ??
            'Desktop request failed.';
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
    _rememberCurrent();
    _notify();
  }

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
    pairedLogin.setAllowed(false);
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
    await pairedLogin.forget(LoginIdentity(pair.macDeviceId, pair.publicKey));
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
    pairedLogin.dispose();
    host.dispose();
    _disposed = true;
    _retry?.cancel();
    _hostPresenceRecovery?.cancel();
    unawaited(_subscription?.cancel());
    unawaited(transport.dispose());
    super.dispose();
  }
}
