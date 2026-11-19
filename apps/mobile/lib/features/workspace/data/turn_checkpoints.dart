import 'workspace_repository.dart';

/// Best-effort snapshots must settle before turn/start, without making chat depend on Git.
class TurnCheckpoints {
  TurnCheckpoints(this.repository, {this.messageId});
  final WorkspaceRepository repository;
  final String? messageId;
  Future<void>? _prepare;
  final _starts = <String, Future<void>>{}, _ends = <String, Future<void>>{};
  String? warning;
  Future<void> prepare() => _prepare ??= _captureMessage();
  Future<void> _captureMessage() async {
    if (messageId == null) {
      return;
    }
    try {
      await repository.capture(kind: 'messageStart', messageId: messageId);
    } catch (e) {
      warning = e.toString();
    }
  }

  Future<void> started(String turnId) => _starts.putIfAbsent(turnId, () async {
    await prepare();
    if (messageId == null) {
      return;
    }
    try {
      final result = await repository.copyStart(messageId!, turnId);
      if (result['copied'] == false) {
        await repository.capture(kind: 'turnStart', turnId: turnId);
      }
    } catch (e) {
      warning = e.toString();
    }
  });
  Future<void> completed(String turnId) => _ends.putIfAbsent(turnId, () async {
    await started(turnId);
    try {
      await repository.capture(kind: 'turnEnd', turnId: turnId);
    } catch (e) {
      warning = e.toString();
    }
  });
}
