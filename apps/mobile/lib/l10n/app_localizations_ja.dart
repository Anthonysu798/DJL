// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Japanese (`ja`).
class AppLocalizationsJa extends AppLocalizations {
  AppLocalizationsJa([String locale = 'ja']) : super(locale);

  @override
  String get appName => 'DJL';

  @override
  String get commonCancel => 'キャンセル';

  @override
  String get commonTryAgain => '再試行';

  @override
  String get chatUiAccessAskTitle => '承認を求める';

  @override
  String get chatUiAccessAskDetail => '外部ファイルの編集やインターネットの利用の前に、毎回確認します';

  @override
  String get chatUiAccessAutoTitle => '自動で承認';

  @override
  String get chatUiAccessAutoDetail => '安全でない可能性がある操作のときだけ確認します';

  @override
  String get chatUiAccessFullTitle => 'フルアクセス';

  @override
  String get chatUiAccessFullDetail => 'パソコンへのフルアクセス（リスク高）';

  @override
  String get chatUiAccessHint => 'Codex が許可を求める方法を変更します';

  @override
  String get chatUiAccessFullConfirmTitle => 'パソコンへのフルアクセスを許可しますか？';

  @override
  String get chatUiAccessFullConfirmBody =>
      'エージェントは承認を求めずに、ワークスペースの外でファイルを変更したりコマンドを実行したりできます。';

  @override
  String get chatUiAccessFullConfirm => 'フルアクセスを許可';

  @override
  String get chatUiAttentionNoMatches => '該当する項目はありません';

  @override
  String get chatUiAttentionAllCaughtUp => 'すべて対応済みです';

  @override
  String get chatUiAttentionNoMatchesHint => '別のプロジェクト、チャット、ステータスで試してください。';

  @override
  String get chatUiAttentionEmptyHint =>
      '承認待ちの操作、エージェントからの質問、失敗した実行、完了した作業がここに表示されます。';

  @override
  String get chatUiAttentionNeedsYou => '対応が必要';

  @override
  String get chatUiAttentionReadyToReview => '確認できます';

  @override
  String get chatUiAgoNow => 'たった今';

  @override
  String chatUiAgoMinutes(int minutes) {
    return '$minutes 分前';
  }

  @override
  String chatUiAgoHours(int hours) {
    return '$hours 時間前';
  }

  @override
  String chatUiAgoDays(int days) {
    return '$days 日前';
  }

  @override
  String get chatUiAttentionTitle => '要対応';

  @override
  String get chatUiAttentionConnectionChanged =>
      '接続が変わりました。戻ってから「要対応」を開き直してください。';

  @override
  String get chatUiAttentionSearch => '要対応の項目を検索';

  @override
  String get appSavedConnectionsUnreadable =>
      '保存済みのパソコン接続情報を読み込めませんでした。保存済みの接続はそのまま残っています。';

  @override
  String get appRestoreMacsFailed =>
      '保存済みの Mac を復元できませんでした。デバイスのロックを解除してから再試行してください。';

  @override
  String get appLinkedConversationFailed =>
      'リンク先のチャットを開けませんでした。接続を確認して再試行してください。';

  @override
  String get appLinkedAccountUnavailable =>
      'アカウント情報をまだ取得できません。読み込みが終わったら、リンク先のチャットをもう一度開いてください。';

  @override
  String get appAccountStillLoading => 'アカウント情報を読み込み中です。しばらくしてからもう一度お試しください。';

  @override
  String get appRenameChat => 'チャット名を変更';

  @override
  String get appRenameChatPlaceholder => 'タイトル';

  @override
  String get appSave => '保存';

  @override
  String get appOpenNavigation => 'ナビゲーションを開く';

  @override
  String get appAccountUnavailable => 'アカウント情報を取得できません。';

  @override
  String get appRetryAccount => 'アカウントを再読み込み';

  @override
  String get appImages => '画像';

  @override
  String get appNotifications => '通知';

  @override
  String get appRetryLinkedConversation => 'リンク先のチャットを開き直す';

  @override
  String get coreBack => '戻る';

  @override
  String get coreMenu => 'メニュー';

  @override
  String get coreChatActions => 'チャットの操作';

  @override
  String get coreSessionEnded => 'セッションが終了しました。もう一度ログインしてください。';

  @override
  String coreCloudRequestFailed(int status) {
    return 'DJL Cloud へのリクエストに失敗しました（$status）。';
  }

  @override
  String get coreAccountChanged => 'アカウントが切り替わりました。';

  @override
  String get corePleaseSignIn => 'ログインしてください。';

  @override
  String get coreNoAccessToken => 'DJL Cloud からアクセストークンが返されませんでした。';

  @override
  String get coreCloudTimeout => 'DJL Cloud の応答がタイムアウトしました。';

  @override
  String get coreCloudUnreachable => 'DJL Cloud に接続できませんでした。接続を確認してください。';

  @override
  String get corePleaseSignInAgain => 'もう一度ログインしてください。';

  @override
  String get coreInvalidPushRegistration => '通知の登録情報が無効です。';

  @override
  String get corePushNotAcknowledged => '通知の登録が確認されませんでした。';

  @override
  String get coreCloudResponseUnreadable =>
      'このバージョンでは DJL Cloud の応答を読み取れませんでした。';

  @override
  String get coreInvalidDesktopEnvelope => 'パソコンからのメッセージが無効か、重複して送信されています。';

  @override
  String get coreDesktopMessageUnauthenticated => 'パソコンからのメッセージを認証できませんでした。';

  @override
  String get gitThreadChangedReopenAction =>
      'スレッドの状態が変わりました。このブランチまたはワークツリーの操作を開き直してください。';

  @override
  String get gitWaitForThread => 'ブランチやワークツリーを切り替える前に、このスレッドの完了を待ってください。';

  @override
  String get gitWaitForOperation =>
      'ブランチやワークツリーを切り替える前に、実行中の Git 操作の完了を待ってください。';

  @override
  String get gitNotRepositorySentence => 'このフォルダは Git リポジトリではありません。';

  @override
  String get gitNotRepository => 'このフォルダは Git リポジトリではありません';

  @override
  String get gitNoLongerRepository =>
      'このフォルダは Git リポジトリではなくなりました。ブランチやワークツリーを作成する前に更新してください。';

  @override
  String get gitContinue => '続行';

  @override
  String get gitOk => 'OK';

  @override
  String get gitCreate => '作成';

  @override
  String get gitClose => '閉じる';

  @override
  String get gitDone => '完了';

  @override
  String get gitGenerating => '生成中…';

  @override
  String get gitGenerateMessage => 'メッセージを生成';

  @override
  String get gitCommitAllTitle => '現在の変更をすべてコミット';

  @override
  String get gitCommitPublishTitle => '変更をコミットして公開';

  @override
  String get gitCommitMessageLabel => 'コミットメッセージ';

  @override
  String get gitPublishBranchTitle => 'このブランチを公開しますか？';

  @override
  String get gitPublishCommitPushBody => '現在の変更をすべてコミットし、このブランチをリモートにプッシュします。';

  @override
  String get gitPublishFeatureBranchPrBody =>
      '機能ブランチを用意し、すべての変更をコミットしてブランチをプッシュし、GitHub でプルリクエストを作成します。';

  @override
  String get gitPublishCommitPrBody =>
      'すべての変更をコミットしてブランチをプッシュし、GitHub でプルリクエストを作成します。';

  @override
  String get gitCommitCreateSwitch => 'コミット・作成・切り替え';

  @override
  String get gitCreateManagedWorktree => '管理対象のワークツリーを作成';

  @override
  String get gitCreateWorktree => 'ワークツリーを作成';

  @override
  String get gitBranchName => 'ブランチ名';

  @override
  String get gitBaseBranch => 'ベースブランチ';

  @override
  String get gitMoveCurrentChanges => '現在の変更を移動';

  @override
  String get gitCopyCurrentChanges => '現在の変更をコピー';

  @override
  String get gitLeaveChangesHere => '変更をここに残す';

  @override
  String get gitInitializeTitle => 'Git を初期化しますか？';

  @override
  String get gitInitializeBody => 'このワークスペースに Git リポジトリを作成します。';

  @override
  String get gitPushTitle => 'ブランチをプッシュしますか？';

  @override
  String get gitPushBody => 'コミット済みの変更を設定済みのリモートにプッシュします。';

  @override
  String get gitLocalChangesNeedAttention => 'ローカルの変更を確認してください';

  @override
  String get gitUpdateRepositoryTitle => 'リポジトリを更新しますか？';

  @override
  String get gitDirtyAndBehindBody =>
      'ローカルに変更があり、リモートブランチも先に進んでいます。これらの変更を調整する準備ができている場合のみ、リベースでプルしてください。';

  @override
  String get gitPullBody => 'リモートのコミットをこのブランチにプルします。';

  @override
  String get gitPullAndRebase => 'プルしてリベース';

  @override
  String get gitUpdate => '更新';

  @override
  String get gitTransferChangesTitle => '変更を移す';

  @override
  String get gitTargetWorkspacePath => '移動先のワークスペースのパス';

  @override
  String get gitRemoveWorktreeTitle => 'このワークツリーを削除しますか？';

  @override
  String get gitRemoveWorktreeBody =>
      'このブランチの管理対象ワークツリーを削除します。メインのチェックアウトはパソコン側で削除されません。';

  @override
  String get gitDiscardTitle => 'ローカルの変更を破棄しますか？';

  @override
  String get gitDiscardBody => 'ローカルのファイル変更を破棄し、このブランチをリモートの状態にリセットします。';

  @override
  String get gitPrDraftTitle => 'プルリクエストの下書き';

  @override
  String get gitCopyDraft => '下書きをコピー';

  @override
  String get gitCreatePrTitle => 'プルリクエストを作成しますか？';

  @override
  String get gitCreatePrBody =>
      'パソコンが必要に応じてこのブランチをプッシュし、コミット済みの変更からタイトルと説明を生成して、GitHub でプルリクエストを作成します。';

  @override
  String get gitNoChangesToShow => '表示できるリポジトリの変更はありません。';

  @override
  String get gitBranchSwitchFailed => 'ブランチを切り替えられませんでした';

  @override
  String get gitBranchOpenElsewhere =>
      'ブランチを切り替えられません：このブランチは別のワークツリーですでに開かれています。';

  @override
  String get gitErrorTitle => 'Git エラー';

  @override
  String get gitOpenPr => 'PR を開く';

  @override
  String get gitLoadingChanges => '変更を読み込み中';

  @override
  String get gitLoadingChangesEllipsis => '変更を読み込み中…';

  @override
  String get gitChangesUnavailable => '変更を取得できません';

  @override
  String get gitNoChanges => '変更なし';

  @override
  String get gitDesktopChanged => '接続先のパソコンが変わりました。そのワークスペースから Git を開き直してください。';

  @override
  String get gitChooseWorkspace => 'Git を使う前に、パソコンのワークスペースを選んでください。';

  @override
  String get gitWorking => '処理中…';

  @override
  String get gitRetryStatus => 'Git の状態を再取得';

  @override
  String get gitWorktreeUnavailable => 'ワークツリーを利用できません';

  @override
  String get gitActionsLabel => 'Git の操作';

  @override
  String get gitRefreshStatus => 'Git の状態を更新';

  @override
  String get gitShowMenu => 'メニューを表示';

  @override
  String get gitInitializeRepository => 'リポジトリを初期化';

  @override
  String get gitCreateBranch => 'ブランチを作成';

  @override
  String get gitTransferToWorkspace => '変更をワークスペースに移す';

  @override
  String get gitRemoveManagedWorktree => '管理対象のワークツリーを削除';

  @override
  String get gitGeneratePrDraft => 'PR の下書きを生成';

  @override
  String get gitCreatePullRequest => 'プルリクエストを作成';

  @override
  String get gitCommitAndPushMenu => 'コミットしてプッシュ';

  @override
  String get gitCommitPushCreatePrMenu => 'コミット・プッシュして PR を作成';

  @override
  String get gitDiscardAndReset => '破棄してリモートにリセット';

  @override
  String get gitWorktreeReady => 'ワークツリーの準備ができました';

  @override
  String get gitOpenChat => 'チャットを開く';

  @override
  String get gitOpenPullRequest => 'プルリクエストを開く';

  @override
  String get gitDetachedHead => 'デタッチされた HEAD';

  @override
  String get gitNoUpstream => '上流ブランチなし';

  @override
  String gitAheadBehind(int ahead, int behind) {
    return '$ahead 件先行 · $behind 件遅れ';
  }

  @override
  String get gitCommitChanges => '変更をコミット';

  @override
  String get gitPush => 'プッシュ';

  @override
  String get gitPullTitle => '変更をプルしますか？';

  @override
  String get gitPull => 'プル';

  @override
  String get gitViewDiff => '差分を表示';

  @override
  String get gitCurrentBranch => '現在のブランチ';

  @override
  String get gitBranchFallback => 'ブランチ';

  @override
  String get gitWriterModel => 'Git 文章作成モデル';

  @override
  String get gitConnectCodexModel =>
      'Mac で Codex のモデルに接続すると、コミットメッセージや PR の下書きを生成できます。';

  @override
  String gitChangedFilesCount(int count) {
    return '$count 件のファイルに変更';
  }

  @override
  String get gitActionInitialize => 'Git を初期化';

  @override
  String get gitActionChanges => '変更';

  @override
  String get gitActionCommit => 'コミット';

  @override
  String get gitActionCommitAndPush => 'コミットしてプッシュ';

  @override
  String get gitActionCommitPushPr => 'コミット・プッシュ・PR';

  @override
  String get gitActionCreatePr => 'PR を作成';

  @override
  String get gitSectionSetup => 'セットアップ';

  @override
  String get gitSectionWrite => '書き込み';

  @override
  String get gitStatusNotInitialized => 'Git が初期化されていません';

  @override
  String get gitStatusUpToDate => 'リポジトリは最新です';

  @override
  String get gitStatusAheadOnly => 'ローカルブランチがリモートより進んでいます';

  @override
  String get gitStatusBehindOnly => 'リモートブランチがローカルより進んでいます';

  @override
  String get gitStatusDiverged => 'ローカルとリモートのブランチが分岐しています';

  @override
  String get gitStatusDirty => 'ローカルリポジトリに未コミットの変更があります';

  @override
  String get gitStatusDirtyAndBehind => 'ローカルに変更があり、リモートブランチも進んでいます';

  @override
  String get gitStatusNoUpstream => 'ブランチはまだ公開されていません';

  @override
  String get gitStatusDetachedHead => '現在のブランチを取得できません';

  @override
  String get gitStatusUnavailable => 'リポジトリの状態を取得できません';

  @override
  String gitReviewLocalCommits(int count) {
    return '$count 件のローカルコミット';
  }

  @override
  String get gitReviewTheCurrentBranch => '現在のブランチ';

  @override
  String gitReviewCreatingFrom(String name, String source) {
    return '$source から「$name」を作成しようとしています。ローカルの変更を新しいブランチに持っていくか、先にコミットしてから作成して切り替えてください。';
  }

  @override
  String gitReviewCommitsStayPrefix(
    String base,
    String commits,
    String message,
  ) {
    return '$base には、まだリモートにない $commits があります。これらのコミットは $base の履歴に残ります。$message';
  }

  @override
  String get gitReviewFilesWithChanges => 'ローカルに変更があるファイル：';

  @override
  String gitReviewMoreFiles(int count) {
    return 'ほか $count 件のファイル';
  }

  @override
  String gitReviewBringChangesTitle(String name) {
    return 'ローカルの変更を「$name」に持っていきますか？';
  }

  @override
  String get gitReviewCarryToNewBranch => '新しいブランチに持っていく';

  @override
  String gitReviewCommitsStayTitle(String base) {
    return 'ローカルのコミットは $base に残ります';
  }

  @override
  String gitReviewBranchCommitsStay(String base, String commits, String name) {
    return '$base には、まだリモートにない $commits があります。今「$name」を作成すると現在の HEAD から新しいブランチが始まりますが、これらのコミットは $base の履歴に残ります。';
  }

  @override
  String get gitReviewCreateAnyway => 'このまま作成';

  @override
  String get gitReviewManagedWorktreeNoun => '管理対象のワークツリー';

  @override
  String gitReviewQuotedName(String name) {
    return '「$name」';
  }

  @override
  String get gitReviewCopyTitle => '現在のブランチからローカルの変更をコピー';

  @override
  String get gitReviewMoveTitle => '現在のブランチからローカルの変更を移動';

  @override
  String get gitReviewVerbCopy => 'コピー';

  @override
  String get gitReviewVerbMove => '移動';

  @override
  String gitReviewOnlyCurrentBranch(
    String target,
    String verb,
    String current,
  ) {
    return '$targetを作成するときに$verbできるのは、現在のブランチのローカルの変更だけです。ベースブランチを「$current」に切り替えるか、ローカルの変更を整理してからワークツリーを作成してください。';
  }

  @override
  String gitReviewCopiedInto(String worktree) {
    return 'ローカルの変更は$worktreeにもコピーされます。無視されているファイルはここに残ります。';
  }

  @override
  String gitReviewMovedInto(String worktree) {
    return 'ローカルの変更は$worktreeに移動します。無視されているファイルはここに残ります。';
  }

