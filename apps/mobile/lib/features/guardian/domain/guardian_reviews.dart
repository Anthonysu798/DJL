import 'dart:convert';
import '../../pairing/data/pairing_repository.dart';
import 'guardian_review.dart';

typedef GuardianKey = (String, String);

// Only this live-memory store holds grants. Rows and encrypted history contain display data.
class GuardianReviews {
  GuardianReviews({DateTime Function()? now}) : _now = now ?? DateTime.now;
  final DateTime Function() _now;
  final reviews = <GuardianKey, GuardianReview>{};
  final _tokens = <GuardianKey, ({DateTime expiry, RemoteJson event})>{};
  // Presentation correlation only; null is a consumed, mismatched-event tombstone.
  final _submittedEvents = <GuardianKey, String?>{};
  String? _device, _mac, _session;
  int epoch = 0;
  String? get deviceId => _device;
  void bind(String? mac, String? session) {
    if (_mac == mac && _session == session) return;
    epoch++;
    _tokens.clear();
    for (final review in reviews.values) {
      if (review.status == 'denied' &&
          !review.retryApproved &&
          review.retryUnavailableReason == null) {
        review.retryUnavailableReason = guardianLiveReason;
      }
      review.submitting = false;
    }
    if (mac != null && _device != null && mac != _device) {
      reviews.clear();
      _submittedEvents.clear();
    }
    if (mac != null) _device = mac;
    _mac = mac;
    _session = session;
  }

  GuardianReview? find(String thread, String id) => reviews[(thread, id)];
  Map<String, RemoteJson> rebindHistoryTurn(
    String thread,
    String oldTurn,
    String turn, {
    Set<String>? rowIds,
  }) {
    final rows = <String, RemoteJson>{};
    for (final entry
        in reviews.entries
            .where(
              (e) =>
                  e.key.$1 == thread &&
                  e.value.turnId == oldTurn &&
                  (rowIds == null ||
                      rowIds.contains(e.value.toRow(thread)['id'])),
            )
            .toList()) {
      final old = entry.value;
      // A display identity upgrade never rewrites the signed/live denied event.
      _drop(entry.key);
      final row = old.toRow(thread);
      row['turnId'] = turn;
      (row['guardianReview'] as Map)['turnId'] = turn;
      final rebound = GuardianReview.fromRow(row)!;
      reviews[entry.key] = rebound;
      rows[row['id'] as String] = rebound.toRow(thread);
    }
    return rows;
  }

  void _prune() {
    for (final key in _tokens.keys.toList()) {
      if (!_tokens[key]!.expiry.isAfter(_now())) _drop(key);
    }
  }

  void _drop(GuardianKey key) {
    _tokens.remove(key);
    final review = reviews[key];
    if (review != null &&
        review.status == 'denied' &&
        !review.retryApproved &&
        review.retryUnavailableReason == null) {
      review.retryUnavailableReason = guardianExpiredReason;
    }
  }

  void upsert(String thread, GuardianReview review, {required bool live}) {
    _prune();
    final key = (thread, review.reviewId),
        old = reviews[(thread, review.reviewId)];
    if (old?.isTerminal == true && !review.isTerminal) return;
    final token = _tokens[key];
    if (token != null &&
        review.coreDeniedEvent != null &&
        jsonEncode(token.event) != jsonEncode(review.coreDeniedEvent)) {
      _tokens.remove(key);
      review.retryUnavailableReason ??= guardianUnsafeReason;
    }
    final identity = review.coreDeniedEvent == null
        ? null
        : jsonEncode(review.coreDeniedEvent);
    var retainRetryPresentation = true;
    if (_submittedEvents.containsKey(key)) {
      final submitted = _submittedEvents[key];
      if (submitted == null ||
          identity != null && identity != submitted ||
          review.retryUnavailableReason == guardianUnsafeReason) {
        _submittedEvents[key] = null;
        retainRetryPresentation = false;
        review.retryUnavailableReason ??= guardianUnsafeReason;
      }
    } else if (old != null &&
        (old.retryApproved || old.submitting) &&
        identity != null) {
      // An acknowledged cached summary carries no proof for a newly received core event.
      retainRetryPresentation = false;
      review.retryUnavailableReason ??= guardianLiveReason;
    }
    if (old != null && retainRetryPresentation) {
      review.retryApproved = old.retryApproved;
      review.submitting = old.submitting;
      review.retryUnavailableReason ??= old.retryUnavailableReason;
    }
    // First terminal transition is the only opportunity to create authority.
    if (live &&
        _mac != null &&
        _session != null &&
        review.status == 'denied' &&
        old?.isTerminal != true &&
        review.retryUnavailableReason == null &&
        review.coreDeniedEvent != null) {
      _tokens[key] = (
        expiry: _now().add(const Duration(minutes: 15)),
        event: review.coreDeniedEvent!,
      );
    }
    if (review.status != 'denied' ||
        review.retryApproved ||
        review.retryUnavailableReason != null && live) {
      _tokens.remove(key);
    }
    if (review.status == 'denied' &&
        !review.retryApproved &&
        review.retryUnavailableReason == null &&
        !_tokens.containsKey(key)) {
      review.retryUnavailableReason = guardianLiveReason;
    }
    reviews[key] = review;
    while (_tokens.length > 10) {
      _drop(_tokens.keys.first);
    }
  }

  RemoteJson? consume(String thread, String id, String mac, String session) {
    _prune();
    final review = find(thread, id), key = (thread, id);
    if (_mac != mac ||
        _session != session ||
        review == null ||
        review.status != 'denied' ||
        review.retryApproved ||
        review.submitting ||
        review.retryUnavailableReason != null) {
      return null;
    }
    final token = _tokens.remove(key);
    if (token == null) return null;
    _submittedEvents[key] = jsonEncode(token.event);
    review.submitting = true;
    review.retryUnavailableReason = guardianSubmittedReason;
    return token.event;
  }

  bool finish(
    String thread,
    String id, {
    required RemoteJson event,
    required bool acknowledged,
  }) {
    final review = find(thread, id), identity = jsonEncode(event);
    if (review == null ||
        review.status != 'denied' ||
        _submittedEvents[(thread, id)] != identity ||
        review.coreDeniedEvent != null &&
            jsonEncode(review.coreDeniedEvent) != identity) {
      return false;
    }
    review.submitting = false;
    review.retryApproved = acknowledged;
    review.retryUnavailableReason = acknowledged
        ? null
        : guardianUncertainReason;
    return true;
  }
}
