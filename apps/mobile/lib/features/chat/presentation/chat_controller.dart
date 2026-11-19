import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/cloud_repository.dart';
import '../../../core/network/client_configuration.dart';
import '../../../core/network/cloud_client.dart';
import '../../account/domain/account_snapshot.dart';
import '../domain/cloud_models.dart';

/// Owns one account-scoped conversation and resumable run; UI never sends raw HTTP.
class ChatController extends ChangeNotifier {
  ChatController(
    this.repository, {
    required this.accountScope,
    this.conversation,
    Json? initialImage,
  }) : _revision = repository.client.revision,
       _composerGeneration = repository.composerDrafts.generation,
       _modelGeneration = repository.modelSelection.generation,
       _composerConversation = conversation?.id ?? 'new' {
    if (initialImage != null) {
      attachments.add({...initialImage, '_displayName': 'Image to edit'});
    }
    repository.modelSelection.addListener(_syncModelSelection);
  }
  final CloudRepository repository;
  final String accountScope;
  final int _revision;
  final int _composerGeneration;
  final int _modelGeneration;
  int _modelChoiceRevision = 0;
  bool modelSelectionSaving = false;
  String? modelSelectionError;
  String _composerConversation;
  String composerDraft = '';
  String? composerError;
  bool _composerReady = false, composerSaving = false;
  int _composerRevision = 0;
  Conversation? conversation;
  List<ChatMessage> messages = [];
  List<Json> models = [], attachments = [];
  Json? get selectedModel => models.where((m) => m['id'] == model).firstOrNull;
  bool get acceptsImages =>
      (selectedModel?['capabilities'] as List?)?.contains('vision') == true;
  Map<String, String> branchSelections = {};
  String? model, error, notice;
  String? usageBlockedUntil, usageError;
  CloudUsageSnapshot? usage;
  bool usageLoading = false, redeemingUsage = false;
  String? _usageRedemptionId;
  int _usageRevision = 0;
  String mode = 'chat';
  bool loading = false, sending = false, uploading = false;
  bool sharing = false;
  RunReducer? reducer;
  RunStream? _watch;
  StreamSubscription<Json>? _subscription;
  SendInput? _pending;
  bool _pendingEditing = false;
  Json? _pendingImage;
  ClientConfiguration configuration = const ClientConfiguration();
  String _creationId = const Uuid().v4();
  bool _disposed = false, _suspended = false;
  bool get _current =>
      !_disposed &&
      repository.client.revision == _revision &&
      _composerGeneration == repository.composerDrafts.generation &&
      _modelGeneration == repository.modelSelection.generation;
  bool get composerReady => _composerReady && _current;
  bool get streaming => reducer != null && !reducer!.terminal;
  List<ChatMessage> get visibleMessages =>
      visibleBranch(messages, branchSelections);
  List<Json> get steps => reducer?.steps ?? [];
  String emptyMessageText(ChatMessage message) {
    if (message.runId != reducer?.runId) return 'No response content.';
    return switch (reducer?.status) {
      'queued' || 'running' => 'Thinking…',
      'cancelled' => 'Response stopped.',
      'failed' => 'Response failed.',
      'blocked_on_usage' => 'Waiting for usage reset.',
      _ => 'No response content.',
    };
  }

  String get _draftKey =>
      'cloud.draft.$accountScope.${conversation?.id ?? 'new'}';
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refreshUsage() async {
    if (!_current || redeemingUsage) return;
    final revision = ++_usageRevision;
    usageLoading = true;
    usageError = null;
    _notify();
    try {
      final result = await repository.usage();
      if (_current && revision == _usageRevision) {
        usage = result;
        if (usageBlockedUntil != null && usageBlockedUntil!.isEmpty) {
          usageBlockedUntil = result.exhaustedReset?.toIso8601String() ?? '';
        }
      }
    } catch (e) {
      if (_current && revision == _usageRevision) usageError = e.toString();
    } finally {
      if (_current && revision == _usageRevision) {
        usageLoading = false;
        _notify();
      }
    }
  }