  @override
  String get gitReviewTheManagedWorktree => '管理対象のワークツリー';

  @override
  String get gitReviewTheNewWorktree => '新しいワークツリー';

  @override
  String gitReviewWorktreeCommitsStay(
    String base,
    String commits,
    String target,
    String from,
    String suffix,
  ) {
    return '$base には、まだリモートにない $commits があります。$from から$targetを作成すると現在の HEAD から始まりますが、これらのコミットも $base の履歴に残ります。$suffix';
  }

  @override
  String get gitBadgeOpenWorktree => 'ワークツリーで開いています';

  @override
  String get gitBadgeOpenElsewhere => '別の場所で開いています';

  @override
  String get gitActionCompleted => 'Git の操作が完了しました。';

  @override
  String gitActionFailed(String error) {
    return '$error 結果が不明な操作をやり直す前に、更新してください。';
  }

  @override
  String get gitDismissMenu => 'メニューを閉じる';

  @override
  String get gitDiffPatch => 'パッチ';

  @override
  String gitDiffLine(int line) {
    return '$line 行目';
  }

  @override
  String gitDiffLines(int first, int last) {
    return '$first〜$last 行目';
  }

  @override
  String get gitDismissBranchPicker => 'ブランチの選択を閉じる';

  @override
  String get gitBadgeCurrent => '現在';

  @override
  String get gitBadgeDefault => 'デフォルト';

  @override
  String get gitCloseBranchPicker => 'ブランチの選択を閉じる';

  @override
  String get gitBranchPickerStale => 'スレッドまたはパソコンが変わりました。ブランチの選択を閉じて開き直してください。';

  @override
  String get gitSearchBranches => 'ブランチを検索';

  @override
  String get gitClearBranchSearch => 'ブランチの検索をクリア';

  @override
  String get gitBranches => 'ブランチ';

  @override
  String get gitNoBranchesFound => 'ブランチが見つかりません';

  @override
  String get gitNoBranchesHint => '別のキーワードで検索するか、ブランチの一覧を更新してください。';

  @override
  String gitCreateAndCheckout(String name) {
    return '「$name」を作成してチェックアウト';
  }

  @override
  String get gitNewBranchEllipsis => '新しいブランチ…';

  @override
  String get gitSwitching => '切り替え中…';

  @override
  String get gitRefreshing => '更新中…';

  @override
  String get gitReloadBranchList => 'ブランチの一覧を再読み込み';

  @override
  String get gitCloseWorktreeReview => 'ワークツリーの確認を閉じる';

  @override
  String get gitHandoffTitle => 'スレッドをワークツリーに引き継ぐ';

  @override
  String get gitForkTitle => 'スレッドを新しいワークツリーにフォーク';

  @override
  String get gitHandoff => '引き継ぐ';

  @override
  String get gitFork => 'フォーク';

  @override
  String get gitHandoffMessage =>
      '新しいワークツリーでブランチを作成してチェックアウトし、並行して作業を続けます。ブランチ名には djl/ が自動で付きます。';

  @override
  String get gitForkMessage =>
      '新しいワークツリーでブランチを作成してチェックアウトし、このチャットをそこへ新しいチャットとしてフォークします。';

  @override
  String get gitStartsFromBase => 'このベースブランチから始まります。';

  @override
  String get gitLoadingWorktreeBranches => 'ワークツリーのブランチを読み込み中';

  @override
  String get gitPreparingWorktree => 'ワークツリーを準備中';

  @override
  String get gitNewBranch => '新しいブランチ';

  @override
  String get gitNewBranchBody =>
      'ブランチをローカルに作成してチェックアウトします。未コミットの変更は現在の作業コピーに残ります。';

  @override
  String get gitThreadChangedReopenGit =>
      'スレッドの状態が変わりました。この Git 操作を閉じて開き直してください。';

  @override
  String get gitRepositoryChanges => 'リポジトリの変更';

  @override
  String gitFilesChanged(int count) {
    return '$count 件のファイルを変更';
  }

  @override
  String get gitExpandAll => 'すべて展開';

  @override
  String get gitCollapseAll => 'すべて折りたたむ';

  @override
  String gitPatchIndex(int index, int total) {
    return 'パッチ $index/$total';
  }

  @override
  String get chatUiComposerOptions => '入力オプション';

  @override
  String get chatUiStopDictation => '音声入力を停止';

  @override
  String get chatUiStartDictation => '音声入力を開始';

  @override
  String get chatUiResumeQueued => '待機中のメッセージを再開';

  @override
  String get chatUiStopTurn => '応答を停止';

  @override
  String get chatUiSendToDesktop => 'パソコンに送信';

  @override
  String get chatUiStartingRun => '実行を開始中';

  @override
  String get chatUiRemoveImage => '画像を削除';

  @override
  String get chatUiAttachedImage => '添付した画像';

  @override
  String chatUiDesktopImage(String source) {
    return 'パソコンの画像：$source';
  }

  @override
  String get chatUiImagePreviewUnavailable => '画像をプレビューできません';

  @override
  String get chatUiContextSkills => 'スキル';

  @override
  String get chatUiContextPlugins => 'プラグイン';

  @override
  String get chatUiContextFiles => 'ファイル';

  @override
  String chatUiContextUnsupported(String kind) {
    return 'このパソコンの実行環境は$kindに対応していません。';
  }

  @override
  String get chatUiContextStale => 'チャットが変わりました。コンテキストの選択を開き直してください。';

  @override
  String get chatUiContextRetry => 'もう一度探す';

  @override
  String chatUiContextSearchFilesIn(String path) {
    return '$path 内のファイルを検索';
  }

  @override
  String get chatUiContextSelectFolder =>
      'パソコンのファイルを検索するには、プロジェクトフォルダを選んでください。';

  @override
  String chatUiContextNoneFound(String kind) {
    return '$kindが見つかりません。';
  }

  @override
  String get chatUiAddDesktopContext => 'パソコンのコンテキストを追加';

  @override
  String get chatUiContextSearchFiles => 'パソコンのファイルを検索';

  @override
  String chatUiContextSearchKind(String kind) {
    return '$kindを検索';
  }

  @override
  String get chatUiContextDisabled => 'パソコンで無効';

  @override
  String get chatUiContextOnDesktop => 'ペアリング済みのパソコン上';

  @override
  String get chatUiEmptyGeneralTitle => '何に取り組みますか？';

  @override
  String get chatUiEmptyFolderPrefix => '「';

  @override
  String get chatUiEmptyFolderSuffix => '」で何をしますか？';

  @override
  String get chatUiEmptyGreeting => 'こんにちは！何をお手伝いしましょうか？';

  @override
  String get chatUiEncryptedCaption => 'チャットはエンドツーエンドで暗号化されています';

  @override
  String get chatUiUserMessage => 'あなたのメッセージ';

  @override
  String get chatUiAssistantMessage => 'アシスタントの返信';

  @override
  String get chatUiThreadActions => 'スレッドの操作';

  @override
  String get chatUiBranchesAndWorktrees => 'ブランチとワークツリー';

  @override
  String get chatUiGitActions => 'Git の操作';

  @override
  String get chatUiWorking => '処理中…';

  @override
  String get chatUiScrollToLatest => '最新のメッセージへ移動';

  @override
  String get chatUiSavedToPhotos => '写真に保存しました。';

  @override
  String get chatUiShareImageFailed => 'この画像を共有できませんでした。もう一度お試しください。';

  @override
  String get chatUiSaveImageFailed => 'この画像を保存できませんでした。もう一度お試しください。';

  @override
  String get chatUiLoadImageFailed => 'この画像を読み込めませんでした。';

  @override
  String get chatUiRetry => '再試行';

  @override
  String get chatUiImageReopenWorkspace => '再接続するか、元のワークスペースからこの画像を開き直してください。';

  @override
  String get chatUiImageReopenChat => 'ペアリング済みの元のチャットからこの画像を開き直してください。';

  @override
  String chatUiOpenImage(String name) {
    return '画像 $name を開く';
  }

  @override
  String get chatUiClose => '閉じる';

  @override
  String get chatUiShare => '共有';

  @override
  String get chatUiSaveToPhotos => '写真に保存';

  @override
  String get chatUiModelsGroup => 'モデル';

  @override
  String get chatUiRefreshModels => 'モデルを更新';

  @override
  String get chatUiProviderAndModel => 'プロバイダーとモデル';

  @override
  String get chatUiDone => '完了';

  @override
  String get chatUiAllProviders => 'すべてのプロバイダー';

  @override
  String get chatUiModelsConnectionChanged => '接続が変わりました。モデルの選択を開き直してください。';

  @override
  String get chatUiLoadingModels => 'モデルを読み込み中';

  @override
  String get chatUiNoModels => '利用できるモデルがありません';

  @override
  String get chatUiNoModelsHint => 'パソコンの DJL でプロバイダーに接続してから、モデルの一覧を更新してください。';

  @override
  String get chatUiNoMatchingModels => '該当するモデルはありません';

  @override
  String get chatUiSearchModels => 'プロバイダーやモデルを検索';

  @override
  String get chatUiClearModelSearch => 'モデルの検索をクリア';

  @override
  String get chatUiNavCloudChat => 'クラウドチャット';

  @override
  String get chatUiNavRemote => 'リモート';

  @override
  String get chatUiNavSearchFailed => 'チャットを検索できませんでした。';

  @override
  String get chatUiNavRetrySearch => 'もう一度検索';

  @override
  String get chatUiNavSearching => 'チャットを検索中…';

  @override
  String get chatUiNavPinned => 'ピン留め';

  @override
  String get chatUiNavPinnedEmpty =>
      'よく使うチャットをすぐ開けるようにしましょう。\nチャットを長押しするとピン留めできます。';

  @override
  String get chatUiNavRecent => '最近のチャット';

  @override
  String get chatUiNavRecentEmpty => 'チャットはここに表示されます。';

  @override
  String get chatUiNoMatchingChats => '該当するチャットはありません';

  @override
  String get chatUiCloseSearch => '検索を閉じる';

  @override
  String get chatUiSearchChats => 'チャットを検索';

  @override
  String get chatUiChatButton => 'チャット';

  @override
  String get chatUiNewChat => '新しいチャット';

  @override
  String get chatUiSettings => '設定';

  @override
  String get chatUiMoreActions => 'その他の操作';

  @override
  String get chatUiMenuNewChat => '新しいチャット';

  @override
  String get chatUiMenuQuickChat => 'クイックチャット';

  @override
  String get chatUiMenuNewProject => '新しいプロジェクト';

  @override
  String get chatUiMenuConnections => '接続';

  @override
  String get chatUiMenuSecurePairing => '安全なペアリングの詳細';

  @override
  String get chatUiMenuYourMac => 'あなたの Mac';

  @override
  String get chatUiMenuActiveChats => '進行中のチャット';

  @override
  String get chatUiArchivedChats => 'アーカイブ済みのチャット';

  @override
  String get chatUiMenuRefresh => '更新';

  @override
  String get chatUiMenuDisconnect => '接続を解除';

  @override
  String get chatUiOpenNavigation => 'ナビゲーションを開く';

  @override
  String get chatUiSearchConversations => 'チャットを検索';

  @override
  String get chatUiDismissSearch => '検索を閉じる';

  @override
  String get chatUiStatusConnecting => '接続中';

  @override
  String get chatUiStatusDeviceOffline => 'デバイスがオフライン';

  @override
  String get chatUiStatusOffline => 'オフライン';

  @override
  String chatUiConnectionStatus(String status) {
    return '接続状態：$status';
  }

  @override
  String get chatUiGroups => 'グループ';

  @override
  String get homeTabChats => 'チャット';

  @override
  String get chatUiExpandAll => 'すべて展開';

  @override
  String get chatUiCollapseAll => 'すべて折りたたむ';

  @override
  String chatUiCollapseChildChats(String title) {
    return '「$title」の子チャットを折りたたむ';
  }

  @override
  String chatUiExpandChildChats(String title) {
    return '「$title」の子チャットを展開';
  }

  @override
  String get chatUiDesktopChatActions => 'チャットの操作';

  @override
  String get chatUiArchiveProject => 'プロジェクトをアーカイブ';

  @override
  String get chatUiRemoveFromPhone => 'スマホから削除';

  @override
  String chatUiArchiveProjectTitle(String name) {
    return '「$name」をアーカイブしますか？';
  }

  @override
  String get chatUiArchiveProjectBody => 'このプロジェクトの進行中のチャットがすべてアーカイブされます。';

  @override
  String chatUiRemoveProjectTitle(String name) {
    return 'このスマホから「$name」を削除しますか？';
  }

  @override
  String get chatUiRemoveProjectBody =>
      'このプロジェクトのチャットは、このスマホの DJL からのみ削除されます。パソコンや Codex observer からは何も削除されません。';

  @override
  String chatUiExpandProject(String name) {
    return 'プロジェクト $name を展開';
  }

  @override
  String chatUiCollapseProject(String name) {
    return 'プロジェクト $name を折りたたむ';
  }

  @override
  String chatUiNewChatIn(String name) {
    return '$name で新しいチャット';
  }

  @override
  String get chatUiNewGroup => '新しいグループ';

  @override
  String get chatUiGroupButton => 'グループ';

  @override
  String get chatUiOfflineSavedChats => 'オフライン · 保存済みのチャットを表示中';

  @override
  String get chatUiReconnect => '再接続';

  @override
  String get chatUiNoMatchingChatsPeriod => '該当するチャットはありません。';

  @override
  String get chatUiNoStudioThreads => 'Studio のスレッドはありません';

  @override
  String get chatUiNoProjectChats => 'プロジェクトのチャットはありません';

  @override
  String get desktopAttentionApproval => '承認が必要です';

  @override
  String get desktopAttentionQuestion => 'エージェントから質問があります';

  @override
  String get desktopAttentionFailedRun => '実行に失敗しました';

  @override
  String get desktopAttentionBlockedGoal => '目標の確認が必要です';

  @override
  String get desktopAttentionCompletedRun => '確認できます';

  @override
  String get desktopFailurePermission =>
      '要求されたアクセスを確認するか、このチャットのアクセスモードを変更してから、もう一度実行してください。';

  @override
  String get desktopFailureSignIn => 'Mac でもう一度ログインしてから、もう一度実行してください。';

  @override
  String get desktopFailureTimeout => 'Mac との接続を確認してから、もう一度実行してください。';

  @override
  String get desktopFailureNetwork => 'Mac と中継サーバーがオンラインか確認してから、もう一度実行してください。';

  @override
  String get desktopFailureCheck => 'チャットを開いて失敗したチェックを確認し、修正してから再試行してください。';

  @override
  String get desktopFailureGeneric => 'チャットを開いて最後のステップを確認し、問題を解決してから再試行してください。';

  @override
  String desktopAttentionAllowCommand(String command) {
    return 'Codex に「$command」の実行を許可しますか？';
  }

  @override
  String get desktopAttentionAwaitingPermission => 'Codex は続行するための許可を待っています。';

  @override
  String get desktopAttentionAnswerAgent => 'チャットを開いてエージェントに回答してください。';

  @override
  String get desktopGoalBlocked =>
      '目標が進められなくなっています。チャットを開いて、エージェントが必要としているものを確認してください。';

  @override
  String get desktopGoalUsageLimited =>
      '使用量の上限に達したため、この目標は一時停止しました。再開する前にチャットを確認してください。';

  @override
  String get desktopGoalBudgetLimited =>
      'この目標は予算の上限に達しました。次にどうするか決める前に、結果を確認してください。';

  @override
  String get desktopRunFinishedReview => '実行が完了しました。続ける前に、結果とファイルの変更を確認してください。';

  @override
  String get desktopScopeStudio => 'Studio';

  @override
  String get desktopScopeProjects => 'プロジェクト';

  @override
  String get desktopNoProject => 'プロジェクトなし';

  @override
  String get desktopGroupPinned => 'ピン留め';

  @override
  String get desktopUntitledChat => '無題のチャット';

  @override
  String get desktopComposerTooManyImages => '画像は 4 枚まで選べます。';

  @override
  String get desktopContextIncomplete => '選択したコンテキストが不完全です。削除してから選び直してください。';

  @override
  String get desktopApproveForMeUnsupported =>
      'この実行環境は「自動で承認」に対応していません。Mac で Codex を更新してから再試行してください。';

  @override
  String get desktopEnterChatName => 'チャット名を入力してください。';

  @override
  String get desktopContextPickerStale =>
      '接続先のパソコンが変わりました。コンテキストの選択を開き直してください。';

  @override
  String get desktopNoSkillList => 'パソコンからスキルの一覧が返されませんでした。';

  @override
  String get desktopNoPluginList => 'パソコンからプラグインの一覧が返されませんでした。';

  @override
  String get desktopNoFileMatches => 'パソコンから一致するファイルが返されませんでした。';

  @override
  String get desktopPairedDisconnectedOrChanged =>
      'ペアリング済みのパソコンとの接続が切れたか、パソコンが変わりました。';

  @override
  String get desktopPairedChangedRefreshOverview =>
      'ペアリング済みのパソコンが変わりました。概要を更新してください。';

