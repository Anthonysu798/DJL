import '../../desktop/data/remote_transport.dart';
import '../../pairing/data/pairing_repository.dart';
import '../domain/thread_goal.dart';

Object goalError(Object error) {
  if (error is! RemoteRpcException) {
    return error;
  }
  final message = error.message.toLowerCase();
  if (message.contains('ephemeral thread does not support goals') ||
      message.contains('thread goals require a persisted thread')) {
    return const EphemeralGoal();
  }
  if (error.code == -32601 || message.contains('goals feature is disabled')) {
    return const GoalsUnsupported();
  }
  return error;
}

class GoalRepository {
  GoalRepository(this.transport, {required this.threadId, String? macDeviceId})
    : macDeviceId = macDeviceId ?? transport.macDeviceId;
  final RemoteTransport transport;
  final String threadId;
  final String? macDeviceId;
  Future<RemoteJson> _call(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (transport.macDeviceId != macDeviceId) {
      throw StateError('Connected desktop changed. Reopen this goal.');
    }
    try {
      final result = await transport.request(method, {
        'threadId': threadId,
        ...params,
      }, timeout: timeout);
      if (transport.macDeviceId != macDeviceId) {
        throw StateError('Connected desktop changed. Reopen this goal.');
      }
      return result;
    } catch (error) {
      throw goalError(error);
    }
  }

  Future<ThreadGoal?> get({
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final value = (await _call(
      'thread/goal/get',
      {},
      timeout: timeout,
    ))['goal'];
    if (value is! Map) {
      return null;
    }
    final goal = ThreadGoal.fromJson(Map<String, dynamic>.from(value));
    if (goal.threadId != threadId) {
      throw StateError('The runtime returned another chat’s goal.');
    }
    return goal;
  }

  Future<ThreadGoal> set({
    String? objective,
    GoalStatus? status,
    GoalBudgetUpdate budget = const GoalBudgetUpdate.keep(),
  }) async {
    if (budget.tokens != null && budget.tokens! <= 0) {
      throw const FormatException(
        'Token budget must be a positive whole number.',
      );
    }
    final value = (await _call('thread/goal/set', {
      'objective': ?objective,
      'status': ?status?.name,
      if (budget.changed) 'tokenBudget': budget.tokens,
    }))['goal'];
    if (value is! Map) {
      throw StateError('The runtime returned an unexpected goal response.');
    }
    final goal = ThreadGoal.fromJson(Map<String, dynamic>.from(value));
    if (goal.threadId != threadId) {
      throw StateError('The runtime returned another chat’s goal.');
    }
    return goal;
  }

  Future<bool> clear() async =>
      (await _call('thread/goal/clear', {}))['cleared'] == true;
}