  /// Only the explicitly confirmed banner action invokes this method.
  Future<void> redeemUsageReset() async {
    if (!_current ||
        redeemingUsage ||
        sending ||
        uploading ||
        usageBlockedUntil == null ||
        (usage?.bankedResets ?? 0) == 0) {
      return;
    }
    final pending = _pending, image = _pendingImage, run = reducer;
    final editing = _pendingEditing, draft = composerDraft;
    final pendingText = pending?.parts
        .where((part) => part['type'] == 'text')
        .map((part) => part['text'] as String)
        .join();
    final clearDraft =
        !editing && pendingText != null && draft.trim() == pendingText;
    final revision = ++_usageRevision;
    redeemingUsage = true;
    usageLoading = false;
    usageError = null;
    _usageRedemptionId ??= const Uuid().v4();
    _notify();
    try {
      final result = await repository.redeemUsageReset(_usageRedemptionId!);
      if (!_current) return;
      _usageRedemptionId = null;
      if (revision != _usageRevision ||
          !identical(_pending, pending) ||
          !identical(_pendingImage, image) ||
          !identical(reducer, run)) {
        return;
      }
      usage = result;
      usageBlockedUntil = null;
      error = null;
      if (run?.status == 'blocked_on_usage') {
        _startStream();
      } else if (image != null) {
        await _postImage();
      } else if (pending != null) {
        final accepted = await _postPending();
        if (_current && accepted && clearDraft && composerDraft == draft) {
          updateComposerDraft('');
        }
      }
    } catch (e) {
      if (_current && revision == _usageRevision) usageError = e.toString();
    } finally {
      if (_current) {
        redeemingUsage = false;
        if (usageBlockedUntil != null && usageError == null) {
          unawaited(refreshUsage());
        }
        _notify();
      }
    }
  }

  void _usageBlocked([String? resetsAt]) {
    usageBlockedUntil = resetsAt ?? '';
    error = null;
    unawaited(refreshUsage());
  }

  void _sendFailure(Object failure) {
    if (failure is CloudFailure && failure.code == 'usage_window_exhausted') {
      _usageBlocked(failure.resetsAt);
    } else {
      error = failure.toString();
    }
  }

  void _syncModelSelection() {
    if (!_current || modelSelectionSaving) return;
    final choice = repository.modelSelection.value;
    if (!models.any((m) => m['id'] == choice)) return;
    if (model == choice &&
        (modelSelectionError == null || repository.modelSelection.dirty)) {
      return;
    }
    model = choice;
    modelSelectionError = null;
    _notify();
  }

  Future<void> _loadModelSelection() async {
    if (!_current || modelSelectionSaving) return;
    final revision = _modelChoiceRevision;
    modelSelectionSaving = true;
    modelSelectionError = null;
    _notify();
    String? saved;
    try {
      saved = await repository.modelSelection.read();
    } catch (_) {
      if (_current && revision == _modelChoiceRevision) {
        model ??= models.firstOrNull?['id'] as String?;
        modelSelectionError = 'Could not load your saved model choice. Retry.';
      }
      return;
    } finally {
      if (_current && revision == _modelChoiceRevision) {
        modelSelectionSaving = false;
        _notify();
      }
    }
    if (!_current || revision != _modelChoiceRevision) return;
    model = models.any((m) => m['id'] == saved)
        ? saved
        : models.firstOrNull?['id'] as String?;
    if (saved != model || repository.modelSelection.dirty) {
      await _saveModelSelection();
    } else {
      _notify();
    }
  }

  Future<void> _saveModelSelection() async {
    if (!_current) return;
    final revision = ++_modelChoiceRevision;
    modelSelectionSaving = true;
    modelSelectionError = null;
    _notify();
    try {
      await repository.modelSelection.save(model, generation: _modelGeneration);
    } catch (_) {
      if (_current && revision == _modelChoiceRevision) {
        modelSelectionError = 'Could not save your model choice. Retry.';
      }
    } finally {
      if (_current && revision == _modelChoiceRevision) {
        modelSelectionSaving = false;
        _syncModelSelection();
        _notify();
      }
    }
  }