  @override
  String get desktopPairedChangedRefreshChats =>
      'ペアリング済みのパソコンが変わりました。チャットを更新してください。';

  @override
  String get desktopIdentityMismatch =>
      'パソコンの識別情報またはセキュリティプロトコルがペアリング情報と一致しません。';

  @override
  String get desktopHandshakeUnverified => 'パソコンのハンドシェイク署名を検証できませんでした。';

  @override
  String get desktopHandshakeTimedOut => 'パソコンとの安全なハンドシェイクがタイムアウトしました。';

  @override
  String get desktopSecureConnectionRefused => 'パソコンが安全な接続を拒否しました。';

  @override
  String get desktopHandshakeInterrupted => '安全なハンドシェイク中にパソコンとの接続が途切れました。';

  @override
  String get desktopSecureConnectionRejected => 'パソコンとの安全な接続が拒否されました。';

  @override
  String get desktopInvalidFrame => 'パソコンから無効なデータを受信しました。';

  @override
  String get desktopSecureTransportFailed => 'パソコンとの安全な通信に失敗しました。';

  @override
  String get desktopUnencryptedRejected => 'パソコンからの暗号化されていない通信を拒否しました。';

  @override
  String get desktopPayloadDecodeFailed => 'パソコンから受信したデータの一部を読み取れませんでした。';

  @override
  String get desktopRequestFailed => 'パソコンへのリクエストに失敗しました。';

  @override
  String get desktopIsDisconnected => 'パソコンとの接続が切れています。';

  @override
  String get desktopConnectionChanged => 'パソコンとの接続が変わりました。';

  @override
  String get desktopRequestTimedOut =>
      'パソコンへのリクエストがタイムアウトしました。結果は不明です。再試行する前に更新してください。';

  @override
  String get desktopDisconnectedRefresh => 'パソコンとの接続が切れました。操作をやり直す前に更新してください。';

  @override
  String get desktopVerifiedHostRequired => '検証済みの保存済み Mac が必要です。';

  @override
  String get desktopResponseFailed =>
      'パソコンでこの応答を完了できませんでした。プロバイダーの設定を確認して再試行してください。';

  @override
  String get desktopWaitBeforeMovingProject =>
      'プロジェクトを移動する前に、実行中のチャット操作の完了を待ってください。';

  @override
  String get desktopProviderUnavailable =>
      'このチャットのプロバイダーを利用できません。パソコンで接続するか、別のプロバイダーを選んでください。';

  @override
  String get desktopReopenBeforeRestore => '変更を復元する前に、このチャットを開き直して内容を確認してください。';

  @override
  String get desktopSwitchCancelled => '切り替えをキャンセルしました。再接続するデバイスを選んでください。';

  @override
  String get desktopSelectionClearUnconfirmed =>
      '保存済みの選択が解除されたか確認できませんでした。デバイスのロックを解除し、保存済みの Mac を選んで復元してください。';

  @override
  String get desktopLinkIdentityUnavailable =>
      'このリンクに対応する保存済み Mac の識別情報が見つかりません。検証済みの Mac からチャットを開いてください。';

  @override
  String get desktopChooseMatchingMac =>
      'このリンクに対応する保存済みの Mac を選んでください。検証済みの識別情報が一致している必要があります。';

  @override
  String get desktopWaitingForMac => '選択した Mac を待っています。利用できるようになったら再試行してください。';

  @override
  String get desktopLinkedConversationUnavailable => 'リンク先のパソコンのチャットを利用できません。';

  @override
  String get desktopLinkedConversationLoadFailed =>
      'リンク先のチャットを読み込めませんでした。選択した Mac で再試行してください。';

  @override
  String get desktopDevicePreferencesLoadFailed =>
      'このデバイスの設定を読み込めませんでした。デバイスのロックを解除して再試行してください。';

  @override
  String get desktopSavedDesktopsOpenFailed =>
      '保存済みのパソコンを開けませんでした。デバイスのロックを解除してもう一度お試しください。';

  @override
  String get desktopModelUnavailable =>
      '選択したモデルはパソコンで利用できません。利用できるモデルを選んでください。';

  @override
  String get desktopStopRunsUnconfirmed =>
      '実行の停止を確認できませんでした。もう一方の Mac でまだ実行中の可能性があります。';

  @override
  String get desktopPairingIdentityReadFailed =>
      '安全なペアリングの識別情報を読み取れませんでした。デバイスのロックを解除してから「再接続」を選んでください。';

  @override
  String get desktopRuntimeOtherHistory => '実行環境から別のチャットの履歴が返されました。';

  @override
  String get desktopLinkedHistoryUnverified => 'リンク先のチャット履歴を検証できませんでした。';

  @override
  String get desktopIdleChatAndProjectRequired =>
      '待機中の現在のチャットと、有効なプロジェクトが必要です。';

  @override
  String get desktopProjectChangeUnverified =>
      '実行環境でこのチャットのプロジェクト変更が確認されませんでした。';

  @override
  String get desktopForkUnidentified =>
      '実行環境で作成されたフォークを特定できませんでした。更新してから再試行してください。';

  @override
  String get desktopForkNotSeparate => '実行環境で別のチャットが作成されませんでした。';

  @override
  String get desktopForkUnsupported =>
      'この実行環境はチャットのフォークに対応していません。パソコンで DJL を更新してから再試行してください。';

  @override
  String get desktopReadSettingsFirst => '新しいチャットを作成する前に、保存済みの設定を読み込んでください。';

  @override
  String get desktopConnectMacWithModels =>
      '新しいチャットを作成する前に、利用できるモデルがある Mac に接続してください。';

  @override
  String get desktopChatCreatedElsewhere =>
      'パソコンが別のプロジェクトフォルダにチャットを作成しました。ローカルの下書きは残っています。';

  @override
  String get desktopDraftContextOtherFolder =>
      '下書きのコンテキストは別のプロジェクトフォルダのものです。削除してから選び直してください。';

  @override
  String get desktopQueuedPlanModelRequired =>
      '待機中のこの下書きを送信する前に、計画モードに対応した利用可能なモデルを選んでください。';

  @override
  String get desktopChooseModelFirst => '先に利用できるモデルを選んでください。';

  @override
  String get desktopRunChangedBeforeQueue =>
      '待機中のメッセージを送る前に、実行中の処理が変わりました。再開する前に更新してください。';

  @override
  String get desktopRunChangedBeforeSteer =>
      '実行中の処理が変わりました。もう一度指示を追加する前に更新してください。';

  @override
  String get desktopModelBeforeLeavingPlan => '計画モードを終了する前に、利用できるモデルを選んでください。';

  @override
  String get desktopPlanModeUnsupported =>
      'この実行環境は計画モードに対応していないため、通常のメッセージとして送信しました。';

  @override
  String get desktopRunIdPending =>
      '実行中の処理の ID がまだ発行されていません。しばらくしてからもう一度お試しください。';

  @override
  String get desktopRuntimeOtherTurnPage => '実行環境から別のチャットのやり取りが返されました。';

  @override
  String get desktopRuntimeNoTurnState => '実行環境からこのチャットのやり取りの状態が返されませんでした。';

  @override
  String get desktopRuntimeInvalidTurnState => '実行環境から無効なやり取りの状態が返されました。';

  @override
  String get desktopRetryApprovalUnacknowledged => 'パソコンで再試行の承認が確認されませんでした。';

  @override
  String get desktopDeviceFallbackName => 'デバイス';

  @override
  String get desktopDeviceChangeUnconfirmed =>
      '変更を確認できませんでした。保存された名前を確認して再試行してください。このデバイスが削除または置き換えられた場合は、編集画面を閉じて開き直してください。';

  @override
  String get desktopPreferencesReloadFailed =>
      'このデバイスの設定を確認または再読み込みできませんでした。デバイスのロックを解除して再試行してから、もう一度保存してください。';

  @override
  String get desktopRunChangedBeforePlan =>
      '実行中の処理が変わりました。この計画を実行する前に更新してください。';

  @override
  String get desktopQueueMessageArrived =>
      'メッセージが届きました。待機中のメッセージを再開する前に、結果を確認してください。';

  @override
  String get desktopQueueDeliveryUnconfirmed =>
      '待機中のメッセージの送信を確認できませんでした。再試行する前にこのチャットを開き直してください。';

  @override
  String get desktopRequestFromEarlierSession =>
      'このリクエストは以前のパソコンのセッションのものです。チャットを更新してください。';

  @override
  String get desktopUndoReconnect => '取り消しを確認する前に、パソコンに再接続してください。';

  @override
  String get desktopUndoReopen => '変更を取り消す前に、このチャットを開き直して応答を確認してください。';

  @override
  String get desktopUndoRepoBusy =>
      'このリポジトリでチャットが実行中です。応答を取り消すのは少し待ってからにしてください。';

  @override
  String get desktopUndoWaitResponse => '変更を取り消す前に、実行中の応答が終わるのを待ってください。';

  @override
  String get desktopUndoPersistFailed => '取り消しの結果を保存できませんでした。';

  @override
  String get desktopUndoRepoUnverified =>
      '応答のリポジトリを検証できませんでした。再接続してもう一度確認してください。';

  @override
  String get desktopReconnectToRefreshModels => 'モデルを更新するには、パソコンに再接続してください。';

  @override
  String get desktopAccessModeNotApplied => '要求したアクセスモードがパソコンに適用されませんでした。';

  @override
  String get desktopSubagentOfflineCached => 'オフライン · キャッシュされた詳細';

  @override
  String get desktopSubagentLoading => 'エージェントの詳細を読み込み中';

  @override
  String get desktopSubagentLoaded => '詳細を読み込みました';

  @override
  String get desktopSubagentIdentityUnknown => 'エージェントを特定できません';

  @override
  String get desktopSubagentLoadFailed => 'エージェントの詳細を読み込めませんでした';

  @override
  String get desktopSavedDeviceChanged => 'この保存済みデバイスが変わりました。もう一度選んでください。';

  @override
  String get desktopMacIdentityMismatch => '選択した Mac の識別情報が一致しませんでした。';

  @override
  String get desktopOfflineChatsOpenFailed =>
      'オフラインのチャットを開けませんでした。デバイスのロックを解除するか、再接続して読み込んでください。';

  @override
  String get desktopOfflineChatsSaveFailed =>
      'オフラインのチャットを保存できませんでした。デバイスのロックを解除してもう一度お試しください。';

  @override
  String get desktopChoosePairedDesktop => 'ペアリング済みのパソコンを選んでください。';

  @override
  String get desktopSavedLocallyUnconfirmed =>
      'このデバイスに保存しました。パソコン側の変更は確認できなかったため、再試行する前に更新してください。';

  @override
  String get desktopImageEmptyOrTooLarge => '選択した画像は空か、大きすぎます。小さい画像を選んでください。';

  @override
  String get desktopImageUnsupported => '選択したファイルは対応している画像形式ではありません。';

  @override
  String get desktopImageResizeFailed =>
      'このデバイスでは画像のサイズを変更できませんでした。1600 ピクセル以下の画像を選んでください。';

  @override
  String get desktopImageTooLarge => '選択した画像が大きすぎます。小さい画像を選んでください。';

  @override
  String get desktopContextFolderChanged =>
      'プロジェクトフォルダが変わりました。既存のコンテキストを削除するか、元のフォルダに戻ってください。';

  @override
  String get desktopPickerOpenFailed => '選択画面を開けませんでした。もう一度お試しください。';

  @override
  String get desktopWorktreeStale =>
      '接続先のパソコンまたはチャットが変わりました。このワークツリーの操作を開き直してください。';

  @override
  String get desktopNotGitRepository => 'このフォルダは Git リポジトリではなくなりました。';

  @override
  String get desktopBranchAlreadyExists => 'ブランチはすでに存在します';

  @override
  String get desktopWorktreeUnidentified =>
      'パソコンで新しいワークツリーを特定できませんでした。更新してから再試行してください。';

  @override
  String get desktopForkUnverified => 'フォークの結果を検証できませんでした。';

  @override
  String get desktopHandoffUnverified =>
      'パソコンで引き継ぎ先が確認されませんでした。再試行する前に両方のフォルダを確認してください。';

  @override
  String get desktopWorktreePathUnavailable => 'ワークツリーのパスを利用できません。';

  @override
  String get desktopLocalCheckoutUnresolved =>
      'このワークツリーに対応するローカルのチェックアウトが見つかりませんでした。';

  @override
  String get desktopWorktreeHandoffFailed => 'ワークツリーへの引き継ぎに失敗しました';

  @override
  String get desktopWorktreeForkFailed => 'ワークツリーへのフォークに失敗しました';

  @override
  String desktopAccessModeNotAppliedBy(String method) {
    return '$method で選択したアクセスモードが適用されませんでした。';
  }

  @override
  String desktopApprovalReviewerNotApplied(String method) {
    return '$method で選択した承認者が適用されませんでした。';
  }

  @override
  String desktopApprovalPolicyNotApplied(String method) {
    return '$method で選択した承認ポリシーが適用されませんでした。';
  }

  @override
  String desktopSandboxNotApplied(String method) {
    return '$method で選択したサンドボックスの権限が適用されませんでした。';
  }

  @override
  String desktopForkResultUnknown(String error) {
    return '$error フォークの結果が不明な可能性があります。更新してから再試行してください。';
  }

  @override
  String desktopSendResultUnknown(String error) {
    return '$error 送信の結果が不明な可能性があります。チャットを更新してから再試行してください。';
  }

  @override
  String desktopQueuePaused(String reason) {
    return '待機キューを一時停止しました：$reason';
  }

  @override
  String desktopWorktreeExists(String branch) {
    return '「$branch」のワークツリーはすでに存在します。別の名前を選んでください。';
  }

  @override
  String desktopRollbackFailed(String reason) {
    return '追跡中の変更を自動で元に戻せませんでした：$reason。再試行する前に両方のフォルダを確認してください。';
  }

  @override
  String desktopWorktreeKeptAt(String path) {
    return '新しいワークツリーは $path に残してあります。再試行する前に確認してください。';
  }

  @override
  String get desktopWorktreeMayExist =>
      'ワークツリーが作成された可能性があり、そのまま残してあります。再試行する前に更新して確認してください。';

  @override
  String get pairingEnterTenCharCode =>
      'パソコンの「リモート」設定に表示されている 10 文字のコードを入力してください。';

  @override
  String get pairingSecureRelayRequired => 'ペアリングには安全な中継サーバーの URL が必要です。';

  @override
  String get pairingPairedMac => 'ペアリング済みの Mac';

  @override
  String get pairingNotAPairingCode =>
      'これは DJL のペアリング用 QR コードや貼り付け用コードではありません。';

  @override
  String get pairingUpdateDesktop =>
      'パソコンの DJL を更新してください。このペアリングは別のプロトコルを使っています。';

  @override
  String get pairingProofMismatch =>
      'ペアリングコードまたは QR コードが一致しませんでした。新しいコードを生成して、もう一度お試しください。';

  @override
  String get pairingInvalidIdentifier => 'デバイスまたはセッションの ID が無効です。';

  @override
  String get pairingInvalidIdentityKey => 'パソコンの識別キーが無効です。';

  @override
  String get pairingCodeExpired =>
      'このペアリングコードは有効期限が切れています。Mac で新しいコードを生成してください。';

  @override
  String get pairingPrefsUnavailable => '保存済みのデバイス設定を利用できません。';

  @override
  String get pairingDeviceChangedReopen =>
      'この保存済みデバイスが変わりました。編集画面を閉じて開き直してください。';

  @override
  String get pairingRecoverSelectionFailed =>
      '保存済みの選択を復元できませんでした。Mac を選ぶ前に、デバイスのロックを解除して再試行してください。';

  @override
  String get pairingDeviceChangedChooseAgain => '保存済みのデバイスが変わりました。もう一度選んでください。';

  @override
  String get pairingConfirmSavedFailed =>
      '選択した Mac が保存されたか確認できませんでした。デバイスのロックを解除し、保存済みの Mac を選んで復元してください。';

  @override
  String get pairingRelayDifferentIdentity =>
      '信頼済みの中継サーバーから別のパソコンの識別情報が返されました。もう一度ペアリングしてください。';

  @override
  String get pairingRelayTemporarilyUnavailable => 'パソコンの中継サーバーは一時的に利用できません。';

  @override
  String get pairingRelayInvalidResponse => 'パソコンの中継サーバーから無効な応答が返されました。';

  @override
  String get pairingTrustedComputerOffline => '信頼済みのパソコンがオフラインです。';

  @override
  String get pairingServiceUnavailable => 'パソコンのペアリングサービスを利用できません。';

  @override
  String get pairingRelayUnreachable => 'パソコンの中継サーバーに接続できませんでした。';

  @override
  String get pairingRelayUnsupportedMethod => 'この中継サーバーはこのペアリング方法に対応していません。';

  @override
  String get pairingRelayRequired => '中継サーバーの URL が必要です。';

  @override
  String get pairingEnterOneTimeCode => 'ワンタイムコードを入力';

  @override
  String get pairingFindCodeHint => 'コードは DJL Desktop の「設定 → リモート」で確認できます。';

  @override
  String get pairingCodeLabel => 'ペアリングコード';

