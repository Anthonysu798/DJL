import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import '../../integration_test/threads_test.dart' show projectDraftPicker;
import '../core/cloud_client_test.dart' show TestCredentials;
import '../features/desktop_new_chat_draft_test.dart'
    show
        DraftTransport,
        draftDesktop,
        finishDraft,
        projectPath,
        requests,
        acknowledgeOverviewSetup;

void main() {
  testWidgets(
    'native folder draft helper uses project compose and exactly two picker reads',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.threadList.data.upsert({
        'id': 'existing-project',
        'name': 'Existing project chat',
        'cwd': projectPath,
      });
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      acknowledgeOverviewSetup(remote);
      await projectDraftPicker(tester, projectPath);
      expect(find.byType(ProjectPickerPage), findsOneWidget);
      expect(find.byType(BottomSheet), findsOneWidget);
      final owner = desktop.newChatDraft!;
      expect(owner.source.name, 'folderChat');
      expect(owner.cwd, projectPath);
      expect(desktop.thread, isNull);
      expect(requests(remote, 'thread/start'), isEmpty);
      expect(remote.calls.map((c) => c['method']), [
        'project/quickLocations',
        'project/listDirectory',
      ]);
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, same(owner));
      expect(requests(remote, 'thread/start'), isEmpty);
      expect(requests(remote, 'turn/start'), isEmpty);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );
}
