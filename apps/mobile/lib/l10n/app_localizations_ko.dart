// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Korean (`ko`).
class AppLocalizationsKo extends AppLocalizations {
  AppLocalizationsKo([String locale = 'ko']) : super(locale);

  @override
  String get appName => 'DJL';

  @override
  String get commonCancel => '취소';

  @override
  String get commonTryAgain => '다시 시도';

  @override
  String get chatUiAccessAskTitle => '승인 요청';

  @override
  String get chatUiAccessAskDetail => '외부 파일 편집과 인터넷 사용 전에 항상 물어봐요';

  @override
  String get chatUiAccessAutoTitle => '자동 승인';

  @override
  String get chatUiAccessAutoDetail => '안전하지 않을 수 있는 작업만 물어봐요';

  @override
  String get chatUiAccessFullTitle => '전체 액세스';

  @override
  String get chatUiAccessFullDetail => '컴퓨터 전체 접근 (위험도 높음)';

  @override
  String get chatUiAccessHint => 'Codex가 권한을 요청하는 방식을 바꿔요';

  @override
  String get chatUiAccessFullConfirmTitle => '데스크톱 전체 액세스를 허용할까요?';

  @override
  String get chatUiAccessFullConfirmBody =>
      '에이전트가 승인 없이 작업 공간 밖의 파일을 바꾸고 명령을 실행할 수 있어요.';

  @override
  String get chatUiAccessFullConfirm => '전체 액세스 허용';

  @override
  String get chatUiAttentionNoMatches => '일치하는 항목이 없어요';

  @override
  String get chatUiAttentionAllCaughtUp => '모두 확인했어요';

  @override
  String get chatUiAttentionNoMatchesHint => '다른 프로젝트, 채팅 또는 상태로 찾아보세요.';

  @override
  String get chatUiAttentionEmptyHint =>
      '승인 요청, 에이전트 질문, 실패한 실행, 완료된 작업이 여기에 표시돼요.';

  @override
  String get chatUiAttentionNeedsYou => '확인 필요';

  @override
  String get chatUiAttentionReadyToReview => '검토 대기';

  @override
  String get chatUiAgoNow => '방금';

  @override
  String chatUiAgoMinutes(int minutes) {
    return '$minutes분 전';
  }

  @override
  String chatUiAgoHours(int hours) {
    return '$hours시간 전';
  }

  @override
  String chatUiAgoDays(int days) {
    return '$days일 전';
  }

  @override
  String get chatUiAttentionTitle => '확인할 일';

  @override
  String get chatUiAttentionConnectionChanged =>
      '연결이 바뀌었어요. 뒤로 가서 확인할 일을 다시 여세요.';

  @override
  String get chatUiAttentionSearch => '확인할 일 검색';

  @override
  String get appSavedConnectionsUnreadable =>
      '저장된 데스크톱 연결 정보를 읽을 수 없어요. 저장된 연결은 그대로 유지돼요.';

  @override
  String get appRestoreMacsFailed =>
      '저장된 Mac을 복원하지 못했어요. 기기 잠금을 해제하고 다시 시도하세요.';

  @override
  String get appLinkedConversationFailed =>
      '연결된 대화를 열지 못했어요. 연결 상태를 확인하고 다시 시도하세요.';

  @override
  String get appLinkedAccountUnavailable =>
      '아직 계정 정보를 불러올 수 없어요. 정보가 로드되면 연결된 대화를 다시 열어 보세요.';

  @override
  String get appAccountStillLoading => '계정 정보를 아직 불러오는 중이에요. 다시 시도해 주세요.';

  @override
  String get appRenameChat => '채팅 이름 변경';

  @override
  String get appRenameChatPlaceholder => '제목';

  @override
  String get appSave => '저장';

  @override
  String get appOpenNavigation => '탐색 메뉴 열기';

  @override
  String get appAccountUnavailable => '계정 정보를 사용할 수 없어요.';

  @override
  String get appRetryAccount => '계정 다시 불러오기';

  @override
  String get appImages => '이미지';

  @override
  String get appNotifications => '알림';

  @override
  String get appRetryLinkedConversation => '연결된 대화 다시 열기';

  @override
  String get coreBack => '뒤로';

  @override
  String get coreMenu => '메뉴';

  @override
  String get coreChatActions => '채팅 작업';

  @override
  String get coreSessionEnded => '세션이 종료됐어요. 다시 로그인해 주세요.';

  @override
  String coreCloudRequestFailed(int status) {
    return 'DJL Cloud 요청에 실패했어요 ($status).';
  }

  @override
  String get coreAccountChanged => '계정이 바뀌었어요.';

  @override
  String get corePleaseSignIn => '로그인해 주세요.';

  @override
  String get coreNoAccessToken => 'DJL Cloud에서 액세스 토큰을 받지 못했어요.';

  @override
  String get coreCloudTimeout => 'DJL Cloud 응답이 너무 오래 걸려요.';

  @override
  String get coreCloudUnreachable => 'DJL Cloud에 연결할 수 없어요. 연결 상태를 확인하세요.';

  @override
  String get corePleaseSignInAgain => '다시 로그인해 주세요.';

  @override
  String get coreInvalidPushRegistration => '알림 등록 정보가 올바르지 않아요.';

  @override
  String get corePushNotAcknowledged => '등록이 확인되지 않았어요.';

  @override
  String get coreCloudResponseUnreadable => '이 버전에서는 DJL Cloud 응답을 읽을 수 없어요.';

  @override
  String get coreInvalidDesktopEnvelope => '데스크톱 메시지가 올바르지 않거나 재전송된 메시지예요.';

  @override
  String get coreDesktopMessageUnauthenticated => '데스크톱 메시지를 인증할 수 없어요.';

  @override
  String get gitThreadChangedReopenAction =>
      '스레드 활동이 바뀌었어요. 이 브랜치 또는 작업 트리 작업을 다시 여세요.';

  @override
  String get gitWaitForThread => '브랜치나 작업 트리를 바꾸기 전에 이 스레드가 끝날 때까지 기다려 주세요.';

  @override
  String get gitWaitForOperation =>
      '브랜치나 작업 트리를 바꾸기 전에 현재 Git 작업이 끝날 때까지 기다려 주세요.';

  @override
  String get gitNotRepositorySentence => '이 폴더는 Git 저장소가 아니에요.';

  @override
  String get gitNotRepository => 'Git 저장소가 아닌 폴더예요';

  @override
  String get gitNoLongerRepository =>
      '이 폴더는 더 이상 Git 저장소가 아니에요. 브랜치나 작업 트리를 만들기 전에 새로고침하세요.';

  @override
  String get gitContinue => '계속';

  @override
  String get gitOk => '확인';

  @override
  String get gitCreate => '만들기';

  @override
  String get gitClose => '닫기';

  @override
  String get gitDone => '완료';

  @override
  String get gitGenerating => '생성 중…';

  @override
  String get gitGenerateMessage => '메시지 생성';

  @override
  String get gitCommitAllTitle => '현재 변경 사항 모두 커밋';

  @override
  String get gitCommitPublishTitle => '변경 사항 커밋 및 게시';

  @override
  String get gitCommitMessageLabel => '커밋 메시지';

  @override
  String get gitPublishBranchTitle => '이 브랜치를 게시할까요?';

  @override
  String get gitPublishCommitPushBody =>
      '현재 변경 사항을 모두 커밋하고 이 브랜치를 원격 저장소에 푸시해요.';

  @override
  String get gitPublishFeatureBranchPrBody =>
      '기능 브랜치를 준비하고, 모든 변경 사항을 커밋한 뒤 브랜치를 푸시하고 GitHub에 풀 리퀘스트를 만들어요.';

  @override
  String get gitPublishCommitPrBody =>
      '모든 변경 사항을 커밋하고 브랜치를 푸시한 뒤 GitHub에 풀 리퀘스트를 만들어요.';

  @override
  String get gitCommitCreateSwitch => '커밋 후 만들고 전환';

  @override
  String get gitCreateManagedWorktree => '관리형 작업 트리 만들기';

  @override
  String get gitCreateWorktree => '작업 트리 만들기';

  @override
  String get gitBranchName => '브랜치 이름';

  @override
  String get gitBaseBranch => '기준 브랜치';

  @override
  String get gitMoveCurrentChanges => '현재 변경 사항 이동';

  @override
  String get gitCopyCurrentChanges => '현재 변경 사항 복사';

  @override
  String get gitLeaveChangesHere => '변경 사항 여기에 두기';

  @override
  String get gitInitializeTitle => 'Git을 초기화할까요?';

  @override
  String get gitInitializeBody => '이 작업 공간에 Git 저장소를 만들어요.';

  @override
  String get gitPushTitle => '브랜치를 푸시할까요?';

  @override
  String get gitPushBody => '커밋된 변경 사항을 설정된 원격 저장소에 푸시해요.';

  @override
  String get gitLocalChangesNeedAttention => '로컬 변경 사항을 확인해야 해요';

  @override
  String get gitUpdateRepositoryTitle => '저장소를 업데이트할까요?';

  @override
  String get gitDirtyAndBehindBody =>
      '로컬 변경 사항이 있고 원격 브랜치가 앞서 있어요. 변경 사항을 정리할 준비가 됐을 때만 리베이스로 풀하세요.';

  @override
  String get gitPullBody => '원격 커밋을 이 브랜치로 가져와요.';

  @override
  String get gitPullAndRebase => '풀 및 리베이스';

  @override
  String get gitUpdate => '업데이트';

  @override
  String get gitTransferChangesTitle => '변경 사항 옮기기';

  @override
  String get gitTargetWorkspacePath => '대상 작업 공간 경로';

  @override
  String get gitRemoveWorktreeTitle => '이 작업 트리를 제거할까요?';

  @override
  String get gitRemoveWorktreeBody =>
      '이 브랜치의 관리형 작업 트리를 제거해요. 기본 체크아웃은 데스크톱에서 제거하지 않아요.';

  @override
  String get gitDiscardTitle => '로컬 변경 사항을 버릴까요?';

  @override
  String get gitDiscardBody => '로컬 파일 변경 사항을 버리고 이 브랜치를 원격 상태로 되돌려요.';

  @override
  String get gitPrDraftTitle => '풀 리퀘스트 초안';

  @override
  String get gitCopyDraft => '초안 복사';

  @override
  String get gitCreatePrTitle => '풀 리퀘스트를 만들까요?';

  @override
  String get gitCreatePrBody =>
      '필요하면 데스크톱이 이 브랜치를 푸시하고, 커밋된 변경 사항으로 제목과 설명을 만든 뒤 GitHub에 풀 리퀘스트를 만들어요.';

  @override
  String get gitNoChangesToShow => '표시할 저장소 변경 사항이 없어요.';

  @override
  String get gitBranchSwitchFailed => '브랜치 전환 실패';

  @override
  String get gitBranchOpenElsewhere =>
      '브랜치를 전환할 수 없어요. 이 브랜치는 이미 다른 작업 트리에서 열려 있어요.';

  @override
  String get gitErrorTitle => 'Git 오류';

  @override
  String get gitOpenPr => 'PR 열기';

  @override
  String get gitLoadingChanges => '변경 사항 불러오는 중';

  @override
  String get gitLoadingChangesEllipsis => '변경 사항 불러오는 중…';

  @override
  String get gitChangesUnavailable => '변경 사항을 볼 수 없음';

  @override
  String get gitNoChanges => '변경 사항 없음';

  @override
  String get gitDesktopChanged => '연결된 데스크톱이 바뀌었어요. 작업 공간에서 Git을 다시 여세요.';

  @override
  String get gitChooseWorkspace => 'Git을 사용하기 전에 데스크톱 작업 공간을 선택하세요.';

  @override
  String get gitWorking => '작업 중…';

  @override
  String get gitRetryStatus => 'Git 상태 다시 확인';

  @override
  String get gitWorktreeUnavailable => '작업 트리를 사용할 수 없음';

  @override
  String get gitActionsLabel => 'Git 작업';

  @override
  String get gitRefreshStatus => 'Git 상태 새로고침';

  @override
  String get gitShowMenu => '메뉴 보기';

  @override
  String get gitInitializeRepository => '저장소 초기화';

  @override
  String get gitCreateBranch => '브랜치 만들기';

  @override
  String get gitTransferToWorkspace => '변경 사항을 작업 공간으로 옮기기';

  @override
  String get gitRemoveManagedWorktree => '관리형 작업 트리 제거';

  @override
  String get gitGeneratePrDraft => 'PR 초안 생성';

  @override
  String get gitCreatePullRequest => '풀 리퀘스트 만들기';

  @override
  String get gitCommitAndPushMenu => '커밋 및 푸시';

  @override
  String get gitCommitPushCreatePrMenu => '커밋, 푸시 후 PR 만들기';

  @override
  String get gitDiscardAndReset => '버리고 원격 상태로 되돌리기';

  @override
  String get gitWorktreeReady => '작업 트리 준비 완료';

  @override
  String get gitOpenChat => '채팅 열기';

  @override
  String get gitOpenPullRequest => '풀 리퀘스트 열기';

  @override
  String get gitDetachedHead => '분리된 HEAD';

  @override
  String get gitNoUpstream => '업스트림 브랜치 없음';

  @override
  String gitAheadBehind(int ahead, int behind) {
    return '$ahead개 앞섬 · $behind개 뒤처짐';
  }

  @override
  String get gitCommitChanges => '변경 사항 커밋';

  @override
  String get gitPush => '푸시';

  @override
  String get gitPullTitle => '변경 사항을 풀할까요?';

  @override
  String get gitPull => '풀';

  @override
  String get gitViewDiff => '변경 내용 보기';

  @override
  String get gitCurrentBranch => '현재 브랜치';

  @override
  String get gitBranchFallback => '브랜치';

  @override
  String get gitWriterModel => 'Git 작성 모델';

  @override
  String get gitConnectCodexModel =>
      '커밋 메시지와 PR 초안을 생성하려면 Mac에서 Codex 모델을 연결하세요.';

  @override
  String gitChangedFilesCount(int count) {
    return '변경된 파일 $count개';
  }

  @override
  String get gitActionInitialize => 'Git 초기화';

  @override
  String get gitActionChanges => '변경 사항';

  @override
  String get gitActionCommit => '커밋';

  @override
  String get gitActionCommitAndPush => '커밋 및 푸시';

  @override
  String get gitActionCommitPushPr => '커밋, 푸시 및 PR';

  @override
  String get gitActionCreatePr => 'PR 만들기';

  @override
  String get gitSectionSetup => '설정';

  @override
  String get gitSectionWrite => '작성';

  @override
  String get gitStatusNotInitialized => 'Git이 초기화되지 않았어요';

  @override
  String get gitStatusUpToDate => '저장소가 최신 상태예요';

  @override
  String get gitStatusAheadOnly => '로컬 브랜치가 원격보다 앞서 있어요';

  @override
  String get gitStatusBehindOnly => '원격 브랜치가 로컬 브랜치보다 앞서 있어요';

  @override
  String get gitStatusDiverged => '로컬 브랜치와 원격 브랜치가 갈라졌어요';

  @override
  String get gitStatusDirty => '커밋하지 않은 로컬 변경 사항이 있어요';

  @override
  String get gitStatusDirtyAndBehind => '로컬 변경 사항이 있고 원격 브랜치가 앞서 있어요';

  @override
  String get gitStatusNoUpstream => '아직 게시하지 않은 브랜치예요';

  @override
  String get gitStatusDetachedHead => '현재 브랜치를 알 수 없어요';

  @override
  String get gitStatusUnavailable => '저장소 상태를 확인할 수 없어요';