  Future<void> retryModelSelection() async {
    if (!_current || modelSelectionSaving) return;
    if (_modelChoiceRevision == 0) {
      await _loadModelSelection();
    } else {
      await _saveModelSelection();
    }
  }

  Future<void> retryComposerDraft() async {
    if (!_current || composerSaving) return;
    if (!_composerReady) {
      await _loadComposerDraft();
      if (composerReady) await _bindComposerConversation();
      return;
    }
    final revision = _composerRevision;
    composerSaving = true;
    composerError = null;
    _notify();
    try {
      await repository.composerDrafts.flush(generation: _composerGeneration);
    } catch (_) {
      if (_current && revision == _composerRevision) {
        composerError =
            'Could not save your draft. Keep the text here and retry.';
      }
    } finally {
      if (_current && revision == _composerRevision) {
        composerSaving = false;
        _notify();
      }
    }
  }

  Future<void> _loadComposerDraft() async {
    if (!_current || composerSaving) return;
    composerSaving = true;
    composerError = null;
    _notify();
    try {
      final text = await repository.composerDrafts.read(
        accountScope,
        _composerConversation,
      );
      if (!_current) return;
      composerDraft = text;
      _composerReady = true;
      if (repository.composerDrafts.dirty) {
        composerError =
            'Could not save your draft. Keep the text here and retry.';
      }
    } catch (_) {
      if (_current) {
        composerError =
            'Could not load your saved draft. Retry before editing.';
      }
    } finally {
      if (_current) {
        composerSaving = false;
        _notify();
      }
    }
  }

  void updateComposerDraft(String text) {
    if (!composerReady || text == composerDraft) return;
    composerDraft = text;
    final revision = ++_composerRevision;
    final write = repository.composerDrafts.save(
      accountScope,
      _composerConversation,
      text,
      generation: _composerGeneration,
    );
    composerSaving = true;
    composerError = null;
    _notify();
    unawaited(_finishComposerWrite(write, revision));
  }

  Future<void> _finishComposerWrite(Future<bool> write, int revision) async {
    try {
      await write;
    } catch (_) {
      if (_current && revision == _composerRevision) {
        composerError =
            'Could not save your draft. Keep the text here and retry.';
      }
    } finally {
      if (_current && revision == _composerRevision) {
        composerSaving = false;
        _notify();
      }
    }
  }

  Future<void> _bindComposerConversation() async {
    final id = conversation?.id;
    if (!composerReady || id == null || id == _composerConversation) return;
    final from = _composerConversation;
    _composerConversation = id;
    final revision = ++_composerRevision;
    composerSaving = true;
    _notify();
    try {
      await repository.composerDrafts.move(
        accountScope,
        from,
        id,
        generation: _composerGeneration,
      );
      final text = await repository.composerDrafts.read(accountScope, id);
      if (_current && revision == _composerRevision) {
        composerDraft = text;
      }
    } catch (_) {
      if (_current && revision == _composerRevision) {
        composerError =
            'Could not save your draft. Keep the text here and retry.';
      }
    } finally {
      if (_current && revision == _composerRevision) {
        composerSaving = false;
        _notify();
      }
    }
  }