  @override
  String get pairingRelayConfigured => '中継サーバー設定済み';

  @override
  String get pairingRelaySettings => '中継サーバーの設定';

  @override
  String get pairingInProgress => 'ペアリング中…';

  @override
  String get pairingPair => 'ペアリング';

  @override
  String get pairingSecureDetailsTitle => '安全なペアリングの詳細';

  @override
  String get pairingSecureDetailsBody =>
      'パソコンの DJL で「設定 → リモート」を開きます。表示されたペアリングデータを貼り付けるか、ワンタイムコードで使う中継サーバーを設定してください。';

  @override
  String get pairingPasteCode => 'ペアリングコードを貼り付け';

  @override
  String get pairingPayloadHint => 'RMX1:… または QR の JSON';

  @override
  String get pairingPairSecurely => '安全にペアリング';

  @override
  String get pairingRelayUrlLabel => 'パソコンの中継サーバーの URL';

  @override
  String get pairingSwitchDeviceTitle => 'デバイスを切り替えますか？';

  @override
  String get pairingSwitchDeviceBody =>
      'DJL はこの Mac で実行中の処理の停止を試み、もう一方のデバイスのチャットを読み込み直します。';

  @override
  String get pairingSwitch => '切り替え';

  @override
  String get pairingCancellingSwitch => '切り替えをキャンセル中…';

  @override
  String get pairingSwitchingDevice => 'デバイスを切り替え中…';

  @override
  String get pairingCancelSwitch => '切り替えをキャンセル';

  @override
  String get pairingChooseMatchingMac =>
      'このリンクの検証済み識別情報と一致する、保存済みの Mac を選んでください。';

  @override
  String get pairingChooseMacForLink => 'リンク先のチャットを開くには、保存済みの Mac を選んでください。';

  @override
  String get pairingOpeningLinkedConversation => 'リンク先のパソコンのチャットを開いています…';

  @override
  String get pairingRetryDesktopLink => 'リンクを開き直す';

  @override
  String get pairingCancelDesktopLink => 'リンクを開くのをキャンセル';

  @override
  String get pairingMatchesLinkIdentity => 'このリンクの検証済み識別情報と一致';

  @override
  String get pairingDifferentIdentity => 'パソコンの識別情報が異なります';

  @override
  String get pairingSavedVerifiedIdentity => '保存・検証済みのパソコンの識別情報';

  @override
  String get pairingReconnect => '再接続';

  @override
  String get pairingConnections => '接続';

  @override
  String get pairingScanQrCode => 'QR コードをスキャン';

  @override
  String get pairingPairWithCode => 'コードでペアリング';

  @override
  String get pairingConnectToDesktop => 'DJL Desktop に接続';

  @override
  String get pairingChooseSavedMac => '保存済みの Mac を選択';

  @override
  String get pairingFirstPairingHint =>
      'Mac または Windows PC で DJL を開き、「設定 → リモート」に進んでください。';

  @override
  String get pairingGetDesktop => 'Mac・PC 版 DJL を入手';

  @override
  String get pairingScanTitle => 'DJL Desktop の QR をスキャン';

  @override
  String get pairingCameraDenied =>
      'カメラへのアクセスが許可されていません。代わりにペアリングコードを貼り付けることもできます。';

  @override
  String get pairingScanUnsupported =>
      'このデバイスでは QR をスキャンできません。代わりにペアリングコードを貼り付けることもできます。';

  @override
  String get pairingCameraUnavailable =>
      'カメラを利用できません。代わりにペアリングコードを貼り付けることもできます。';

  @override
  String get pairingSwitchDevice => 'デバイスを切り替え';

  @override
  String get pairingSwitchTo => '切り替え先';

  @override
  String get pairingStatusSwitching => '切り替え中…';

  @override
  String get pairingStatusConnected => '接続済み';

  @override
  String get pairingStatusSelected => '選択中';

  @override
  String get pairingStatusPrevious => '前回使用';

  @override
  String get pairingStatusSaved => '保存済み';

  @override
  String get pairingForget => '削除';

  @override
  String get pairingForgetDeviceTitle => 'このデバイスを削除しますか？';

  @override
  String pairingForgetDeviceBody(String name) {
    return '$name はこのスマホから削除されます。再接続するには、もう一度 QR コードをスキャンしてください。';
  }

  @override
  String get pairingActiveBadge => '使用中';

  @override
  String pairingShowInMenu(String name) {
    return 'デバイスメニューに $name を表示';
  }

  @override
  String get pairingMenuVisibilityUnavailable => 'メニューの表示を設定できません';

  @override
  String get pairingClose => '閉じる';

  @override
  String get pairingActiveDevice => '使用中のデバイス';

  @override
  String pairingActiveDeviceNamed(String name) {
    return '使用中のデバイス：$name';
  }

  @override
  String pairingDevicesInMenu(int count) {
    return 'メニューに $count 台のデバイス';
  }

  @override
  String get pairingDevices => 'デバイス';

  @override
  String get pairingNoDevices => 'ペアリング済みのデバイスはまだありません。';

  @override
  String get pairingScanQr => 'QR をスキャン';

  @override
  String get pairingForgetDesktop => 'パソコンを削除';

  @override
  String get pairingRecencyNow => 'たった今';

  @override
  String pairingRecencyMinutes(int count) {
    return '$count 分';
  }

  @override
  String pairingRecencyHours(int count) {
    return '$count 時間';
  }

  @override
  String pairingRecencyDays(int count) {
    return '$count 日';
  }

  @override
  String pairingRecencyAgo(String age) {
    return '$age前';
  }

  @override
  String pairingRecencyIn(String age) {
    return '$age後';
  }

  @override
  String get chatUiCloseNavigation => 'ナビゲーションを閉じる';

  @override
  String get chatUiRuntime => '実行場所';

  @override
  String get chatUiContinueIn => '続ける場所';

  @override
  String get chatUiLocal => 'ローカル';

  @override
  String get chatUiWorktree => 'ワークツリー';

  @override
  String get chatUiCurrentBranch => '現在のブランチ';

  @override
  String get chatUiCollapseProjectControls => 'プロジェクトの設定を折りたたむ';

  @override
  String get chatUiExpandProjectControls => 'プロジェクトの設定を展開';

  @override
  String get chatUiQueuedMessages => '待機中のメッセージ';

  @override
  String get chatUiQueuedHint => '待機中の追加メッセージをシートで表示します';

  @override
  String get chatUiQueued => '待機中';

  @override
  String get chatUiQueuedNeedsPlanModel =>
      'この下書きを入力欄に移す前に、計画モードに対応したモデルを選んでください。';

  @override
  String chatUiImageCount(int count) {
    return '画像 $count 枚';
  }

  @override
  String get chatUiAttachedContext => '添付したコンテキスト';

  @override
  String get chatUiMoveDraftToInput => '入力欄に移動';

  @override
  String get chatUiSteerQueued => '待機中のメッセージを今すぐ指示として追加';

  @override
  String get chatUiSteer => '指示を追加';

  @override
  String get chatUiDeleteQueued => '待機中のメッセージを削除';

  @override
  String get chatUiCopyResponse => '応答をコピー';

  @override
  String get chatUiCopied => 'コピーしました';

  @override
  String get chatUiEffortLow => '低';

  @override
  String get chatUiEffortMedium => '中';

  @override
  String get chatUiEffortHigh => '高';

  @override
  String get chatUiEffortExtraHigh => '最高';

  @override
  String get chatUiLoading => '読み込み中…';

  @override
  String get chatUiSelectModel => 'モデルを選択';

  @override
  String get chatUiModel => 'モデル';

  @override
  String get chatUiSpeed => '速度';

  @override
  String get chatUiSpeedFast => '高速';

  @override
  String get chatUiSpeedNormal => '標準';

  @override
  String get chatUiChatControls => 'チャットの設定';

  @override
  String get chatUiControlsConnectionChanged => '接続が変わりました。チャットの設定を開き直してください。';

  @override
  String get chatUiLoadingModelsEllipsis => 'モデルを読み込み中…';

  @override
  String get chatUiOtherModels => 'その他のモデル…';

  @override
  String get chatUiIntelligence => '推論レベル';

  @override
  String get chatUiCopySessionId => 'セッション ID をコピー';

  @override
  String get chatUiRenameChat => 'チャット名を変更';

  @override
  String get chatUiUnpinChat => 'ピン留めを解除';

  @override
  String get chatUiPinChat => 'チャットをピン留め';

  @override
  String get chatUiUnarchiveChat => 'アーカイブを解除';

  @override
  String get chatUiArchiveChat => 'チャットをアーカイブ';

  @override
  String get chatUiRemoveFromDevice => 'このデバイスから削除';

  @override
  String get chatUiSessionIdCopied => 'セッション ID をコピーしました。';

  @override
  String get chatUiRemoveChatTitle => 'このチャットをこのデバイスから削除しますか？';

  @override
  String get chatUiRemoveChatBodyArchived =>
      'チャットはパソコンに残ります。サブエージェントのチャットはこのデバイスでアーカイブされます。';

  @override
  String get chatUiRemoveChatBody =>
      'チャットはパソコンに残り、パソコン側でもアーカイブされます。サブエージェントのチャットはこのデバイスでアーカイブされます。';

  @override
  String get chatUiRemoveChat => 'チャットを削除';

  @override
  String get chatUiChatName => 'チャット名';

  @override
  String get chatUiSaveName => '名前を保存';

  @override
  String get chatUiCopyPathFailed => 'パスをコピーできませんでした。もう一度お試しください。';

  @override
  String get chatUiConversationChanged => 'チャットが変わりました';

  @override
  String get chatUiCloseLocation => '場所を閉じる';

  @override
  String get chatUiThreadLabel => 'スレッド';

  @override
  String get chatUiRenameConversation => 'チャット名を変更';

  @override
  String get chatUiPathLabel => 'パス';

  @override
  String get chatUiPathCopied => 'パスをコピーしました';

  @override
  String get chatUiCopyPath => 'パスをコピー';

  @override
  String get chatUiLocationStale => 'このシートを閉じて、チャットの場所を開き直してください。';

  @override
  String get chatUiMoreThreadActions => 'スレッドのその他の操作';

  @override
  String chatUiPreviousMessages(int count) {
    return '以前のメッセージ $count 件';
  }

  @override
  String chatUiMoreToolCalls(int count) {
    return 'ほか $count 件のツール呼び出し';
  }

  @override
  String chatUiRanCommands(int count) {
    return '$count 件のコマンドを実行';
  }

  @override
  String chatUiCommandsFailed(int count) {
    return '$count 件失敗';
  }

  @override
  String chatUiCommandsStopped(int count) {
    return '$count 件停止';
  }

  @override
  String get chatUiCollapsePreviousMessages => '以前のメッセージを折りたたむ';

  @override
  String get chatUiExpandPreviousMessages => '以前のメッセージを展開';

  @override
  String get chatUiCollapseCommands => 'コマンドを折りたたむ';

  @override
  String get chatUiExpandCommands => 'コマンドを展開';

  @override
  String get chatUiCollapseToolCalls => 'ツール呼び出しを折りたたむ';

  @override
  String get chatUiExpandToolCalls => 'ツール呼び出しを展開';

  @override
  String get chatUiQuestions => '質問';

  @override
  String chatUiQuestionPage(int page, int total) {
    return '$page/$total';
  }

  @override
  String get chatUiQuestionResponseUnknown =>
      '以前の回答がすでに送信されている可能性があります。もう一度回答する前に、パソコンの状態を確認してください。';

  @override
  String get chatUiBack => '戻る';

  @override
  String get chatUiQuestionClosing => '閉じています…';

  @override
  String get chatUiQuestionEsc => '閉じる';

  @override
  String get chatUiNext => '次へ';

  @override
  String get chatUiResponseSent => '回答を送信しました';

  @override
  String get chatUiSendingDots => '送信中…';

  @override
  String get chatUiSend => '送信';

  @override
  String chatUiSelectUpTo(int limit) {
    return '$limit 個まで選択';
  }

  @override
  String get chatUiOtherAnswer => 'その他の回答';

  @override
  String get chatUiYourAnswer => 'あなたの回答';

  @override
  String get settingsFontSystem => 'システム';

  @override
  String get settingsUnlockReason => 'DJL とリモートのコーディングセッションのロックを解除します。';

  @override
  String get settingsUsageWeekly => '週間';

  @override
  String settingsUsageWeeks(int count) {
    return '$count 週';
  }

  @override
  String settingsUsageDays(int count) {
    return '$count 日';
  }

  @override
  String settingsUsageHours(int count) {
    return '$count 時間';
  }

  @override
  String settingsUsageMinutes(int count) {
    return '$count 分';
  }

  @override
  String get settingsThemeSystem => 'システム';

  @override
  String get settingsThemeLight => 'ライト';

  @override
  String get settingsThemeDark => 'ダーク';

  @override
  String get settingsAppearance => '外観';

  @override
  String get settingsFont => 'フォント';

  @override
  String get settingsLiquidGlass => 'Liquid Glass';

  @override
  String get settingsTheme => 'テーマ';

  @override
  String get settingsNotifications => '通知';

  @override
  String get settingsInAppAlertsFooter => 'ほかのチャットのタスクが完了したときにバナーを表示します。';

  @override
  String get settingsInAppAlerts => 'アプリ内通知';

  @override
  String get settingsVoice => '音声';

  @override
  String get settingsVoiceFooter => '音声入力の内容は送信前に確認できます。返信の読み上げにはデバイスの音声を使います。';

  @override
  String get settingsSpeakReplies => '新しい返信を読み上げる';

  @override
  String get settingsRetryReading => '設定を再読み込み';

  @override
  String get settingsErrorPartialSave =>
      '一部のデフォルト設定が途中までしか保存されていない可能性があります。再読み込みした内容を確認して再試行してください。';

  @override
  String get settingsErrorPartialReload =>
      'デフォルト設定が途中までしか保存されていない可能性があり、設定を再読み込みできませんでした。先に設定を再読み込みしてください。';

  @override
  String get settingsErrorRead => '保存済みの設定を読み込めませんでした。設定を保持するには再試行してください。';

  @override
  String get settingsErrorSave => 'この設定を保存できませんでした。以前の設定のままです。もう一度お試しください。';

  @override
  String settingsUsageResets(String when) {
    return '$whenにリセット';
  }

  @override
  String get settingsUsage => '使用状況';

  @override
  String get settingsUsageFooter => 'ペアリング済みのデバイスから取得した、アカウント全体のレート制限です。';

  @override
  String get settingsUsageLoading => '現在の上限を読み込み中…';

  @override
  String get settingsUsageConnect => '現在の上限を読み込むには、ペアリング済みのデバイスに接続してください。';

  @override
  String get settingsUsageUnavailable => 'このアカウントのレート制限は取得できません。';

  @override
  String settingsUsageLeft(int percent) {
    return '残り $percent%';
  }

  @override
  String get settingsUsageStale => '前回取得した上限です。最新の情報にするには再接続するか更新してください。';

  @override
  String get settingsUsageRefreshTooltip => '使用状況を更新';

  @override
  String get settingsUsageRefreshing => '更新中…';

  @override
  String get settingsUsageRefresh => '更新';

  @override
  String get settingsUsageRuntimeUnavailable => 'この実行環境のレート制限は取得できません。';

  @override
  String get settingsUsageLoadFailed => '現在の上限を読み込めませんでした。もう一度お試しください。';

  @override
  String get settingsTitle => '設定';

  @override
  String get settingsOpenCloudChat => 'DJL Cloud のチャットを開く';

  @override
  String get settingsSignInCloud => 'DJL Cloud にログイン';

  @override
  String get settingsCloudSubtitle => 'Mac がなくても、チャット・画像生成・バックグラウンドタスクが使えます';

  @override
  String get settingsDevicePermissions => 'デバイスの権限';

  @override
  String get settingsDevice => 'デバイス';

  @override
  String get settingsMyMacs => 'マイ Mac';

  @override
  String get settingsLocked => 'DJL はロックされています';

  @override
  String get settingsPreparing => 'DJL を準備中';

  @override
  String get settingsStartFailed => 'DJL を起動できませんでした';

  @override
  String get settingsPrivateNote => '離れている間も、リモートセッションは非公開に保たれます。';

  @override
  String get settingsRetryStartup => 'もう一度起動';

  @override
  String get settingsUnlockHint => 'Face ID、Touch ID、またはデバイスのパスコードで認証します';

  @override
  String get settingsUnlocking => 'ロックを解除中…';

  @override
  String get settingsUnlock => 'DJL のロックを解除';

  @override
  String get settingsLockSetup =>
      'DJL のロックを解除するには、Face ID、Touch ID、またはデバイスのパスコードを設定してください。';

  @override
  String get settingsLockStillLocked =>
      'DJL はまだロックされています。続けるには DJL のロックを解除してください。';

  @override
  String get settingsLockCancelled =>
      '認証がキャンセルされたか、利用できませんでした。続けるには DJL のロックを解除してください。';

  @override
  String get settingsBridgeUnknown => '不明';

  @override
  String get settingsBridgeInstalled => 'インストール済み';

  @override
  String get settingsBridgeUpToDate => '最新です';

