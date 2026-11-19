// The complete passive window must contain a history read for this child and
// only known read operations for it. Other threads cannot satisfy discovery.
bool passiveChildReadOnly(
  Map snapshot, {
  required String childId,
  required int afterSequence,
}) {
  final requests = snapshot['requests'];
  final sequence = snapshot['requestSequence'];
  if (requests is! List || sequence is! int) return false;
  final recent = requests
      .cast<Map>()
      .where((request) => (request['sequence'] as int) > afterSequence)
      .toList();
  if (recent.length != sequence - afterSequence) return false;
  for (var index = 0; index < recent.length; index++) {
    if (recent[index]['sequence'] != afterSequence + index + 1) return false;
  }
  final child = recent
      .where((request) => request['threadId'] == childId)
      .toList();
  return child.any(
        (request) =>
            request['method'] == 'thread/read' &&
            request['includeTurns'] == true,
      ) &&
      child.every(
        (request) =>
            {'thread/read', 'thread/goal/get'}.contains(request['method']),
      );
}
