part of 'desktop_controller.dart';

/// Model, effort, access and plan mode for the next message.
extension DesktopRuntimeSettings on DesktopController {
  RemoteJson? get selectedModel =>
      models.where((m) => m['id'] == model).firstOrNull;

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
        StateError(appStrings.desktopReconnectToRefreshModels),
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
        throw StateError(appStrings.desktopAccessModeNotApplied);
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
}