  @override
  String get settingsBridgeUpdateAvailable => 'アップデートあり';

  @override
  String get settingsBridgeDifferentBuild => '別のビルド';

  @override
  String get settingsBridgeConnectHint =>
      'Mac の DJL のバージョンを確認するには、Mac に接続してください。';

  @override
  String get settingsBridgeStaleHint => '前回確認したバージョンです。再接続するともう一度確認できます。';

  @override
  String get settingsBridgeMatches => 'Mac の DJL は最新のリリースです。';

  @override
  String get settingsBridgeNewer =>
      'DJL の新しいリリースがあります。Mac の DJL をアップデートしてください。';

  @override
  String get settingsBridgeDifferent => 'Mac で最新のリリースとは異なるビルドが実行されています。';

  @override
  String get settingsBridgeStatus => 'ステータス';

  @override
  String settingsBridgeLastKnown(String status) {
    return '前回の確認 · $status';
  }

  @override
  String get settingsVersion => 'バージョン';

  @override
  String get settingsBridgeLatest => '最新';

  @override
  String get settingsBridgeUpdate => 'Mac の DJL をアップデート';

  @override
  String get settingsBridgeCheck => 'DJL のアップデートを確認';

  @override
  String settingsElapsedDays(int days) {
    return '$days 日';
  }

  @override
  String settingsElapsedHours(int hours, int minutes) {
    return '$hours 時間 $minutes 分';
  }

  @override
  String settingsElapsedMinutes(int minutes, int seconds) {
    return '$minutes 分 $seconds 秒';
  }

  @override
  String settingsElapsedSeconds(int seconds) {
    return '$seconds 秒';
  }

  @override
  String get settingsArchived => 'アーカイブ済み';

  @override
  String get settingsArchivedChats => 'アーカイブ済みのチャット';

  @override
  String settingsArchivedSaved(int count) {
    return 'このデバイスに $count 件保存';
  }

  @override
  String get settingsArchivedActions => 'アーカイブ済みチャットの操作';

  @override
  String get settingsUnarchive => 'アーカイブを解除';

  @override
  String get settingsRemoveFromPhone => 'スマホから削除';

  @override
  String get settingsRemove => '削除';

  @override
  String get settingsNoArchived => 'アーカイブ済みのチャットはありません';

  @override
  String settingsRemoveTitle(String title) {
    return 'このスマホから「$title」を削除しますか？';
  }

  @override
  String get settingsRemoveBody =>
      'このスマホの DJL からチャットを削除するだけです。ペアリング済みのパソコンからは何も削除されません。';

  @override
  String get settingsCloudRefreshFailed => 'アカウントと Cloud の設定を更新できませんでした。';

  @override
  String get settingsLinkFailed => 'このリンクを開けませんでした。もう一度お試しください。';

  @override
  String get settingsOpenNotificationsFailed => '通知設定を開けませんでした。もう一度お試しください。';

  @override
  String get settingsAlertsUnavailable => '利用不可';

  @override
  String get settingsAlertsOff => 'オフ';

  @override
  String get settingsAlertsEnabled => 'オン';

  @override
  String get settingsAlertsNotEnabled => '未設定';

  @override
  String get settingsBack => '戻る';

  @override
  String get settingsOpenNavigation => 'ナビゲーションを開く';

  @override
  String get settingsRetry => '再試行';

  @override
  String get settingsAccount => 'アカウント';

  @override
  String get settingsDjlAccount => 'DJL アカウント';

  @override
  String get settingsAvailableCredits => '利用可能なクレジット';

  @override
  String get settingsConversations => 'チャット';

  @override
  String get settingsArchivedChatsRow => 'アーカイブ済みのチャット';

  @override
  String get settingsRemoteAccess => 'リモートアクセス';

  @override
  String get settingsBackgroundAlerts => 'バックグラウンド通知';

  @override
  String get settingsEnableBackgroundAlerts => 'バックグラウンド通知をオン';

  @override
  String get settingsOpenNotificationSettings => '通知設定を開く';

  @override
  String get settingsVoiceIos =>
      '音声入力の内容は iPhone の中だけで処理されます。送信前にテキストを確認できます。返信の読み上げには iPhone の音声を使います。';

  @override
  String get settingsVoiceDevice =>
      '音声入力の内容はこのデバイスの中だけで処理されます。送信前にテキストを確認できます。返信の読み上げにはデバイスの音声を使います。';

  @override
  String get settingsAbout => '情報';

  @override
  String get settingsTerms => '規約';

  @override
  String get settingsPrivacy => 'プライバシー';

  @override
  String get settingsRetryLocalPrefs => 'このデバイスの設定を再読み込み';

  @override
  String get settingsDeviceNameOnPhone => 'このスマホでのデバイス名';

  @override
  String get settingsEditDeviceNameTooltip => 'デバイス名を編集';

  @override
  String get settingsClose => '閉じる';

  @override
  String get settingsEditDeviceNameTitle => 'デバイス名を編集';

  @override
  String get settingsDeviceName => 'デバイス名';

  @override
  String get settingsNicknameNote =>
      'このニックネームはこのスマホにのみ保存され、このデバイスが表示されるすべての場所で使われます。';

  @override
  String get settingsDeviceChanged => 'この保存済みデバイスが変わりました。編集画面を閉じて開き直してください。';

  @override
  String get settingsUseDefault => 'デフォルトに戻す';

  @override
  String get settingsSave => '保存';

  @override
  String get settingsAboutFooter =>
      'スマホとペアリング済みデバイスの間のチャットは、エンドツーエンドで暗号化されています。';

  @override
  String get settingsHowDjlWorks => 'DJL のしくみ';

  @override
  String get settingsChatSupport => 'チャットとサポート';

  @override
  String get settingsPrivacyPolicy => 'プライバシーポリシー';

  @override
  String get settingsTermsOfUse => '利用規約';

  @override
  String get settingsAboutRouteBridgeDevice => 'ペアリング済みデバイスのブリッジ';

  @override
  String get settingsAboutRouteBridge => 'ブリッジ';

  @override
  String settingsAboutRouteLabel(String from, String to, String via) {
    return '$from から $via 経由で $to へ';
  }

  @override
  String get settingsAboutIntro => 'スマホから **Codex** を操作できます。';

  @override
  String get settingsAboutIntroNote =>
      'Codex の実行環境はペアリング済みのデバイス上にあります。スマホは中継サーバー経由でつながる、安全なリモコンです。';

  @override
  String get settingsAboutHowItWorks => 'しくみ';

  @override
  String get settingsAboutBridge =>
      'ペアリング済みのデバイスでは軽量な **ブリッジ** が動いていて、WebSocket で **中継サーバー** に接続します。';

  @override
  String get settingsAboutStep1 => 'スマホからプロンプトを送信します。';

  @override
  String get settingsAboutStep2 => 'プロンプトは中継サーバーを経由して、ペアリング済みデバイスのブリッジに届きます。';

  @override
  String get settingsAboutStep3 =>
      'ブリッジが JSON-RPC で `codex app-server` に転送します。';

  @override
  String get settingsAboutStep4 => '応答は同じ経路でリアルタイムに戻ってきます。';

  @override
  String get settingsAboutWorkspaceNote =>
      'ワークスペースのツールやファイル編集は、ペアリング済みのデバイス上で実行されます。中継サーバーは暗号化された通信を転送するだけで、ワークスペースを実行することはありません。';

  @override
  String get settingsAboutArchitecture => 'アーキテクチャ';

  @override
  String get settingsAboutRelay => '中継サーバー';

  @override
  String get settingsAboutRelayIntro =>
      '軽量な WebSocket サーバーが、スマホとペアリング済みデバイスの間でメッセージを転送します。';

  @override
  String get settingsAboutRelayDiscovery =>
      'セッションの検出を行い、スマホがデバイス上の稼働中のセッションを見つけられるようにします。';

  @override
  String get settingsAboutRelayPrivate => 'ハンドシェイク後は、復号されたメッセージの内容を見ることはありません。';

  @override
  String get settingsAboutRelayMetadata =>
      'セッション ID、デバイス ID、タイミングなどの接続メタデータは参照します。';

  @override
  String get settingsAboutRelaySelfHost =>
      '中継サーバーは **セルフホスト** することも、ブリッジに設定されたホスト型のエンドポイントを使うこともできます。';

  @override
  String get settingsAboutAppServerIntro =>
      'Codex の実行環境では、ブリッジは Codex クライアントが使う JSON-RPC インターフェースである **`codex app-server`** に接続します。';

  @override
  String get settingsAboutAppServerSessions =>
      'スマホでのチャットは、完全な Codex セッションとして扱われます。';

  @override
  String get settingsAboutAppServerRollout =>
      'Codex は `~/.codex/sessions/` に JSONL の rollout ファイルを作成します。';

  @override
  String get settingsAboutAppServerHandoff =>
      'スマホのスレッドをペアリング済みのデバイスで続けるには、DJL の「パソコンで続ける」を使います。';

  @override
  String get settingsAboutPairing => 'ペアリングとセキュリティ';

  @override
  String get settingsAboutPairingQr =>
      '初めて接続するときは、ブリッジの **QR コード** をスキャンします。QR コードには中継サーバー、セッション、ペアリング済みデバイス、ブリッジの識別用公開鍵の情報が含まれています。';

  @override
  String get settingsAboutPairingAfter => '安全なハンドシェイクの後：';

  @override
  String get settingsAboutPairingTrusted =>
      'スマホはブリッジを **信頼済みデバイス** として、OS の安全なストレージに保存します。';

  @override
  String get settingsAboutPairingIdentity => 'ブリッジはスマホの識別情報をローカルに保存します。';

  @override
  String get settingsAboutPairingReconnect =>
      '保存済みの信頼済みデバイスは、スキャンし直さなくても再接続できます。';

  @override
  String get settingsAboutPairingRecovery =>
      '信頼関係が変わったり、現在のセッションが見つからなかったりした場合も、QR コードで復旧できます。同じ中継サーバーが設定されていれば、ワンタイムコードでもペアリングできます。';

  @override
  String get settingsAboutEncryption => 'エンドツーエンド暗号化';

  @override
  String get settingsAboutEncryptionIntro =>
      'ペアリング後、メッセージは暗号化されたエンベロープでやり取りされます。';

  @override
  String get settingsAboutCipher => '暗号方式';

  @override
  String get settingsAboutKeyDerivation => '鍵導出';

  @override
  String get settingsAboutKeyDerivationValue => 'HKDF-SHA256、方向ごとに別の鍵';

  @override
  String get settingsAboutKeyExchange => '鍵交換';

  @override
  String get settingsAboutKeyExchangeValue => 'X25519 一時鍵';

  @override
  String get settingsAboutIdentity => '識別情報';

  @override
  String get settingsAboutIdentityValue => 'Ed25519 署名';

  @override
  String get settingsAboutReplayProtection => 'リプレイ攻撃対策';

  @override
  String get settingsAboutReplayProtectionValue => '単調増加カウンター';

  @override
  String get settingsAboutCacheKey => 'スマホのキャッシュ鍵';

  @override
  String get settingsAboutCacheKeyValue => 'OS の安全なストレージで保護';

  @override
  String get settingsAboutEncryptionNote =>
      'ここで説明しているのは **ペアリングデバイスモード** です。DJL Cloud は別のサービスで、アカウントの仕組みも別です。';

  @override
  String get settingsAboutGit => 'Git とワークスペース';

  @override
  String get settingsAboutGitIntro =>
      'ブリッジは、ペアリング済みのデバイス上で Git コマンドをローカルに処理します：';

  @override
  String get settingsAboutGitRevert =>
      'DJL は **ワークスペースの復元** にも対応しています。アシスタントの変更を取り消したいときは、逆パッチをプレビューして適用できます。変更を適用する前に確認内容をチェックしてください。';

  @override
  String get settingsAboutResilience => '接続の安定性';

  @override
  String get settingsAboutReconnect => '自動再接続では、上限付きのバックオフを使います。';

  @override
  String get settingsAboutReplay =>
      '暗号化されたリプレイカーソルで、取りこぼしたイベントを復元できます。結果が不明な操作が、切断後に勝手に再送信されることはありません。';

  @override
  String get settingsAboutRuntimeDrop => 'スマホの接続が一時的に切れても、実行環境は作業を続けられます。';

  @override
  String get settingsAboutShutdown =>
      'ブリッジは `SIGINT` と `SIGTERM` を受け取ると正常に終了します。';

  @override
  String get settingsAboutDesktop => 'デスクトップアプリとの連携';

  @override
  String get settingsAboutDesktopRollout =>
      'Codex はスマホのスレッドを、ペアリング済みデバイス上のセッション rollout ファイルとして保存します。';

  @override
  String get settingsAboutDesktopHandoff =>
      'デスクトップアプリは外部からの書き込みをすぐに反映しない場合があります。現在のスレッドを引き継ぐには、DJL の **パソコンで続ける** を使ってください。';

  @override
  String get settingsAboutDjl => 'DJL について';

  @override
  String get settingsOpenSource => 'オープンソース';

  @override
  String get settingsMitLicense => 'MIT ライセンス';

  @override
  String get hostYourMac => 'あなたの Mac';

  @override
  String get hostUpdating => 'Mac の DJL をアップデートしています。完了するとこのスマホは再接続します。';

  @override
  String get hostCheckingVersion => 'Mac の DJL のバージョンを確認中…';

  @override
  String hostNowVersion(String version) {
    return 'Mac の DJL は $version になりました。';
  }

  @override
  String hostStillVersion(String version) {
    return 'Mac の DJL はまだ $version です。すでに最新の可能性があります。';
  }

  @override
  String get hostConnectedFooter => 'チャットはエンドツーエンドで暗号化され、Mac の DJL に直接届きます。';

  @override
  String get hostReconnectFooter => '再接続するには、Mac で DJL を開いてください。';

  @override
  String get hostDjlVersion => 'DJL のバージョン';

  @override
  String get hostCheckFailedNow => '今は Mac を確認できませんでした。';

  @override
  String get hostReconnecting => '再接続中…';

  @override
  String get hostWakeScreen => '画面をオンにする';

  @override
  String get hostWakeScreenDetail => 'DJL の実行中に Mac のディスプレイをオンにします。';

  @override
  String get hostKeepAwake => 'Mac をスリープさせない';

  @override
  String get hostKeepAwakeDetail =>
      'DJL を開いている間、Mac がスリープしないようにします。充電中の利用がおすすめです。';

  @override
  String get hostUpdates => 'アップデート';

  @override
  String get hostUpdateDjl => 'DJL をアップデート';

  @override
  String get hostUpdateDjlDetail => 'Mac に最新の DJL をインストールしてから再接続します。';

  @override
  String get hostNotConnected => '未接続';

  @override
  String get hostConnectedChecking => '接続済み · 確認中';

  @override
  String get hostConnected => '接続済み';

  @override
  String hostStatusLabel(String status) {
    return 'Mac の DJL、$status';
  }

  @override
  String get hostDjlOnYourMac => 'Mac の DJL';

  @override
  String get hostUpdateTitle => 'Mac の DJL をアップデートしますか？';

  @override
  String hostUpdateCurrent(String version) {
    return 'Mac の DJL は $version です。';
  }

  @override
  String get hostUpdateBody =>
      '最新バージョンをインストールするため、Mac の DJL が再起動します。このスマホは一瞬接続が切れますが、自動で再接続します。';

  @override
  String get hostUpdate => 'アップデート';

  @override
  String get hostContinueOnDesktop => 'パソコンで続ける';

  @override
  String get hostContinueTitle => 'パソコンで続けますか？';

  @override
  String get hostContinueBody => 'このチャットを Mac の DJL で開きます。';

  @override
  String get hostContinue => '続ける';

  @override
  String get hostActionFinished => '操作が完了しました。';

  @override
  String get hostErrorUnsupported =>
      'Mac の DJL はまだこの操作に対応していません。Mac の DJL をアップデートしてください。';

  @override
  String get hostErrorRefused =>
      'Mac がこの操作を拒否しました。Mac の DJL を確認してから、もう一度お試しください。';

  @override
  String get hostErrorUncertain =>
      'うまくいったかどうか確認できませんでした。もう一度試す前に Mac を確認してください。';

  @override
  String get hostCheckFailed => 'Mac を確認できませんでした。もう一度お試しください。';

  @override
  String get hostCheckingFirst => 'Mac を確認しています。少ししてからもう一度お試しください。';

  @override
  String get hostConnectFirst => '先に Mac に接続してください。';

  @override
  String get hostNotConfirmed => 'Mac でこの操作が確認されませんでした。もう一度試す前に確認してください。';

  @override
  String get hostOpenedOnMac => 'Mac の DJL で開きました。';

  @override
  String get hostReconnectFirst => '先に Mac に再接続してください。';

  @override
  String get hostReachFailed =>
      'Mac の DJL に接続できませんでした。DJL が開いているか確認してから、もう一度お試しください。';

  @override
  String get hostWaking => 'Mac の画面をオンにしています。';

  @override
  String get hostPrefReadFailed => '保存済みの設定を読み込めませんでした。再試行してください。';

  @override
  String get hostPrefSaveFailed => 'この設定を保存できませんでした。以前の設定のままです。もう一度お試しください。';

