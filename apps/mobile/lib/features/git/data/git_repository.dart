import '../../desktop/data/remote_transport.dart';
import '../../pairing/data/pairing_repository.dart';
import '../domain/git_models.dart';

class GitRepository {
  GitRepository(this.transport, {required this.cwd, bool Function()? isCurrent})
    : _isCurrent = isCurrent,
      _owner = (
        transport.macDeviceId,
        transport.sessionId,
        transport.connectionRevision,
      );
  final RemoteTransport transport;
  final String cwd;
  final (String?, String?, int) _owner;
  final bool Function()? _isCurrent;
  bool get isCurrent =>
      _isCurrent?.call() != false &&
      _owner ==
          (
            transport.macDeviceId,
            transport.sessionId,
            transport.connectionRevision,
          );
  void _checkCurrent() {
    if (!isCurrent) {
      throw StateError(
        'Connected desktop changed. Reopen Git from its workspace.',
      );
    }
    if (cwd.trim().isEmpty) {
      throw StateError('Choose a desktop workspace before using Git.');
    }
  }

  Future<RemoteJson> call(String method, [RemoteJson params = const {}]) async {
    _checkCurrent();
    final result = await transport.request(method, {
      ...params,
      'cwd': cwd,
    }, timeout: Duration(minutes: method == 'git/runStackedAction' ? 6 : 3));
    _checkCurrent();
    return result;
  }

  Future<GitStatus> status() async =>
      GitStatus.fromJson(await call('git/status'));
  Future<String> diff() async =>
      (await call('git/diff'))['patch'] as String? ?? '';
  Future<RemoteJson> branches() => call('git/branches');
  Future<RemoteJson> commit(String message) =>
      call('git/commit', {'message': message});
  Future<RemoteJson> generateCommitMessage(String? model) =>
      call('git/generateCommitMessage', {'model': ?model});
  Future<RemoteJson> push() => call('git/push');
  Future<RemoteJson> pull() => call('git/pull');
  Future<RemoteJson> initialize() => call('git/init');
  Future<RemoteJson> checkout(String branch) =>
      call('git/checkout', {'branch': branch});
  Future<RemoteJson> createBranch(String name) =>
      call('git/createBranch', {'name': name});
  Future<RemoteJson> createWorktree(
    String name,
    String base,
    String transfer,
  ) => call('git/createWorktree', {
    'name': name,
    'baseBranch': base,
    'changeTransfer': transfer,
  });
  Future<RemoteJson> createManagedWorktree(String base, String transfer) =>
      call('git/createManagedWorktree', {
        'baseBranch': base,
        'changeTransfer': transfer,
      });
  Future<RemoteJson> transfer(String path) =>
      call('git/transferManagedHandoff', {'targetPath': path});
  Future<RemoteJson> removeWorktree(String? branch) =>
      call('git/removeWorktree', {'branch': ?branch});
  Future<RemoteJson> resetToRemote() =>
      call('git/resetToRemote', {'confirm': 'discard_runtime_changes'});
  Future<RemoteJson> prDraft({String? model, String? base}) => call(
    'git/generatePullRequestDraft',
    {'model': ?model, 'baseBranch': ?base},
  );
  Future<RemoteJson> stackedAction(
    String action, {
    String? message,
    String? model,
    String? base,
    bool featureBranch = false,
    String? progressId,
  }) => call('git/runStackedAction', {
    'action': action,
    'commitMessage': ?message,
    'model': ?model,
    'baseBranch': ?base,
    if (featureBranch) 'featureBranch': true,
    'progressId': ?progressId,
  });
  Future<RemoteJson> remoteUrl() => call('git/remoteUrl');
}