  Future<void> initialize() async {
    loading = true;
    _notify();
    try {
      await _loadComposerDraft();
      if (!_current) return;
      final response = await repository.client.request('GET', 'v1/models');
      if (!_current) return;
      models = (response['models'] as List)
          .cast<Json>()
          .where(
            (m) =>
                m['status'] != 'disabled' &&
                m['capabilities'] is List &&
                (m['capabilities'] as List).contains('text.chat'),
          )
          .toList();
      await _loadModelSelection();
      if (!_current) return;
      configuration = ClientConfiguration.fromJson(
        await repository.client.request(
          'GET',
          'v1/client-config',
          authenticated: false,
        ),
      );
      await _restorePending();
      if (conversation != null) await load();
    } catch (e) {
      if (_current) error = e.toString();
    } finally {
      if (_current) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> _restorePending() async {
    final raw = await repository.client.credentials.read(_draftKey);
    if (raw == null || !_current) return;
    final draft = jsonDecode(raw) as Json;
    _creationId = draft['creationId'] as String;
    _pendingImage = draft['image'] as Json?;
    if (_pendingImage != null) {
      notice =
          'An interrupted image request is saved securely. Retry to check its result.';
    }
    final input = draft['input'] as Json?;
    if (input != null) {
      _pendingEditing = draft['editing'] == true;
      _pending = SendInput(
        clientMessageId: input['clientMessageId'] as String,
        parentId: input['parentId'] as String?,
        parts: (input['parts'] as List).cast<Json>(),
        model: input['model'] as String,
        mode: input['mode'] as String,
      );
      notice =
          'An interrupted message is saved securely. Retry to check its result.';
    }
  }

  Future<void> load() async {
    if (conversation == null || !_current) return;
    loading = true;
    error = null;
    _notify();
    try {
      final detail = await repository.detail(conversation!.id);
      if (!_current) return;
      conversation = detail.conversation;
      messages = detail.messages;
      final last = visibleMessages
          .where((m) => m.role == 'assistant')
          .lastOrNull;
      if (last?.runId != null) {
        final response = await repository.run(last!.runId!);
        if (!_current) return;
        final run = response['run'] as Json;
        if (!{
          'succeeded',
          'failed',
          'cancelled',
          'blocked_on_usage',
        }.contains(run['status'])) {
          // The server snapshot already contains partial text. Rebuild that reply from seq 0.
          last.parts.clear();
          reducer = RunReducer(runId: run['id'] as String, messages: messages);
          _startStream();
        } else {
          reducer = RunReducer(
            runId: run['id'] as String,
            messages: messages,
            lastSeq: run['lastSeq'] as int? ?? 0,
          )..status = run['status'] as String;
          if (run['status'] == 'blocked_on_usage' &&
              (run['error'] as Json?)?['code'] == 'usage_window_exhausted') {
            _usageBlocked();
          } else if (run['error'] != null) {
            error = (run['error'] as Json)['message'] as String?;
          }
        }
      }
    } catch (e) {
      if (_current) error = e.toString();
    } finally {
      if (_current) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> attach(String name, String mime, Uint8List bytes) async {
    if (redeemingUsage || uploading || sending || !_current) return;
    if (mime.startsWith('image/') && !acceptsImages) {
      error =
          'Choose a model that can view images before sending this attachment.';
      _notify();
      return;
    }
    uploading = true;
    error = null;
    _notify();
    try {
      final part = await repository.upload(name, mime, bytes);
      if (_current) attachments.add({...part, '_displayName': name});
    } catch (e) {
      if (_current) error = e.toString();
    } finally {
      if (_current) {
        uploading = false;
        _notify();
      }
    }
  }

  void removeAttachment(Json part) {
    attachments.remove(part);
    _notify();
  }

  Future<bool> send(String text) async {
    if (redeemingUsage ||
        sending ||
        streaming ||
        uploading ||
        model == null ||
        !_current) {
      return false;
    }
    if (text.trim().isEmpty && attachments.isEmpty) return false;
    if (attachments.any((part) => part['type'] == 'image_ref') &&
        !acceptsImages) {
      error =
          'Choose a model that can view images before sending this attachment.';
      _notify();
      return false;
    }
    _pendingImage = null;
    _pendingEditing = false;
    _pending = SendInput(
      clientMessageId: const Uuid().v4(),
      parentId: visibleMessages.lastOrNull?.id,
      parts: [
        if (text.trim().isNotEmpty) {'type': 'text', 'text': text.trim()},
        ...attachments.map(
          (p) => Map<String, dynamic>.from(p)..remove('_displayName'),
        ),
      ],
      model: model!,
      mode: mode,
    );
    return _postPending();
  }

  Future<bool> edit(ChatMessage original, String text) async {
    if (redeemingUsage ||
        !_current ||
        sending ||
        streaming ||
        uploading ||
        model == null ||
        text.trim().isEmpty ||
        original.role != 'user' ||
        !messages.any((message) => message.id == original.id)) {
      return false;
    }
    final kept = original.parts.where((part) => part['type'] != 'text');
    if (kept.any((part) => part['type'] == 'image_ref') && !acceptsImages) {
      error =
          'Choose a model that can view images before sending this attachment.';
      _notify();
      return false;
    }
    _pendingImage = null;
    _pendingEditing = true;
    _pending = SendInput(
      clientMessageId: const Uuid().v4(),
      parentId: original.parentId,
      parts: [
        {'type': 'text', 'text': text.trim()},
        ...kept.map((part) => Map<String, dynamic>.from(part)),
      ],
      model: model!,
      mode: mode,
    );
    return _postPending();
  }

  Future<bool> retry() => _pendingImage != null ? _postImage() : _postPending();

  void useImage(Json part) {
    if (part['type'] != 'image_ref' || sending || streaming) return;
    attachments.add({...part, '_displayName': 'Image to edit'});
    _notify();
  }

  Future<bool> generateImage(String prompt, String aspectRatio) async {
    final text = prompt.trim();
    if (redeemingUsage ||
        !_current ||
        sending ||
        streaming ||
        uploading ||
        text.isEmpty ||
        !{'1:1', '4:3', '3:4'}.contains(aspectRatio)) {
      return false;
    }
    if (!configuration.imageGeneration) {
      error = 'Image generation is not configured for this service.';
      _notify();
      return false;
    }
    if (_pendingImage?['prompt'] != text ||
        _pendingImage?['aspectRatio'] != aspectRatio) {
      _pendingImage = {
        'clientMessageId': const Uuid().v4(),
        'prompt': text,
        'aspectRatio': aspectRatio,
      };
    }
    _pending = null;
    return _postImage();
  }

  Future<bool> _postImage() async {
    final input = _pendingImage;
    if (input == null || sending || !_current) return false;
    sending = true;
    error = null;
    notice = null;
    _notify();
    final originalKey = _draftKey;
    try {
      final saved = jsonEncode({'creationId': _creationId, 'image': input});
      await repository.client.credentials.write(originalKey, saved);
      if (!_current) return false;
      if (conversation == null) {
        final created = await repository.create(_creationId);
        if (!_current) return false;
        conversation = created;
        await _bindComposerConversation();
        if (!_current) return false;
        await repository.client.credentials.write(_draftKey, saved);
      }
      if (!_current) return false;
      final response = await repository.image(conversation!.id, input);
      if (!_current) return false;
      await repository.client.credentials.write(originalKey, null);
      await repository.client.credentials.write(_draftKey, null);
      _pendingImage = null;
      _accept(response);
      return true;
    } catch (e) {
      if (_current) _sendFailure(e);
      return false;
    } finally {
      if (_current) {
        sending = false;
        _notify();
      }
    }
  }

  Future<bool> _postPending() async {
    final input = _pending;
    final editing = _pendingEditing;
    if (input == null || sending || !_current) return false;
    sending = true;
    error = null;
    notice = null;
    _notify();
    final originalKey = _draftKey;
    try {
      await repository.client.credentials.write(
        originalKey,
        jsonEncode({
          'creationId': _creationId,
          'input': input.toJson(),
          if (editing) 'editing': true,
        }),
      );
      if (!_current) return false;
      if (conversation == null) {
        final created = await repository.create(_creationId);
        if (!_current) return false;
        conversation = created;
        await _bindComposerConversation();
        if (!_current) return false;
        await repository.client.credentials.write(
          _draftKey,
          jsonEncode({
            'creationId': _creationId,
            'input': input.toJson(),
            if (editing) 'editing': true,
          }),
        );
      }
      if (!_current) return false;
      final response = await repository.send(conversation!.id, input);
      if (!_current) return false;
      await repository.client.credentials.write(originalKey, null);
      await repository.client.credentials.write(_draftKey, null);
      _accept(response);
      _pending = null;
      _pendingEditing = false;
      if (!editing) {
        attachments.removeWhere((attachment) {
          final part = Map<String, dynamic>.from(attachment)
            ..remove('_displayName');
          return input.parts.any((sent) => mapEquals(part, sent));
        });
      }
      return true;
    } catch (e) {
      if (_current) _sendFailure(e);
      return false;
    } finally {
      if (_current) {
        sending = false;
        _notify();
      }
    }
  }

  void _accept(Json response) {
    usageBlockedUntil = null;
    _usageRevision++;
    usageLoading = false;
    for (final key in ['message', 'reply']) {
      final message = ChatMessage.fromJson(response[key] as Json);
      final index = messages.indexWhere((m) => m.id == message.id);
      if (index < 0) {
        messages.add(message);
      } else {
        messages[index] = message;
      }
      branchSelections[message.parentId ?? 'root'] = message.id;
    }
    reducer = RunReducer(
      runId: (response['run'] as Json)['id'] as String,
      messages: messages,
    );
    _startStream();
  }

  void _startStream() {
    _watch?.cancel();
    unawaited(_subscription?.cancel());
    final run = reducer;
    if (run == null || run.terminal || _suspended || !_current) return;
    _watch = repository.watch(run.runId, after: run.lastSeq);
    _subscription = _watch!.stream.listen(
      (event) {
        if (!_current) return;
        try {
          if (run.apply(event)) {
            if (run.status == 'blocked_on_usage' &&
                run.error?['code'] == 'usage_window_exhausted') {
              _usageBlocked();
            } else {
              error = run.error?['message'] as String?;
            }
            _notify();
          }
        } catch (e) {
          error = e.toString();
          _watch?.cancel();
          _notify();
        }
      },
      onError: (Object e) {
        if (_current) {
          error = e.toString();
          _notify();
        }
      },
    );
  }

  void suspend() {
    _suspended = true;
    _watch?.cancel();
    unawaited(_subscription?.cancel());
  }

  void resume() {
    _suspended = false;
    if (_current && streaming) {
      error = null;
      _startStream();
      _notify();
    }
  }

  Future<void> stop() async {
    final run = reducer;
    if (run == null || !streaming) return;
    try {
      await repository.stop(run.runId);
      if (_current) {
        run.status = 'cancelled';
        _watch?.cancel();
        _notify();
      }
    } catch (e) {
      if (_current) {
        error = e.toString();
        _notify();
      }
    }
  }

  void selectBranch(ChatMessage message) {
    branchSelections[message.parentId ?? 'root'] = message.id;
    _notify();
  }

  Future<void> regenerate(ChatMessage message) async {
    if (redeemingUsage ||
        conversation == null ||
        model == null ||
        streaming ||
        sending) {
      return;
    }
    sending = true;
    error = null;
    _notify();
    try {
      final response = await repository.regenerate(
        conversation!.id,
        message.id,
        model!,
      );
      if (_current) _accept(response);
    } catch (e) {
      if (_current) _sendFailure(e);
    } finally {
      if (_current) {
        sending = false;
        _notify();
      }
    }
  }

  Future<String?> share() async {
    final last = visibleMessages.lastOrNull;
    if (!_current ||
        sharing ||
        streaming ||
        last == null ||
        conversation == null) {
      return null;
    }
    sharing = true;
    error = null;
    _notify();
    try {
      final response = await repository.share(conversation!.id, last.id);
      if (!_current) return null;
      return response['url'] as String?;
    } catch (e) {
      if (_current) {
        error = e.toString();
        _notify();
      }
      return null;
    } finally {
      if (_current) {
        sharing = false;
        _notify();
      }
    }
  }

  void setModel(String value) {
    if (!_current ||
        sending ||
        streaming ||
        !models.any((m) => m['id'] == value)) {
      return;
    }
    model = value;
    unawaited(_saveModelSelection());
    _notify();
  }

  void setMode(String value) {
    mode = value;
    _notify();
  }

  bool get canRetry => (_pending != null || _pendingImage != null) && !sending;
  @override
  void dispose() {
    _disposed = true;
    repository.modelSelection.removeListener(_syncModelSelection);
    _watch?.cancel();
    unawaited(_subscription?.cancel());
    super.dispose();
  }
}