  @override
  String get hostPrefUnconfirmed => 'このスマホには保存しましたが、Mac ではまだ確認されていません。';

  @override
  String get pushTitle => 'プッシュ通知';

  @override
  String get pushUnsupported =>
      'このスマホはまだ DJL のプッシュ通知を受け取れません。エージェントが完了したかどうかは DJL を開いて確認してください。';

  @override
  String get pushDenied => 'スマホの「設定」で DJL の通知がオフになっています。';

  @override
  String get pushReady => 'エージェントが作業を終えたときや、回答が必要なときに通知を受け取れます。';

  @override
  String get pushSimulator => 'このシミュレーターではプッシュ通知を受け取れません。';

  @override
  String get pushUnavailableVersion => 'このバージョンではプッシュ通知を利用できません。';

  @override
  String get pushFailed => '通知をオンにできませんでした。オンラインのときにもう一度お試しください。';

  @override
  String get pushUnavailableNow => '現在、プッシュ通知を利用できません。';

  @override
  String get pushReadFailed => '通知の設定を読み込めませんでした。再試行してください。';

  @override
  String get pushUpdateFailed => '通知の設定を更新できませんでした。再試行してください。';

  @override
  String get whatsNewTitle => '新機能';

  @override
  String get whatsNewIntro => 'DJL の新しい機能をご紹介します。';

  @override
  String get whatsNewOnce => 'この画面はアプリのバージョンごとに一度だけ表示されます。';

  @override
  String get whatsNewGotIt => 'OK';

  @override
  String get whatsNewDismiss => 'リリースノートを閉じる';

  @override
  String get whatsNew100Design => '落ち着いたモノトーンのデザインになりました。';

  @override
  String get whatsNew100Groups => 'グループチャット：複数のエージェントと同時に話し、返信をリアルタイムで見られます。';

  @override
  String get whatsNew100Files => 'グループチャットでファイルや写真を送れるようになりました。';

  @override
  String get whatsNew100Mac => 'チャットは Mac の DJL に直接届きます。';

  @override
  String get accountSomethingWrong => '問題が発生しました';

  @override
  String get accountTypeDeleteToConfirm => '確認のため DELETE と入力してください。';

  @override
  String get accountOk => 'OK';

  @override
  String get accountDone => '完了';

  @override
  String get accountEmail => 'メールアドレス';

  @override
  String get accountPlan => 'プラン';

  @override
  String get accountCredits => 'クレジット';

  @override
  String get accountUsageFooter =>
      '保存済みのリセットを使うと、両方の上限がリセットされ、週の期間も最初からになります。保存済みのリセットは付与から 90 日で期限切れになります。';

  @override
  String get accountFiveHourLimit => '5 時間の上限';

  @override
  String get accountWeeklyLimit => '週間の上限';

  @override
  String get accountBankedResets => '保存済みのリセット';

  @override
  String accountNextExpires(String date, String year) {
    return '次の期限：$year年$date';
  }

  @override
  String get accountNone => 'なし';

  @override
  String accountUseOne(int count) {
    return '1 回使う（残り $count 回）';
  }

  @override
  String get accountDeleteFooter =>
      'アカウントを削除すると、チャット、ファイル、クレジットが削除されます。30 日以内であれば、サポートに連絡して取り消すことができます。';

  @override
  String get accountSignOut => 'ログアウト';

  @override
  String get accountDelete => 'アカウントを削除';

  @override
  String accountUsedPercent(int percent) {
    return '$percent% 使用済み';
  }

  @override
  String get accountResetsNow => 'まもなくリセット';

  @override
  String get accountResetsTomorrow => '明日リセット';

  @override
  String get accountResetsYesterday => '昨日リセット済み';

  @override
  String get accountResetsNextWeek => '来週リセット';

  @override
  String get accountResetsLastWeek => '先週リセット済み';

  @override
  String accountResetsIn(String quantity) {
    return '$quantity後にリセット';
  }

  @override
  String accountResetsAgo(String quantity) {
    return '$quantity前にリセット済み';
  }

  @override
  String accountSeconds(int count) {
    return '$count 秒';
  }

  @override
  String accountMinutes(int count) {
    return '$count 分';
  }

  @override
  String accountHours(int count) {
    return '$count 時間';
  }

  @override
  String accountDays(int count) {
    return '$count 日';
  }

  @override
  String accountWeeks(int count) {
    return '$count 週間';
  }

  @override
  String get accountDeleteTitle => 'アカウントを削除しますか？';

  @override
  String get accountDeleteBody => '30 日を過ぎると元に戻せません。確認のため DELETE と入力してください。';

  @override
  String get accountTypeDelete => 'DELETE と入力';

  @override
  String get accountSignOutTitle => 'DJL Cloud からログアウトしますか？';

  @override
  String get notificationsTitle => '通知';

  @override
  String get notificationsMarkAllRead => 'すべて既読にする';

  @override
  String get notificationsCaughtUp => '新しい通知はありません';

  @override
  String get notificationsEmptyHint => '完了したタスクがここに表示されます。';

  @override
  String get notificationsTaskComplete => 'タスク完了';

  @override
  String get notificationsLoadMore => 'さらに読み込む';

  @override
  String notificationsStatus(String status) {
    String _temp0 = intl.Intl.selectLogic(status, {
      'succeeded': '成功',
      'failed': '失敗',
      'other': '$status',
    });
    return '$_temp0';
  }

  @override
  String get notificationsTaskStopped => 'タスクが停止しました';

  @override
  String get notificationsTaskFinished => 'タスクが終了しました';

  @override
  String get notificationsOpenResult => 'DJL を開いて結果を確認';

  @override
  String get notificationsDismiss => '通知を閉じる';

  @override
  String get reportOffensive => '不快・差別的な内容';

  @override
  String get reportHarmful => '有害・危険な内容';

  @override
  String get reportWrong => '誤り・誤解を招く内容';

  @override
  String get reportOther => 'その他';

  @override
  String get reportThanks => 'ありがとうございます。この回答を確認します。';

  @override
  String get reportTitle => 'この回答を報告';

  @override
  String get reportRateLimited => '報告が多すぎます。しばらくしてからもう一度お試しください。';

  @override
  String get reportFailed => '報告を送信できませんでした。もう一度お試しください。';

  @override
  String get reportIntro => 'DJL は回答の安全性を保つため、報告を確認しています。この回答のどこに問題がありますか？';

  @override
  String get reportDetailsHint => '詳細を追加（任意）';

  @override
  String get reportSending => '送信中…';

  @override
  String get reportSend => '報告を送信';

  @override
  String get attachmentsNoApp => 'このファイルを開けるアプリがありません。送信先のアプリを選んでください。';

  @override
  String get attachmentsOpenFailed => 'このファイルを開けませんでした';

  @override
  String get attachmentsCheckMac => 'Mac が接続されているか確認してから、もう一度お試しください。';

  @override
  String get attachmentsImageUnshowable => 'この画像はここでは表示できません';

  @override
  String get attachmentsOpenElsewhere => '別のアプリで開く';

  @override
  String get attachmentsOpen => '開く';

  @override
  String get attachmentsShare => '共有';

  @override
  String get imagesSquare => '正方形';

  @override
  String get imagesLandscape => '横長';

  @override
  String get imagesPortrait => '縦長';

  @override
  String get imagesOnePerRequest =>
      '1 回のリクエストで画像は 1 枚です。DJL の処理中はチャットを離れても大丈夫です。';

  @override
  String get imagesCreate => '画像を作成';

  @override
  String get imagesMakeYours => 'あなただけの一枚を。';

  @override
  String get imagesDescribe => '被写体、スタイル、細部のイメージを入力してください。';

  @override
  String get imagesPromptHint => '朝の光が差し込む静かなアトリエ…';

  @override
  String get imagesShape => '形';

  @override
  String get imagesNotConfigured =>
      'このサーバーでは画像生成がまだ設定されていません。保存済みの画像は引き続き利用できます。';

  @override
  String get imagesStarting => '開始中…';

  @override
  String get imagesOpenImage => '画像を開く';

  @override
  String get imagesGenerated => '生成された画像';

  @override
  String get imagesOpenChat => 'チャットを開く';

  @override
  String get imagesActions => '画像の操作';

  @override
  String get imagesEditInChat => 'チャットで編集';

  @override
  String get imagesTitle => '画像';

  @override
  String get imagesYourImages => 'あなたの画像';

  @override
  String get imagesEmpty => '作成した画像はここに表示され、すぐに保存や共有ができます。';

  @override
  String get imagesEmptyNotConfigured => '画像の作成はまだ設定されていません。保存済みの画像はここに表示されます。';

  @override
  String get imagesLoadMore => 'さらに読み込む';

  @override
  String get imagesYourImage => 'あなたの画像';

  @override
  String get imagesShare => '共有';

  @override
  String get imagesSaveToPhotos => '写真に保存';

  @override
  String get imagesSaved => '写真に保存しました。';

  @override
  String get authSocialNotConfigured =>
      'このアプリではこのログイン方法が設定されていません。メールアドレスで続けてください。';

  @override
  String get authSocialOpenFailed => 'ログイン画面を開けませんでした。もう一度お試しください。';

  @override
  String get authSignInOptionsFailed => 'ログイン方法を読み込めませんでした。';

  @override
  String get authCloudSignInFailed => 'DJL Cloud にログインできませんでした。もう一度お試しください。';

  @override
  String get authSecureStorageFailed =>
      '安全なストレージを開けませんでした。デバイスのロックを解除して、もう一度お試しください。';

  @override
  String get authCheckEmailForCode => 'メールに届いた確認コードをご確認ください。';

  @override
  String get authRequestSent => 'リクエストを送信しました。メールをご確認ください。';

  @override
  String get authCloudDataNotCleared => '保存済みの Cloud データの一部を削除できませんでした。';

  @override
  String get authLinkOpenFailed => 'このリンクを開けませんでした。もう一度お試しください。';

  @override
  String get authWelcomeTitle => 'DJL へようこそ';

  @override
  String get authWelcomeSubtitle => 'アイデアも、チャットも、Mac も。\nすべて DJL で。';

  @override
  String get authRetrySignInOptions => 'ログイン方法を再読み込み';

  @override
  String get authLoadingSignInOptions => 'ログイン方法を読み込み中';

  @override
  String get authContinueWithApple => 'Apple で続ける';

  @override
  String get authContinueWithGoogle => 'Google で続ける';

  @override
  String get authContinueWithEmail => 'メールアドレスで続ける';

  @override
  String get authPairWithMac => 'Mac とペアリング';

  @override
  String get authNoMacHint => 'Mac がなくても、ログインすれば DJL Cloud でチャットできます。';

  @override
  String get authTerms => '利用規約';

  @override
  String get authPrivacy => 'プライバシー';

  @override
  String get authVerifyAndContinue => '確認して続ける';

  @override
  String get authSignIn => 'ログイン';

  @override
  String get authEmailMeCode => 'メールでコードを受け取る';

  @override
  String get authCreateAccount => 'アカウントを作成';

  @override
  String get authSignInIncomplete => 'ログインを完了できませんでした。もう一度お試しください。';

  @override
  String get authPassword => 'パスワード';

  @override
  String get authEmailCode => 'メールのコード';

  @override
  String get authName => '名前';

  @override
  String get authEmail => 'メールアドレス';

  @override
  String get authSixDigitCode => '6 桁のコード';

  @override
  String authCodeSent(String email) {
    return '$email にコードを送信しました。有効期限は 10 分です。';
  }

  @override
  String get authCreateAccountHint =>
      '10 文字以上で入力してください。メールアドレスの確認のため、コードをお送りします。';

  @override
  String get authResendCode => 'コードを再送信';

  @override
  String authResendIn(int seconds) {
    return '$seconds 秒後に再送信できます';
  }

  @override
  String get authUseAnotherEmail => '別のメールアドレスを使う';

  @override
  String get authForgotPassword => 'パスワードをお忘れですか？';

  @override
  String get authResetPassword => 'パスワードをリセット';

  @override
  String get authPasswordUpdated => 'パスワードを更新しました';

  @override
  String get authSignInWithNewPassword => '新しいパスワードでログインしてください。';

  @override
  String get authBackToSignIn => 'ログインに戻る';

  @override
  String get authNewPassword => '新しいパスワード';

  @override
  String get authRecoveryHint => 'このメールアドレスのアカウントがある場合、復旧コードをお送りします。';

  @override
  String get authRecoveryCodeHint => '復旧コードと、10〜256 文字のパスワードを入力してください。';

  @override
  String get authSendRecoveryCode => '復旧コードを送信';

  @override
  String get chatUiWorktreeHandoffFailed => 'ワークツリーへの引き継ぎに失敗しました';

  @override
  String get chatUiOk => 'OK';

  @override
  String get chatUiSelectFolder => 'フォルダを選択';

  @override
  String get chatUiBrowseFolders => 'ローカルのフォルダを参照…';

  @override
  String get chatUiBranchOpenElsewhere => 'ブランチは別の場所で開かれています';

  @override
  String chatUiBranchOpenElsewhereChat(String branch) {
    return '「$branch」は別のワークツリーでチェックアウトされています。そのチャットを開いて続けてください。';
  }

  @override
  String chatUiBranchOpenElsewhereSidebar(String branch) {
    return '「$branch」は別のワークツリーでチェックアウトされています。サイドバーからそのチャットを開いて続けてください。';
  }

  @override
  String get chatUiOpenChat => 'チャットを開く';

  @override
  String get chatUiWorktreeChatGone =>
      'このワークツリーのチャットは利用できなくなりました。サイドバーから開いてください。';

  @override
  String get chatUiPhotoLibrary => '写真ライブラリ';

  @override
  String get chatUiTakePhoto => '写真を撮る';

  @override
  String get chatUiPlanMode => '計画モード';

  @override
  String get chatUiFastMode => '高速モード';

  @override
  String get chatUiImage => '画像';

  @override
  String get chatUiOpensThreadLocation => 'スレッドの場所を開きます';

  @override
  String get chatUiDesktopChat => 'パソコンのチャット';

  @override
  String get chatUiNewThread => '新しいスレッド';

  @override
  String get chatUiHandOffToDesktop => 'パソコンに引き継ぐ';

  @override
  String get chatUiHandOffToLocal => 'ローカルに引き継ぐ';

  @override
  String get chatUiHandOffToWorktree => 'ワークツリーに引き継ぐ';

  @override
  String get chatUiGoal => '目標';

  @override
  String get chatUiForkChat => 'このチャットをフォーク';

  @override
  String get chatUiForkIntoFolder => '別のフォルダにフォーク';

  @override
  String get chatUiForkIntoWorktree => '新しいワークツリーにフォーク';

  @override
  String get chatUiWorkspaceFiles => 'ワークスペースのファイル';

  @override
  String get chatUiTurnChanges => 'やり取りごとの変更と復元';

  @override
  String get chatUiRefreshFromDesktop => 'パソコンから更新';

  @override
  String get chatUiDesktopDisconnected => 'パソコンとの接続が切れました。メッセージは再送信されていません。';

  @override
  String get chatUiLinkedPositionUnavailable => 'リンク先の位置は、読み込まれた履歴の中にありません。';

  @override
  String get chatUiReviewResponseChanges => 'この応答による変更を確認';

  @override
  String get chatUiResponseUndone => '応答を取り消しました';

  @override
  String get chatUiUndoResponse => 'この応答を取り消す';

  @override
  String get chatUiApprovalRequired => '承認が必要です';

  @override
  String get chatUiApprovalSent => '回答を送信しました。パソコンを待っています。';

  @override
  String get chatUiDecline => '拒否';

  @override
  String get chatUiApproveOnce => '今回のみ承認';

  @override
  String get chatUiBranch => 'ブランチ';

  @override
  String get chatUiPreparingWorktree => 'ワークツリーを準備中…';

  @override
  String get chatUiNewWorktree => '新しいワークツリー';

  @override
  String chatUiGoalChip(String status, String elapsed) {
    return '目標 $status · $elapsed';
  }

  @override
  String get chatUiReturnToParent => '親チャットに戻る';

  @override
  String chatUiReturnTo(String title) {
    return '「$title」に戻る';
  }

  @override
  String get chatUiAskDjl => 'DJL に聞く';

  @override
  String get chatUiFollowUp => '続けて質問';

  @override
  String get workspaceRestoreFailed => 'パソコンで復元が確認されませんでした。再試行する前に更新してください。';

  @override
  String workspaceRestoredFiles(int count) {
    return '$count 件のファイルを復元しました。';
  }

  @override
  String get workspaceBackupSaved => 'Mac にバックアップのチェックポイントを保存しました。';

  @override
  String get workspaceNoLocalFolders => 'このデバイスから利用できるローカルフォルダはありません。';

  @override
  String get workspaceUndoReviewChanged => '応答または接続が変わりました。この確認画面を開き直してください。';

  @override
  String get workspaceUndoPreviewFailed =>
      'パッチの内容をプレビューできませんでした。確認画面を更新してから再試行してください。';

  @override
  String get workspaceUndoRepositoryChanged =>
      '応答またはリポジトリが変わりました。この確認画面を開き直してください。';