  @override
  String gitReviewLocalCommits(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '로컬 커밋 $count개',
    );
    return '$_temp0';
  }

  @override
  String get gitReviewTheCurrentBranch => '현재 브랜치';

  @override
  String gitReviewCreatingFrom(String name, String source) {
    return '$source에서 ‘$name’ 브랜치를 만들고 있어요. 로컬 변경 사항을 새 브랜치로 가져가거나, 먼저 커밋한 뒤 만들고 전환하세요.';
  }

  @override
  String gitReviewCommitsStayPrefix(
    String base,
    String commits,
    String message,
  ) {
    return '$base에는 원격에 없는 $commits가 이미 있어요. 이 커밋은 $base의 기록에 그대로 남아요. $message';
  }

  @override
  String get gitReviewFilesWithChanges => '로컬 변경 사항이 있는 파일:';

  @override
  String gitReviewMoreFiles(int count) {
    return '외 파일 $count개';
  }

  @override
  String gitReviewBringChangesTitle(String name) {
    return '로컬 변경 사항을 ‘$name’(으)로 가져갈까요?';
  }

  @override
  String get gitReviewCarryToNewBranch => '새 브랜치로 가져가기';

  @override
  String gitReviewCommitsStayTitle(String base) {
    return '로컬 커밋은 $base에 남아요';
  }

  @override
  String gitReviewBranchCommitsStay(String base, String commits, String name) {
    return '$base에는 원격에 없는 $commits가 이미 있어요. 지금 ‘$name’ 브랜치를 만들면 현재 HEAD에서 시작하지만, 이 커밋은 $base의 기록에 그대로 남아요.';
  }

  @override
  String get gitReviewCreateAnyway => '그래도 만들기';

  @override
  String get gitReviewManagedWorktreeNoun => '관리형 작업 트리';

  @override
  String gitReviewQuotedName(String name) {
    return '‘$name’';
  }

  @override
  String get gitReviewCopyTitle => '현재 브랜치의 로컬 변경 사항 복사';

  @override
  String get gitReviewMoveTitle => '현재 브랜치의 로컬 변경 사항 이동';

  @override
  String get gitReviewVerbCopy => '복사';

  @override
  String get gitReviewVerbMove => '이동';

  @override
  String gitReviewOnlyCurrentBranch(
    String target,
    String verb,
    String current,
  ) {
    return '$target을(를) 만들 때는 현재 브랜치의 로컬 변경 사항만 $verb할 수 있어요. 작업 트리를 만들기 전에 기준 브랜치를 ‘$current’(으)로 바꾸거나 로컬 변경 사항을 정리하세요.';
  }

  @override
  String gitReviewCopiedInto(String worktree) {
    return ' 로컬 변경 사항도 $worktree에 복사돼요. 무시된 파일은 여기에 남아요.';
  }

  @override
  String gitReviewMovedInto(String worktree) {
    return ' 로컬 변경 사항은 $worktree에 옮겨져요. 무시된 파일은 여기에 남아요.';
  }

  @override
  String get gitReviewTheManagedWorktree => '관리형 작업 트리';

  @override
  String get gitReviewTheNewWorktree => '새 작업 트리';

  @override
  String gitReviewWorktreeCommitsStay(
    String base,
    String commits,
    String target,
    String from,
    String suffix,
  ) {
    return '$base에는 원격에 없는 $commits가 이미 있어요. $from에서 $target을(를) 만들면 현재 HEAD에서 시작하지만, 이 커밋은 $base의 기록에도 남아요.$suffix';
  }

  @override
  String get gitBadgeOpenWorktree => '작업 트리 열림';

  @override
  String get gitBadgeOpenElsewhere => '다른 곳에서 열림';

  @override
  String get gitActionCompleted => 'Git 작업을 완료했어요.';

  @override
  String gitActionFailed(String error) {
    return '$error 결과를 알 수 없는 작업은 다시 시도하기 전에 새로고침하세요.';
  }

  @override
  String get gitDismissMenu => '메뉴 닫기';

  @override
  String get gitDiffPatch => '패치';

  @override
  String gitDiffLine(int line) {
    return '$line번째 줄';
  }

  @override
  String gitDiffLines(int first, int last) {
    return '$first-$last번째 줄';
  }

  @override
  String get gitDismissBranchPicker => '브랜치 선택 닫기';

  @override
  String get gitBadgeCurrent => '현재';

  @override
  String get gitBadgeDefault => '기본';

  @override
  String get gitCloseBranchPicker => '브랜치 선택 닫기';

  @override
  String get gitBranchPickerStale => '스레드나 데스크톱이 바뀌었어요. 브랜치 선택을 닫았다가 다시 여세요.';

  @override
  String get gitSearchBranches => '브랜치 검색';

  @override
  String get gitClearBranchSearch => '브랜치 검색 지우기';

  @override
  String get gitBranches => '브랜치';

  @override
  String get gitNoBranchesFound => '브랜치를 찾을 수 없어요';

  @override
  String get gitNoBranchesHint => '다른 검색어를 입력하거나 브랜치 목록을 새로고침하세요.';

  @override
  String gitCreateAndCheckout(String name) {
    return '‘$name’ 만들고 체크아웃';
  }

  @override
  String get gitNewBranchEllipsis => '새 브랜치...';

  @override
  String get gitSwitching => '전환 중...';

  @override
  String get gitRefreshing => '새로고침 중...';

  @override
  String get gitReloadBranchList => '브랜치 목록 새로고침';

  @override
  String get gitCloseWorktreeReview => '작업 트리 검토 닫기';

  @override
  String get gitHandoffTitle => '스레드를 작업 트리로 넘기기';

  @override
  String get gitForkTitle => '스레드를 새 작업 트리로 포크';

  @override
  String get gitHandoff => '넘기기';

  @override
  String get gitFork => '포크';

  @override
  String get gitHandoffMessage =>
      '새 작업 트리에 브랜치를 만들고 체크아웃해서 병렬로 이어서 작업해요. 브랜치 이름에는 djl/ 접두사가 붙어요.';

  @override
  String get gitForkMessage =>
      '새 작업 트리에 브랜치를 만들고 체크아웃한 뒤, 이 대화를 그 체크아웃에서 새 채팅으로 포크해요.';

  @override
  String get gitStartsFromBase => '이 기준 브랜치에서 시작해요.';

  @override
  String get gitLoadingWorktreeBranches => '작업 트리 브랜치 불러오는 중';

  @override
  String get gitPreparingWorktree => '작업 트리 준비 중';

  @override
  String get gitNewBranch => '새 브랜치';

  @override
  String get gitNewBranchBody =>
      '브랜치를 로컬에 만들고 체크아웃해요. 커밋하지 않은 변경 사항은 이 작업 사본에 남아요.';

  @override
  String get gitThreadChangedReopenGit =>
      '스레드 활동이 바뀌었어요. 이 Git 작업을 닫았다가 다시 여세요.';

  @override
  String get gitRepositoryChanges => '저장소 변경 사항';

  @override
  String gitFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '파일 $count개 변경됨',
    );
    return '$_temp0';
  }

  @override
  String get gitExpandAll => '모두 펼치기';

  @override
  String get gitCollapseAll => '모두 접기';

  @override
  String gitPatchIndex(int index, int total) {
    return '패치 $index/$total';
  }

  @override
  String get chatUiComposerOptions => '입력창 옵션';

  @override
  String get chatUiStopDictation => '받아쓰기 중지';

  @override
  String get chatUiStartDictation => '받아쓰기 시작';

  @override
  String get chatUiResumeQueued => '대기 중인 메시지 재개';

  @override
  String get chatUiStopTurn => '응답 중지';

  @override
  String get chatUiSendToDesktop => '데스크톱으로 보내기';

  @override
  String get chatUiStartingRun => '실행 시작 중';

  @override
  String get chatUiRemoveImage => '이미지 제거';

  @override
  String get chatUiAttachedImage => '첨부된 이미지';

  @override
  String chatUiDesktopImage(String source) {
    return '데스크톱 이미지: $source';
  }

  @override
  String get chatUiImagePreviewUnavailable => '이미지 미리보기를 사용할 수 없어요';

  @override
  String get chatUiContextSkills => '스킬';

  @override
  String get chatUiContextPlugins => '플러그인';

  @override
  String get chatUiContextFiles => '파일';

  @override
  String chatUiContextUnsupported(String kind) {
    return '이 데스크톱 런타임은 $kind을(를) 지원하지 않아요.';
  }

  @override
  String get chatUiContextStale => '대화가 바뀌었어요. 컨텍스트 선택을 다시 여세요.';

  @override
  String get chatUiContextRetry => '다시 찾기';

  @override
  String chatUiContextSearchFilesIn(String path) {
    return '$path에서 파일 검색';
  }

  @override
  String get chatUiContextSelectFolder => '데스크톱 파일을 검색하려면 프로젝트 폴더를 선택하세요.';

  @override
  String chatUiContextNoneFound(String kind) {
    return '$kind을(를) 찾을 수 없어요.';
  }

  @override
  String get chatUiAddDesktopContext => '데스크톱 컨텍스트 추가';

  @override
  String get chatUiContextSearchFiles => '데스크톱에서 파일 검색';

  @override
  String chatUiContextSearchKind(String kind) {
    return '$kind 검색';
  }

  @override
  String get chatUiContextDisabled => '데스크톱에서 꺼져 있음';

  @override
  String get chatUiContextOnDesktop => '페어링된 데스크톱에 있음';

  @override
  String get chatUiEmptyGeneralTitle => '무엇을 함께 해 볼까요?';

  @override
  String get chatUiEmptyFolderPrefix => '‘';

  @override
  String get chatUiEmptyFolderSuffix => '’에서 무엇을 할까요?';

  @override
  String get chatUiEmptyGreeting => '안녕하세요! 무엇을 도와드릴까요?';

  @override
  String get chatUiEncryptedCaption => '채팅은 종단 간 암호화돼요';

  @override
  String get chatUiUserMessage => '사용자 메시지';

  @override
  String get chatUiAssistantMessage => '어시스턴트 메시지';

  @override
  String get chatUiThreadActions => '스레드 작업';

  @override
  String get chatUiBranchesAndWorktrees => '브랜치 및 작업 트리';

  @override
  String get chatUiGitActions => 'Git 작업';

  @override
  String get chatUiWorking => '작업 중…';

  @override
  String get chatUiScrollToLatest => '최신 메시지로 이동';

  @override
  String get chatUiSavedToPhotos => '사진에 저장했어요.';

  @override
  String get chatUiShareImageFailed => '이미지를 공유하지 못했어요. 다시 시도해 주세요.';

  @override
  String get chatUiSaveImageFailed => '이미지를 저장하지 못했어요. 다시 시도해 주세요.';

  @override
  String get chatUiLoadImageFailed => '이미지를 불러오지 못했어요.';

  @override
  String get chatUiRetry => '다시 시도';

  @override
  String get chatUiImageReopenWorkspace => '다시 연결하거나 작업 공간에서 이 이미지를 다시 여세요.';

  @override
  String get chatUiImageReopenChat => '페어링된 채팅에서 이 이미지를 다시 여세요.';

  @override
  String chatUiOpenImage(String name) {
    return '$name 이미지 열기';
  }

  @override
  String get chatUiClose => '닫기';

  @override
  String get chatUiShare => '공유';

  @override
  String get chatUiSaveToPhotos => '사진에 저장';

  @override
  String get chatUiModelsGroup => '모델';

  @override
  String get chatUiRefreshModels => '모델 새로고침';

  @override
  String get chatUiProviderAndModel => '제공업체 및 모델';

  @override
  String get chatUiDone => '완료';

  @override
  String get chatUiAllProviders => '모든 제공업체';

  @override
  String get chatUiModelsConnectionChanged => '연결이 바뀌었어요. 모델 선택을 다시 여세요.';

  @override
  String get chatUiLoadingModels => '모델 불러오는 중';

  @override
  String get chatUiNoModels => '사용할 수 있는 모델이 없어요';

  @override
  String get chatUiNoModelsHint => '컴퓨터의 DJL에서 제공업체를 연결한 뒤 모델 목록을 새로고침하세요.';

  @override
  String get chatUiNoMatchingModels => '일치하는 모델이 없어요';

  @override
  String get chatUiSearchModels => '제공업체 또는 모델 검색';

  @override
  String get chatUiClearModelSearch => '모델 검색 지우기';

  @override
  String get chatUiNavCloudChat => '클라우드 채팅';

  @override
  String get chatUiNavRemote => '원격';

  @override
  String get chatUiNavSearchFailed => '채팅을 검색하지 못했어요.';

  @override
  String get chatUiNavRetrySearch => '다시 검색';

  @override
  String get chatUiNavSearching => '채팅 검색 중…';

  @override
  String get chatUiNavPinned => '고정됨';

  @override
  String get chatUiNavPinnedEmpty =>
      '자주 쓰는 채팅을 가까이 두세요.\n채팅을 길게 누르면 고정할 수 있어요.';

  @override
  String get chatUiNavRecent => '최근 채팅';

  @override
  String get chatUiNavRecentEmpty => '채팅이 여기에 표시돼요.';

  @override
  String get chatUiNoMatchingChats => '일치하는 채팅이 없어요';

  @override
  String get chatUiCloseSearch => '검색 닫기';

  @override
  String get chatUiSearchChats => '채팅 검색';

  @override
  String get chatUiChatButton => '채팅';

  @override
  String get chatUiNewChat => '새 채팅';

  @override
  String get chatUiSettings => '설정';

  @override
  String get chatUiMoreActions => '더보기';

  @override
  String get chatUiMenuNewChat => '새 채팅';

  @override
  String get chatUiMenuQuickChat => '빠른 채팅';

  @override
  String get chatUiMenuNewProject => '새 프로젝트';

  @override
  String get chatUiMenuConnections => '연결';

  @override
  String get chatUiMenuSecurePairing => '보안 페어링 정보';

  @override
  String get chatUiMenuYourMac => '내 Mac';

  @override
  String get chatUiMenuActiveChats => '진행 중인 채팅';

  @override
  String get chatUiArchivedChats => '보관된 채팅';

  @override
  String get chatUiMenuRefresh => '새로고침';

  @override
  String get chatUiMenuDisconnect => '연결 해제';

  @override
  String get chatUiOpenNavigation => '탐색 메뉴 열기';

  @override
  String get chatUiSearchConversations => '대화 검색';

  @override
  String get chatUiDismissSearch => '검색 닫기';

  @override
  String get chatUiStatusConnecting => '연결 중';

  @override
  String get chatUiStatusDeviceOffline => '기기 오프라인';

  @override
  String chatUiStatusDeviceOfflineSince(String time) {
    return '$time부터 잠자기 또는 오프라인';
  }

  @override
  String get chatUiStatusOffline => '오프라인';

  @override
  String chatUiConnectionStatus(String status) {
    return '연결 상태: $status';
  }

  @override
  String get chatUiGroups => '그룹';

  @override
  String get homeTabChats => '채팅';

  @override
  String get chatUiExpandAll => '모두 펼치기';

  @override
  String get chatUiCollapseAll => '모두 접기';

  @override
  String chatUiCollapseChildChats(String title) {
    return '$title의 하위 채팅 접기';
  }

  @override
  String chatUiExpandChildChats(String title) {
    return '$title의 하위 채팅 펼치기';
  }

  @override
  String get chatUiDesktopChatActions => '데스크톱 채팅 작업';

  @override
  String get chatUiArchiveProject => '프로젝트 보관';

  @override
  String get chatUiRemoveFromPhone => '휴대폰에서 제거';

  @override
  String chatUiArchiveProjectTitle(String name) {
    return '“$name”을(를) 보관할까요?';
  }

  @override
  String get chatUiArchiveProjectBody => '이 프로젝트의 진행 중인 채팅이 모두 보관돼요.';

  @override
  String chatUiRemoveProjectTitle(String name) {
    return '이 휴대폰에서 “$name”을(를) 제거할까요?';
  }

  @override
  String get chatUiRemoveProjectBody =>
      '이 프로젝트의 채팅은 이 휴대폰의 DJL에서만 삭제돼요. 기기나 Codex 옵저버에서는 아무것도 삭제되지 않아요.';

  @override
  String chatUiExpandProject(String name) {
    return '$name 프로젝트 펼치기';
  }

  @override
  String chatUiCollapseProject(String name) {
    return '$name 프로젝트 접기';
  }

  @override
  String chatUiNewChatIn(String name) {
    return '$name에서 새 채팅';
  }

  @override
  String get chatUiNewGroup => '새 그룹';

  @override
  String get chatUiGroupButton => '그룹';

  @override
  String get chatUiOfflineSavedChats => '오프라인 · 저장된 채팅 표시 중';

  @override
  String get chatUiReconnect => '다시 연결';

  @override
  String get chatUiNoMatchingChatsPeriod => '일치하는 채팅이 없어요.';

  @override
  String get chatUiNoStudioThreads => 'Studio 스레드 없음';

  @override
  String get chatUiNoProjectChats => '프로젝트 채팅 없음';

  @override
  String get desktopAttentionApproval => '승인 필요';

  @override
  String get desktopAttentionQuestion => '에이전트의 질문';

  @override
  String get desktopAttentionFailedRun => '실행 실패';

  @override
  String get desktopAttentionBlockedGoal => '목표 확인 필요';

  @override
  String get desktopAttentionCompletedRun => '검토 대기';

  @override
  String get desktopFailurePermission =>
      '요청된 접근 권한을 검토하거나 이 채팅의 액세스 모드를 바꾼 뒤 다시 실행하세요.';

  @override
  String get desktopFailureSignIn => 'Mac에서 다시 로그인한 뒤 다시 실행하세요.';

  @override
  String get desktopFailureTimeout => 'Mac 연결을 확인한 뒤 다시 실행하세요.';

  @override
  String get desktopFailureNetwork => 'Mac과 릴레이가 온라인인지 확인한 뒤 다시 실행하세요.';

  @override
  String get desktopFailureCheck => '채팅을 열어 실패한 검사를 확인하고 고친 뒤 다시 시도하세요.';

  @override
  String get desktopFailureGeneric => '채팅을 열어 마지막 단계를 검토하고 문제를 고친 뒤 다시 시도하세요.';

  @override
  String desktopAttentionAllowCommand(String command) {
    return 'Codex가 “$command”을(를) 실행하도록 허용할까요?';
  }

  @override
  String get desktopAttentionAwaitingPermission => 'Codex가 계속하려면 권한이 필요해요.';

  @override
  String get desktopAttentionAnswerAgent => '채팅을 열어 에이전트에게 답하세요.';

  @override
  String get desktopGoalBlocked => '목표가 막혔어요. 채팅을 열어 에이전트에게 필요한 것을 확인하세요.';

  @override
  String get desktopGoalUsageLimited =>
      '사용량 한도로 이 목표가 일시 중지됐어요. 재개하기 전에 채팅을 검토하세요.';

  @override
  String get desktopGoalBudgetLimited =>
      '목표가 예산에 도달했어요. 다음 단계를 정하기 전에 결과를 검토하세요.';

  @override
  String get desktopRunFinishedReview =>
      '실행이 끝났어요. 계속하기 전에 결과와 파일 변경 사항을 검토하세요.';

  @override
  String get desktopScopeStudio => 'Studio';

  @override
  String get desktopScopeProjects => '프로젝트';

  @override
  String get desktopNoProject => '프로젝트 없음';

  @override
  String get desktopGroupPinned => '고정됨';

  @override
  String get desktopUntitledChat => '제목 없는 채팅';

  @override
  String get desktopComposerTooManyImages => '이미지는 최대 4장까지 선택할 수 있어요.';

  @override
  String get desktopContextIncomplete => '선택한 컨텍스트가 완전하지 않아요. 제거한 뒤 다시 선택하세요.';

  @override
  String get desktopApproveForMeUnsupported =>
      '이 런타임은 자동 승인을 지원하지 않아요. Mac에서 Codex를 업데이트하고 다시 시도하세요.';

  @override
  String get desktopEnterChatName => '채팅 이름을 입력하세요.';

  @override
  String get desktopContextPickerStale => '연결된 데스크톱이 바뀌었어요. 컨텍스트 선택을 다시 여세요.';

  @override
  String get desktopNoSkillList => '데스크톱에서 스킬 목록을 받지 못했어요.';

  @override
  String get desktopNoPluginList => '데스크톱에서 플러그인 목록을 받지 못했어요.';

  @override
  String get desktopNoFileMatches => '데스크톱에서 일치하는 파일을 받지 못했어요.';

  @override
  String get desktopPairedDisconnectedOrChanged => '페어링된 데스크톱의 연결이 끊겼거나 바뀌었어요.';

  @override
  String get desktopPairedChangedRefreshOverview =>
      '페어링된 데스크톱이 바뀌었어요. 개요를 새로고침하세요.';

  @override
  String get desktopPairedChangedRefreshChats =>
      '페어링된 데스크톱이 바뀌었어요. 채팅을 새로고침하세요.';

  @override
  String get desktopIdentityMismatch => '데스크톱 ID 또는 보안 프로토콜이 페어링 정보와 일치하지 않아요.';

  @override
  String get desktopHandshakeUnverified => '데스크톱 핸드셰이크 서명을 확인할 수 없어요.';

  @override
  String get desktopHandshakeTimedOut => '데스크톱 보안 핸드셰이크 시간이 초과됐어요.';

  @override
  String get desktopSecureConnectionRefused => '데스크톱이 보안 연결을 거부했어요.';

  @override
  String get desktopHandshakeInterrupted => '보안 핸드셰이크 중에 데스크톱 연결이 끊겼어요.';

  @override
  String get desktopSecureConnectionRejected => '보안 데스크톱 연결이 거부됐어요.';

  @override
  String get desktopInvalidFrame => '잘못된 데스크톱 프레임이에요.';

  @override
  String get desktopSecureTransportFailed => '데스크톱 보안 전송에 실패했어요.';

  @override
  String get desktopUnencryptedRejected => '암호화되지 않은 데스크톱 앱 트래픽이 거부됐어요.';

  @override
  String get desktopPayloadDecodeFailed => '데스크톱 데이터 일부를 해석할 수 없어요.';

  @override
  String get desktopRequestFailed => '데스크톱 요청에 실패했어요.';

  @override
  String get desktopIsDisconnected => '데스크톱 연결이 끊겼어요.';

  @override
  String get desktopConnectionChanged => '데스크톱 연결이 바뀌었어요.';

  @override
  String get desktopRequestTimedOut =>
      '데스크톱 요청 시간이 초과됐어요. 결과를 알 수 없으니 새로고침한 뒤 다시 시도하세요.';

  @override
  String get desktopDisconnectedRefresh =>
      '데스크톱 연결이 끊겼어요. 작업을 다시 시도하기 전에 새로고침하세요.';

  @override
  String get desktopVerifiedHostRequired => '저장된 인증 호스트가 필요해요.';

  @override
  String get desktopResponseFailed =>
      '데스크톱에서 이 응답을 완료하지 못했어요. 제공업체 설정을 확인하고 다시 시도하세요.';

  @override
  String get desktopWaitBeforeMovingProject =>
      '프로젝트를 옮기기 전에 현재 채팅 작업이 끝날 때까지 기다려 주세요.';

  @override
  String get desktopProviderUnavailable =>
      '이 대화의 제공업체를 사용할 수 없어요. 데스크톱에서 연결하거나 다른 제공업체를 선택하세요.';

  @override
  String get desktopReopenBeforeRestore =>
      '변경 사항을 복원하기 전에 이 채팅을 다시 열어 응답을 확인하세요.';

  @override
  String get desktopSwitchCancelled => '전환을 취소했어요. 다시 연결할 기기를 선택하세요.';

  @override
  String get desktopSelectionClearUnconfirmed =>
      '저장된 선택이 지워졌는지 확인하지 못했어요. 기기 잠금을 해제하고 저장된 Mac을 선택해 복구하세요.';

  @override
  String get desktopLinkIdentityUnavailable =>
      '이 링크의 저장된 Mac ID를 사용할 수 없어요. 인증된 Mac에서 채팅을 여세요.';

  @override
  String get desktopChooseMatchingMac =>
      '이 링크와 일치하는 저장된 Mac을 선택하세요. 인증된 ID가 일치해야 해요.';

  @override
  String get desktopWaitingForMac => '선택한 Mac을 기다리는 중이에요. 사용할 수 있을 때 다시 시도하세요.';

  @override
  String get desktopLinkedConversationUnavailable => '연결된 데스크톱 대화를 사용할 수 없어요.';

  @override
  String get desktopLinkedConversationLoadFailed =>
      '연결된 대화를 불러오지 못했어요. 선택한 Mac에서 다시 시도하세요.';

  @override
  String get desktopDevicePreferencesLoadFailed =>
      '기기 환경설정을 불러오지 못했어요. 기기 잠금을 해제하고 다시 시도하세요.';

  @override
  String get desktopSavedDesktopsOpenFailed =>
      '저장된 데스크톱을 열지 못했어요. 기기 잠금을 해제하고 다시 시도하세요.';

  @override
  String get desktopModelUnavailable =>
      '선택한 데스크톱 모델을 사용할 수 없어요. 사용 가능한 모델을 선택하세요.';

  @override
  String get desktopStopRunsUnconfirmed =>
      '실행 중지를 확인하지 못했어요. 다른 Mac에서 아직 실행 중일 수 있어요.';

  @override
  String get desktopPairingIdentityReadFailed =>
      '보안 페어링 ID를 읽지 못했어요. 기기 잠금을 해제한 뒤 다시 연결을 선택하세요.';

  @override
  String get desktopRuntimeOtherHistory => '런타임이 다른 채팅의 기록을 보냈어요.';

  @override
  String get desktopLinkedHistoryUnverified => '연결된 대화 기록을 확인하지 못했어요.';

  @override
  String get desktopIdleChatAndProjectRequired =>
      '현재 대기 중인 채팅과 올바른 프로젝트가 필요해요.';

  @override
  String get desktopProjectChangeUnverified => '런타임이 이 채팅의 프로젝트 변경을 확인하지 않았어요.';

  @override
  String get desktopForkUnidentified =>
      '런타임이 생성된 포크를 알려 주지 않았어요. 새로고침한 뒤 다시 시도하세요.';

  @override
  String get desktopForkNotSeparate => '런타임이 별도의 대화를 만들지 않았어요.';

  @override
  String get desktopForkUnsupported =>
      '이 런타임은 대화 포크를 지원하지 않아요. 데스크톱의 DJL을 업데이트하고 다시 시도하세요.';

  @override
  String get desktopReadSettingsFirst => '새 채팅을 만들기 전에 저장된 설정을 불러오세요.';

  @override
  String get desktopConnectMacWithModels =>
      '새 채팅을 만들기 전에 사용 가능한 모델이 있는 Mac을 연결하세요.';

  @override
  String get desktopChatCreatedElsewhere =>
      '데스크톱이 다른 프로젝트 폴더에 채팅을 만들었어요. 로컬 초안은 그대로 남아 있어요.';

  @override
  String get desktopDraftContextOtherFolder =>
      '초안의 컨텍스트가 다른 프로젝트 폴더에 속해 있어요. 제거한 뒤 컨텍스트를 다시 선택하세요.';

  @override
  String get desktopQueuedPlanModelRequired =>
      '대기 중인 초안을 보내기 전에 계획 모드를 지원하는 모델을 선택하세요.';

  @override
  String get desktopChooseModelFirst => '먼저 사용 가능한 데스크톱 모델을 선택하세요.';

  @override
  String get desktopRunChangedBeforeQueue =>
      '대기열 전송 전에 진행 중인 실행이 바뀌었어요. 재개하기 전에 새로고침하세요.';

  @override
  String get desktopRunChangedBeforeSteer =>
      '진행 중인 실행이 바뀌었어요. 다시 지시하기 전에 새로고침하세요.';

  @override
  String get desktopModelBeforeLeavingPlan => '계획 모드를 끄기 전에 사용 가능한 모델을 선택하세요.';

  @override
  String get desktopPlanModeUnsupported =>
      '이 런타임은 계획 모드를 지원하지 않아요. 일반 메시지로 보냈어요.';

  @override
  String get desktopRunIdPending => '진행 중인 실행의 ID가 아직 없어요. 잠시 후 다시 시도하세요.';

  @override
  String get desktopRuntimeOtherTurnPage => '런타임이 다른 채팅의 대화 페이지를 보냈어요.';

  @override
  String get desktopRuntimeNoTurnState => '런타임이 이 채팅의 대화 상태를 보내지 않았어요.';

  @override
  String get desktopRuntimeInvalidTurnState => '런타임이 잘못된 대화 상태를 보냈어요.';

  @override
  String get desktopRetryApprovalUnacknowledged => '데스크톱이 재시도 승인을 확인하지 않았어요.';

  @override
  String get desktopDeviceFallbackName => '기기';

  @override
  String get desktopDeviceChangeUnconfirmed =>
      '변경 사항을 확인하지 못했어요. 저장된 이름을 확인하고 다시 시도하세요. 이 기기를 삭제했거나 교체했다면 편집기를 닫았다가 다시 여세요.';

  @override
  String get desktopPreferencesReloadFailed =>
      '기기 환경설정을 확인하거나 다시 불러오지 못했어요. 다시 저장하기 전에 기기 잠금을 해제하고 다시 시도하세요.';

  @override
  String get desktopRunChangedBeforePlan =>
      '진행 중인 실행이 바뀌었어요. 이 계획을 실행하기 전에 새로고침하세요.';

  @override
  String get desktopQueueMessageArrived =>
      '메시지가 도착했어요. 대기 중인 메시지를 재개하기 전에 결과를 확인하세요.';

  @override
  String get desktopQueueDeliveryUnconfirmed =>
      '대기열 전송을 확인하지 못했어요. 다시 시도하기 전에 이 채팅을 다시 여세요.';

  @override
  String get desktopRequestFromEarlierSession =>
      '이전 데스크톱 세션의 요청이에요. 채팅을 새로고침하세요.';

  @override
  String get desktopUndoReconnect => '실행 취소를 검토하기 전에 데스크톱에 다시 연결하세요.';

  @override
  String get desktopUndoReopen => '변경 사항을 실행 취소하기 전에 이 채팅을 다시 열어 응답을 확인하세요.';

  @override
  String get desktopUndoRepoBusy => '이 저장소의 채팅이 실행 중이에요. 응답을 실행 취소하려면 기다려 주세요.';

  @override
  String get desktopUndoWaitResponse =>
      '변경 사항을 실행 취소하기 전에 진행 중인 응답이 끝날 때까지 기다려 주세요.';

  @override
  String get desktopUndoPersistFailed => '실행 취소 결과를 저장하지 못했어요.';

  @override
  String get desktopUndoRepoUnverified =>
      '응답의 저장소를 확인하지 못했어요. 다시 연결한 뒤 다시 검토하세요.';

  @override
  String get desktopReconnectToRefreshModels => '모델을 새로고침하려면 데스크톱에 다시 연결하세요.';

  @override
  String get desktopAccessModeNotApplied => '데스크톱이 요청한 액세스 모드를 적용하지 않았어요.';

  @override
  String get desktopSubagentOfflineCached => '오프라인 · 저장된 정보';

  @override
  String get desktopSubagentLoading => '에이전트 정보 불러오는 중';

  @override
  String get desktopSubagentLoaded => '정보를 불러왔어요';

  @override
  String get desktopSubagentIdentityUnknown => '알 수 없는 에이전트';

  @override
  String get desktopSubagentLoadFailed => '에이전트 정보를 불러오지 못했어요';

  @override
  String get desktopSavedDeviceChanged => '저장된 기기가 바뀌었어요. 다시 선택하세요.';

  @override
  String get desktopMacIdentityMismatch => '선택한 Mac의 ID가 일치하지 않아요.';

  @override
  String get desktopOfflineChatsOpenFailed =>
      '오프라인 채팅을 열지 못했어요. 기기 잠금을 해제하거나 다시 연결해서 불러오세요.';

  @override
  String get desktopOfflineChatsSaveFailed =>
      '오프라인 채팅을 저장하지 못했어요. 기기 잠금을 해제하고 다시 시도하세요.';

  @override
  String get desktopChoosePairedDesktop => '페어링된 데스크톱을 선택하세요.';

  @override
  String get desktopSavedLocallyUnconfirmed =>
      '이 기기에 저장했어요. 데스크톱의 변경 사항은 확인하지 못했으니 새로고침한 뒤 다시 시도하세요.';

  @override
  String get desktopImageEmptyOrTooLarge =>
      '선택한 이미지가 비어 있거나 너무 커요. 더 작은 이미지를 선택하세요.';

  @override
  String get desktopImageUnsupported => '선택한 파일은 지원되는 이미지가 아니에요.';

  @override
  String get desktopImageResizeFailed =>
      '이 기기에서 이미지 크기를 줄이지 못했어요. 1600픽셀 이하의 이미지를 선택하세요.';

  @override
  String get desktopImageTooLarge => '선택한 이미지가 너무 커요. 더 작은 이미지를 선택하세요.';

  @override
  String get desktopContextFolderChanged =>
      '프로젝트 폴더가 바뀌었어요. 기존 컨텍스트를 제거하거나 원래 폴더로 돌아가세요.';

  @override
  String get desktopPickerOpenFailed => '선택 창을 열지 못했어요. 다시 시도해 주세요.';

  @override
  String get desktopWorktreeStale =>
      '연결된 데스크톱이나 채팅이 바뀌었어요. 이 작업 트리 작업을 다시 여세요.';

  @override
  String get desktopNotGitRepository => '이 폴더는 더 이상 Git 저장소가 아니에요.';

  @override
  String get desktopBranchAlreadyExists => '이미 있는 브랜치';

  @override
  String get desktopWorktreeUnidentified =>
      '데스크톱이 새 작업 트리를 알려 주지 않았어요. 새로고침한 뒤 다시 시도하세요.';

  @override
  String get desktopForkUnverified => '포크 결과를 확인할 수 없어요.';

  @override
  String get desktopHandoffUnverified =>
      '데스크톱이 넘길 위치를 확인하지 않았어요. 다시 시도하기 전에 두 폴더를 모두 확인하세요.';

  @override
  String get desktopWorktreePathUnavailable => '작업 트리 경로를 사용할 수 없어요.';

  @override
  String get desktopLocalCheckoutUnresolved =>
      '이 작업 트리와 페어링된 로컬 체크아웃을 찾지 못했어요.';

  @override
  String get desktopWorktreeHandoffFailed => '작업 트리로 넘기기 실패';

  @override
  String get desktopWorktreeForkFailed => '작업 트리 포크 실패';

  @override
  String desktopAccessModeNotAppliedBy(String method) {
    return '$method에서 선택한 액세스 모드를 적용하지 않았어요.';
  }

  @override
  String desktopApprovalReviewerNotApplied(String method) {
    return '$method에서 선택한 승인 검토자를 적용하지 않았어요.';
  }

  @override
  String desktopApprovalPolicyNotApplied(String method) {
    return '$method에서 선택한 승인 정책을 적용하지 않았어요.';
  }

  @override
  String desktopSandboxNotApplied(String method) {
    return '$method에서 선택한 샌드박스 권한을 적용하지 않았어요.';
  }

  @override
  String desktopForkResultUnknown(String error) {
    return '$error 포크 결과를 알 수 없을 수 있어요. 새로고침한 뒤 다시 시도하세요.';
  }

  @override
  String desktopSendResultUnknown(String error) {
    return '$error 전송 결과를 알 수 없을 수 있어요. 대화를 새로고침한 뒤 다시 시도하세요.';
  }

  @override
  String desktopQueuePaused(String reason) {
    return '대기열 일시 중지됨: $reason';
  }

  @override
  String desktopWorktreeExists(String branch) {
    return '‘$branch’ 작업 트리가 이미 있어요. 다른 이름을 선택하세요.';
  }

  @override
  String desktopRollbackFailed(String reason) {
    return '추적된 변경 사항을 자동으로 되돌리지 못했어요: $reason. 다시 시도하기 전에 두 폴더를 모두 확인하세요.';
  }

  @override
  String desktopWorktreeKeptAt(String path) {
    return '새 작업 트리를 $path에 남겨 두었어요. 다시 시도하기 전에 확인하세요.';
  }

  @override
  String get desktopWorktreeMayExist =>
      '작업 트리가 만들어졌을 수 있어 그대로 남겨 두었어요. 다시 시도하기 전에 새로고침하고 확인하세요.';

  @override
  String get pairingEnterTenCharCode => '데스크톱 원격 설정에 표시된 10자리 코드를 입력하세요.';

  @override
  String get pairingSecureRelayRequired => '페어링하려면 보안 릴레이 URL이 필요해요.';

  @override
  String get pairingPairedMac => '페어링된 Mac';

  @override
  String get pairingNotAPairingCode => 'DJL 페어링 QR이나 붙여 넣을 수 있는 코드가 아니에요.';

  @override
  String get pairingUpdateDesktop =>
      '데스크톱의 DJL을 업데이트하세요. 이 페어링은 다른 프로토콜을 사용해요.';

  @override
  String get pairingProofMismatch =>
      '페어링 코드 또는 QR 코드가 일치하지 않아요. 새로 생성한 뒤 다시 시도하세요.';

  @override
  String get pairingInvalidIdentifier => '기기/세션 식별자가 올바르지 않아요.';

  @override
  String get pairingInvalidIdentityKey => '데스크톱 ID 키가 올바르지 않아요.';

  @override
  String get pairingCodeExpired => '페어링 코드가 만료됐어요. Mac에서 새 코드를 생성하세요.';

  @override
  String get pairingPrefsUnavailable => '저장된 기기 환경설정을 사용할 수 없어요.';

  @override
  String get pairingDeviceChangedReopen => '저장된 기기가 바뀌었어요. 편집기를 닫았다가 다시 여세요.';

  @override
  String get pairingRecoverSelectionFailed =>
      '저장된 선택을 복구하지 못했어요. Mac을 선택하기 전에 기기 잠금을 해제하고 다시 시도하세요.';

  @override
  String get pairingDeviceChangedChooseAgain => '저장된 기기가 바뀌었어요. 다시 선택하세요.';

  @override
  String get pairingConfirmSavedFailed =>
      '선택한 Mac이 저장됐는지 확인하지 못했어요. 기기 잠금을 해제하고 저장된 Mac을 선택해 복구하세요.';

  @override
  String get pairingRelayDifferentIdentity =>
      '신뢰하는 릴레이가 다른 데스크톱 ID를 보냈어요. 다시 페어링하세요.';

  @override
  String get pairingRelayTemporarilyUnavailable => '데스크톱 릴레이를 일시적으로 사용할 수 없어요.';

  @override
  String get pairingRelayInvalidResponse => '데스크톱 릴레이가 잘못된 응답을 보냈어요.';

  @override
  String get pairingTrustedComputerOffline => '신뢰하는 컴퓨터가 오프라인이에요.';

  @override
  String get pairingServiceUnavailable => '데스크톱 페어링 서비스를 사용할 수 없어요.';

  @override
  String get pairingRelayUnreachable => '데스크톱 릴레이에 연결할 수 없어요.';

  @override
  String get pairingRelayUnsupportedMethod => '이 릴레이는 이 페어링 방식을 지원하지 않아요.';

  @override
  String get pairingRelayRequired => '릴레이 URL이 필요해요.';

  @override
  String get pairingEnterOneTimeCode => '일회용 코드 입력';

  @override
  String get pairingFindCodeHint => 'DJL Desktop의 설정 → 원격에서 코드를 확인하세요.';

  @override
  String get pairingCodeLabel => '페어링 코드';

  @override
  String get pairingRelayConfigured => '릴레이 설정됨';

  @override
  String get pairingRelaySettings => '릴레이 설정';

  @override
  String get pairingInProgress => '페어링 중…';

  @override
  String get pairingPair => '페어링';

  @override
  String get pairingSecureDetailsTitle => '보안 페어링 정보';

  @override
  String get pairingSecureDetailsBody =>
      'DJL 데스크톱 → 설정 → 원격을 여세요. 페어링 데이터를 붙여 넣거나, 일회용 코드에 쓰이는 릴레이를 설정하세요.';

  @override
  String get pairingPasteCode => '페어링 코드 붙여넣기';

  @override
  String get pairingPayloadHint => 'RMX1:… 또는 QR JSON';

  @override
  String get pairingPairSecurely => '안전하게 페어링';

  @override
  String get pairingRelayUrlLabel => '데스크톱 릴레이 URL';

  @override
  String get pairingSwitchDeviceTitle => '기기를 전환할까요?';

  @override
  String get pairingSwitchDeviceBody =>
      'DJL이 이 Mac에서 진행 중인 실행을 중지하고 다른 기기의 채팅을 다시 불러와요.';

  @override
  String get pairingSwitch => '전환';

  @override
  String get pairingCancellingSwitch => '전환 취소 중…';

  @override
  String get pairingSwitchingDevice => '기기 전환 중…';

  @override
  String get pairingCancelSwitch => '전환 취소';

  @override
  String get pairingChooseMatchingMac => '이 링크의 인증된 ID와 일치하는 저장된 Mac을 선택하세요.';

  @override
  String get pairingChooseMacForLink => '연결된 대화를 열 저장된 Mac을 선택하세요.';

  @override
  String get pairingOpeningLinkedConversation => '연결된 데스크톱 대화 여는 중…';

  @override
  String get pairingRetryDesktopLink => '데스크톱 링크 다시 시도';

  @override
  String get pairingCancelDesktopLink => '데스크톱 링크 취소';

  @override
  String get pairingMatchesLinkIdentity => '이 링크의 인증된 ID와 일치';

  @override
  String get pairingDifferentIdentity => '다른 데스크톱 ID';

  @override
  String get pairingSavedVerifiedIdentity => '저장 및 인증된 데스크톱 ID';

  @override
  String get pairingReconnect => '다시 연결';

  @override
  String get pairingConnections => '연결';

  @override
  String get pairingScanQrCode => 'QR 코드 스캔';

  @override
  String get pairingPairWithCode => '코드로 페어링';

  @override
  String get pairingConnectToDesktop => 'DJL Desktop에 연결';

  @override
  String get pairingChooseSavedMac => '저장된 Mac 선택';

  @override
  String get pairingFirstPairingHint =>
      'Mac이나 Windows PC에서 DJL을 열고 설정 → 원격으로 이동하세요.';

  @override
  String get pairingGetDesktop => 'Mac 또는 PC용 DJL 받기';

  @override
  String get pairingScanTitle => 'DJL 데스크톱 QR 스캔';

  @override
  String get pairingCameraDenied => '카메라 접근이 거부됐어요. 대신 페어링 코드를 붙여 넣을 수 있어요.';

  @override
  String get pairingScanUnsupported =>
      '이 기기에서는 QR 스캔을 사용할 수 없어요. 대신 페어링 코드를 붙여 넣을 수 있어요.';

  @override
  String get pairingCameraUnavailable =>
      '카메라를 사용할 수 없어요. 대신 페어링 코드를 붙여 넣을 수 있어요.';

  @override
  String get pairingSwitchDevice => '기기 전환';

  @override
  String get pairingSwitchTo => '전환할 기기';

  @override
  String get pairingStatusSwitching => '전환 중…';

  @override
  String get pairingStatusConnected => '연결됨';

  @override
  String get pairingStatusSelected => '선택됨';

  @override
  String get pairingStatusPrevious => '이전';

  @override
  String get pairingStatusSaved => '저장됨';

  @override
  String get pairingForget => '삭제';

  @override
  String get pairingForgetDeviceTitle => '이 기기를 삭제할까요?';

  @override
  String pairingForgetDeviceBody(String name) {
    return '$name이(가) 이 휴대폰에서 삭제돼요. 다시 연결하려면 QR 코드를 다시 스캔하세요.';
  }

  @override
  String get pairingActiveBadge => '사용 중';

  @override
  String pairingShowInMenu(String name) {
    return '기기 메뉴에 $name 표시';
  }

  @override
  String get pairingMenuVisibilityUnavailable => '메뉴 표시 설정을 사용할 수 없음';

  @override
  String get pairingClose => '닫기';

  @override
  String get pairingActiveDevice => '사용 중인 기기';

  @override
  String pairingActiveDeviceNamed(String name) {
    return '사용 중인 기기, $name';
  }

  @override
  String pairingDevicesInMenu(int count) {
    return '메뉴에 기기 $count대';
  }

  @override
  String get pairingDevices => '기기';

  @override
  String get pairingNoDevices => '아직 페어링된 기기가 없어요.';

  @override
  String get pairingScanQr => 'QR 스캔';

  @override
  String get pairingForgetDesktop => '데스크톱 삭제';

  @override
  String get pairingRecencyNow => '방금';

  @override
  String pairingRecencyMinutes(int count) {
    return '$count분';
  }

  @override
  String pairingRecencyHours(int count) {
    return '$count시간';
  }

  @override
  String pairingRecencyDays(int count) {
    return '$count일';
  }

  @override
  String pairingRecencyAgo(String age) {
    return '$age 전';
  }

  @override
  String pairingRecencyIn(String age) {
    return '$age 후';
  }

  @override
  String get chatUiCloseNavigation => '탐색 메뉴 닫기';

  @override
  String get chatUiRuntime => '런타임';

  @override
  String get chatUiContinueIn => '이어서 작업할 곳';

  @override
  String get chatUiLocal => '로컬';

  @override
  String get chatUiWorktree => '작업 트리';

  @override
  String get chatUiCurrentBranch => '현재 브랜치';

  @override
  String get chatUiCollapseProjectControls => '프로젝트 컨트롤 접기';

  @override
  String get chatUiExpandProjectControls => '프로젝트 컨트롤 펼치기';

  @override
  String get chatUiQueuedMessages => '대기 중인 메시지';

  @override
  String get chatUiQueuedHint => '대기 중인 후속 메시지를 시트로 보여 줘요';

  @override
  String get chatUiQueued => '대기 중';

  @override
  String get chatUiQueuedNeedsPlanModel =>
      '이 초안을 입력창으로 옮기기 전에 계획 모드를 지원하는 모델을 선택하세요.';

  @override
  String chatUiImageCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '이미지 $count장',
    );
    return '$_temp0';
  }

  @override
  String get chatUiAttachedContext => '첨부된 컨텍스트';

  @override
  String get chatUiMoveDraftToInput => '초안을 입력창으로 옮기기';

  @override
  String get chatUiSteerQueued => '대기 중인 메시지로 지시 추가';

  @override
  String get chatUiSteer => '지시 추가';

  @override
  String get chatUiDeleteQueued => '대기 중인 메시지 삭제';

  @override
  String get chatUiCopyResponse => '응답 복사';

  @override
  String get chatUiCopied => '복사됨';

  @override
  String get chatUiEffortLow => '낮음';

  @override
  String get chatUiEffortMedium => '보통';

  @override
  String get chatUiEffortHigh => '높음';

  @override
  String get chatUiEffortExtraHigh => '매우 높음';

  @override
  String get chatUiLoading => '불러오는 중…';

  @override
  String get chatUiSelectModel => '모델 선택';

  @override
  String get chatUiModel => '모델';

  @override
  String get chatUiSpeed => '속도';

  @override
  String get chatUiSpeedFast => '빠름';

  @override
  String get chatUiSpeedNormal => '보통';

  @override
  String get chatUiChatControls => '채팅 설정';

  @override
  String get chatUiControlsConnectionChanged => '연결이 바뀌었어요. 채팅 설정을 다시 여세요.';

  @override
  String get chatUiLoadingModelsEllipsis => '모델 불러오는 중…';

  @override
  String get chatUiOtherModels => '다른 모델…';

  @override
  String get chatUiIntelligence => '추론 수준';

  @override
  String get chatUiCopySessionId => '세션 ID 복사';

  @override
  String get chatUiRenameChat => '채팅 이름 변경';

  @override
  String get chatUiUnpinChat => '채팅 고정 해제';

  @override
  String get chatUiPinChat => '채팅 고정';

  @override
  String get chatUiUnarchiveChat => '채팅 보관 해제';

  @override
  String get chatUiArchiveChat => '채팅 보관';

  @override
  String get chatUiRemoveFromDevice => '이 기기에서 제거';

  @override
  String get chatUiSessionIdCopied => '세션 ID를 복사했어요.';

  @override
  String get chatUiRemoveChatTitle => '이 기기에서 채팅을 제거할까요?';

  @override
  String get chatUiRemoveChatBodyArchived =>
      '채팅은 데스크톱에 그대로 남아요. 하위 에이전트 채팅은 이 기기에 보관돼요.';

  @override
  String get chatUiRemoveChatBody =>
      '채팅은 데스크톱에 그대로 남고, 데스크톱에서도 보관돼요. 하위 에이전트 채팅은 이 기기에 보관돼요.';

  @override
  String get chatUiRemoveChat => '채팅 제거';

  @override
  String get chatUiChatName => '채팅 이름';

  @override
  String get chatUiSaveName => '이름 저장';

  @override
  String get chatUiCopyPathFailed => '경로를 복사하지 못했어요. 다시 시도하세요.';

  @override
  String get chatUiConversationChanged => '대화가 바뀌었어요';

  @override
  String get chatUiCloseLocation => '위치 닫기';

  @override
  String get chatUiThreadLabel => '스레드';

  @override
  String get chatUiRenameConversation => '대화 이름 변경';

  @override
  String get chatUiPathLabel => '경로';

  @override
  String get chatUiPathCopied => '경로를 복사했어요';

  @override
  String get chatUiCopyPath => '경로 복사';

  @override
  String get chatUiLocationStale => '이 시트를 닫고 대화 위치를 다시 여세요.';

  @override
  String get chatUiMoreThreadActions => '스레드 작업 더보기';

  @override
  String chatUiPreviousMessages(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '이전 메시지 $count개',
    );
    return '$_temp0';
  }

  @override
  String chatUiMoreToolCalls(int count) {
    return '도구 호출 $count개 더';
  }

  @override
  String chatUiRanCommands(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '명령 $count개 실행함',
    );
    return '$_temp0';
  }

  @override
  String chatUiCommandsFailed(int count) {
    return '$count개 실패';
  }

  @override
  String chatUiCommandsStopped(int count) {
    return '$count개 중지됨';
  }

  @override
  String get chatUiCollapsePreviousMessages => '이전 메시지 접기';

  @override
  String get chatUiExpandPreviousMessages => '이전 메시지 펼치기';

  @override
  String get chatUiCollapseCommands => '명령 접기';

  @override
  String get chatUiExpandCommands => '명령 펼치기';

  @override
  String get chatUiCollapseToolCalls => '도구 호출 접기';

  @override
  String get chatUiExpandToolCalls => '도구 호출 펼치기';

  @override
  String get chatUiQuestions => '질문';

  @override
  String chatUiQuestionPage(int page, int total) {
    return '$page/$total';
  }

  @override
  String get chatUiQuestionResponseUnknown =>
      '이전 응답이 이미 전송됐을 수 있어요. 다시 답하기 전에 데스크톱 상태를 확인하세요.';

  @override
  String get chatUiBack => '뒤로';

  @override
  String get chatUiQuestionClosing => '닫는 중...';

  @override
  String get chatUiQuestionEsc => 'ESC';

  @override
  String get chatUiNext => '다음';

  @override
  String get chatUiResponseSent => '응답을 보냈어요';

  @override
  String get chatUiSendingDots => '보내는 중...';

  @override
  String get chatUiSend => '보내기';

  @override
  String chatUiSelectUpTo(int limit) {
    return '최대 $limit개 선택';
  }

  @override
  String get chatUiOtherAnswer => '기타 답변';

  @override
  String get chatUiYourAnswer => '내 답변';

  @override
  String get settingsFontSystem => '시스템';

  @override
  String get settingsUnlockReason => 'DJL과 원격 코딩 세션의 잠금을 해제해요.';

  @override
  String get settingsUsageWeekly => '주간';

  @override
  String settingsUsageWeeks(int count) {
    return '$count주';
  }

  @override
  String settingsUsageDays(int count) {
    return '$count일';
  }

  @override
  String settingsUsageHours(int count) {
    return '$count시간';
  }

  @override
  String settingsUsageMinutes(int count) {
    return '$count분';
  }

  @override
  String get settingsThemeSystem => '시스템';

  @override
  String get settingsThemeLight => '라이트';

  @override
  String get settingsThemeDark => '다크';

  @override
  String get settingsAppearance => '화면 스타일';

  @override
  String get settingsFont => '글꼴';

  @override
  String get settingsLiquidGlass => 'Liquid Glass';

  @override
  String get settingsTheme => '테마';

  @override
  String get settingsNotifications => '알림';

  @override
  String get settingsInAppAlertsFooter => '다른 대화의 작업이 끝나면 배너를 표시해요.';

  @override
  String get settingsInAppAlerts => '앱 내 알림';

  @override
  String get settingsVoice => '음성';

  @override
  String get settingsVoiceFooter =>
      '받아쓴 내용을 보내기 전에 확인할 수 있어요. 답변은 기기의 음성으로 읽어 줘요.';

  @override
  String get settingsSpeakReplies => '새 답변 소리 내어 읽기';

  @override
  String get settingsRetryReading => '설정 다시 불러오기';

  @override
  String get settingsErrorPartialSave =>
      '일부 기본값만 저장됐을 수 있어요. 다시 불러온 설정을 확인하고 다시 시도하세요.';

  @override
  String get settingsErrorPartialReload =>
      '기본값이 일부만 저장됐을 수 있어요. 환경설정을 다시 불러오지 못했어요. 먼저 설정을 다시 불러오세요.';

  @override
  String get settingsErrorRead => '저장된 설정을 읽지 못했어요. 설정을 유지하려면 다시 시도하세요.';

  @override
  String get settingsErrorSave => '이 설정을 저장하지 못했어요. 이전 선택은 그대로예요. 다시 시도하세요.';

  @override
  String settingsUsageResets(String when) {
    return '$when 초기화';
  }

  @override
  String get settingsUsage => '사용량';

  @override
  String get settingsUsageFooter => '페어링된 기기에서 가져온 계정 전체 사용 한도예요.';

  @override
  String get settingsUsageLoading => '현재 한도 불러오는 중...';

  @override
  String get settingsUsageConnect => '현재 한도를 불러오려면 페어링된 기기에 연결하세요.';

  @override
  String get settingsUsageUnavailable => '이 계정은 사용 한도 정보를 볼 수 없어요.';

  @override
  String settingsUsageLeft(int percent) {
    return '$percent% 남음';
  }

  @override
  String get settingsUsageStale => '마지막으로 확인한 한도예요. 업데이트하려면 다시 연결하거나 새로고침하세요.';

  @override
  String get settingsUsageRefreshTooltip => '사용량 새로고침';

  @override
  String get settingsUsageRefreshing => '새로고침 중...';

  @override
  String get settingsUsageRefresh => '새로고침';

  @override
  String get settingsUsageRuntimeUnavailable => '이 런타임은 사용 한도 정보를 볼 수 없어요.';

  @override
  String get settingsUsageLoadFailed => '현재 한도를 불러오지 못했어요. 다시 시도하세요.';

  @override
  String get settingsTitle => '설정';

  @override
  String get settingsOpenCloudChat => 'DJL Cloud 채팅 열기';

  @override
  String get settingsSignInCloud => 'DJL Cloud에 로그인';

  @override
  String get settingsCloudSubtitle => 'Mac 없이 채팅, 이미지, 백그라운드 작업 사용';

  @override
  String get settingsDevicePermissions => '기기 권한';

  @override
  String get settingsDevice => '기기';

  @override
  String get settingsMyMacs => '내 Mac';

  @override
  String get settingsLocked => 'DJL이 잠겨 있어요';

  @override
  String get settingsPreparing => 'DJL 준비 중';

  @override
  String get settingsStartFailed => 'DJL을 시작하지 못했어요';

  @override
  String get settingsPrivateNote => '자리를 비운 동안에도 원격 세션은 안전하게 보호돼요.';

  @override
  String get settingsRetryStartup => '다시 시작';

  @override
  String get settingsUnlockHint => 'Face ID, Touch ID 또는 기기 암호로 인증해요';

  @override
  String get settingsUnlocking => '잠금 해제 중…';

  @override
  String get settingsUnlock => 'DJL 잠금 해제';

  @override
  String get settingsLockSetup =>
      'DJL 잠금을 해제하려면 Face ID, Touch ID 또는 기기 암호를 설정하세요.';

  @override
  String get settingsLockStillLocked => 'DJL이 아직 잠겨 있어요. 계속하려면 잠금을 해제하세요.';

  @override
  String get settingsLockCancelled =>
      '인증이 취소됐거나 사용할 수 없어요. 계속하려면 DJL 잠금을 해제하세요.';

  @override
  String get settingsBridgeUnknown => '알 수 없음';

  @override
  String get settingsBridgeInstalled => '설치됨';

  @override
  String get settingsBridgeUpToDate => '최신 버전';

  @override
  String get settingsBridgeUpdateAvailable => '업데이트 있음';

  @override
  String get settingsBridgeDifferentBuild => '다른 빌드';

  @override
  String get settingsBridgeConnectHint => 'Mac에 연결하면 DJL 버전을 확인할 수 있어요.';

  @override
  String get settingsBridgeStaleHint => '마지막으로 확인한 버전이에요. 다시 연결해서 확인하세요.';

  @override
  String get settingsBridgeMatches => 'Mac의 DJL이 최신 버전이에요.';

  @override
  String get settingsBridgeNewer => '새 DJL 버전이 나왔어요. Mac에서 DJL을 업데이트하세요.';

  @override
  String get settingsBridgeDifferent => 'Mac에서 최신 릴리스와 다른 빌드를 실행 중이에요.';

  @override
  String get settingsBridgeStatus => '상태';

  @override
  String settingsBridgeLastKnown(String status) {
    return '마지막 확인 · $status';
  }

  @override
  String get settingsVersion => '버전';

  @override
  String get settingsBridgeLatest => '최신';

  @override
  String get settingsBridgeUpdate => 'Mac에서 DJL 업데이트';

  @override
  String get settingsBridgeCheck => 'DJL 업데이트 확인';

  @override
  String settingsElapsedDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days일',
    );
    return '$_temp0';
  }

  @override
  String settingsElapsedHours(int hours, int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: '$hours시간',
    );
    return '$_temp0 $minutes분';
  }

  @override
  String settingsElapsedMinutes(int minutes, int seconds) {
    return '$minutes분 $seconds초';
  }

  @override
  String settingsElapsedSeconds(int seconds) {
    return '$seconds초';
  }

  @override
  String get settingsArchived => '보관됨';

  @override
  String get settingsArchivedChats => '보관된 채팅';

  @override
  String settingsArchivedSaved(int count) {
    return '이 기기에 $count개 저장됨';
  }

  @override
  String get settingsArchivedActions => '보관된 채팅 작업';

  @override
  String get settingsUnarchive => '보관 해제';

  @override
  String get settingsRemoveFromPhone => '휴대폰에서 제거';

  @override
  String get settingsRemove => '제거';

  @override
  String get settingsNoArchived => '보관된 채팅이 없어요';

  @override
  String settingsRemoveTitle(String title) {
    return '이 휴대폰에서 “$title”을(를) 제거할까요?';
  }

  @override
  String get settingsRemoveBody =>
      '이 휴대폰의 DJL에서만 채팅이 제거돼요. 페어링된 데스크톱에서는 아무것도 삭제되지 않아요.';

  @override
  String get settingsCloudRefreshFailed => '계정 및 Cloud 설정을 새로고침하지 못했어요.';

  @override
  String get settingsLinkFailed => '이 링크를 열지 못했어요. 다시 시도하세요.';

  @override
  String get settingsOpenNotificationsFailed => '알림 설정을 열지 못했어요. 다시 시도하세요.';

  @override
  String get settingsAlertsUnavailable => '사용할 수 없음';

  @override
  String get settingsAlertsOff => '꺼짐';

  @override
  String get settingsAlertsEnabled => '켜짐';

  @override
  String get settingsAlertsNotEnabled => '꺼져 있음';

  @override
  String get settingsBack => '뒤로';

  @override
  String get settingsOpenNavigation => '탐색 메뉴 열기';

  @override
  String get settingsRetry => '다시 시도';

  @override
  String get settingsAccount => '계정';

  @override
  String get settingsDjlAccount => 'DJL 계정';

  @override
  String get settingsAvailableCredits => '사용 가능 크레딧';

  @override
  String get settingsConversations => '대화';

  @override
  String get settingsArchivedChatsRow => '보관된 채팅';

  @override
  String get settingsRemoteAccess => '원격 접근';

  @override
  String get settingsBackgroundAlerts => '백그라운드 알림';

  @override
  String get settingsEnableBackgroundAlerts => '백그라운드 알림 켜기';

  @override
  String get settingsOpenNotificationSettings => '알림 설정 열기';

  @override
  String get settingsVoiceIos =>
      '받아쓰기는 iPhone 안에서만 처리돼요. 보내기 전에 텍스트를 확인하세요. 답변은 iPhone 음성으로 읽어 줘요.';

  @override
  String get settingsVoiceDevice =>
      '받아쓰기는 기기 안에서만 처리돼요. 보내기 전에 텍스트를 확인하세요. 답변은 기기의 음성으로 읽어 줘요.';

  @override
  String get settingsAbout => '정보';

  @override
  String get settingsTerms => '약관';

  @override
  String get settingsPrivacy => '개인정보';

  @override
  String get settingsRetryLocalPrefs => '기기 환경설정 다시 불러오기';

  @override
  String get settingsDeviceNameOnPhone => '이 휴대폰에 표시될 기기 이름';

  @override
  String get settingsEditDeviceNameTooltip => '기기 이름 편집';

  @override
  String get settingsClose => '닫기';

  @override
  String get settingsEditDeviceNameTitle => '기기 이름 편집';

  @override
  String get settingsDeviceName => '기기 이름';

  @override
  String get settingsNicknameNote =>
      '이 별명은 이 휴대폰에만 저장되며, 이 기기가 표시되는 모든 곳에 나타나요.';

  @override
  String get settingsDeviceChanged => '저장된 기기가 바뀌었어요. 편집기를 닫았다가 다시 여세요.';

  @override
  String get settingsUseDefault => '기본값 사용';

  @override
  String get settingsSave => '저장';

  @override
  String get settingsAboutFooter => '채팅은 휴대폰과 페어링된 기기 사이에서 종단 간 암호화돼요.';

  @override
  String get settingsHowDjlWorks => 'DJL 작동 방식';

  @override
  String get settingsChatSupport => '채팅 및 지원';

  @override
  String get settingsPrivacyPolicy => '개인정보 처리방침';

  @override
  String get settingsTermsOfUse => '이용약관';

  @override
  String get settingsAboutRouteBridgeDevice => '페어링된 기기의 브리지';

  @override
  String get settingsAboutRouteBridge => '브리지';

  @override
  String settingsAboutRouteLabel(String from, String to, String via) {
    return '$from → $to (경유: $via)';
  }

  @override
  String get settingsAboutIntro => '휴대폰에서 **Codex**를 제어하세요.';

  @override
  String get settingsAboutIntroNote =>
      'Codex 런타임은 페어링된 기기에서 실행돼요. 휴대폰은 릴레이로 연결된 안전한 리모컨 역할을 해요.';

  @override
  String get settingsAboutHowItWorks => '작동 방식';

  @override
  String get settingsAboutBridge =>
      '페어링된 기기에서는 가벼운 **브리지**가 실행되며, WebSocket으로 **릴레이 서버**에 연결돼요.';

  @override
  String get settingsAboutStep1 => '휴대폰에서 프롬프트를 보내요.';

  @override
  String get settingsAboutStep2 => '프롬프트가 릴레이를 거쳐 페어링된 기기의 브리지로 전달돼요.';

  @override
  String get settingsAboutStep3 => '브리지가 JSON-RPC로 `codex app-server`에 전달해요.';

  @override
  String get settingsAboutStep4 => '응답은 같은 경로를 따라 실시간으로 스트리밍돼요.';

  @override
  String get settingsAboutWorkspaceNote =>
      '작업 공간 도구와 파일 편집은 페어링된 기기에서 실행돼요. 릴레이는 암호화된 트래픽을 전달할 뿐, 작업 공간을 실행하지 않아요.';

  @override
  String get settingsAboutArchitecture => '구조';

  @override
  String get settingsAboutRelay => '릴레이';

  @override
  String get settingsAboutRelayIntro =>
      '가벼운 WebSocket 서버가 휴대폰과 페어링된 기기 사이에서 메시지를 전달해요.';

  @override
  String get settingsAboutRelayDiscovery =>
      '휴대폰이 기기의 활성 세션을 찾을 수 있도록 세션 탐색을 처리해요.';

  @override
  String get settingsAboutRelayPrivate => '핸드셰이크 이후에는 복호화된 메시지 내용을 절대 볼 수 없어요.';

  @override
  String get settingsAboutRelayMetadata =>
      '세션 ID, 기기 ID, 시간 같은 연결 메타데이터는 볼 수 있어요.';

  @override
  String get settingsAboutRelaySelfHost =>
      '릴레이를 **직접 호스팅**하거나 브리지에 설정된 호스팅 엔드포인트를 사용할 수 있어요.';

  @override
  String get settingsAboutAppServerIntro =>
      'Codex 런타임의 경우 브리지는 Codex 클라이언트가 사용하는 JSON-RPC 인터페이스인 **`codex app-server`**에 연결돼요.';

  @override
  String get settingsAboutAppServerSessions => '휴대폰 대화도 완전한 Codex 세션이에요.';

  @override
  String get settingsAboutAppServerRollout =>
      'Codex는 `~/.codex/sessions/` 아래에 JSONL 롤아웃 파일을 만들어요.';

  @override
  String get settingsAboutAppServerHandoff =>
      'DJL의 데스크톱 넘기기 기능을 사용하면 휴대폰 스레드를 페어링된 기기에서 이어 갈 수 있어요.';

  @override
  String get settingsAboutPairing => '페어링 및 보안';

  @override
  String get settingsAboutPairingQr =>
      '처음 연결할 때 브리지의 **QR 코드**를 스캔하세요. QR 코드에는 릴레이, 세션, 페어링된 기기, 브리지 ID 공개 키 정보가 담겨 있어요.';

  @override
  String get settingsAboutPairingAfter => '보안 핸드셰이크 후에는:';

  @override
  String get settingsAboutPairingTrusted =>
      '휴대폰이 브리지를 플랫폼 보안 저장소에 **신뢰하는 기기**로 저장해요.';

  @override
  String get settingsAboutPairingIdentity => '브리지는 휴대폰의 ID를 로컬에 저장해요.';

  @override
  String get settingsAboutPairingReconnect =>
      '저장된 신뢰하는 기기는 다시 스캔하지 않고도 다시 연결할 수 있어요.';

  @override
  String get settingsAboutPairingRecovery =>
      '신뢰 정보가 바뀌거나 현재 세션을 찾을 수 없을 때는 QR로 복구할 수 있어요. 같은 릴레이가 설정돼 있다면 일회용 코드로도 페어링할 수 있어요.';

  @override
  String get settingsAboutEncryption => '종단 간 암호화';

  @override
  String get settingsAboutEncryptionIntro => '페어링 후에는 메시지가 암호화된 봉투에 담겨 전송돼요.';

  @override
  String get settingsAboutCipher => '암호';

  @override
  String get settingsAboutKeyDerivation => '키 파생';

  @override
  String get settingsAboutKeyDerivationValue => 'HKDF-SHA256, 방향별 키';

  @override
  String get settingsAboutKeyExchange => '키 교환';

  @override
  String get settingsAboutKeyExchangeValue => 'X25519 임시 키';

  @override
  String get settingsAboutIdentity => 'ID';

  @override
  String get settingsAboutIdentityValue => 'Ed25519 서명';

  @override
  String get settingsAboutReplayProtection => '재전송 방지';

  @override
  String get settingsAboutReplayProtectionValue => '단조 증가 카운터';

  @override
  String get settingsAboutCacheKey => '휴대폰 캐시 키';

  @override
  String get settingsAboutCacheKeyValue => '플랫폼 보안 저장소로 보호';

  @override
  String get settingsAboutEncryptionNote =>
      '이 내용은 **페어링된 기기 모드**에 대한 설명이에요. DJL Cloud는 별도의 서비스이며 계정 방식으로 작동해요.';

  @override
  String get settingsAboutGit => 'Git 및 작업 공간';

  @override
  String get settingsAboutGitIntro => '브리지는 페어링된 기기에서 Git 명령을 로컬로 처리해요:';

  @override
  String get settingsAboutGitRevert =>
      'DJL은 **작업 공간 되돌리기**도 지원해요. 어시스턴트의 변경 사항을 취소하고 싶을 때 역방향 패치를 미리 보고 적용할 수 있어요. 변경 사항을 적용하기 전에 확인 내용을 검토하세요.';

  @override
  String get settingsAboutResilience => '연결 안정성';

  @override
  String get settingsAboutReconnect => '자동 재연결은 제한된 백오프를 사용해요.';

  @override
  String get settingsAboutReplay =>
      '암호화된 재생 커서로 놓친 이벤트를 복구해요. 결과가 불확실한 작업은 연결이 끊긴 뒤 몰래 다시 보내지 않아요.';

  @override
  String get settingsAboutRuntimeDrop => '휴대폰 연결이 잠시 끊겨도 런타임은 계속 작업할 수 있어요.';

  @override
  String get settingsAboutShutdown =>
      '브리지는 `SIGINT`와 `SIGTERM`을 받으면 깔끔하게 종료돼요.';

  @override
  String get settingsAboutDesktop => '데스크톱 앱 연동';

  @override
  String get settingsAboutDesktopRollout =>
      'Codex는 휴대폰 스레드를 페어링된 기기에 세션 롤아웃 파일로 저장해요.';

  @override
  String get settingsAboutDesktopHandoff =>
      '데스크톱 앱은 외부에서 기록한 내용을 실시간으로 다시 불러오지 않을 수 있어요. 현재 스레드를 넘기려면 DJL에서 **데스크톱에서 계속하기**를 사용하세요.';

  @override
  String get settingsAboutDjl => 'DJL 정보';

  @override
  String get settingsOpenSource => '오픈 소스';

  @override
  String get settingsMitLicense => 'MIT 라이선스';

  @override
  String get hostYourMac => '내 Mac';

  @override
  String get hostUpdating => 'Mac에서 DJL을 업데이트하는 중이에요. 완료되면 이 휴대폰이 다시 연결돼요.';

  @override
  String get hostCheckingVersion => 'Mac의 DJL 버전 확인 중…';

  @override
  String hostNowVersion(String version) {
    return 'Mac의 DJL이 $version 버전이 됐어요.';
  }

  @override
  String hostStillVersion(String version) {
    return 'Mac의 DJL은 아직 $version 버전이에요. 이미 최신 버전일 수 있어요.';
  }

  @override
  String get hostConnectedFooter => '채팅은 종단 간 암호화되어 Mac의 DJL로 바로 전달돼요.';

  @override
  String get hostReconnectFooter => '다시 연결하려면 Mac에서 DJL을 여세요.';

  @override
  String get hostDjlVersion => 'DJL 버전';

  @override
  String get hostCheckFailedNow => '지금은 Mac을 확인할 수 없어요.';

  @override
  String get hostReconnecting => '다시 연결 중…';

  @override
  String get hostWakeScreen => '화면 깨우기';

  @override
  String get hostWakeScreenDetail => 'DJL이 실행 중일 때 Mac 디스플레이를 켜요.';

  @override
  String get hostKeepAwake => 'Mac 잠자기 방지';

  @override
  String get hostKeepAwakeDetail =>
      'DJL이 열려 있는 동안 Mac이 잠자기 상태가 되지 않게 해요. 충전 중일 때 사용하는 게 좋아요.';

  @override
  String get hostUpdates => '업데이트';

  @override
  String get hostUpdateDjl => 'DJL 업데이트';

  @override
  String get hostUpdateDjlDetail => 'Mac에 최신 DJL을 설치한 뒤 다시 연결해요.';

  @override
  String get hostNotConnected => '연결 안 됨';

  @override
  String get hostConnectedChecking => '연결됨 · 확인 중';

  @override
  String get hostConnected => '연결됨';

  @override
  String hostStatusLabel(String status) {
    return 'Mac의 DJL, $status';
  }

  @override
  String get hostDjlOnYourMac => 'Mac의 DJL';

  @override
  String get hostUpdateTitle => 'Mac의 DJL을 업데이트할까요?';

  @override
  String hostUpdateCurrent(String version) {
    return 'Mac에 DJL $version 버전이 설치돼 있어요.';
  }

  @override
  String get hostUpdateBody =>
      '최신 버전을 설치하기 위해 Mac에서 DJL이 다시 시작돼요. 이 휴대폰은 잠시 연결이 끊겼다가 자동으로 다시 연결돼요.';

  @override
  String get hostUpdate => '업데이트';

  @override
  String get hostContinueOnDesktop => '데스크톱에서 계속하기';

  @override
  String get hostContinueTitle => '데스크톱에서 계속할까요?';

  @override
  String get hostContinueBody => 'Mac의 DJL에서 이 채팅을 열어요.';

  @override
  String get hostContinue => '계속';

  @override
  String get hostActionFinished => '호스트 작업을 완료했어요.';

  @override
  String get hostErrorUnsupported =>
      'Mac의 DJL에서는 아직 이 기능을 사용할 수 없어요. Mac에서 DJL을 업데이트하세요.';

  @override
  String get hostErrorRefused => 'Mac에서 요청을 거부했어요. Mac의 DJL을 확인하고 다시 시도하세요.';

  @override
  String get hostErrorUncertain => '제대로 처리됐는지 알 수 없어요. 다시 시도하기 전에 Mac을 확인하세요.';

  @override
  String get hostCheckFailed => 'Mac을 확인하지 못했어요. 다시 시도하세요.';

  @override
  String get hostCheckingFirst => '먼저 Mac을 확인하는 중이에요. 잠시 후 다시 시도하세요.';

  @override
  String get hostConnectFirst => '먼저 Mac에 연결하세요.';

  @override
  String get hostNotConfirmed => 'Mac에서 확인하지 않았어요. 다시 시도하기 전에 Mac을 확인하세요.';

  @override
  String get hostOpenedOnMac => 'Mac의 DJL에서 열었어요.';

  @override
  String get hostReconnectFirst => '먼저 Mac에 다시 연결하세요.';

  @override
  String get hostReachFailed =>
      'Mac의 DJL에 연결할 수 없어요. DJL이 열려 있는지 확인하고 다시 시도하세요.';

  @override
  String get hostWaking => 'Mac 화면을 깨우고 있어요.';

  @override
  String get hostPrefReadFailed => '저장된 설정을 읽지 못했어요. 다시 시도하세요.';

  @override
  String get hostPrefSaveFailed => '이 설정을 저장하지 못했어요. 이전 선택은 그대로예요. 다시 시도하세요.';

  @override
  String get hostPrefUnconfirmed => '이 휴대폰에는 저장했지만 Mac에서 아직 확인하지 않았어요.';

  @override
  String get pushTitle => '푸시 알림';

  @override
  String get pushUnsupported =>
      '이 휴대폰은 아직 DJL 푸시 알림을 받을 수 없어요. 에이전트가 작업을 마쳤는지 보려면 DJL을 여세요.';

  @override
  String get pushDenied => '휴대폰 설정에서 DJL 알림이 꺼져 있어요.';

  @override
  String get pushReady => '에이전트가 작업을 마치거나 답이 필요할 때 알림을 받아요.';

  @override
  String get pushSimulator => '이 시뮬레이터에서는 푸시 알림을 받을 수 없어요.';

  @override
  String get pushUnavailableVersion => '이 버전에서는 푸시 알림을 사용할 수 없어요.';

  @override
  String get pushFailed => '알림을 켜지 못했어요. 온라인 상태에서 다시 시도하세요.';

  @override
  String get pushUnavailableNow => '지금은 푸시 알림을 사용할 수 없어요.';

  @override
  String get pushReadFailed => '알림 설정을 읽지 못했어요. 다시 시도하세요.';

  @override
  String get pushUpdateFailed => '알림 설정을 업데이트하지 못했어요. 다시 시도하세요.';

  @override
  String get whatsNewTitle => '새로운 기능';

  @override
  String get whatsNewIntro => 'DJL의 새로운 기능을 소개해요.';

  @override
  String get whatsNewOnce => '앱 버전마다 한 번만 보여 드려요.';

  @override
  String get whatsNewGotIt => '확인';

  @override
  String get whatsNewDismiss => '릴리스 노트 닫기';

  @override
  String get whatsNew100Design => '더 차분해진 흑백 디자인.';

  @override
  String get whatsNew100Groups => '그룹 채팅: 여러 에이전트와 동시에 대화하고 실시간으로 답변을 확인하세요.';

  @override
  String get whatsNew100Files => '그룹 채팅에서 파일과 사진을 보낼 수 있어요.';

  @override
  String get whatsNew100Mac => '채팅이 Mac의 DJL로 바로 전달돼요.';

  @override
  String get accountSomethingWrong => '문제가 발생했어요';

  @override
  String get accountTypeDeleteToConfirm => '확인하려면 DELETE를 입력하세요.';

  @override
  String get accountOk => '확인';

  @override
  String get accountDone => '완료';

  @override
  String get accountEmail => '이메일';

  @override
  String get accountPlan => '요금제';

  @override
  String get accountCredits => '크레딧';

  @override
  String get accountUsageFooter =>
      '적립된 초기화를 사용하면 두 한도가 모두 처음부터 다시 시작되고 한 주도 새로 시작돼요. 적립된 초기화는 받은 날로부터 90일 후 만료돼요.';

  @override
  String get accountFiveHourLimit => '5시간 한도';

  @override
  String get accountWeeklyLimit => '주간 한도';

  @override
  String get accountBankedResets => '적립된 초기화';

  @override
  String accountNextExpires(String date, String year) {
    return '다음 만료: $year년 $date';
  }

  @override
  String get accountNone => '없음';

  @override
  String accountUseOne(int count) {
    return '$count개 중 1개 사용';
  }

  @override
  String get accountDeleteFooter =>
      '계정을 삭제하면 채팅, 파일, 크레딧이 모두 삭제돼요. 30일 안에 지원팀에 연락하면 취소할 수 있어요.';

  @override
  String get accountSignOut => '로그아웃';

  @override
  String get accountDelete => '계정 삭제';

  @override
  String accountUsedPercent(int percent) {
    return '$percent% 사용함';
  }

  @override
  String get accountResetsNow => '지금 초기화';

  @override
  String get accountResetsTomorrow => '내일 초기화';

  @override
  String get accountResetsYesterday => '어제 초기화됨';

  @override
  String get accountResetsNextWeek => '다음 주 초기화';

  @override
  String get accountResetsLastWeek => '지난주 초기화됨';

  @override
  String accountResetsIn(String quantity) {
    return '$quantity 후 초기화';
  }

  @override
  String accountResetsAgo(String quantity) {
    return '$quantity 전 초기화됨';
  }

  @override
  String accountSeconds(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count초',
    );
    return '$_temp0';
  }

  @override
  String accountMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count분',
    );
    return '$_temp0';
  }

  @override
  String accountHours(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count시간',
    );
    return '$_temp0';
  }

  @override
  String accountDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count일',
    );
    return '$_temp0';
  }

  @override
  String accountWeeks(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count주',
    );
    return '$_temp0';
  }

  @override
  String get accountDeleteTitle => '계정을 삭제할까요?';

  @override
  String get accountDeleteBody => '30일이 지나면 되돌릴 수 없어요. 확인하려면 DELETE를 입력하세요.';

  @override
  String get accountTypeDelete => 'DELETE 입력';

  @override
  String get accountSignOutTitle => 'DJL Cloud에서 로그아웃할까요?';

  @override
  String get notificationsTitle => '알림';

  @override
  String get notificationsMarkAllRead => '모두 읽음으로 표시';

  @override
  String get notificationsCaughtUp => '모두 확인했어요';

  @override
  String get notificationsEmptyHint => '완료된 작업이 여기에 표시돼요.';

  @override
  String get notificationsTaskComplete => '작업 완료';

  @override
  String get notificationsLoadMore => '더 보기';

  @override
  String notificationsStatus(String status) {
    String _temp0 = intl.Intl.selectLogic(status, {
      'succeeded': '성공',
      'failed': '실패',
      'other': '$status',
    });
    return '$_temp0';
  }

  @override
  String get notificationsTaskStopped => '작업 중지됨';

  @override
  String get notificationsTaskFinished => '작업 종료';

  @override
  String get notificationsOpenResult => 'DJL을 열어 결과를 확인하세요';

  @override
  String get notificationsDismiss => '알림 닫기';

  @override
  String get reportOffensive => '불쾌하거나 혐오스러운 내용';

  @override
  String get reportHarmful => '해롭거나 위험한 내용';

  @override
  String get reportWrong => '틀리거나 오해의 소지가 있는 내용';

  @override
  String get reportOther => '기타';

  @override
  String get reportThanks => '감사합니다. 이 답변을 검토할게요.';

  @override
  String get reportTitle => '이 답변 신고';

  @override
  String get reportRateLimited => '지금은 신고가 너무 많아요. 나중에 다시 시도하세요.';

  @override
  String get reportFailed => '신고를 보내지 못했어요. 다시 시도하세요.';

  @override
  String get reportIntro => 'DJL은 안전한 답변을 위해 신고 내용을 검토해요. 어떤 문제가 있나요?';

  @override
  String get reportDetailsHint => '자세한 내용 추가 (선택)';

  @override
  String get reportSending => '보내는 중…';

  @override
  String get reportSend => '신고 보내기';

  @override
  String get attachmentsNoApp => '이 파일을 열 수 있는 앱이 없어요. 보낼 앱을 선택하세요.';

  @override
  String get attachmentsOpenFailed => '이 파일을 열 수 없어요';

  @override
  String get attachmentsCheckMac => 'Mac이 연결돼 있는지 확인한 뒤 다시 시도하세요.';

  @override
  String get attachmentsImageUnshowable => '이 이미지는 여기에서 표시할 수 없어요';

  @override
  String get attachmentsOpenElsewhere => '다른 앱에서 열기';

  @override
  String get attachmentsOpen => '열기';

  @override
  String get attachmentsShare => '공유';

  @override
  String get imagesSquare => '정사각형';

  @override
  String get imagesLandscape => '가로';

  @override
  String get imagesPortrait => '세로';

  @override
  String get imagesOnePerRequest =>
      '요청당 이미지 1장을 만들어요. DJL이 작업하는 동안 채팅을 나가도 괜찮아요.';

  @override
  String get imagesCreate => '이미지 만들기';

  @override
  String get imagesMakeYours => '나만의 이미지를 만들어 보세요.';

  @override
  String get imagesDescribe => '생각하는 대상, 스타일, 세부 사항을 설명해 주세요.';

  @override
  String get imagesPromptHint => '아침 햇살이 드는 조용한 작업실…';

  @override
  String get imagesShape => '비율';

  @override
  String get imagesNotConfigured =>
      '이 서버에는 아직 이미지 생성이 설정되지 않았어요. 저장된 이미지는 계속 볼 수 있어요.';

  @override
  String get imagesStarting => '시작 중…';

  @override
  String get imagesOpenImage => '이미지 열기';

  @override
  String get imagesGenerated => '생성된 이미지';

  @override
  String get imagesOpenChat => '채팅 열기';

  @override
  String get imagesActions => '이미지 작업';

  @override
  String get imagesEditInChat => '채팅에서 편집';

  @override
  String get imagesTitle => '이미지';

  @override
  String get imagesYourImages => '내 이미지';

  @override
  String get imagesEmpty => '이미지를 만들면 여기에서 저장하거나 공유할 수 있어요.';

  @override
  String get imagesEmptyNotConfigured =>
      '아직 이미지 생성이 설정되지 않았어요. 저장된 이미지가 여기에 표시돼요.';

  @override
  String get imagesLoadMore => '더 보기';

  @override
  String get imagesYourImage => '내 이미지';

  @override
  String get imagesShare => '공유';

  @override
  String get imagesSaveToPhotos => '사진에 저장';

  @override
  String get imagesSaved => '사진에 저장했어요.';

  @override
  String get authSocialNotConfigured => '이 앱에는 소셜 로그인이 설정되지 않았어요. 이메일로 계속하세요.';

  @override
  String get authSocialOpenFailed => '로그인 화면을 열지 못했어요. 다시 시도하세요.';

  @override
  String get authSignInOptionsFailed => '로그인 옵션을 불러오지 못했어요.';

  @override
  String get authCloudSignInFailed => 'DJL Cloud에 로그인하지 못했어요. 다시 시도하세요.';

  @override
  String get authSecureStorageFailed =>
      '보안 저장소를 열지 못했어요. 기기 잠금을 해제하고 다시 시도하세요.';

  @override
  String get authCheckEmailForCode => '이메일에서 인증 코드를 확인하세요.';

  @override
  String get authRequestSent => '요청을 보냈어요. 이메일을 확인하세요.';

  @override
  String get authCloudDataNotCleared => '저장된 Cloud 데이터 일부를 지우지 못했어요.';

  @override
  String get authLinkOpenFailed => '이 링크를 열지 못했어요. 다시 시도하세요.';

  @override
  String get authWelcomeTitle => 'DJL에 오신 것을 환영해요';

  @override
  String get authWelcomeSubtitle => '아이디어, 대화, 그리고 Mac.\nDJL에서 함께.';

  @override
  String get authRetrySignInOptions => '로그인 옵션 다시 불러오기';

  @override
  String get authLoadingSignInOptions => '로그인 옵션 불러오는 중';

  @override
  String get authContinueWithApple => 'Apple로 계속하기';

  @override
  String get authContinueWithGoogle => 'Google로 계속하기';

  @override
  String get authContinueWithEmail => '이메일로 계속하기';

  @override
  String get authPairWithMac => 'Mac과 페어링';

  @override
  String get authNoMacHint => 'Mac이 없나요? 로그인하고 DJL Cloud로 채팅하세요.';

  @override
  String get authTerms => '약관';

  @override
  String get authPrivacy => '개인정보';

  @override
  String get authVerifyAndContinue => '인증하고 계속하기';

  @override
  String get authSignIn => '로그인';

  @override
  String get authEmailMeCode => '이메일로 코드 받기';

  @override
  String get authCreateAccount => '계정 만들기';

  @override
  String get authSignInIncomplete => '로그인을 완료하지 못했어요. 다시 시도하세요.';

  @override
  String get authPassword => '비밀번호';

  @override
  String get authEmailCode => '이메일 코드';

  @override
  String get authName => '이름';

  @override
  String get authEmail => '이메일';

  @override
  String get authSixDigitCode => '6자리 코드';

  @override
  String authCodeSent(String email) {
    return '$email(으)로 코드를 보냈어요. 코드는 10분 후 만료돼요.';
  }

  @override
  String get authCreateAccountHint => '10자 이상 입력하세요. 이메일 주소 확인용 코드를 보내 드려요.';

  @override
  String get authResendCode => '코드 다시 보내기';

  @override
  String authResendIn(int seconds) {
    return '$seconds초 후 다시 보내기';
  }

  @override
  String get authUseAnotherEmail => '다른 이메일 사용';

  @override
  String get authForgotPassword => '비밀번호를 잊으셨나요?';

  @override
  String get authResetPassword => '비밀번호 재설정';

  @override
  String get authPasswordUpdated => '비밀번호를 변경했어요';

  @override
  String get authSignInWithNewPassword => '새 비밀번호로 로그인하세요.';

  @override
  String get authBackToSignIn => '로그인으로 돌아가기';

  @override
  String get authNewPassword => '새 비밀번호';

  @override
  String get authRecoveryHint => '이 이메일로 가입된 계정이 있으면 복구 코드를 보내 드려요.';

  @override
  String get authRecoveryCodeHint => '복구 코드와 10–256자의 새 비밀번호를 입력하세요.';

  @override
  String get authSendRecoveryCode => '복구 코드 보내기';

  @override
  String get chatUiWorktreeHandoffFailed => '작업 트리로 넘기기 실패';

  @override
  String get chatUiOk => '확인';

  @override
  String get chatUiSelectFolder => '폴더 선택';

  @override
  String get chatUiBrowseFolders => '로컬 폴더 찾아보기…';

  @override
  String get chatUiBranchOpenElsewhere => '다른 곳에서 열려 있는 브랜치';

  @override
  String chatUiBranchOpenElsewhereChat(String branch) {
    return '‘$branch’ 브랜치는 이미 다른 작업 트리에 체크아웃돼 있어요. 해당 채팅을 열어 이어서 작업하세요.';
  }

  @override
  String chatUiBranchOpenElsewhereSidebar(String branch) {
    return '‘$branch’ 브랜치는 이미 다른 작업 트리에 체크아웃돼 있어요. 사이드바에서 해당 채팅을 열어 이어서 작업하세요.';
  }

  @override
  String get chatUiOpenChat => '채팅 열기';

  @override
  String get chatUiWorktreeChatGone => '작업 트리 채팅을 더 이상 사용할 수 없어요. 사이드바에서 여세요.';

  @override
  String get chatUiPhotoLibrary => '사진 보관함';

  @override
  String get chatUiTakePhoto => '사진 찍기';

  @override
  String get chatUiPlanMode => '계획 모드';

  @override
  String get chatUiFastMode => '빠른 모드';

  @override
  String get chatUiImage => '이미지';

  @override
  String get chatUiOpensThreadLocation => '스레드 위치를 열어요';

  @override
  String get chatUiDesktopChat => '데스크톱 채팅';

  @override
  String get chatUiNewThread => '새 스레드';

  @override
  String get chatUiHandOffToDesktop => '데스크톱으로 넘기기';

  @override
  String get chatUiHandOffToLocal => '로컬로 넘기기';

  @override
  String get chatUiHandOffToWorktree => '작업 트리로 넘기기';

  @override
  String get chatUiGoal => '목표';

  @override
  String get chatUiForkChat => '이 채팅 포크';

  @override
  String get chatUiForkIntoFolder => '다른 폴더로 포크';

  @override
  String get chatUiForkIntoWorktree => '새 작업 트리로 포크';

  @override
  String get chatUiWorkspaceFiles => '작업 공간 파일';

  @override
  String get chatUiTurnChanges => '턴별 변경 사항 및 복원';

  @override
  String get chatUiRefreshFromDesktop => '데스크톱에서 새로고침';

  @override
  String get chatUiDesktopDisconnected => '데스크톱 연결이 끊겼어요. 메시지는 다시 보내지 않았어요.';

  @override
  String get chatUiLinkedPositionUnavailable => '불러온 기록에서 링크된 위치를 찾을 수 없어요.';

  @override
  String get chatUiReviewResponseChanges => '응답의 정확한 변경 사항 검토';

  @override
  String get chatUiResponseUndone => '응답을 실행 취소했어요';

  @override
  String get chatUiUndoResponse => '이 응답 실행 취소';

  @override
  String get chatUiApprovalRequired => '승인 필요';

  @override
  String get chatUiApprovalSent => '응답을 보냈어요. 데스크톱을 기다리는 중이에요.';

  @override
  String get chatUiDecline => '거절';

  @override
  String get chatUiApproveOnce => '한 번 승인';

  @override
  String get chatUiBranch => '브랜치';

  @override
  String get chatUiPreparingWorktree => '작업 트리 준비 중...';

  @override
  String get chatUiNewWorktree => '새 작업 트리';

  @override
  String chatUiGoalChip(String status, String elapsed) {
    return '목표 $status · $elapsed';
  }

  @override
  String get chatUiReturnToParent => '상위 채팅으로 돌아가기';

  @override
  String chatUiReturnTo(String title) {
    return '$title(으)로 돌아가기';
  }

  @override
  String get chatUiAskDjl => 'DJL에게 물어보기';

  @override
  String get chatUiFollowUp => '후속 질문';

  @override
  String get workspaceRestoreFailed =>
      '데스크톱이 복원을 확인하지 않았어요. 다시 시도하기 전에 새로고침하세요.';

  @override
  String workspaceRestoredFiles(int count) {
    return '파일 $count개를 복원했어요.';
  }

  @override
  String get workspaceBackupSaved => ' Mac에 백업 체크포인트를 저장했어요.';

  @override
  String get workspaceNoLocalFolders => '이 기기에서 사용할 수 있는 로컬 폴더가 없어요.';

  @override
  String get workspaceUndoReviewChanged => '응답이나 연결이 바뀌었어요. 이 검토를 다시 여세요.';

  @override
  String get workspaceUndoPreviewFailed =>
      '정확한 패치를 미리 볼 수 없어요. 다시 시도하기 전에 검토를 새로고침하세요.';

  @override
  String get workspaceUndoRepositoryChanged => '응답이나 저장소가 바뀌었어요. 이 검토를 다시 여세요.';

  @override
  String get workspaceUndoResultUnknownChanged =>
      '연결이나 응답이 바뀌었어요. 실행 취소 결과를 알 수 없으니 새로고침하고 검토하세요.';

  @override
  String get workspaceUndoRefused =>
      '데스크톱이 응답을 실행 취소하지 않았어요. 현재 충돌과 스테이징된 파일을 검토하세요.';

  @override
  String get workspaceUndoResultUnknown =>
      '실행 취소 결과를 알 수 없어요. 다시 시도하기 전에 새로고침하고 정확한 패치를 검토하세요.';

  @override
  String get workspaceUndoSaveAfterSuccessFailed =>
      '실행 취소는 완료됐지만 로컬 결과를 저장하거나 새로고침하지 못했어요. 다시 연결해서 파일을 확인하세요.';

  @override
  String get workspaceUndoSaveFailed =>
      '실행 취소 결과를 저장하지 못했어요. 다시 연결하고 현재 파일을 검토하세요.';

  @override
  String get workspaceUndoTitle => '이 응답 실행 취소';

  @override
  String workspaceUndoWorkspace(String path) {
    return '작업 공간: $path';
  }

  @override
  String get workspaceUndoIntro =>
      '이 응답의 정확한 변경 사항을 검토하세요. 역방향 패치를 적용할 수 있는 곳에서는 이후 편집 내용이 그대로 유지돼요. 확인하면 데스크톱이 충돌을 다시 검사해요.';

  @override
  String get workspaceUndoOverlap =>
      '다른 응답도 이 파일들을 수정했어요. 실행 취소가 이 채팅이나 다른 채팅의 변경 사항과 겹칠 수 있으니 신중하게 검토하세요.';

  @override
  String get workspaceUndoUncertain =>
      '이전 실행 취소 결과를 알 수 없어요. 다시 시도하기 전에 이 검토를 새로고침하고 현재 파일을 확인하세요.';

  @override
  String get workspaceUndoStale => '이 검토는 더 이상 최신이 아니에요. 닫고 응답을 다시 여세요.';

  @override
  String get workspaceUndoDone => '이 응답을 실행 취소했어요.';

  @override
  String workspaceUndoStagedBlock(String files) {
    return '스테이징된 파일 때문에 실행 취소할 수 없어요: $files';
  }

  @override
  String workspaceUndoConflict(String conflict) {
    return '충돌: $conflict';
  }

  @override
  String get workspaceUndoCannotReverse => '데스크톱에서 이 패치를 안전하게 되돌릴 수 없어요.';

  @override
  String get workspaceClose => '닫기';

  @override
  String get workspaceRefreshReview => '검토 새로고침';

  @override
  String get workspaceUndoResponse => '응답 실행 취소';

  @override
  String get workspaceConflictFallback => '충돌';

  @override
  String get workspaceAlreadyUndone => '이미 실행 취소한 응답이에요.';

  @override
  String get workspaceStillRunning => '이 응답은 아직 실행 중이에요.';

  @override
  String get workspaceNoDesktopWorkspace => '이 응답에는 데스크톱 작업 공간이 없어요.';

  @override
  String get workspaceNoPatchCaptured => '지원되는 응답 패치가 기록되지 않았어요.';

  @override
  String get workspaceRestoreTitle => '이 턴 이전으로 작업 공간을 복원할까요?';

  @override
  String get workspaceRestoreBody =>
      '현재 작업 공간 파일을 바꾸고 추적되지 않는 파일을 삭제해요. 복원하기 전에 영향을 받는 파일을 검토하세요. Mac이 먼저 백업 체크포인트를 저장해요.';

  @override
  String get workspaceNoAffectedFiles => '영향을 받는 파일이 없어요.';

  @override
  String get workspaceStagedFiles => '스테이징된 파일';

  @override
  String get workspaceUntrackedFiles => '추적되지 않는 파일';

  @override
  String get workspaceRestoreFiles => '파일 복원';

  @override
  String get workspaceTurnChanges => '턴별 변경 사항';

  @override
  String get workspaceReloadTurnChanges => '턴별 변경 사항 새로고침';

  @override
  String get workspaceConversationTurn => '대화 턴';

  @override
  String workspaceTurnNumber(int number) {
    return '$number번째 턴';
  }

  @override
  String get workspaceNoSavedChanges => '이 턴에 저장된 변경 사항이 없어요.';

  @override
  String get workspaceNoCompletedTurns => '아직 완료된 턴이 없어요.';

  @override
  String get workspaceChooseTurn => '턴을 선택하면 저장된 작업 공간 변경 사항을 볼 수 있어요.';

  @override
  String get workspaceStopBeforeRestore => '파일을 복원하기 전에 실행 중인 턴을 중지하세요.';

  @override
  String get workspacePreviewRestore => '이 턴 이전으로 복원 미리 보기';

  @override
  String get workspaceFileFallbackTitle => '작업 공간 파일';

  @override
  String get workspaceCopyFileContents => '파일 내용 복사';

  @override
  String get workspaceFileContentsCopied => '파일 내용을 복사했어요.';

  @override
  String get workspaceReloadFile => '파일 새로고침';

  @override
  String get workspaceFilePathOnMac => 'Mac의 파일 경로';

  @override
  String get workspaceSegmentText => '텍스트';

  @override
  String get workspaceSegmentImage => '이미지';

  @override
  String get workspaceOpen => '열기';

  @override
  String get workspaceSvgRenderFailed => '이 SVG를 표시할 수 없어요.';

  @override
  String get workspaceImageRenderFailed => '이 기기에서는 이 이미지 형식을 표시할 수 없어요.';

  @override
  String get workspaceOpenFileToPreview => '미리 보려면 작업 공간 파일을 여세요.';

  @override
  String get workspaceSavedToPhotos => '사진에 저장했어요.';

  @override
  String get workspaceImageTitle => '이미지';

  @override
  String get workspaceOk => '확인';

  @override
  String get workspaceLoadingFile => '파일 불러오는 중';

  @override
  String get workspaceUnableToLoadFile => '파일을 불러올 수 없어요.';

  @override
  String get workspaceRetry => '다시 시도';

  @override
  String get workspaceCloseFilePreview => '파일 미리보기 닫기';

  @override
  String get workspaceDone => '완료';

  @override
  String get workspaceFindInFile => '파일에서 찾기';

  @override
  String workspaceLineCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count줄',
    );
    return '$_temp0';
  }

  @override
  String workspaceByteCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count바이트',
    );
    return '$_temp0';
  }

  @override
  String get workspaceCloseSvgPreview => 'SVG 미리보기 닫기';

  @override
  String get workspaceReloadSvgPreview => 'SVG 미리보기 새로고침';

  @override
  String get workspaceShare => '공유';

  @override
  String get workspaceSaveToPhotos => '사진에 저장';

  @override
  String get workspaceUnableToDisplayImage => '이미지를 표시할 수 없어요.';

  @override
  String get workspaceFileContents => '파일 내용';

  @override
  String get workspaceSearching => '검색 중…';

  @override
  String workspaceMatchPosition(int index, int total) {
    return '$index/$total';
  }

  @override
  String get workspacePreviousMatch => '이전 결과';

  @override
  String get workspaceNextMatch => '다음 결과';

  @override
  String get workspaceCloseFind => '찾기 닫기';

  @override
  String get workspaceAddLocalFolder => '로컬 폴더 추가';

  @override
  String get workspaceCreateFolderOnMac => 'Mac에 폴더 만들기';

  @override
  String get workspaceUse => '사용';

  @override
  String get workspaceParentFolder => '상위 폴더';

  @override
  String get workspaceSearchingFolders => '폴더 검색 중...';

  @override
  String get workspaceLoading => '불러오는 중';

  @override
  String get workspaceNoMatchingFolders => '이 폴더 아래에 일치하는 폴더가 없어요.';

  @override
  String get workspaceNoChildFolders => '하위 폴더가 없어요.';

  @override
  String get workspaceSearchFolders => '폴더 검색';

  @override
  String get workspaceClearFolderSearch => '폴더 검색 지우기';

  @override
  String get workspaceLocations => '위치';

  @override
  String get workspaceCurrentFolder => '현재 폴더';

  @override
  String get workspaceLoadingFolders => '폴더 불러오는 중...';

  @override
  String get workspaceNoFolderSelected => '선택한 폴더가 없어요.';

  @override
  String get workspaceMatchingFolders => '일치하는 폴더';

  @override
  String get workspaceFolders => '폴더';

  @override
  String get workspaceNewFolder => '새 폴더';

  @override
  String get workspaceNewFolderBody => '기기에 이 폴더를 만들고 그곳에서 채팅을 시작해요.';

  @override
  String get workspaceFolderName => '폴더 이름';

  @override
  String get workspaceCreate => '만들기';

  @override
  String get workspaceDesktopChangedPicker =>
      '연결된 데스크톱이 바뀌었어요. 프로젝트 선택을 다시 여세요.';

  @override
  String get workspaceDesktopChanged => '연결된 데스크톱이 바뀌었어요. 이 작업 공간을 다시 여세요.';

  @override
  String get workspaceChooseWorkspaceFirst => '먼저 데스크톱에서 작업 공간을 선택하세요.';

  @override
  String get workspaceNoTextInPreview => '파일 미리보기에 텍스트가 없어요. 작업 공간에서 다시 불러오세요.';

  @override
  String get workspaceNoImageInPreview =>
      '이미지 미리보기에 이미지 데이터가 없어요. 작업 공간에서 다시 불러오세요.';

  @override
  String get workspaceRestorePreviewOtherWorkspace =>
      '이 복원 미리보기는 다른 작업 공간의 것이에요. 다시 미리 보세요.';

  @override
  String get cloudChatNewChat => '새 채팅';

  @override
  String get cloudChatLostConnection => '연결이 끊겼어요. 다시 연결을 눌러 이 응답을 이어서 받으세요.';

  @override
  String get cloudChatImageToEdit => '편집할 이미지';

  @override
  String get cloudChatNoContent => '응답 내용이 없어요.';

  @override
  String get cloudChatThinking => '생각 중…';

  @override
  String get cloudChatResponseStopped => '응답을 중지했어요.';

  @override
  String get cloudChatResponseFailed => '응답에 실패했어요.';

  @override
  String get cloudChatWaitingForUsageReset => '사용량 초기화를 기다리는 중이에요.';

  @override
  String get cloudChatModelChoiceLoadFailed =>
      '저장된 모델 선택을 불러오지 못했어요. 다시 시도하세요.';

  @override
  String get cloudChatModelChoiceSaveFailed => '모델 선택을 저장하지 못했어요. 다시 시도하세요.';

  @override
  String get cloudChatDraftSaveFailed => '초안을 저장하지 못했어요. 텍스트는 그대로 두고 다시 시도하세요.';

  @override
  String get cloudChatDraftLoadFailed => '저장된 초안을 불러오지 못했어요. 편집하기 전에 다시 시도하세요.';

  @override
  String get cloudChatInterruptedImage =>
      '중단된 이미지 요청이 안전하게 저장돼 있어요. 다시 시도해서 결과를 확인하세요.';

  @override
  String get cloudChatInterruptedMessage =>
      '중단된 메시지가 안전하게 저장돼 있어요. 다시 시도해서 결과를 확인하세요.';

  @override
  String get cloudChatModelCannotViewImages =>
      '이 첨부 파일을 보내기 전에 이미지를 볼 수 있는 모델을 선택하세요.';

  @override
  String get cloudChatImageGenerationUnavailable =>
      '이 서비스에는 이미지 생성이 설정되지 않았어요.';

  @override
  String get cloudChatUseBankedResetTitle => '적립된 초기화를 사용할까요?';

  @override
  String get cloudChatUseBankedResetBody =>
      '5시간 한도와 주간 한도가 지금 모두 다시 시작되고, 한 주도 오늘부터 새로 시작돼요.';

  @override
  String get cloudChatUseReset => '초기화 사용';

  @override
  String get cloudChatLimitFreesSoon => '곧 한도가 다시 풀려요.';

  @override
  String get cloudChatResetsNow => '지금 초기화돼요.';

  @override
  String get cloudChatResetsTomorrow => '내일 초기화돼요.';

  @override
  String cloudChatResetsInDays(int days) {
    return '$days일 후 초기화돼요.';
  }

  @override
  String cloudChatResetsOn(String date) {
    return '$date에 초기화돼요.';
  }

  @override
  String get cloudChatResetsInAMoment => '잠시 후 초기화돼요.';

  @override
  String cloudChatResetsInMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '$minutes분 후 초기화돼요.',
    );
    return '$_temp0';
  }

  @override
  String cloudChatResetsInHours(int hours) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: '$hours시간 후 초기화돼요.',
    );
    return '$_temp0';
  }

  @override
  String get cloudChatUsageLimitReached => '사용 한도에 도달했어요';

  @override
  String get cloudChatRetryUsage => '사용량 다시 확인';

  @override
  String cloudChatUseBankedReset(int count) {
    return '적립된 초기화 사용 ($count개 남음)';
  }

  @override
  String get cloudChatPickerFailed => '선택 창을 열지 못했어요. 다시 시도해 주세요.';

  @override
  String get cloudChatModel => '모델';

  @override
  String get cloudChatShareLink => '링크 공유';

  @override
  String get cloudChatTaskPrompt => 'DJL이 어떤 작업을 할까요?';

  @override
  String get cloudChatHowCanIHelp => '무엇을 도와드릴까요?';

  @override
  String get cloudChatTaskHint => '작업을 시작하고, 준비되면 결과를 확인하러 돌아오세요.';

  @override
  String cloudChatStepProgress(String step, String total) {
    return '$total단계 중 $step단계';
  }

  @override
  String get cloudChatRetry => '다시 시도';

  @override
  String get cloudChatRetryDraft => '초안 다시 불러오기';

  @override
  String get cloudChatRetryModelChoice => '모델 선택 다시 불러오기';

  @override
  String get cloudChatMessageHint => 'DJL에게 메시지 보내기';

  @override
  String get cloudChatAttachTooltip => '파일 또는 이미지 첨부';

  @override
  String get cloudChatCreateImage => '이미지 만들기';

  @override
  String get cloudChatChooseFile => '파일 선택';

  @override
  String get cloudChatPhotoLibrary => '사진 보관함';

  @override
  String get cloudChatCamera => '카메라';

  @override
  String get cloudChatTaskMode => '작업 모드';

  @override
  String get cloudChatTask => '작업';

  @override
  String get cloudChatStopDictation => '받아쓰기 중지';

  @override
  String get cloudChatStartDictation => '받아쓰기 시작';

  @override
  String get cloudChatStopResponse => '응답 중지';

  @override
  String get cloudChatSendMessage => '메시지 보내기';

  @override
  String get cloudChatEditMessage => '메시지 편집';

  @override
  String get cloudChatSend => '보내기';

  @override
  String get cloudChatDisableWordWrap => '자동 줄바꿈 끄기';

  @override
  String get cloudChatEnableWordWrap => '자동 줄바꿈 켜기';

  @override
  String get cloudChatCopied => '복사됨';

  @override
  String get cloudChatCopyCode => '코드 복사';

  @override
  String get cloudChatCodeLabel => '코드';

  @override
  String get cloudChatEdit => '편집';

  @override
  String get cloudChatPreviousBranch => '이전 버전';

  @override
  String get cloudChatNextBranch => '다음 버전';

  @override
  String get cloudChatCopyMessage => '메시지 복사';

  @override
  String get cloudChatRegenerateReply => '답변 다시 생성';

  @override
  String get cloudChatStopReading => '읽기 중지';

  @override
  String get cloudChatReadAloud => '소리 내어 읽기';

  @override
  String get cloudChatReportAnswer => '이 답변 신고';

  @override
  String cloudChatToolResult(String name, String status) {
    return '$name · $status';
  }

  @override
  String get cloudChatToolFailed => '실패';

  @override
  String get cloudChatToolDone => '완료';

  @override
  String get cloudChatNeedsNewerVersion => '이 메시지에는 최신 버전이 필요한 콘텐츠가 있어요.';

  @override
  String get cloudChatImageUnavailableRetry => '이미지를 볼 수 없음 · 다시 시도';

  @override
  String get cloudChatConversationImage => '대화 이미지';

  @override
  String get cloudChatImageDisplayFailed => '이 이미지를 표시하지 못했어요.';

  @override
  String get cloudChatShareFailed => '공유를 열지 못했어요. 다시 시도하세요.';

  @override
  String get cloudChatShareLinkCreated => '공유 링크를 만들었어요';

  @override
  String get cloudChatShareLinkBody =>
      '링크가 있는 사람은 누구나 현재 상태의 채팅을 볼 수 있어요. 이후에 보내는 메시지는 공유되지 않아요.';

  @override
  String get cloudChatCopyLink => '링크 복사';

  @override
  String get cloudChatShare => '공유';

  @override
  String get conversationsPinned => '고정됨';

  @override
  String get conversationsPinnedEmpty => '채팅을 길게 누르면 고정할 수 있어요.';

  @override
  String get conversationsRecentEmpty => '대화가 여기에 표시돼요.';

  @override
  String get conversationsCloudConversationHint => '클라우드 대화';

  @override
  String get conversationsChat => '채팅';

  @override
  String get conversationsSearchChats => '채팅 검색';

  @override
  String get conversationsRemote => '원격';

  @override
  String get conversationsRecentChats => '최근 채팅';

  @override
  String get conversationsLoadMore => '더 보기';

  @override
  String get conversationsSettings => '설정';

  @override
  String get conversationsArchivedChats => '보관된 채팅';

  @override
  String get conversationsRestore => '복원';

  @override
  String get conversationsNoArchivedChats => '보관된 채팅이 없어요';

  @override
  String get conversationsPin => '고정';

  @override
  String get conversationsUnpin => '고정 해제';

  @override
  String get conversationsRename => '이름 변경';

  @override
  String get conversationsArchive => '보관';

  @override
  String get conversationsDelete => '삭제';

  @override
  String get conversationsDeleteChatQuestion => '이 채팅을 삭제할까요?';

  @override
  String get plansCompleted => '완료';

  @override
  String get plansInProgress => '진행 중';

  @override
  String get plansPending => '대기 중';

  @override
  String get plansOpenActivePlan => '진행 중인 계획 열기';

  @override
  String get plansPlan => '계획';

  @override
  String plansStepOf(int current, int total) {
    return '$total단계 중 $current단계';
  }

  @override
  String plansStepFraction(int current, int total) {
    return '$current/$total단계';
  }

  @override
  String plansStatusValue(String status, String position) {
    return '$status, $position';
  }

  @override
  String get plansImage => '이미지';

  @override
  String get plansActivePlan => '진행 중인 계획';

  @override
  String get plansDone => '완료';

  @override
  String get plansNoLongerAvailable => '이 계획은 더 이상 사용할 수 없어요.';

  @override
  String get plansProposedPlan => '제안된 계획';

  @override
  String get plansCollapsePlan => '계획 접기';

  @override
  String get plansExpandPlan => '계획 펼치기';

  @override
  String get plansCollapse => '접기';

  @override
  String get plansExpand => '펼치기';

  @override
  String get plansStarting => '시작 중...';

  @override
  String get plansImplement => '실행';

  @override
  String get plansNextStepQuestion => 'Codex가 다음에 무엇을 만들까요?';

  @override
  String get plansNextStepHeader => '다음 단계';

  @override
  String get voiceAllowMicrophone => '받아쓰기를 하려면 기기 설정에서 마이크와 음성 인식 접근을 허용하세요.';

  @override
  String get voiceDictationUnavailable =>
      '이 언어나 기기에서는 기기 내 받아쓰기를 사용할 수 없어요. 메시지는 직접 입력할 수 있어요.';

  @override
  String get voiceSpeechAccessRequired =>
      '기기 설정에서 마이크와 음성 인식 접근을 허용하세요. 사용하는 언어의 기기 내 음성 인식을 사용할 수 있어야 해요.';

  @override
  String get voiceInputUnavailable => '음성 입력을 사용할 수 없어요. 메시지는 직접 입력할 수 있어요.';

  @override
  String get voiceStopFailed => '음성 입력을 중지하지 못했어요.';

  @override
  String get voicePlaybackUnavailable => '이 기기에서는 음성 재생을 사용할 수 없어요.';

  @override
  String get voiceStopUnclean => '음성이 제대로 멈추지 않았어요. 계속하기 전에 이 화면을 닫으세요.';

  @override
  String get goalsStatusActive => '진행 중';

  @override
  String get goalsStatusPaused => '일시 중지됨';

  @override
  String get goalsStatusBlocked => '막힘';

  @override
  String get goalsStatusUsageLimited => '사용량 한도';

  @override
  String get goalsStatusBudgetLimited => '예산 한도';

  @override
  String get goalsStatusComplete => '완료';

  @override
  String goalsTokenUsage(String used, String budget) {
    return '$used / $budget 토큰';
  }

  @override
  String get goalsUnsupported =>
      '이 런타임에서는 목표를 사용할 수 없어요. Mac에서 Codex를 업데이트하고 목표를 켜세요.';

  @override
  String get goalsEphemeral => '목표를 쓰려면 저장된 채팅이 필요해요. 이 채팅은 임시 채팅이에요.';

  @override
  String get goalsDesktopChanged => '연결된 데스크톱이 바뀌었어요. 이 목표를 다시 여세요.';

  @override
  String get goalsOtherChatGoal => '런타임이 다른 채팅의 목표를 보냈어요.';

  @override
  String get goalsBudgetInvalid => '토큰 예산은 양의 정수여야 해요.';

  @override
  String get goalsUnexpectedResponse => '런타임이 예상치 못한 목표 응답을 보냈어요.';

  @override
  String get goalsReconnect => '이 목표를 관리하려면 데스크톱에 다시 연결하세요.';

  @override
  String get goalsDescribeFirst => '먼저 목표를 설명하세요.';

  @override
  String get goalsReplaceTitle => '현재 목표를 바꿀까요?';

  @override
  String get goalsReplaceBody =>
      '이 목표는 아직 완료되지 않았어요. 바꾸면 새 목표가 시작되고 사용량 집계가 초기화돼요.';

  @override
  String get goalsReplaceAction => '목표 바꾸기';

  @override
  String get goalsClearTitle => '이 목표를 지울까요?';

  @override
  String get goalsClearBody => '데스크톱이 이 목표 추진을 멈추고 진행 상황 집계를 지워요.';

  @override
  String get goalsClearAction => '목표 지우기';

  @override
  String get goalsTitle => '목표';

  @override
  String get goalsReload => '목표 다시 불러오기';

  @override
  String get goalsShowingLastKnown => '마지막으로 확인한 목표를 표시하고 있어요. 관리하려면 다시 연결하세요.';

  @override
  String get goalsNewGoal => '새 목표';

  @override
  String get goalsEditGoal => '목표 편집';

  @override
  String get goalsDescribeHint => '원하는 결과, 확인 방법, 그리고 깨지면 안 되는 부분을 설명하세요.';

  @override
  String get goalsObjective => '목표 내용';

  @override
  String get goalsBudgetLabel => '토큰 예산 (선택)';

  @override
  String get goalsBudgetHelper => '토큰 예산을 두지 않으려면 비워 두세요.';

  @override
  String get goalsStart => '목표 시작';

  @override
  String get goalsSave => '목표 저장';

  @override
  String get goalsCancelEditing => '편집 취소';

  @override
  String goalsTokensRemaining(String tokens) {
    return '$tokens 토큰 남음';
  }

  @override
  String get goalsActiveExplainer =>
      '채팅이 대기 중일 때도 데스크톱은 이 목표가 완료되거나, 일시 중지되거나, 한도에 도달할 때까지 계속 작업해요.';

  @override
  String get goalsPause => '목표 일시 중지';

  @override
  String get goalsResume => '목표 재개';

  @override
  String get goalsEditObjective => '목표 내용 편집';

  @override
  String get groupsKindSpreadsheet => '스프레드시트';

  @override
  String get groupsKindText => '텍스트';

  @override
  String get groupsKindArchive => '압축 파일';

  @override
  String get groupsKindImage => '이미지';

  @override
  String get groupsKindVideo => '동영상';

  @override
  String get groupsKindAudio => '오디오';

  @override
  String get groupsKindFile => '파일';

  @override
  String get groupsMacUnreachable => 'Mac에 연결할 수 없어요. 다시 시도하세요.';

  @override
  String get groupsCreateFailed => '그룹을 만들지 못했어요. 다시 시도하세요.';

  @override
  String get groupsNewGroup => '새 그룹';

  @override
  String get groupsChooseMembers => '채팅에 참여할 멤버를 선택하세요.';

  @override
  String get groupsNameOptional => '이름 (선택)';

  @override
  String get groupsCreateGroup => '그룹 만들기';

  @override
  String groupsCreateGroupWith(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '에이전트 $count명으로 그룹 만들기',
    );
    return '$_temp0';
  }

  @override
  String get groupsSignInOnMac => '사용하려면 Mac에서 로그인하세요';

  @override
  String get groupsUpdateMacTitle => 'Mac에서 DJL 업데이트';

  @override
  String get groupsUpdateMacBody =>
      '그룹 채팅을 쓰려면 Mac에 최신 DJL이 필요해요. Mac에서 업데이트한 뒤 다시 돌아오세요.';

  @override
  String get groupsConnectMacTitle => 'Mac에 연결';

  @override
  String get groupsConnectMacBody => '그룹 채팅은 Mac에 저장돼요. Mac이 연결되면 여기에 표시돼요.';

  @override
  String get groupsLoadFailed => '그룹을 불러오지 못했어요';

  @override
  String get groupsEmptyTitle => '에이전트들을 한 채팅에 모아 보세요';

  @override
  String get groupsEmptyBody => '한 번만 질문하면 Claude, Codex 등 여러 에이전트가 함께 답해요.';

  @override
  String groupsMemberWriting(String name) {
    return '$name 님이 작성 중';
  }

  @override
  String groupsAgentsWriting(int count) {
    return '에이전트 $count명이 작성 중';
  }

  @override
  String get groupsPausedWaiting => '일시 중지됨, 내 답변을 기다리는 중';

  @override
  String groupsAgentCount(int count) {
    return '에이전트 $count명';
  }

  @override
  String get groupsMacDidNotKeepFile => 'Mac에 파일이 저장되지 않았어요.';

  @override
  String get groupsFileStillSending => '이 파일은 아직 전송 중이에요.';

  @override
  String get groupsMacTimeout =>
      'Mac이 제시간에 응답하지 않았어요. Mac에서 DJL이 열려 있는지 확인하세요.';

  @override
  String get groupsMacNotConnected => '지금은 Mac이 연결돼 있지 않아요.';

  @override
  String groupsRemoveAttachment(String name) {
    return '$name 제거';
  }

  @override
  String get groupsSendingFiles => '파일 보내는 중';

  @override
  String groupsImageNamed(String name) {
    return '이미지 $name';
  }

  @override
  String get groupsAttach => '첨부';

  @override
  String get groupsPhotos => '사진';

  @override
  String get groupsFiles => '파일';

  @override
  String groupsFileUnsupported(String name) {
    return '$name은(는) 보낼 수 없어요. 사진, PDF, Word, Excel, PowerPoint, 텍스트, 코드 파일을 보낼 수 있어요.';
  }

  @override
  String groupsFileTooLarge(String name, String size) {
    return '$name이(가) $size보다 커요.';
  }

  @override
  String groupsTooManyFiles(int count) {
    return '메시지 하나에 파일을 $count개까지 보낼 수 있어요.';
  }

  @override
  String get groupsOpenFailed => '열지 못했어요. 다시 시도해 주세요.';

  @override
  String get groupsAskEveryoneTitle => '모두에게 물어볼까요?';

  @override
  String groupsAskEveryoneBody(int count) {
    return '에이전트 $count명 모두가 이 메시지에 답해요.';
  }

  @override
  String get groupsDontAskAgain => '다시 묻지 않기';

  @override
  String get groupsAskEveryone => '모두에게 묻기';

  @override
  String get groupsGroupGone => '이 그룹은 더 이상 Mac에 없어요.';

  @override
  String groupsSayHelloPrompt(String everyone) {
    return '$everyone 한 줄로 인사해 주세요.';
  }

  @override
  String get groupsReconnectingToMac => 'Mac에 다시 연결하는 중…';

  @override
  String groupsHeaderLabel(String name, int count) {
    return '$name, 에이전트 $count명';
  }

  @override
  String get groupsMembers => '멤버';

  @override
  String get groupsYou => '나';

  @override
  String get groupsCouldNotReply => '답하지 못함';

  @override
  String get groupsNothingToAdd => '덧붙일 내용 없음';

  @override
  String get groupsImageOnMac => 'Mac에 있는 이미지';

  @override
  String get groupsRemovedAgent => '제거된 에이전트';

  @override
  String get groupsWaitingTurn => '차례를 기다리는 중';

  @override
  String get groupsWriting => '작성 중';

  @override
  String get groupsAttachTooltip => '파일 또는 사진 첨부';

  @override
  String get groupsMentionAgent => '에이전트 멘션';

  @override
  String get groupsMessageHint => '메시지';

  @override
  String get groupsStopAgents => '에이전트 중지';

  @override
  String get groupsEveryone => '모두';

  @override
  String get groupsPausedTitle => '에이전트들이 잠시 멈췄어요';

  @override
  String get groupsPausedBody => '한동안 서로 대화를 나눴고 아직 할 말이 남아 있어요.';

  @override
  String get groupsEndItHere => '여기서 끝내기';

  @override
  String get groupsLetThemContinue => '계속하게 두기';

  @override
  String get groupsOfflineHint => 'Mac이 연결되면 메시지가 여기에 표시돼요.';

  @override
  String get groupsLoadingMessages => '메시지 불러오는 중';

  @override
  String get groupsEveryoneIsHere => '모두 모였어요';

  @override
  String get groupsEmptyChatHint => '@를 입력해 답할 에이전트를 고르세요. 첫 메시지는 모두에게 전달돼요.';

  @override
  String get groupsAskEveryoneToSayHello => '모두에게 인사 요청하기';

  @override
  String get groupsManageOnMac => '에이전트 추가나 제거는 Mac의 DJL에서 할 수 있어요.';

  @override
  String get groupsReady => '준비됨';

  @override
  String get groupsStop => '중지';

  @override
  String get guardianLiveReason => '재시도 승인은 세션이 진행 중일 때만 할 수 있어요.';

  @override
  String get guardianExpiredReason =>
      '이 재시도는 더 이상 사용할 수 없어요. Codex가 작업을 다시 요청할 때까지 기다려 주세요.';

  @override
  String get guardianDesktopReason => 'Codex Desktop에서 이 재시도를 승인하세요.';

  @override
  String get guardianUnsafeReason =>
      '이 작업은 여기에서 안전하게 재시도할 수 없어요. Codex에서 승인하세요.';

  @override
  String get guardianSubmittedReason =>
      '재시도 승인을 보냈어요. 다시 시도하기 전에 Codex를 확인하세요.';

  @override
  String get guardianUncertainReason =>
      '재시도 승인이 Codex에 전달되지 않았을 수 있어요. 다시 시도하기 전에 Codex를 확인하세요.';

  @override
  String get guardianRequestedAction => '요청된 작업';

  @override
  String get guardianRunCommand => '명령 실행';

  @override
  String get guardianApplyFileChanges => '파일 변경 사항 적용';

  @override
  String guardianEditFile(String file) {
    return '$file 편집';
  }

  @override
  String guardianEditFiles(int count, String files) {
    return '파일 $count개 편집: $files';
  }

  @override
  String get guardianAccessNetwork => '네트워크 접근';

  @override
  String guardianAccessHost(String host) {
    return '$host에 접근';
  }

  @override
  String get guardianRequestPermissions => '추가 권한 요청';

  @override
  String get guardianRequestNetwork => '네트워크 요청';

  @override
  String get guardianRequestFileAccess => '파일 접근 요청';

  @override
  String get guardianRequestNetworkAndFileAccess => '네트워크 및 파일 접근 요청';

  @override
  String get guardianReviewing => '검토 중';

  @override
  String get guardianApproved => '승인됨';

  @override
  String get guardianDenied => '거부됨';

  @override
  String get guardianTimedOut => '시간 초과';

  @override
  String get guardianStopped => '중지됨';

  @override
  String guardianUpdatedStatus(String status) {
    return '업데이트됨 ($status)';
  }

  @override
  String get guardianDetailsUnavailable => '검토 세부 정보를 볼 수 없어요.';

  @override
  String guardianAutoReviewTitle(String status) {
    return '자동 검토 · $status';
  }

  @override
  String get guardianRiskLow => '위험 낮음';

  @override
  String get guardianRiskMedium => '위험 보통';

  @override
  String get guardianRiskHigh => '위험 높음';

  @override
  String guardianRiskOther(String level) {
    return '위험도 $level';
  }

  @override
  String guardianAuthorization(String value) {
    return '권한: $value';
  }

  @override
  String get guardianApprovalRecorded => '승인이 기록됐어요. 재시도는 여전히 검토를 거쳐요';

  @override
  String get guardianSubmittingApproval => '재시도 승인 보내는 중…';

  @override
  String get guardianApproveOneRetry => '재시도 1회 승인';

  @override
  String get subagentsSubagent => '하위 에이전트';

  @override
  String get subagentsSpawnAgent => '에이전트 생성';

  @override
  String get subagentsWaitForAgents => '에이전트 기다리기';

  @override
  String get subagentsUpdateAgent => '에이전트 업데이트';

  @override
  String get subagentsResumeAgent => '에이전트 재개';

  @override
  String get subagentsCloseAgent => '에이전트 닫기';

  @override
  String get subagentsActivity => '하위 에이전트 활동';

  @override
  String get subagentsMetadataUnavailable => '하위 에이전트 정보를 사용할 수 없음';

  @override
  String get activityCommand => '명령';

  @override
  String get activityFileChanges => '파일 변경 사항';

  @override
  String activityFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '파일 $count개 변경됨',
    );
    return '$_temp0';
  }

  @override
  String get activityToolActivity => '도구 활동';

  @override
  String get activityReadFile => '파일 읽기';

  @override
  String activityReadValue(String value) {
    return '$value 읽기';
  }

  @override
  String get activitySearchFiles => '파일 검색';

  @override
  String activitySearchValue(String value) {
    return '$value 검색';
  }

  @override
  String get activityListFiles => '파일 목록 보기';

  @override
  String activityListFilesValue(String value) {
    return '$value 파일 목록 보기';
  }

  @override
  String get statusTaskStatus => '작업 상태';

  @override
  String get statusAllowed => '이 기기에서 작업 상태 표시가 허용돼 있어요.';

  @override
  String get statusDenied => '기기 설정에서 작업 상태 표시를 허용하세요. 허용하지 않아도 채팅은 사용할 수 있어요.';

  @override
  String get statusUnsupported => '이 기기에서는 작업 상태 표시를 사용할 수 없어요.';

  @override
  String get statusChecking => '기기 권한 확인 중…';

  @override
  String get statusEnable => '켜기';

  @override
  String get statusRefresh => '작업 상태 새로고침';

  @override
  String get statusSystemSettings => '설정 열기';

  @override
  String pairingStateLabel(String state) {
    String _temp0 = intl.Intl.selectLogic(state, {
      'disconnected': '연결 끊김',
      'resolving': '찾는 중',
      'connecting': '연결 중',
      'connected': '연결됨',
      'offline': '데스크톱 오프라인',
      'suspended': '일시 중지됨',
      'other': '$state',
    });
    return '$_temp0';
  }

  @override
  String get settingsLanguage => '언어';

  @override
  String get settingsLanguageSystem => '시스템 기본값';

  @override
  String get workspaceUndoNoExactPatch => '완전하고 정확한 통합 패치가 기록되지 않았어요.';

  @override
  String get workspaceUndoRenames => '이름 변경은 여기에서 실행 취소할 수 없어요.';

  @override
  String get workspaceUndoBinary =>
      '바이너리, 이름 변경, 권한 모드, 심볼릭 링크 변경은 여기에서 실행 취소할 수 없어요.';
}