  @override
  String get workspaceUndoResultUnknownChanged =>
      '接続または応答が変わりました。取り消しの結果は不明です。更新して確認してください。';

  @override
  String get workspaceUndoRefused =>
      'パソコンで応答が取り消されませんでした。現在の競合とステージ済みのファイルを確認してください。';

  @override
  String get workspaceUndoResultUnknown =>
      '取り消しの結果は不明です。もう一度試す前に、更新してパッチの内容を確認してください。';

  @override
  String get workspaceUndoSaveAfterSuccessFailed =>
      '取り消しは成功しましたが、ローカルの結果を保存または更新できませんでした。再接続してファイルを確認してください。';

  @override
  String get workspaceUndoSaveFailed =>
      '取り消しの結果を保存できませんでした。再接続して現在のファイルを確認してください。';

  @override
  String get workspaceUndoTitle => 'この応答を取り消す';

  @override
  String workspaceUndoWorkspace(String path) {
    return 'ワークスペース：$path';
  }

  @override
  String get workspaceUndoIntro =>
      'この応答による変更を確認してください。逆パッチを適用できる箇所では、その後の編集はそのまま残ります。確定すると、パソコンがもう一度競合をチェックします。';

  @override
  String get workspaceUndoOverlap =>
      'ほかの応答もこれらのファイルを変更しています。取り消すと、このチャットや別のチャットの変更と重なる可能性があるので、よく確認してください。';

  @override
  String get workspaceUndoUncertain =>
      '前回の取り消しの結果が不明です。もう一度試す前に、この確認画面を更新して現在のファイルを確認してください。';

  @override
  String get workspaceUndoStale => 'この確認画面は最新ではありません。閉じてから応答を開き直してください。';

  @override
  String get workspaceUndoDone => 'この応答は取り消されました。';

  @override
  String workspaceUndoStagedBlock(String files) {
    return 'ステージ済みのファイルがあるため取り消せません：$files';
  }

  @override
  String workspaceUndoConflict(String conflict) {
    return '競合：$conflict';
  }

  @override
  String get workspaceUndoCannotReverse => 'パソコンでこのパッチを安全に元に戻せません。';

  @override
  String get workspaceClose => '閉じる';

  @override
  String get workspaceRefreshReview => '確認画面を更新';

  @override
  String get workspaceUndoResponse => '応答を取り消す';

  @override
  String get workspaceConflictFallback => '競合';

  @override
  String get workspaceAlreadyUndone => 'この応答はすでに取り消されています。';

  @override
  String get workspaceStillRunning => 'この応答はまだ実行中です。';

  @override
  String get workspaceNoDesktopWorkspace => 'この応答にはパソコンのワークスペースがありません。';

  @override
  String get workspaceNoPatchCaptured => 'この応答の対応可能なパッチは記録されていません。';

  @override
  String get workspaceRestoreTitle => 'このやり取りの前の状態にワークスペースを復元しますか？';

  @override
  String get workspaceRestoreBody =>
      '現在のワークスペースのファイルが置き換えられ、追跡されていないファイルは削除されます。復元する前に、影響を受けるファイルを確認してください。Mac は先にバックアップのチェックポイントを保存します。';

  @override
  String get workspaceNoAffectedFiles => '影響を受けるファイルはありません。';

  @override
  String get workspaceStagedFiles => 'ステージ済みのファイル';

  @override
  String get workspaceUntrackedFiles => '追跡されていないファイル';

  @override
  String get workspaceRestoreFiles => 'ファイルを復元';

  @override
  String get workspaceTurnChanges => 'このやり取りの変更';

  @override
  String get workspaceReloadTurnChanges => 'やり取りの変更を再読み込み';

  @override
  String get workspaceConversationTurn => 'チャットのやり取り';

  @override
  String workspaceTurnNumber(int number) {
    return '$number 回目のやり取り';
  }

  @override
  String get workspaceNoSavedChanges => 'このやり取りで保存された変更はありません。';

  @override
  String get workspaceNoCompletedTurns => '完了したやり取りはまだありません。';

  @override
  String get workspaceChooseTurn => 'やり取りを選ぶと、保存されたワークスペースの変更を確認できます。';

  @override
  String get workspaceStopBeforeRestore => 'ファイルを復元する前に、実行中のやり取りを停止してください。';

  @override
  String get workspacePreviewRestore => 'このやり取りの前への復元をプレビュー';

  @override
  String get workspaceFileFallbackTitle => 'ワークスペースのファイル';

  @override
  String get workspaceCopyFileContents => 'ファイルの内容をコピー';

  @override
  String get workspaceFileContentsCopied => 'ファイルの内容をコピーしました。';

  @override
  String get workspaceReloadFile => 'ファイルを再読み込み';

  @override
  String get workspaceFilePathOnMac => 'Mac 上のファイルのパス';

  @override
  String get workspaceSegmentText => 'テキスト';

  @override
  String get workspaceSegmentImage => '画像';

  @override
  String get workspaceOpen => '開く';

  @override
  String get workspaceSvgRenderFailed => 'この SVG を表示できませんでした。';

  @override
  String get workspaceImageRenderFailed => 'この画像形式はこのデバイスでは表示できません。';

  @override
  String get workspaceOpenFileToPreview => 'ワークスペースのファイルを開くとプレビューできます。';

  @override
  String get workspaceSavedToPhotos => '写真に保存しました。';

  @override
  String get workspaceImageTitle => '画像';

  @override
  String get workspaceOk => 'OK';

  @override
  String get workspaceLoadingFile => 'ファイルを読み込み中';

  @override
  String get workspaceUnableToLoadFile => 'ファイルを読み込めません。';

  @override
  String get workspaceRetry => '再試行';

  @override
  String get workspaceCloseFilePreview => 'ファイルのプレビューを閉じる';

  @override
  String get workspaceDone => '完了';

  @override
  String get workspaceFindInFile => 'ファイル内を検索';

  @override
  String workspaceLineCount(int count) {
    return '$count 行';
  }

  @override
  String workspaceByteCount(int count) {
    return '$count バイト';
  }

  @override
  String get workspaceCloseSvgPreview => 'SVG のプレビューを閉じる';

  @override
  String get workspaceReloadSvgPreview => 'SVG のプレビューを再読み込み';

  @override
  String get workspaceShare => '共有';

  @override
  String get workspaceSaveToPhotos => '写真に保存';

  @override
  String get workspaceUnableToDisplayImage => '画像を表示できません。';

  @override
  String get workspaceFileContents => 'ファイルの内容';

  @override
  String get workspaceSearching => '検索中…';

  @override
  String workspaceMatchPosition(int index, int total) {
    return '$index/$total';
  }

  @override
  String get workspacePreviousMatch => '前の一致';

  @override
  String get workspaceNextMatch => '次の一致';

  @override
  String get workspaceCloseFind => '検索を閉じる';

  @override
  String get workspaceAddLocalFolder => 'ローカルフォルダを追加';

  @override
  String get workspaceCreateFolderOnMac => 'Mac にフォルダを作成';

  @override
  String get workspaceUse => '使用';

  @override
  String get workspaceParentFolder => '親フォルダ';

  @override
  String get workspaceSearchingFolders => 'フォルダを検索中…';

  @override
  String get workspaceLoading => '読み込み中';

  @override
  String get workspaceNoMatchingFolders => 'このフォルダ内に該当するフォルダはありません。';

  @override
  String get workspaceNoChildFolders => 'サブフォルダはありません。';

  @override
  String get workspaceSearchFolders => 'フォルダを検索';

  @override
  String get workspaceClearFolderSearch => 'フォルダの検索をクリア';

  @override
  String get workspaceLocations => '場所';

  @override
  String get workspaceCurrentFolder => '現在のフォルダ';

  @override
  String get workspaceLoadingFolders => 'フォルダを読み込み中…';

  @override
  String get workspaceNoFolderSelected => 'フォルダが選択されていません。';

  @override
  String get workspaceMatchingFolders => '該当するフォルダ';

  @override
  String get workspaceFolders => 'フォルダ';

  @override
  String get workspaceNewFolder => '新しいフォルダ';

  @override
  String get workspaceNewFolderBody => 'このフォルダをデバイス上に作成し、そこでチャットを始めます。';

  @override
  String get workspaceFolderName => 'フォルダ名';

  @override
  String get workspaceCreate => '作成';

  @override
  String get workspaceDesktopChangedPicker =>
      '接続先のパソコンが変わりました。プロジェクトの選択を開き直してください。';

  @override
  String get workspaceDesktopChanged => '接続先のパソコンが変わりました。このワークスペースを開き直してください。';

  @override
  String get workspaceChooseWorkspaceFirst => '先にパソコンのワークスペースを選んでください。';

  @override
  String get workspaceNoTextInPreview =>
      'ファイルのプレビューにテキストが含まれていませんでした。ワークスペースから再読み込みしてください。';

  @override
  String get workspaceNoImageInPreview =>
      '画像のプレビューに画像データが含まれていませんでした。ワークスペースから再読み込みしてください。';

  @override
  String get workspaceRestorePreviewOtherWorkspace =>
      'この復元のプレビューは別のワークスペースのものです。もう一度プレビューしてください。';

  @override
  String get cloudChatNewChat => '新しいチャット';

  @override
  String get cloudChatLostConnection => '接続が切れました。「再接続」をタップすると、この応答の続きを受け取れます。';

  @override
  String get cloudChatImageToEdit => '編集する画像';

  @override
  String get cloudChatNoContent => '応答の内容がありません。';

  @override
  String get cloudChatThinking => '考え中…';

  @override
  String get cloudChatResponseStopped => '応答を停止しました。';

  @override
  String get cloudChatResponseFailed => '応答に失敗しました。';

  @override
  String get cloudChatWaitingForUsageReset => '使用量のリセットを待っています。';

  @override
  String get cloudChatModelChoiceLoadFailed =>
      '保存したモデルの選択を読み込めませんでした。再試行してください。';

  @override
  String get cloudChatModelChoiceSaveFailed => 'モデルの選択を保存できませんでした。再試行してください。';

  @override
  String get cloudChatDraftSaveFailed =>
      '下書きを保存できませんでした。テキストはここに残したまま、再試行してください。';

  @override
  String get cloudChatDraftLoadFailed => '保存した下書きを読み込めませんでした。編集する前に再試行してください。';

  @override
  String get cloudChatInterruptedImage =>
      '中断された画像リクエストは安全に保存されています。再試行すると結果を確認できます。';

  @override
  String get cloudChatInterruptedMessage =>
      '中断されたメッセージは安全に保存されています。再試行すると結果を確認できます。';

  @override
  String get cloudChatModelCannotViewImages =>
      'この添付ファイルを送信する前に、画像を扱えるモデルを選んでください。';

  @override
  String get cloudChatImageGenerationUnavailable => 'このサービスでは画像生成が設定されていません。';

  @override
  String get cloudChatUseBankedResetTitle => '保存済みのリセットを使いますか？';

  @override
  String get cloudChatUseBankedResetBody =>
      '5 時間の上限と週間の上限が今すぐリセットされ、週の期間も今日から始まります。';

  @override
  String get cloudChatUseReset => 'リセットを使う';

  @override
  String get cloudChatLimitFreesSoon => 'まもなく上限が回復します。';

  @override
  String get cloudChatResetsNow => 'まもなくリセットされます。';

  @override
  String get cloudChatResetsTomorrow => '明日リセットされます。';

  @override
  String cloudChatResetsInDays(int days) {
    return '$days 日後にリセットされます。';
  }

  @override
  String cloudChatResetsOn(String date) {
    return '$dateにリセットされます。';
  }

  @override
  String get cloudChatResetsInAMoment => 'まもなくリセットされます。';

  @override
  String cloudChatResetsInMinutes(int minutes) {
    return '$minutes 分後にリセットされます。';
  }

  @override
  String cloudChatResetsInHours(int hours) {
    return '$hours 時間後にリセットされます。';
  }

  @override
  String get cloudChatUsageLimitReached => '使用量の上限に達しました';

  @override
  String get cloudChatRetryUsage => '使用状況を再読み込み';

  @override
  String cloudChatUseBankedReset(int count) {
    return '保存済みのリセットを使う（残り $count 回）';
  }

  @override
  String get cloudChatPickerFailed => '選択画面を開けませんでした。もう一度お試しください。';

  @override
  String get cloudChatModel => 'モデル';

  @override
  String get cloudChatShareLink => 'リンクを共有';

  @override
  String get cloudChatTaskPrompt => 'DJL に何をしてもらいますか？';

  @override
  String get cloudChatHowCanIHelp => '何をお手伝いしましょうか？';

  @override
  String get cloudChatTaskHint => 'タスクを開始して、できあがったら結果を見に戻ってきてください。';

  @override
  String cloudChatStepProgress(String step, String total) {
    return 'ステップ $step/$total';
  }

  @override
  String get cloudChatRetry => '再試行';

  @override
  String get cloudChatRetryDraft => '下書きを再読み込み';

  @override
  String get cloudChatRetryModelChoice => 'モデルの選択を再読み込み';

  @override
  String get cloudChatMessageHint => 'DJL にメッセージ';

  @override
  String get cloudChatAttachTooltip => 'ファイルまたは画像を添付';

  @override
  String get cloudChatCreateImage => '画像を作成';

  @override
  String get cloudChatChooseFile => 'ファイルを選択';

  @override
  String get cloudChatPhotoLibrary => '写真ライブラリ';

  @override
  String get cloudChatCamera => 'カメラ';

  @override
  String get cloudChatTaskMode => 'タスクモード';

  @override
  String get cloudChatTask => 'タスク';

  @override
  String get cloudChatStopDictation => '音声入力を停止';

  @override
  String get cloudChatStartDictation => '音声入力を開始';

  @override
  String get cloudChatStopResponse => '応答を停止';

  @override
  String get cloudChatSendMessage => 'メッセージを送信';

  @override
  String get cloudChatEditMessage => 'メッセージを編集';

  @override
  String get cloudChatSend => '送信';

  @override
  String get cloudChatDisableWordWrap => '折り返しをオフ';

  @override
  String get cloudChatEnableWordWrap => '折り返しをオン';

  @override
  String get cloudChatCopied => 'コピーしました';

  @override
  String get cloudChatCopyCode => 'コードをコピー';

  @override
  String get cloudChatCodeLabel => 'コード';

  @override
  String get cloudChatEdit => '編集';

  @override
  String get cloudChatPreviousBranch => '前のバージョン';

  @override
  String get cloudChatNextBranch => '次のバージョン';

  @override
  String get cloudChatCopyMessage => 'メッセージをコピー';

  @override
  String get cloudChatRegenerateReply => '返信を再生成';

  @override
  String get cloudChatStopReading => '読み上げを停止';

  @override
  String get cloudChatReadAloud => '読み上げ';

  @override
  String get cloudChatReportAnswer => 'この回答を報告';

  @override
  String cloudChatToolResult(String name, String status) {
    return '$name · $status';
  }

  @override
  String get cloudChatToolFailed => '失敗';

  @override
  String get cloudChatToolDone => '完了';

  @override
  String get cloudChatNeedsNewerVersion =>
      'このメッセージには、新しいバージョンでないと表示できない内容が含まれています。';

  @override
  String get cloudChatImageUnavailableRetry => '画像を表示できません · 再試行';

  @override
  String get cloudChatConversationImage => 'チャットの画像';

  @override
  String get cloudChatImageDisplayFailed => 'この画像を表示できませんでした。';

  @override
  String get cloudChatShareFailed => '共有を開けませんでした。もう一度お試しください。';

  @override
  String get cloudChatShareLinkCreated => '共有リンクを作成しました';

  @override
  String get cloudChatShareLinkBody =>
      'リンクを知っている人は誰でも、このチャットの現時点の内容を閲覧できます。この後に送信するメッセージは共有されません。';

  @override
  String get cloudChatCopyLink => 'リンクをコピー';

  @override
  String get cloudChatShare => '共有';

  @override
  String get conversationsPinned => 'ピン留め';

  @override
  String get conversationsPinnedEmpty => 'チャットを長押しするとピン留めできます。';

  @override
  String get conversationsRecentEmpty => 'チャットはここに表示されます。';

  @override
  String get conversationsCloudConversationHint => 'Cloud のチャット';

  @override
  String get conversationsChat => 'チャット';

  @override
  String get conversationsSearchChats => 'チャットを検索';

  @override
  String get conversationsRemote => 'リモート';

  @override
  String get conversationsRecentChats => '最近のチャット';

  @override
  String get conversationsLoadMore => 'さらに読み込む';

  @override
  String get conversationsSettings => '設定';

  @override
  String get conversationsArchivedChats => 'アーカイブ済みのチャット';

  @override
  String get conversationsRestore => '復元';

  @override
  String get conversationsNoArchivedChats => 'アーカイブ済みのチャットはありません';

  @override
  String get conversationsPin => 'ピン留め';

  @override
  String get conversationsUnpin => 'ピン留めを解除';

  @override
  String get conversationsRename => '名前を変更';

  @override
  String get conversationsArchive => 'アーカイブ';

  @override
  String get conversationsDelete => '削除';

  @override
  String get conversationsDeleteChatQuestion => 'このチャットを削除しますか？';

  @override
  String get plansCompleted => '完了';

  @override
  String get plansInProgress => '進行中';

  @override
  String get plansPending => '未着手';

  @override
  String get plansOpenActivePlan => '進行中の計画を開く';

  @override
  String get plansPlan => '計画';

  @override
  String plansStepOf(int current, int total) {
    return 'ステップ $current/$total';
  }

  @override
  String plansStepFraction(int current, int total) {
    return 'ステップ $current/$total';
  }

  @override
  String plansStatusValue(String status, String position) {
    return '$status、$position';
  }

  @override
  String get plansImage => '画像';

  @override
  String get plansActivePlan => '進行中の計画';

  @override
  String get plansDone => '完了';

  @override
  String get plansNoLongerAvailable => 'この計画は利用できなくなりました。';

  @override
  String get plansProposedPlan => '提案された計画';

  @override
  String get plansCollapsePlan => '計画を折りたたむ';

  @override
  String get plansExpandPlan => '計画を展開';

  @override
  String get plansCollapse => '折りたたむ';

  @override
  String get plansExpand => '展開';

  @override
  String get plansStarting => '開始中…';

  @override
  String get plansImplement => '実行する';

  @override
  String get plansNextStepQuestion => '次に Codex に何を作ってもらいますか？';

  @override
  String get plansNextStepHeader => '次のステップ';

  @override
  String get voiceAllowMicrophone =>
      '音声入力を使うには、デバイスの設定でマイクと音声認識へのアクセスを許可してください。';

  @override
  String get voiceDictationUnavailable =>
      'この言語またはデバイスでは、デバイス上の音声入力を利用できません。メッセージは引き続き入力できます。';

  @override
  String get voiceSpeechAccessRequired =>
      'デバイスの設定でマイクと音声認識へのアクセスを許可してください。お使いの言語でデバイス上の音声認識が利用できる必要があります。';

  @override
  String get voiceInputUnavailable => '音声入力を利用できません。メッセージは引き続き入力できます。';

  @override
  String get voiceStopFailed => '音声入力を停止できませんでした。';

  @override
  String get voicePlaybackUnavailable => 'このデバイスでは読み上げを利用できません。';

  @override
  String get voiceStopUnclean => '音声を正常に停止できませんでした。続ける前にこの画面を閉じてください。';

  @override
  String get goalsStatusActive => '進行中';

  @override
  String get goalsStatusPaused => '一時停止中';

  @override
  String get goalsStatusBlocked => '停滞中';

  @override
  String get goalsStatusUsageLimited => '使用量の上限';

  @override
  String get goalsStatusBudgetLimited => '予算の上限';

  @override
  String get goalsStatusComplete => '完了';

  @override
  String goalsTokenUsage(String used, String budget) {
    return '$used / $budget トークン';
  }

  @override
  String get goalsUnsupported =>
      'この実行環境では目標を利用できません。Mac で Codex を更新し、目標を有効にしてください。';

  @override
  String get goalsEphemeral => '目標を使うには保存されたチャットが必要です。このチャットは一時的なものです。';

  @override
  String get goalsDesktopChanged => '接続先のパソコンが変わりました。この目標を開き直してください。';

  @override
  String get goalsOtherChatGoal => '実行環境から別のチャットの目標が返されました。';

  @override
  String get goalsBudgetInvalid => 'トークンの予算は正の整数で入力してください。';

  @override
  String get goalsUnexpectedResponse => '実行環境から予期しない目標の応答が返されました。';

  @override
  String get goalsReconnect => 'この目標を管理するには、パソコンに再接続してください。';

  @override
  String get goalsDescribeFirst => '先に目標を入力してください。';

  @override
  String get goalsReplaceTitle => '現在の目標を置き換えますか？';

  @override
  String get goalsReplaceBody =>
      'この目標はまだ完了していません。置き換えると新しい目標が始まり、使用量の集計もリセットされます。';

  @override
  String get goalsReplaceAction => '目標を置き換える';

  @override
  String get goalsClearTitle => 'この目標を消去しますか？';

  @override
  String get goalsClearBody => 'パソコンはこの目標への取り組みを止め、進捗の記録を消去します。';

  @override
  String get goalsClearAction => '目標を消去';

  @override
  String get goalsTitle => '目標';

  @override
  String get goalsReload => '目標を再読み込み';

  @override
  String get goalsShowingLastKnown => '前回取得した目標を表示しています。管理するには再接続してください。';

  @override
  String get goalsNewGoal => '新しい目標';

  @override
  String get goalsEditGoal => '目標を編集';

  @override
  String get goalsDescribeHint => '達成したい結果、その確認方法、壊してはいけない点を書いてください。';

  @override
  String get goalsObjective => '目標の内容';

  @override
  String get goalsBudgetLabel => 'トークンの予算（任意）';

  @override
  String get goalsBudgetHelper => '空欄にすると予算は設定されません。';

  @override
  String get goalsStart => '目標を開始';

  @override
  String get goalsSave => '目標を保存';

  @override
  String get goalsCancelEditing => '編集をキャンセル';

  @override
  String goalsTokensRemaining(String tokens) {
    return '残り $tokens トークン';
  }

  @override
  String get goalsActiveExplainer =>
      'チャットが待機中のあいだも、パソコンはこの目標に向けて作業を続けます。完了するか、一時停止するか、上限に達するまで続きます。';

  @override
  String get goalsPause => '目標を一時停止';

  @override
  String get goalsResume => '目標を再開';

  @override
  String get goalsEditObjective => '目標の内容を編集';

  @override
  String get groupsKindSpreadsheet => 'スプレッドシート';

  @override
  String get groupsKindText => 'テキスト';

  @override
  String get groupsKindArchive => '圧縮ファイル';

  @override
  String get groupsKindImage => '画像';

  @override
  String get groupsKindVideo => '動画';

  @override
  String get groupsKindAudio => '音声';

  @override
  String get groupsKindFile => 'ファイル';

  @override
  String get groupsMacUnreachable => 'Mac に接続できませんでした。もう一度お試しください。';

  @override
  String get groupsCreateFailed => 'グループを作成できませんでした。もう一度お試しください。';

  @override
  String get groupsNewGroup => '新しいグループ';

  @override
  String get groupsChooseMembers => 'チャットに参加するメンバーを選んでください。';

  @override
  String get groupsNameOptional => '名前（任意）';

  @override
  String get groupsCreateGroup => 'グループを作成';

  @override
  String groupsCreateGroupWith(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'エージェント $count 人でグループを作成',
    );
    return '$_temp0';
  }

  @override
  String get groupsSignInOnMac => '使うには Mac でログインしてください';

  @override
  String get groupsUpdateMacTitle => 'Mac の DJL をアップデートしてください';

  @override
  String get groupsUpdateMacBody =>
      'グループチャットを使うには、Mac に最新の DJL が必要です。Mac でアップデートしてから戻ってきてください。';

  @override
  String get groupsConnectMacTitle => 'Mac に接続';

  @override
  String get groupsConnectMacBody => 'グループチャットは Mac に保存されています。接続するとここに表示されます。';

  @override
  String get groupsLoadFailed => 'グループを読み込めませんでした';

  @override
  String get groupsEmptyTitle => 'エージェントをひとつのチャットに';

  @override
  String get groupsEmptyBody => '一度質問するだけで、Claude や Codex などが一緒に答えてくれます。';

  @override
  String groupsMemberWriting(String name) {
    return '$name が入力中';
  }

  @override
  String groupsAgentsWriting(int count) {
    return '$count 人のエージェントが入力中';
  }

  @override
  String get groupsPausedWaiting => '一時停止中、あなたの判断を待っています';

  @override
  String groupsAgentCount(int count) {
    return 'エージェント $count 人';
  }

  @override
  String get groupsMacDidNotKeepFile => 'Mac にファイルが保存されませんでした。';

  @override
  String get groupsFileStillSending => 'このファイルはまだ送信中です。';

  @override
  String get groupsMacTimeout =>
      'Mac から時間内に応答がありませんでした。Mac で DJL が開いているか確認してください。';

  @override
  String get groupsMacNotConnected => '現在、Mac に接続されていません。';

  @override
  String groupsRemoveAttachment(String name) {
    return '$name を削除';
  }

  @override
  String get groupsSendingFiles => 'ファイルを送信中';

  @override
  String groupsImageNamed(String name) {
    return '画像 $name';
  }

  @override
  String get groupsAttach => '添付';

  @override
  String get groupsPhotos => '写真';

  @override
  String get groupsFiles => 'ファイル';

  @override
  String groupsFileUnsupported(String name) {
    return '$name は送信できません。送信できるのは写真、PDF、Word、Excel、PowerPoint、テキスト、コードのファイルです。';
  }

  @override
  String groupsFileTooLarge(String name, String size) {
    return '$name は $size を超えています。';
  }

  @override
  String groupsTooManyFiles(int count) {
    return '1 つのメッセージに添付できるファイルは $count 件までです。';
  }

  @override
  String get groupsOpenFailed => '開けませんでした。もう一度お試しください。';

  @override
  String get groupsAskEveryoneTitle => '全員に聞きますか？';

  @override
  String groupsAskEveryoneBody(int count) {
    return '$count 人のエージェント全員がこのメッセージに返信します。';
  }

  @override
  String get groupsDontAskAgain => '今後は確認しない';

  @override
  String get groupsAskEveryone => '全員に聞く';

  @override
  String get groupsGroupGone => 'このグループは Mac 上にもうありません。';

  @override
  String groupsSayHelloPrompt(String everyone) {
    return '$everyone 一言であいさつしてください。';
  }

  @override
  String get groupsReconnectingToMac => 'Mac に再接続中…';

  @override
  String groupsHeaderLabel(String name, int count) {
    return '$name、エージェント $count 人';
  }

  @override
  String get groupsMembers => 'メンバー';

  @override
  String get groupsYou => 'あなた';

  @override
  String get groupsCouldNotReply => '返信できませんでした';

  @override
  String get groupsNothingToAdd => '付け加えることはありません';

  @override
  String get groupsImageOnMac => 'Mac 上の画像';

  @override
  String get groupsRemovedAgent => '削除されたエージェント';

  @override
  String get groupsWaitingTurn => '順番待ち';

  @override
  String get groupsWriting => '入力中';

  @override
  String get groupsAttachTooltip => 'ファイルまたは写真を添付';

  @override
  String get groupsMentionAgent => 'エージェントをメンション';

  @override
  String get groupsMessageHint => 'メッセージ';

  @override
  String get groupsStopAgents => 'エージェントを停止';

  @override
  String get groupsEveryone => '全員';

  @override
  String get groupsPausedTitle => 'エージェントが一時停止しました';

  @override
  String get groupsPausedBody => 'しばらく話し合いを続けていて、まだ話したいことがあるようです。';

  @override
  String get groupsEndItHere => 'ここで終わる';

  @override
  String get groupsLetThemContinue => '続けさせる';

  @override
  String get groupsOfflineHint => 'Mac に接続すると、メッセージがここに表示されます。';

  @override
  String get groupsLoadingMessages => 'メッセージを読み込み中';

  @override
  String get groupsEveryoneIsHere => '全員そろいました';

  @override
  String get groupsEmptyChatHint => '@ を入力すると、誰が答えるかを選べます。最初のメッセージは全員に届きます。';

  @override
  String get groupsAskEveryoneToSayHello => '全員にあいさつしてもらう';

  @override
  String get groupsManageOnMac => 'エージェントの追加や削除は、Mac の DJL で行ってください。';

  @override
  String get groupsReady => '準備完了';

  @override
  String get groupsStop => '停止';

  @override
  String get guardianLiveReason => '再試行の承認は、ライブセッション中のみ行えます。';

  @override
  String get guardianExpiredReason =>
      'この再試行は利用できなくなりました。Codex がもう一度操作をリクエストするのを待ってください。';

  @override
  String get guardianDesktopReason => 'この再試行は Codex Desktop で承認してください。';

  @override
  String get guardianUnsafeReason => 'この操作はここでは安全に再試行できません。Codex で承認してください。';

  @override
  String get guardianSubmittedReason =>
      '再試行の承認を送信しました。もう一度試す前に Codex を確認してください。';

  @override
  String get guardianUncertainReason =>
      '再試行の承認が Codex に届いていない可能性があります。もう一度試す前に Codex を確認してください。';

  @override
  String get guardianRequestedAction => 'リクエストされた操作';

  @override
  String get guardianRunCommand => 'コマンドを実行';

  @override
  String get guardianApplyFileChanges => 'ファイルの変更を適用';

  @override
  String guardianEditFile(String file) {
    return '$file を編集';
  }

  @override
  String guardianEditFiles(int count, String files) {
    return '$count 件のファイルを編集：$files';
  }

  @override
  String get guardianAccessNetwork => 'ネットワークにアクセス';

  @override
  String guardianAccessHost(String host) {
    return '$host にアクセス';
  }

  @override
  String get guardianRequestPermissions => '追加の権限をリクエスト';

  @override
  String get guardianRequestNetwork => 'ネットワークへのアクセスをリクエスト';

  @override
  String get guardianRequestFileAccess => 'ファイルへのアクセスをリクエスト';

  @override
  String get guardianRequestNetworkAndFileAccess => 'ネットワークとファイルへのアクセスをリクエスト';

  @override
  String get guardianReviewing => '審査中';

  @override
  String get guardianApproved => '承認済み';

  @override
  String get guardianDenied => '拒否済み';

  @override
  String get guardianTimedOut => 'タイムアウト';

  @override
  String get guardianStopped => '停止済み';

  @override
  String guardianUpdatedStatus(String status) {
    return '更新済み（$status）';
  }

  @override
  String get guardianDetailsUnavailable => '審査の詳細を取得できません。';

  @override
  String guardianAutoReviewTitle(String status) {
    return '自動審査 · $status';
  }

  @override
  String get guardianRiskLow => '低リスク';

  @override
  String get guardianRiskMedium => '中リスク';

  @override
  String get guardianRiskHigh => '高リスク';

  @override
  String guardianRiskOther(String level) {
    return 'リスク：$level';
  }

  @override
  String guardianAuthorization(String value) {
    return '承認：$value';
  }

  @override
  String get guardianApprovalRecorded => '承認を記録しました。再試行時にもう一度審査されます';

  @override
  String get guardianSubmittingApproval => '再試行の承認を送信中…';

  @override
  String get guardianApproveOneRetry => '再試行を 1 回承認';

  @override
  String get subagentsSubagent => 'サブエージェント';

  @override
  String get subagentsSpawnAgent => 'エージェントを起動';

  @override
  String get subagentsWaitForAgents => 'エージェントを待機';

  @override
  String get subagentsUpdateAgent => 'エージェントを更新';

  @override
  String get subagentsResumeAgent => 'エージェントを再開';

  @override
  String get subagentsCloseAgent => 'エージェントを終了';

  @override
  String get subagentsActivity => 'サブエージェントのアクティビティ';

  @override
  String get subagentsMetadataUnavailable => 'サブエージェントの情報を取得できません';

  @override
  String get activityCommand => 'コマンド';

  @override
  String get activityFileChanges => 'ファイルの変更';

  @override
  String activityFilesChanged(int count) {
    return '$count 件のファイルを変更';
  }

  @override
  String get activityToolActivity => 'ツールのアクティビティ';

  @override
  String get activityReadFile => 'ファイルを読み込み';

  @override
  String activityReadValue(String value) {
    return '$value を読み込み';
  }

  @override
  String get activitySearchFiles => 'ファイルを検索';

  @override
  String activitySearchValue(String value) {
    return '$value を検索';
  }

  @override
  String get activityListFiles => 'ファイルを一覧表示';

  @override
  String activityListFilesValue(String value) {
    return 'ファイルを一覧表示 $value';
  }

  @override
  String get statusTaskStatus => 'タスクの状態';

  @override
  String get statusAllowed => 'このデバイスではタスクの状態の表示が許可されています。';

  @override
  String get statusDenied =>
      'デバイスの設定で、ローカルのタスク状態の表示を許可してください。許可しなくてもチャットは使えます。';

  @override
  String get statusUnsupported => 'このデバイスではタスクの状態を利用できません。';

  @override
  String get statusChecking => 'デバイスの権限を確認中…';

  @override
  String get statusEnable => 'オンにする';

  @override
  String get statusRefresh => 'タスクの状態を更新';

  @override
  String get statusSystemSettings => '設定を開く';

  @override
  String pairingStateLabel(String state) {
    String _temp0 = intl.Intl.selectLogic(state, {
      'disconnected': '未接続',
      'resolving': '検索中',
      'connecting': '接続中',
      'connected': '接続済み',
      'offline': 'パソコンがオフライン',
      'suspended': '一時停止中',
      'other': '$state',
    });
    return '$_temp0';
  }

  @override
  String get settingsLanguage => '言語';

  @override
  String get settingsLanguageSystem => 'システムのデフォルト';

  @override
  String get workspaceUndoNoExactPatch => '完全なパッチが記録されていないため、取り消せません。';

  @override
  String get workspaceUndoRenames => '名前の変更はここでは取り消せません。';

  @override
  String get workspaceUndoBinary => 'バイナリ、名前の変更、権限、シンボリックリンクの変更はここでは取り消せません。';
}
