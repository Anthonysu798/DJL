// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'DJL';

  @override
  String get commonCancel => 'Cancel';

  @override
  String get commonTryAgain => 'Try again';

  @override
  String get chatUiAccessAskTitle => 'Ask for approval';

  @override
  String get chatUiAccessAskDetail =>
      'Always ask to edit external files and use the internet';

  @override
  String get chatUiAccessAutoTitle => 'Approve for me';

  @override
  String get chatUiAccessAutoDetail =>
      'Only ask for actions detected as potentially unsafe';

  @override
  String get chatUiAccessFullTitle => 'Full access';

  @override
  String get chatUiAccessFullDetail => 'Full computer access (elevated risk)';

  @override
  String get chatUiAccessHint => 'Changes how Codex requests permission';

  @override
  String get chatUiAccessFullConfirmTitle => 'Allow full desktop access?';

  @override
  String get chatUiAccessFullConfirmBody =>
      'The agent can change files and run commands outside the workspace without asking for approval.';

  @override
  String get chatUiAccessFullConfirm => 'Allow full access';

  @override
  String get chatUiAttentionNoMatches => 'No matching attention items';

  @override
  String get chatUiAttentionAllCaughtUp => 'You\'re all caught up';

  @override
  String get chatUiAttentionNoMatchesHint =>
      'Try a different project, chat, or status.';

  @override
  String get chatUiAttentionEmptyHint =>
      'Approvals, agent questions, failed runs, and completed work will appear here.';

  @override
  String get chatUiAttentionNeedsYou => 'NEEDS YOU';

  @override
  String get chatUiAttentionReadyToReview => 'READY TO REVIEW';

  @override
  String get chatUiAgoNow => 'now';

  @override
  String chatUiAgoMinutes(int minutes) {
    return '${minutes}m ago';
  }

  @override
  String chatUiAgoHours(int hours) {
    return '${hours}h ago';
  }

  @override
  String chatUiAgoDays(int days) {
    return '${days}d ago';
  }

  @override
  String get chatUiAttentionTitle => 'Attention';

  @override
  String get chatUiAttentionConnectionChanged =>
      'Connection changed. Go back to reopen Attention.';

  @override
  String get chatUiAttentionSearch => 'Search attention';

  @override
  String get appSavedConnectionsUnreadable =>
      'Saved desktop connection details could not be read. Your saved connections have been kept.';

  @override
  String get appRestoreMacsFailed =>
      'Could not restore saved Macs. Unlock your device and retry.';

  @override
  String get appLinkedConversationFailed =>
      'Could not open the linked conversation. Check your connection and retry.';

  @override
  String get appLinkedAccountUnavailable =>
      'Account details are still unavailable. Retry the linked conversation when they load.';

  @override
  String get appAccountStillLoading =>
      'Account details are still loading. Please try again.';

  @override
  String get appRenameChat => 'Rename chat';

  @override
  String get appRenameChatPlaceholder => 'Title';

  @override
  String get appSave => 'Save';

  @override
  String get appOpenNavigation => 'Open navigation';

  @override
  String get appAccountUnavailable => 'Account details are unavailable.';

  @override
  String get appRetryAccount => 'Retry account';

  @override
  String get appImages => 'Images';

  @override
  String get appNotifications => 'Notifications';

  @override
  String get appRetryLinkedConversation => 'Retry linked conversation';

  @override
  String get coreBack => 'Back';

  @override
  String get coreMenu => 'Menu';

  @override
  String get coreChatActions => 'Chat actions';

  @override
  String get coreSessionEnded =>
      'Your session has ended. Please sign in again.';

  @override
  String coreCloudRequestFailed(int status) {
    return 'DJL Cloud request failed ($status).';
  }

  @override
  String get coreAccountChanged => 'The account changed.';

  @override
  String get corePleaseSignIn => 'Please sign in.';

  @override
  String get coreNoAccessToken => 'DJL Cloud returned no access token.';

  @override
  String get coreCloudTimeout => 'DJL Cloud took too long to respond.';

  @override
  String get coreCloudUnreachable =>
      'Could not reach DJL Cloud. Check your connection.';

  @override
  String get corePleaseSignInAgain => 'Please sign in again.';

  @override
  String get coreInvalidPushRegistration =>
      'Invalid notification registration.';

  @override
  String get corePushNotAcknowledged => 'Registration was not acknowledged.';

  @override
  String get coreCloudResponseUnreadable =>
      'This version could not read the DJL Cloud response.';

  @override
  String get coreInvalidDesktopEnvelope =>
      'Invalid or replayed desktop envelope.';

  @override
  String get coreDesktopMessageUnauthenticated =>
      'Could not authenticate the desktop message.';

  @override
  String get gitThreadChangedReopenAction =>
      'Thread activity changed. Reopen this branch or worktree action.';

  @override
  String get gitWaitForThread =>
      'Wait until this thread finishes before changing branches or worktrees.';

  @override
  String get gitWaitForOperation =>
      'Wait for the current Git operation to finish before changing branches or worktrees.';

  @override
  String get gitNotRepositorySentence => 'This folder is not a Git repository.';

  @override
  String get gitNotRepository => 'This folder is not a Git repository';

  @override
  String get gitNoLongerRepository =>
      'This folder is no longer a Git repository. Refresh before creating a branch or worktree.';

  @override
  String get gitContinue => 'Continue';

  @override
  String get gitOk => 'OK';

  @override
  String get gitCreate => 'Create';

  @override
  String get gitClose => 'Close';

  @override
  String get gitDone => 'Done';

  @override
  String get gitGenerating => 'Generating…';

  @override
  String get gitGenerateMessage => 'Generate message';

  @override
  String get gitCommitAllTitle => 'Commit all current changes';

  @override
  String get gitCommitPublishTitle => 'Commit and publish changes';

  @override
  String get gitCommitMessageLabel => 'Commit message';

  @override
  String get gitPublishBranchTitle => 'Publish this branch?';

  @override
  String get gitPublishCommitPushBody =>
      'Commit all current changes and push this branch to its remote.';

  @override
  String get gitPublishFeatureBranchPrBody =>
      'Prepare a feature branch, commit all changes, push the branch, and create a pull request on GitHub.';

  @override
  String get gitPublishCommitPrBody =>
      'Commit all changes, push the branch, and create a pull request on GitHub.';

  @override
  String get gitCommitCreateSwitch => 'Commit, Create & Switch';

  @override
  String get gitCreateManagedWorktree => 'Create managed worktree';

  @override
  String get gitCreateWorktree => 'Create worktree';

  @override
  String get gitBranchName => 'Branch name';

  @override
  String get gitBaseBranch => 'Base branch';

  @override
  String get gitMoveCurrentChanges => 'Move current changes';

  @override
  String get gitCopyCurrentChanges => 'Copy current changes';

  @override
  String get gitLeaveChangesHere => 'Leave changes here';

  @override
  String get gitInitializeTitle => 'Initialize Git?';

  @override
  String get gitInitializeBody => 'Create a Git repository in this workspace.';

  @override
  String get gitPushTitle => 'Push branch?';

  @override
  String get gitPushBody =>
      'Push the committed changes to the configured remote.';

  @override
  String get gitLocalChangesNeedAttention => 'Local changes need attention';

  @override
  String get gitUpdateRepositoryTitle => 'Update repository?';

  @override
  String get gitDirtyAndBehindBody =>
      'You have local changes and the remote branch moved ahead. Pull with rebase only if you\'re ready to reconcile those changes.';

  @override
  String get gitPullBody => 'Pull remote commits into this branch.';

  @override
  String get gitPullAndRebase => 'Pull & Rebase';

  @override
  String get gitUpdate => 'Update';

  @override
  String get gitTransferChangesTitle => 'Transfer changes';

  @override
  String get gitTargetWorkspacePath => 'Target workspace path';

  @override
  String get gitRemoveWorktreeTitle => 'Remove this worktree?';

  @override
  String get gitRemoveWorktreeBody =>
      'Remove the managed worktree for this branch. The desktop will refuse to remove the main checkout.';

  @override
  String get gitDiscardTitle => 'Discard local changes?';

  @override
  String get gitDiscardBody =>
      'Discard local file changes and reset this branch to its remote.';

  @override
  String get gitPrDraftTitle => 'Pull request draft';

  @override
  String get gitCopyDraft => 'Copy draft';

  @override
  String get gitCreatePrTitle => 'Create pull request?';

  @override
  String get gitCreatePrBody =>
      'The desktop will push this branch if needed, generate a title and description from the committed changes, and create the pull request on GitHub.';

  @override
  String get gitNoChangesToShow => 'There are no repository changes to show.';

  @override
  String get gitBranchSwitchFailed => 'Branch Switch Failed';

  @override
  String get gitBranchOpenElsewhere =>
      'Cannot switch branches: this branch is already open in another worktree.';

  @override
  String get gitErrorTitle => 'Git Error';

  @override
  String get gitOpenPr => 'Open PR';

  @override
  String get gitLoadingChanges => 'Loading changes';

  @override
  String get gitLoadingChangesEllipsis => 'Loading changes…';

  @override
  String get gitChangesUnavailable => 'Changes unavailable';

  @override
  String get gitNoChanges => 'No changes';

  @override
  String get gitDesktopChanged =>
      'Connected desktop changed. Reopen Git from its workspace.';

  @override
  String get gitChooseWorkspace =>
      'Choose a desktop workspace before using Git.';

  @override
  String get gitWorking => 'Working…';

  @override
  String get gitRetryStatus => 'Retry Git status';

  @override
  String get gitWorktreeUnavailable => 'Worktree unavailable';

  @override
  String get gitActionsLabel => 'Git actions';

  @override
  String get gitRefreshStatus => 'Refresh Git status';

  @override
  String get gitShowMenu => 'Show menu';

  @override
  String get gitInitializeRepository => 'Initialize repository';

  @override
  String get gitCreateBranch => 'Create branch';

  @override
  String get gitTransferToWorkspace => 'Transfer changes to workspace';

  @override
  String get gitRemoveManagedWorktree => 'Remove managed worktree';

  @override
  String get gitGeneratePrDraft => 'Generate PR draft';

  @override
  String get gitCreatePullRequest => 'Create pull request';

  @override
  String get gitCommitAndPushMenu => 'Commit and push';

  @override
  String get gitCommitPushCreatePrMenu => 'Commit, push and create PR';

  @override
  String get gitDiscardAndReset => 'Discard and reset to remote';

  @override
  String get gitWorktreeReady => 'Worktree ready';

  @override
  String get gitOpenChat => 'Open chat';

  @override
  String get gitOpenPullRequest => 'Open pull request';

  @override
  String get gitDetachedHead => 'Detached HEAD';

  @override
  String get gitNoUpstream => 'No upstream branch';

  @override
  String gitAheadBehind(int ahead, int behind) {
    return '$ahead ahead · $behind behind';
  }

  @override
  String get gitCommitChanges => 'Commit changes';

  @override
  String get gitPush => 'Push';

  @override
  String get gitPullTitle => 'Pull changes?';

  @override
  String get gitPull => 'Pull';

  @override
  String get gitViewDiff => 'View diff';

  @override
  String get gitCurrentBranch => 'Current Branch';

  @override
  String get gitBranchFallback => 'Branch';

  @override
  String get gitWriterModel => 'Git writer model';

  @override
  String get gitConnectCodexModel =>
      'Connect a Codex model on your Mac to generate commit messages and PR drafts.';

  @override
  String gitChangedFilesCount(int count) {
    return '$count changed files';
  }

  @override
  String get gitActionInitialize => 'Initialize Git';

  @override
  String get gitActionChanges => 'Changes';

  @override
  String get gitActionCommit => 'Commit';

  @override
  String get gitActionCommitAndPush => 'Commit & Push';

  @override
  String get gitActionCommitPushPr => 'Commit, Push & PR';

  @override
  String get gitActionCreatePr => 'Create PR';

  @override
  String get gitSectionSetup => 'Setup';

  @override
  String get gitSectionWrite => 'Write';

  @override
  String get gitStatusNotInitialized => 'Git is not initialized';

  @override
  String get gitStatusUpToDate => 'Repository up to date';

  @override
  String get gitStatusAheadOnly => 'Local branch ahead of remote';

  @override
  String get gitStatusBehindOnly => 'Remote branch ahead of local branch';

  @override
  String get gitStatusDiverged => 'Local and remote branches diverged';

  @override
  String get gitStatusDirty => 'Local repository has uncommitted changes';

  @override
  String get gitStatusDirtyAndBehind =>
      'Local changes exist and remote branch moved ahead';

  @override
  String get gitStatusNoUpstream => 'Branch not published yet';

  @override
  String get gitStatusDetachedHead => 'Current branch unavailable';

  @override
  String get gitStatusUnavailable => 'Repository status unavailable';

  @override
  String gitReviewLocalCommits(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count local commits',
      one: '1 local commit',
    );
    return '$_temp0';
  }

  @override
  String get gitReviewTheCurrentBranch => 'the current branch';

  @override
  String gitReviewCreatingFrom(String name, String source) {
    return 'You\'re creating \'$name\' from $source. Carry your local changes onto the new branch, or commit first and then create + switch.';
  }

  @override
  String gitReviewCommitsStayPrefix(
    String base,
    String commits,
    String message,
  ) {
    return '$base already has $commits that are not on the remote. Those commits stay on $base\'s history. $message';
  }

  @override
  String get gitReviewFilesWithChanges => 'Files with local changes:';

  @override
  String gitReviewMoreFiles(int count) {
    return '+$count more files';
  }

  @override
  String gitReviewBringChangesTitle(String name) {
    return 'Bring local changes to \'$name\'?';
  }

  @override
  String get gitReviewCarryToNewBranch => 'Carry to New Branch';

  @override
  String gitReviewCommitsStayTitle(String base) {
    return 'Local commits stay on $base';
  }

  @override
  String gitReviewBranchCommitsStay(String base, String commits, String name) {
    return '$base already has $commits that are not on the remote. Creating \'$name\' now starts the new branch from the current HEAD, but those commits stay in $base\'s history.';
  }

  @override
  String get gitReviewCreateAnyway => 'Create Anyway';

  @override
  String get gitReviewManagedWorktreeNoun => 'a managed worktree';

  @override
  String gitReviewQuotedName(String name) {
    return '\'$name\'';
  }

  @override
  String get gitReviewCopyTitle => 'Copy local changes from the current branch';

  @override
  String get gitReviewMoveTitle => 'Move local changes from the current branch';

  @override
  String get gitReviewVerbCopy => 'copy';

  @override
  String get gitReviewVerbMove => 'move';

  @override
  String gitReviewOnlyCurrentBranch(
    String target,
    String verb,
    String current,
  ) {
    return 'Creating $target can $verb local changes only from the current branch. Switch the base branch to \'$current\' or clean up local changes before creating the worktree.';
  }

  @override
  String gitReviewCopiedInto(String worktree) {
    return ' Local changes will also be copied into $worktree; ignored files stay here.';
  }

  @override
  String gitReviewMovedInto(String worktree) {
    return ' Local changes will move into $worktree; ignored files stay here.';
  }

  @override
  String get gitReviewTheManagedWorktree => 'the managed worktree';

  @override
  String get gitReviewTheNewWorktree => 'the new worktree';

  @override
  String gitReviewWorktreeCommitsStay(
    String base,
    String commits,
    String target,
    String from,
    String suffix,
  ) {
    return '$base already has $commits that are not on the remote. Creating $target from $from starts from the current HEAD, but those commits stay in $base\'s history too.$suffix';
  }

  @override
  String get gitBadgeOpenWorktree => 'Open worktree';

  @override
  String get gitBadgeOpenElsewhere => 'Open elsewhere';

  @override
  String get gitActionCompleted => 'Git action completed.';

  @override
  String gitActionFailed(String error) {
    return '$error Refresh before retrying an action whose result is unknown.';
  }

  @override
  String get gitDismissMenu => 'Dismiss menu';

  @override
  String get gitDiffPatch => 'Patch';

  @override
  String gitDiffLine(int line) {
    return 'Line $line';
  }

  @override
  String gitDiffLines(int first, int last) {
    return 'Lines $first-$last';
  }

  @override
  String get gitDismissBranchPicker => 'Dismiss branch picker';

  @override
  String get gitBadgeCurrent => 'Current';

  @override
  String get gitBadgeDefault => 'Default';

  @override
  String get gitCloseBranchPicker => 'Close branch picker';

  @override
  String get gitBranchPickerStale =>
      'Thread or desktop changed. Close and reopen the branch picker.';

  @override
  String get gitSearchBranches => 'Search branches';

  @override
  String get gitClearBranchSearch => 'Clear branch search';

  @override
  String get gitBranches => 'Branches';

  @override
  String get gitNoBranchesFound => 'No branches found';

  @override
  String get gitNoBranchesHint =>
      'Try a different search or refresh the branch list.';

  @override
  String gitCreateAndCheckout(String name) {
    return 'Create and checkout \'$name\'';
  }

  @override
  String get gitNewBranchEllipsis => 'New branch...';

  @override
  String get gitSwitching => 'Switching...';

  @override
  String get gitRefreshing => 'Refreshing...';

  @override
  String get gitReloadBranchList => 'Reload branch list';

  @override
  String get gitCloseWorktreeReview => 'Close worktree review';

  @override
  String get gitHandoffTitle => 'Hand off thread to worktree';

  @override
  String get gitForkTitle => 'Fork thread into new worktree';

  @override
  String get gitHandoff => 'Hand off';

  @override
  String get gitFork => 'Fork';

  @override
  String get gitHandoffMessage =>
      'Create and check out a branch in a new worktree to continue in parallel. The branch is normalized with the djl/ prefix.';

  @override
  String get gitForkMessage =>
      'Create and check out a branch in a new worktree, then fork this conversation into that checkout as a new chat.';

  @override
  String get gitStartsFromBase => 'Starts from this base branch.';

  @override
  String get gitLoadingWorktreeBranches => 'Loading worktree branches';

  @override
  String get gitPreparingWorktree => 'Preparing worktree';

  @override
  String get gitNewBranch => 'New branch';

  @override
  String get gitNewBranchBody =>
      'Branch will be created locally and checked out. Uncommitted changes stay with this working copy.';

  @override
  String get gitThreadChangedReopenGit =>
      'Thread activity changed. Close and reopen this Git action.';

  @override
  String get gitRepositoryChanges => 'Repository Changes';

  @override
  String gitFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count files changed',
      one: '1 file changed',
    );
    return '$_temp0';
  }

  @override
  String get gitExpandAll => 'Expand All';

  @override
  String get gitCollapseAll => 'Collapse All';

  @override
  String gitPatchIndex(int index, int total) {
    return 'Patch $index of $total';
  }

  @override
  String get chatUiComposerOptions => 'Composer options';

  @override
  String get chatUiStopDictation => 'Stop dictation';

  @override
  String get chatUiStartDictation => 'Start dictation';

  @override
  String get chatUiResumeQueued => 'Resume queued messages';

  @override
  String get chatUiStopTurn => 'Stop turn';

  @override
  String get chatUiSendToDesktop => 'Send to desktop';

  @override
  String get chatUiStartingRun => 'Starting run';

  @override
  String get chatUiRemoveImage => 'Remove image';

  @override
  String get chatUiAttachedImage => 'Attached image';

  @override
  String chatUiDesktopImage(String source) {
    return 'Desktop image: $source';
  }

  @override
  String get chatUiImagePreviewUnavailable => 'Image preview unavailable';

  @override
  String get chatUiContextSkills => 'Skills';

  @override
  String get chatUiContextPlugins => 'Plugins';

  @override
  String get chatUiContextFiles => 'Files';

  @override
  String chatUiContextUnsupported(String kind) {
    return '$kind are not supported by this desktop runtime.';
  }

  @override
  String get chatUiContextStale =>
      'The conversation changed. Reopen the context picker.';

  @override
  String get chatUiContextRetry => 'Retry discovery';

  @override
  String chatUiContextSearchFilesIn(String path) {
    return 'Search files in $path';
  }

  @override
  String get chatUiContextSelectFolder =>
      'Select a project folder to search desktop files.';

  @override
  String chatUiContextNoneFound(String kind) {
    return 'No $kind found.';
  }

  @override
  String get chatUiAddDesktopContext => 'Add desktop context';

  @override
  String get chatUiContextSearchFiles => 'Search files on your desktop';

  @override
  String chatUiContextSearchKind(String kind) {
    return 'Search $kind';
  }

  @override
  String get chatUiContextDisabled => 'Disabled on desktop';

  @override
  String get chatUiContextOnDesktop => 'On paired desktop';

  @override
  String get chatUiEmptyGeneralTitle => 'What should we work on?';

  @override
  String get chatUiEmptyFolderPrefix => 'What should we do in ';

  @override
  String get chatUiEmptyFolderSuffix => '?';

  @override
  String get chatUiEmptyGreeting => 'Hi! How can I help you?';

  @override
  String get chatUiEncryptedCaption => 'Chats are End-to-end encrypted';

  @override
  String get chatUiUserMessage => 'User message';

  @override
  String get chatUiAssistantMessage => 'Assistant message';

  @override
  String get chatUiThreadActions => 'Thread actions';

  @override
  String get chatUiBranchesAndWorktrees => 'Branches & worktrees';

  @override
  String get chatUiGitActions => 'Git actions';

  @override
  String get chatUiWorking => 'Working…';

  @override
  String get chatUiScrollToLatest => 'Scroll to latest message';

  @override
  String get chatUiSavedToPhotos => 'Saved to Photos.';

  @override
  String get chatUiShareImageFailed =>
      'Could not share this image. Please try again.';

  @override
  String get chatUiSaveImageFailed =>
      'Could not save this image. Please try again.';

  @override
  String get chatUiLoadImageFailed => 'Could not load this image.';

  @override
  String get chatUiRetry => 'Retry';

  @override
  String get chatUiImageReopenWorkspace =>
      'Reconnect or reopen this image from its workspace.';

  @override
  String get chatUiImageReopenChat => 'Reopen this image from its paired chat.';

  @override
  String chatUiOpenImage(String name) {
    return 'Open image $name';
  }

  @override
  String get chatUiClose => 'Close';

  @override
  String get chatUiShare => 'Share';

  @override
  String get chatUiSaveToPhotos => 'Save to Photos';

  @override
  String get chatUiModelsGroup => 'Models';

  @override
  String get chatUiRefreshModels => 'Refresh models';

  @override
  String get chatUiProviderAndModel => 'Provider & model';

  @override
  String get chatUiDone => 'Done';

  @override
  String get chatUiAllProviders => 'All providers';

  @override
  String get chatUiModelsConnectionChanged =>
      'Connection changed. Reopen model selection.';

  @override
  String get chatUiLoadingModels => 'Loading models';

  @override
  String get chatUiNoModels => 'No models available';

  @override
  String get chatUiNoModelsHint =>
      'Connect a provider in DJL on your computer, then refresh the model list.';

  @override
  String get chatUiNoMatchingModels => 'No matching models';

  @override
  String get chatUiSearchModels => 'Search providers or models';

  @override
  String get chatUiClearModelSearch => 'Clear model search';

  @override
  String get chatUiNavCloudChat => 'Cloud chat';

  @override
  String get chatUiNavRemote => 'Remote';

  @override
  String get chatUiNavSearchFailed => 'Could not search chats.';

  @override
  String get chatUiNavRetrySearch => 'Retry search';

  @override
  String get chatUiNavSearching => 'Searching chats…';

  @override
  String get chatUiNavPinned => 'Pinned';

  @override
  String get chatUiNavPinnedEmpty =>
      'Keep favorite chats close.\nTouch and hold a chat to pin it.';

  @override
  String get chatUiNavRecent => 'Recent chats';

  @override
  String get chatUiNavRecentEmpty => 'Your chats will appear here.';

  @override
  String get chatUiNoMatchingChats => 'No matching chats';

  @override
  String get chatUiCloseSearch => 'Close search';

  @override
  String get chatUiSearchChats => 'Search chats';

  @override
  String get chatUiChatButton => 'Chat';

  @override
  String get chatUiNewChat => 'New chat';

  @override
  String get chatUiSettings => 'Settings';

  @override
  String get chatUiMoreActions => 'More actions';

  @override
  String get chatUiMenuNewChat => 'New Chat';

  @override
  String get chatUiMenuQuickChat => 'Quick Chat';

  @override
  String get chatUiMenuNewProject => 'New Project';

  @override
  String get chatUiMenuConnections => 'Connections';

  @override
  String get chatUiMenuSecurePairing => 'Secure pairing details';

  @override
  String get chatUiMenuYourMac => 'Your Mac';

  @override
  String get chatUiMenuActiveChats => 'Active chats';

  @override
  String get chatUiArchivedChats => 'Archived chats';

  @override
  String get chatUiMenuRefresh => 'Refresh';

  @override
  String get chatUiMenuDisconnect => 'Disconnect';

  @override
  String get chatUiOpenNavigation => 'Open navigation';

  @override
  String get chatUiSearchConversations => 'Search conversations';

  @override
  String get chatUiDismissSearch => 'Dismiss search';

  @override
  String get chatUiStatusConnecting => 'Connecting';

  @override
  String get chatUiStatusDeviceOffline => 'Device offline';

  @override
  String chatUiStatusDeviceOfflineSince(String time) {
    return 'Asleep or offline since $time';
  }

  @override
  String get chatUiStatusOffline => 'Offline';

  @override
  String chatUiConnectionStatus(String status) {
    return 'Connection status: $status';
  }

  @override
  String get chatUiGroups => 'Groups';

  @override
  String get homeTabChats => 'Chats';

  @override
  String get chatUiExpandAll => 'Expand all';

  @override
  String get chatUiCollapseAll => 'Collapse all';

  @override
  String chatUiCollapseChildChats(String title) {
    return 'Collapse child chats for $title';
  }

  @override
  String chatUiExpandChildChats(String title) {
    return 'Expand child chats for $title';
  }

  @override
  String get chatUiDesktopChatActions => 'Desktop chat actions';

  @override
  String get chatUiArchiveProject => 'Archive Project';

  @override
  String get chatUiRemoveFromPhone => 'Remove from Phone';

  @override
  String chatUiArchiveProjectTitle(String name) {
    return 'Archive \"$name\"?';
  }

  @override
  String get chatUiArchiveProjectBody =>
      'All active chats in this project will be archived.';

  @override
  String chatUiRemoveProjectTitle(String name) {
    return 'Remove \"$name\" from this phone?';
  }

  @override
  String get chatUiRemoveProjectBody =>
      'Chats for this project will be deleted only from DJL on this phone. Nothing is removed from your device or Codex observer.';

  @override
  String chatUiExpandProject(String name) {
    return 'Expand project $name';
  }

  @override
  String chatUiCollapseProject(String name) {
    return 'Collapse project $name';
  }

  @override
  String chatUiNewChatIn(String name) {
    return 'New chat in $name';
  }

  @override
  String get chatUiNewGroup => 'New group';

  @override
  String get chatUiGroupButton => 'Group';

  @override
  String get chatUiOfflineSavedChats => 'Offline · showing saved chats';

  @override
  String get chatUiReconnect => 'Reconnect';

  @override
  String get chatUiNoMatchingChatsPeriod => 'No matching chats.';

  @override
  String get chatUiNoStudioThreads => 'No Studio threads';

  @override
  String get chatUiNoProjectChats => 'No project chats';

  @override
  String get desktopAttentionApproval => 'Approval needed';

  @override
  String get desktopAttentionQuestion => 'Agent has a question';

  @override
  String get desktopAttentionFailedRun => 'Run failed';

  @override
  String get desktopAttentionBlockedGoal => 'Goal needs attention';

  @override
  String get desktopAttentionCompletedRun => 'Ready to review';

  @override
  String get desktopFailurePermission =>
      'Review the requested access or change this chat\'s access mode, then retry the run.';

  @override
  String get desktopFailureSignIn =>
      'Sign in again on your Mac, then retry the run.';

  @override
  String get desktopFailureTimeout =>
      'Check the Mac connection, then retry the run.';

  @override
  String get desktopFailureNetwork =>
      'Check that the Mac and relay are online, then retry the run.';

  @override
  String get desktopFailureCheck =>
      'Open the chat to inspect the failing check, fix it, and retry.';

  @override
  String get desktopFailureGeneric =>
      'Open the chat to review the last step, correct the issue, and retry.';

  @override
  String desktopAttentionAllowCommand(String command) {
    return 'Allow Codex to run “$command”?';
  }

  @override
  String get desktopAttentionAwaitingPermission =>
      'Codex is waiting for permission to continue.';

  @override
  String get desktopAttentionAnswerAgent =>
      'Open the chat to answer the agent.';

  @override
  String get desktopGoalBlocked =>
      'The goal is blocked. Open the chat to review what the agent needs.';

  @override
  String get desktopGoalUsageLimited =>
      'Usage limits paused this goal. Review the chat before resuming it.';

  @override
  String get desktopGoalBudgetLimited =>
      'The goal reached its budget. Review the result before deciding what to do next.';

  @override
  String get desktopRunFinishedReview =>
      'The run finished. Review the result and any file changes before continuing.';

  @override
  String get desktopScopeStudio => 'Studio';

  @override
  String get desktopScopeProjects => 'Projects';

  @override
  String get desktopNoProject => 'No Project';

  @override
  String get desktopGroupPinned => 'Pinned';

  @override
  String get desktopUntitledChat => 'Untitled chat';

  @override
  String get desktopComposerTooManyImages => 'Choose at most four images.';

  @override
  String get desktopContextIncomplete =>
      'A selected context is incomplete. Remove it and select it again.';

  @override
  String get desktopApproveForMeUnsupported =>
      'Approve for me is not supported by this runtime. Update Codex on your Mac and retry.';

  @override
  String get desktopEnterChatName => 'Enter a chat name.';

  @override
  String get desktopContextPickerStale =>
      'Connected desktop changed. Reopen the context picker.';

  @override
  String get desktopNoSkillList => 'The desktop returned no skill list.';

  @override
  String get desktopNoPluginList => 'The desktop returned no plugin list.';

  @override
  String get desktopNoFileMatches => 'The desktop returned no file matches.';

  @override
  String get desktopPairedDisconnectedOrChanged =>
      'The paired desktop is disconnected or changed.';

  @override
  String get desktopPairedChangedRefreshOverview =>
      'The paired desktop changed. Refresh its overview.';

  @override
  String get desktopPairedChangedRefreshChats =>
      'The paired desktop changed. Refresh its chats.';

  @override
  String get desktopIdentityMismatch =>
      'The desktop identity or secure protocol does not match the pairing.';

  @override
  String get desktopHandshakeUnverified =>
      'The desktop handshake signature could not be verified.';

  @override
  String get desktopHandshakeTimedOut => 'Desktop secure handshake timed out.';

  @override
  String get desktopSecureConnectionRefused =>
      'Desktop refused the secure connection.';

  @override
  String get desktopHandshakeInterrupted =>
      'Desktop connection interrupted during secure handshake.';

  @override
  String get desktopSecureConnectionRejected =>
      'Secure desktop connection refused.';

  @override
  String get desktopInvalidFrame => 'Invalid desktop frame.';

  @override
  String get desktopSecureTransportFailed => 'Desktop secure transport failed.';

  @override
  String get desktopUnencryptedRejected =>
      'Unencrypted desktop application traffic was rejected.';

  @override
  String get desktopPayloadDecodeFailed =>
      'Unable to decode part of the desktop payload.';

  @override
  String get desktopRequestFailed => 'Desktop request failed.';

  @override
  String get desktopIsDisconnected => 'Desktop is disconnected.';

  @override
  String get desktopConnectionChanged => 'Desktop connection changed.';

  @override
  String get desktopRequestTimedOut =>
      'Desktop request timed out. Its result is unknown; refresh before retrying.';

  @override
  String get desktopDisconnectedRefresh =>
      'Desktop disconnected; refresh before retrying an action.';

  @override
  String get desktopVerifiedHostRequired =>
      'A saved verified host is required.';

  @override
  String get desktopResponseFailed =>
      'The desktop could not complete this response. Check its provider settings and retry.';

  @override
  String get desktopWaitBeforeMovingProject =>
      'Wait for the current chat operation before moving its project.';

  @override
  String get desktopProviderUnavailable =>
      'The provider for this conversation is unavailable. Connect it on your desktop or choose another provider.';

  @override
  String get desktopReopenBeforeRestore =>
      'Reopen this chat to verify the turn before restoring changes.';

  @override
  String get desktopSwitchCancelled =>
      'Switch cancelled. Choose a device to reconnect.';

  @override
  String get desktopSelectionClearUnconfirmed =>
      'Could not confirm the saved selection was cleared. Unlock your device and choose a saved Mac to recover.';

  @override
  String get desktopLinkIdentityUnavailable =>
      'The saved Mac identity for this link is unavailable. Open the chat from a verified Mac.';

  @override
  String get desktopChooseMatchingMac =>
      'Choose the saved Mac matching this link. Its verified identity must match.';

  @override
  String get desktopWaitingForMac =>
      'Waiting for the selected Mac. Retry when it is available.';

  @override
  String get desktopLinkedConversationUnavailable =>
      'The linked desktop conversation is unavailable.';

  @override
  String get desktopLinkedConversationLoadFailed =>
      'Could not load the linked conversation. Retry on the selected Mac.';

  @override
  String get desktopDevicePreferencesLoadFailed =>
      'Could not load local device preferences. Unlock your device and retry.';

  @override
  String get desktopSavedDesktopsOpenFailed =>
      'Could not open saved desktops. Unlock your device and try again.';

  @override
  String get desktopModelUnavailable =>
      'The selected desktop model is unavailable. Choose an available model.';

  @override
  String get desktopStopRunsUnconfirmed =>
      'Stopping runs could not be confirmed; they may still be running on the other Mac.';

  @override
  String get desktopPairingIdentityReadFailed =>
      'Could not read your secure pairing identity. Unlock your device, then choose Reconnect.';

  @override
  String get desktopRuntimeOtherHistory =>
      'The runtime returned another chat’s history.';

  @override
  String get desktopLinkedHistoryUnverified =>
      'Could not verify the linked conversation history.';

  @override
  String get desktopIdleChatAndProjectRequired =>
      'The current idle chat and a valid project are required.';

  @override
  String get desktopProjectChangeUnverified =>
      'The runtime did not verify this chat’s project change.';

  @override
  String get desktopForkUnidentified =>
      'The runtime did not identify the created fork. Refresh before trying again.';

  @override
  String get desktopForkNotSeparate =>
      'The runtime did not create a separate conversation.';

  @override
  String get desktopForkUnsupported =>
      'This runtime does not support conversation forks. Update DJL on your desktop and retry.';

  @override
  String get desktopReadSettingsFirst =>
      'Read saved settings before creating a new chat.';

  @override
  String get desktopConnectMacWithModels =>
      'Connect a Mac with available models before creating a new chat.';

  @override
  String get desktopChatCreatedElsewhere =>
      'The desktop created the chat in another project folder. Your local draft was retained.';

  @override
  String get desktopDraftContextOtherFolder =>
      'The draft context belongs to another project folder. Remove it and select context again.';

  @override
  String get desktopQueuedPlanModelRequired =>
      'Choose an available model that supports Plan mode before sending this queued draft.';

  @override
  String get desktopChooseModelFirst =>
      'Choose an available desktop model first.';

  @override
  String get desktopRunChangedBeforeQueue =>
      'The active run changed before queued delivery. Refresh before resuming.';

  @override
  String get desktopRunChangedBeforeSteer =>
      'The active run changed. Refresh before steering again.';

  @override
  String get desktopModelBeforeLeavingPlan =>
      'Choose an available model before leaving Plan mode.';

  @override
  String get desktopPlanModeUnsupported =>
      'Plan mode is not supported by this runtime. Sent as a normal turn instead.';

  @override
  String get desktopRunIdPending =>
      'The active run has not published its ID yet. Try again in a moment.';

  @override
  String get desktopRuntimeOtherTurnPage =>
      'The runtime returned another chat’s turn page.';

  @override
  String get desktopRuntimeNoTurnState =>
      'The runtime did not return this chat’s turn state.';

  @override
  String get desktopRuntimeInvalidTurnState =>
      'The runtime returned an invalid turn state.';

  @override
  String get desktopRetryApprovalUnacknowledged =>
      'Desktop did not acknowledge retry approval.';

  @override
  String get desktopDeviceFallbackName => 'Device';

  @override
  String get desktopDeviceChangeUnconfirmed =>
      'Could not confirm the change. Review the saved name and retry. If this device was forgotten or replaced, close and reopen the editor.';

  @override
  String get desktopPreferencesReloadFailed =>
      'Could not confirm or reload local preferences. Unlock your device and retry before saving again.';

  @override
  String get desktopRunChangedBeforePlan =>
      'The active run changed. Refresh before implementing this plan.';

  @override
  String get desktopQueueMessageArrived =>
      'The message arrived. Review its result before resuming queued messages.';

  @override
  String get desktopQueueDeliveryUnconfirmed =>
      'Queued delivery was not confirmed. Reopen this chat before retrying.';

  @override
  String get desktopRequestFromEarlierSession =>
      'This request belongs to an earlier desktop session. Refresh the chat.';

  @override
  String get desktopUndoReconnect =>
      'Reconnect to your desktop before reviewing undo.';

  @override
  String get desktopUndoReopen =>
      'Reopen this chat to verify the response before undoing changes.';

  @override
  String get desktopUndoRepoBusy =>
      'A chat in this repository is running. Wait before undoing a response.';

  @override
  String get desktopUndoWaitResponse =>
      'Wait for the active response before undoing changes.';

  @override
  String get desktopUndoPersistFailed => 'Could not persist the undo result.';

  @override
  String get desktopUndoRepoUnverified =>
      'Could not verify the response repository. Reconnect and review it again.';

  @override
  String get desktopReconnectToRefreshModels =>
      'Reconnect the desktop to refresh models.';

  @override
  String get desktopAccessModeNotApplied =>
      'Desktop did not apply the requested access mode.';

  @override
  String get desktopSubagentOfflineCached => 'Offline · cached details';

  @override
  String get desktopSubagentLoading => 'Loading agent details';

  @override
  String get desktopSubagentLoaded => 'Details loaded';

  @override
  String get desktopSubagentIdentityUnknown => 'Agent identity unknown';

  @override
  String get desktopSubagentLoadFailed => 'Could not load agent details';

  @override
  String get desktopSavedDeviceChanged =>
      'This saved device changed. Choose it again.';

  @override
  String get desktopMacIdentityMismatch =>
      'The selected Mac identity did not match.';

  @override
  String get desktopOfflineChatsOpenFailed =>
      'Could not open offline chats. Unlock your device or reconnect to load them.';

  @override
  String get desktopOfflineChatsSaveFailed =>
      'Could not save offline chats. Unlock your device and try again.';

  @override
  String get desktopChoosePairedDesktop => 'Choose a paired desktop.';

  @override
  String get desktopSavedLocallyUnconfirmed =>
      'Saved on this device. The change on your desktop could not be confirmed; refresh before retrying.';

  @override
  String get desktopImageEmptyOrTooLarge =>
      'The selected image is empty or too large. Choose a smaller image.';

  @override
  String get desktopImageUnsupported =>
      'The selected file is not a supported image.';

  @override
  String get desktopImageResizeFailed =>
      'This device could not resize the image. Choose an image no larger than 1600 pixels.';

  @override
  String get desktopImageTooLarge =>
      'The selected image is too large. Choose a smaller image.';

  @override
  String get desktopContextFolderChanged =>
      'The project folder changed. Remove existing context or return to its original folder.';

  @override
  String get desktopPickerOpenFailed =>
      'Could not open the picker. Please try again.';

  @override
  String get desktopWorktreeStale =>
      'The connected desktop or chat changed. Reopen this worktree action.';

  @override
  String get desktopNotGitRepository =>
      'This folder is no longer a Git repository.';

  @override
  String get desktopBranchAlreadyExists => 'Branch Already Exists';

  @override
  String get desktopWorktreeUnidentified =>
      'The desktop did not identify a new worktree. Refresh before trying again.';

  @override
  String get desktopForkUnverified => 'The fork result could not be verified.';

  @override
  String get desktopHandoffUnverified =>
      'The desktop did not verify the handoff destination. Check both folders before retrying.';

  @override
  String get desktopWorktreePathUnavailable =>
      'The worktree path is unavailable.';

  @override
  String get desktopLocalCheckoutUnresolved =>
      'Could not resolve the paired Local checkout for this worktree.';

  @override
  String get desktopWorktreeHandoffFailed => 'Worktree Handoff Failed';

  @override
  String get desktopWorktreeForkFailed => 'Worktree Fork Failed';

  @override
  String desktopAccessModeNotAppliedBy(String method) {
    return '$method did not apply the selected access mode.';
  }

  @override
  String desktopApprovalReviewerNotApplied(String method) {
    return '$method did not apply the selected approval reviewer.';
  }

  @override
  String desktopApprovalPolicyNotApplied(String method) {
    return '$method did not apply the selected approval policy.';
  }

  @override
  String desktopSandboxNotApplied(String method) {
    return '$method did not apply the selected sandbox permissions.';
  }

  @override
  String desktopForkResultUnknown(String error) {
    return '$error The fork result may be unknown. Refresh before trying again.';
  }

  @override
  String desktopSendResultUnknown(String error) {
    return '$error The send result may be unknown. Refresh the conversation before trying again.';
  }

  @override
  String desktopQueuePaused(String reason) {
    return 'Queue paused: $reason';
  }

  @override
  String desktopWorktreeExists(String branch) {
    return 'A worktree for \'$branch\' already exists. Choose a different name.';
  }

  @override
  String desktopRollbackFailed(String reason) {
    return 'Tracked changes could not be moved back automatically: $reason. Check both folders before retrying.';
  }

  @override
  String desktopWorktreeKeptAt(String path) {
    return 'The new worktree was kept at $path. Check it before trying again.';
  }

  @override
  String get desktopWorktreeMayExist =>
      'A worktree may have been created. It was kept; refresh and inspect it before trying again.';

  @override
  String get pairingEnterTenCharCode =>
      'Enter the ten-character code shown in desktop Remote settings.';

  @override
  String get pairingSecureRelayRequired =>
      'Pairing requires a secure relay URL.';

  @override
  String get pairingPairedMac => 'Paired Mac';

  @override
  String get pairingNotAPairingCode =>
      'This is not a DJL pairing QR or pasteable code.';

  @override
  String get pairingUpdateDesktop =>
      'Update DJL on your desktop: this pairing uses a different protocol.';

  @override
  String get pairingProofMismatch =>
      'The pairing code or QR code did not match. Generate a new one and try again.';

  @override
  String get pairingInvalidIdentifier => 'Invalid device/session identifier.';

  @override
  String get pairingInvalidIdentityKey => 'Invalid desktop identity key.';

  @override
  String get pairingCodeExpired =>
      'This pairing code has expired. Generate a new code on your Mac.';

  @override
  String get pairingPrefsUnavailable =>
      'Saved device preferences are unavailable.';

  @override
  String get pairingDeviceChangedReopen =>
      'This saved device changed. Close and reopen the editor.';

  @override
  String get pairingRecoverSelectionFailed =>
      'Could not recover the saved selection. Unlock your device and retry before choosing a Mac.';

  @override
  String get pairingDeviceChangedChooseAgain =>
      'The saved device changed. Choose it again.';

  @override
  String get pairingConfirmSavedFailed =>
      'Could not confirm the selected Mac was saved. Unlock your device and choose a saved Mac to recover.';

  @override
  String get pairingRelayDifferentIdentity =>
      'The trusted relay returned a different desktop identity. Pair again.';

  @override
  String get pairingRelayTemporarilyUnavailable =>
      'The desktop relay is temporarily unavailable.';

  @override
  String get pairingRelayInvalidResponse =>
      'The desktop relay returned an invalid response.';

  @override
  String get pairingTrustedComputerOffline =>
      'The trusted computer is offline.';

  @override
  String get pairingServiceUnavailable =>
      'The desktop pairing service is unavailable.';

  @override
  String get pairingRelayUnreachable => 'Could not reach the desktop relay.';

  @override
  String get pairingRelayUnsupportedMethod =>
      'The relay does not support this pairing method.';

  @override
  String get pairingRelayRequired => 'A relay URL is required.';

  @override
  String get pairingEnterOneTimeCode => 'Enter one-time code';

  @override
  String get pairingFindCodeHint =>
      'Find your code in DJL Desktop under Settings → Remote.';

  @override
  String get pairingCodeLabel => 'Pairing code';

  @override
  String get pairingRelayConfigured => 'Relay configured';

  @override
  String get pairingRelaySettings => 'Relay settings';

  @override
  String get pairingInProgress => 'Pairing…';

  @override
  String get pairingPair => 'Pair';

  @override
  String get pairingSecureDetailsTitle => 'Secure pairing details';

  @override
  String get pairingSecureDetailsBody =>
      'Open DJL desktop → Settings → Remote. Paste its pairing payload, or configure the relay used by your one-time code.';

  @override
  String get pairingPasteCode => 'Paste pairing code';

  @override
  String get pairingPayloadHint => 'RMX1:… or QR JSON';

  @override
  String get pairingPairSecurely => 'Pair securely';

  @override
  String get pairingRelayUrlLabel => 'Desktop relay URL';

  @override
  String get pairingSwitchDeviceTitle => 'Switch device?';

  @override
  String get pairingSwitchDeviceBody =>
      'DJL will try to stop in-progress runs on this Mac and reload chats for the other device.';

  @override
  String get pairingSwitch => 'Switch';

  @override
  String get pairingCancellingSwitch => 'Cancelling switch…';

  @override
  String get pairingSwitchingDevice => 'Switching device…';

  @override
  String get pairingCancelSwitch => 'Cancel switch';

  @override
  String get pairingChooseMatchingMac =>
      'Choose the saved Mac matching this link’s verified identity.';

  @override
  String get pairingChooseMacForLink =>
      'Choose a saved Mac to open the linked conversation.';

  @override
  String get pairingOpeningLinkedConversation =>
      'Opening linked desktop conversation…';

  @override
  String get pairingRetryDesktopLink => 'Retry desktop link';

  @override
  String get pairingCancelDesktopLink => 'Cancel desktop link';

  @override
  String get pairingMatchesLinkIdentity =>
      'Matches this link’s verified identity';

  @override
  String get pairingDifferentIdentity => 'Different desktop identity';

  @override
  String get pairingSavedVerifiedIdentity => 'Saved, verified desktop identity';

  @override
  String get pairingReconnect => 'Reconnect';

  @override
  String get pairingConnections => 'Connections';

  @override
  String get pairingScanQrCode => 'Scan QR Code';

  @override
  String get pairingPairWithCode => 'Pair with Code';

  @override
  String get pairingConnectToDesktop => 'Connect to DJL Desktop';

  @override
  String get pairingChooseSavedMac => 'Choose a saved Mac';

  @override
  String get pairingFirstPairingHint =>
      'Open DJL on your Mac or Windows PC, then go to Settings → Remote.';

  @override
  String get pairingGetDesktop => 'Get DJL for your Mac or PC';

  @override
  String get pairingScanTitle => 'Scan DJL desktop QR';

  @override
  String get pairingCameraDenied =>
      'Camera access is denied. You can paste the pairing code instead.';

  @override
  String get pairingScanUnsupported =>
      'QR scanning is not available on this device. You can paste the pairing code instead.';

  @override
  String get pairingCameraUnavailable =>
      'The camera is unavailable. You can paste the pairing code instead.';

  @override
  String get pairingSwitchDevice => 'Switch device';

  @override
  String get pairingSwitchTo => 'Switch to';

  @override
  String get pairingStatusSwitching => 'Switching…';

  @override
  String get pairingStatusConnected => 'Connected';

  @override
  String get pairingStatusSelected => 'Selected';

  @override
  String get pairingStatusPrevious => 'Previous';

  @override
  String get pairingStatusSaved => 'Saved';

  @override
  String get pairingForget => 'Forget';

  @override
  String get pairingForgetDeviceTitle => 'Forget this device?';

  @override
  String pairingForgetDeviceBody(String name) {
    return '$name will be removed from this phone. Scan its QR code again to reconnect.';
  }

  @override
  String get pairingActiveBadge => 'Active';

  @override
  String pairingShowInMenu(String name) {
    return 'Show $name in device menu';
  }

  @override
  String get pairingMenuVisibilityUnavailable => 'Menu visibility unavailable';

  @override
  String get pairingClose => 'Close';

  @override
  String get pairingActiveDevice => 'Active device';

  @override
  String pairingActiveDeviceNamed(String name) {
    return 'Active device, $name';
  }

  @override
  String pairingDevicesInMenu(int count) {
    return '$count devices in menu';
  }

  @override
  String get pairingDevices => 'Devices';

  @override
  String get pairingNoDevices => 'No paired devices yet.';

  @override
  String get pairingScanQr => 'Scan QR';

  @override
  String get pairingForgetDesktop => 'Forget desktop';

  @override
  String get pairingRecencyNow => 'now';

  @override
  String pairingRecencyMinutes(int count) {
    return '${count}m';
  }

  @override
  String pairingRecencyHours(int count) {
    return '${count}h';
  }

  @override
  String pairingRecencyDays(int count) {
    return '${count}d';
  }

  @override
  String pairingRecencyAgo(String age) {
    return '$age ago';
  }

  @override
  String pairingRecencyIn(String age) {
    return 'in $age';
  }

  @override
  String get chatUiCloseNavigation => 'Close navigation';

  @override
  String get chatUiRuntime => 'Runtime';

  @override
  String get chatUiContinueIn => 'Continue in';

  @override
  String get chatUiLocal => 'Local';

  @override
  String get chatUiWorktree => 'Worktree';

  @override
  String get chatUiCurrentBranch => 'Current Branch';

  @override
  String get chatUiCollapseProjectControls => 'Collapse project controls';

  @override
  String get chatUiExpandProjectControls => 'Expand project controls';

  @override
  String get chatUiQueuedMessages => 'Queued messages';

  @override
  String get chatUiQueuedHint => 'Shows the queued follow-ups in a sheet';

  @override
  String get chatUiQueued => 'Queued';

  @override
  String get chatUiQueuedNeedsPlanModel =>
      'Choose a model that supports Plan mode before moving this draft into the input.';

  @override
  String chatUiImageCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count images',
      one: '1 image',
    );
    return '$_temp0';
  }

  @override
  String get chatUiAttachedContext => 'Attached context';

  @override
  String get chatUiMoveDraftToInput => 'Move draft into input';

  @override
  String get chatUiSteerQueued => 'Steer queued message';

  @override
  String get chatUiSteer => 'Steer';

  @override
  String get chatUiDeleteQueued => 'Delete queued message';

  @override
  String get chatUiCopyResponse => 'Copy response';

  @override
  String get chatUiCopied => 'Copied';

  @override
  String get chatUiEffortLow => 'Low';

  @override
  String get chatUiEffortMedium => 'Medium';

  @override
  String get chatUiEffortHigh => 'High';

  @override
  String get chatUiEffortExtraHigh => 'Extra High';

  @override
  String get chatUiLoading => 'Loading…';

  @override
  String get chatUiSelectModel => 'Select model';

  @override
  String get chatUiModel => 'Model';

  @override
  String get chatUiSpeed => 'Speed';

  @override
  String get chatUiSpeedFast => 'Fast';

  @override
  String get chatUiSpeedNormal => 'Normal';

  @override
  String get chatUiChatControls => 'Chat controls';

  @override
  String get chatUiControlsConnectionChanged =>
      'Connection changed. Reopen chat controls.';

  @override
  String get chatUiLoadingModelsEllipsis => 'Loading models…';

  @override
  String get chatUiOtherModels => 'Other models…';

  @override
  String get chatUiIntelligence => 'Intelligence';

  @override
  String get chatUiCopySessionId => 'Copy session ID';

  @override
  String get chatUiRenameChat => 'Rename chat';

  @override
  String get chatUiUnpinChat => 'Unpin chat';

  @override
  String get chatUiPinChat => 'Pin chat';

  @override
  String get chatUiUnarchiveChat => 'Unarchive chat';

  @override
  String get chatUiArchiveChat => 'Archive chat';

  @override
  String get chatUiRemoveFromDevice => 'Remove from this device';

  @override
  String get chatUiSessionIdCopied => 'Session ID copied.';

  @override
  String get chatUiRemoveChatTitle => 'Remove this chat from this device?';

  @override
  String get chatUiRemoveChatBodyArchived =>
      'The chat stays on your desktop. Subagent chats are archived locally.';

  @override
  String get chatUiRemoveChatBody =>
      'The chat stays on your desktop. It will also be archived there. Subagent chats are archived locally.';

  @override
  String get chatUiRemoveChat => 'Remove chat';

  @override
  String get chatUiChatName => 'Chat name';

  @override
  String get chatUiSaveName => 'Save name';

  @override
  String get chatUiCopyPathFailed => 'Could not copy the path. Try again.';

  @override
  String get chatUiConversationChanged => 'Conversation changed';

  @override
  String get chatUiCloseLocation => 'Close location';

  @override
  String get chatUiThreadLabel => 'Thread';

  @override
  String get chatUiRenameConversation => 'Rename conversation';

  @override
  String get chatUiPathLabel => 'Path';

  @override
  String get chatUiPathCopied => 'Path copied';

  @override
  String get chatUiCopyPath => 'Copy path';

  @override
  String get chatUiLocationStale =>
      'Close this sheet and reopen the conversation location.';

  @override
  String get chatUiMoreThreadActions => 'More thread actions';

  @override
  String chatUiPreviousMessages(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count previous messages',
      one: '1 previous message',
    );
    return '$_temp0';
  }

  @override
  String chatUiMoreToolCalls(int count) {
    return '+$count tool calls';
  }

  @override
  String chatUiRanCommands(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Ran $count commands',
      one: 'Ran 1 command',
    );
    return '$_temp0';
  }

  @override
  String chatUiCommandsFailed(int count) {
    return '$count failed';
  }

  @override
  String chatUiCommandsStopped(int count) {
    return '$count stopped';
  }

  @override
  String get chatUiCollapsePreviousMessages => 'Collapse previous messages';

  @override
  String get chatUiExpandPreviousMessages => 'Expand previous messages';

  @override
  String get chatUiCollapseCommands => 'Collapse commands';

  @override
  String get chatUiExpandCommands => 'Expand commands';

  @override
  String get chatUiCollapseToolCalls => 'Collapse tool calls';

  @override
  String get chatUiExpandToolCalls => 'Expand tool calls';

  @override
  String get chatUiQuestions => 'Questions';

  @override
  String chatUiQuestionPage(int page, int total) {
    return '$page of $total';
  }

  @override
  String get chatUiQuestionResponseUnknown =>
      'A previous response may have been sent. Check the desktop state before replying again.';

  @override
  String get chatUiBack => 'Back';

  @override
  String get chatUiQuestionClosing => 'Closing...';

  @override
  String get chatUiQuestionEsc => 'ESC';

  @override
  String get chatUiNext => 'Next';

  @override
  String get chatUiResponseSent => 'Response sent';

  @override
  String get chatUiSendingDots => 'Sending...';

  @override
  String get chatUiSend => 'Send';

  @override
  String chatUiSelectUpTo(int limit) {
    return 'Select up to $limit';
  }

  @override
  String get chatUiOtherAnswer => 'Other answer';

  @override
  String get chatUiYourAnswer => 'Your answer';

  @override
  String get settingsFontSystem => 'System';

  @override
  String get settingsUnlockReason =>
      'Unlock DJL and your remote coding sessions.';

  @override
  String get settingsUsageWeekly => 'Weekly';

  @override
  String settingsUsageWeeks(int count) {
    return '${count}w';
  }

  @override
  String settingsUsageDays(int count) {
    return '${count}d';
  }

  @override
  String settingsUsageHours(int count) {
    return '${count}h';
  }

  @override
  String settingsUsageMinutes(int count) {
    return '${count}m';
  }

  @override
  String get settingsThemeSystem => 'System';

  @override
  String get settingsThemeLight => 'Light';

  @override
  String get settingsThemeDark => 'Dark';

  @override
  String get settingsAppearance => 'Appearance';

  @override
  String get settingsFont => 'Font';

  @override
  String get settingsLiquidGlass => 'Liquid Glass';

  @override
  String get settingsTheme => 'Theme';

  @override
  String get settingsNotifications => 'Notifications';

  @override
  String get settingsInAppAlertsFooter =>
      'Show a banner when another conversation’s task finishes.';

  @override
  String get settingsInAppAlerts => 'In-app alerts';

  @override
  String get settingsVoice => 'Voice';

  @override
  String get settingsVoiceFooter =>
      'Review dictation before sending. Replies use your device’s voice.';

  @override
  String get settingsSpeakReplies => 'Speak new replies';

  @override
  String get settingsRetryReading => 'Retry reading settings';

  @override
  String get settingsErrorPartialSave =>
      'Some defaults may have been saved in part. Review the reloaded choices and retry.';

  @override
  String get settingsErrorPartialReload =>
      'Defaults may have been saved in part. Could not reload preferences. Retry reading settings first.';

  @override
  String get settingsErrorRead =>
      'Could not read saved settings. Retry to keep your preferences.';

  @override
  String get settingsErrorSave =>
      'Could not save this setting. Your previous choice is unchanged. Try again.';

  @override
  String settingsUsageResets(String when) {
    return 'resets $when';
  }

  @override
  String get settingsUsage => 'Usage';

  @override
  String get settingsUsageFooter =>
      'Account-wide rate limits from your paired device.';

  @override
  String get settingsUsageLoading => 'Loading current limits...';

  @override
  String get settingsUsageConnect =>
      'Connect your paired device to load current limits.';

  @override
  String get settingsUsageUnavailable =>
      'Rate limits are unavailable for this account.';

  @override
  String settingsUsageLeft(int percent) {
    return '$percent% left';
  }

  @override
  String get settingsUsageStale =>
      'Last known limits. Reconnect or refresh to update.';

  @override
  String get settingsUsageRefreshTooltip => 'Refresh usage';

  @override
  String get settingsUsageRefreshing => 'Refreshing...';

  @override
  String get settingsUsageRefresh => 'Refresh';

  @override
  String get settingsUsageRuntimeUnavailable =>
      'Rate limits are unavailable for this runtime.';

  @override
  String get settingsUsageLoadFailed =>
      'Could not load current limits. Try again.';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsOpenCloudChat => 'Open DJL Cloud chat';

  @override
  String get settingsSignInCloud => 'Sign in to DJL Cloud';

  @override
  String get settingsCloudSubtitle =>
      'Chat, images, and background tasks without your Mac';

  @override
  String get settingsDevicePermissions => 'Device permissions';

  @override
  String get settingsDevice => 'Device';

  @override
  String get settingsMyMacs => 'My Macs';

  @override
  String get settingsLocked => 'DJL is locked';

  @override
  String get settingsPreparing => 'Preparing DJL';

  @override
  String get settingsStartFailed => 'Could not start DJL';

  @override
  String get settingsPrivateNote =>
      'Your remote sessions stay private when you step away.';

  @override
  String get settingsRetryStartup => 'Retry startup';

  @override
  String get settingsUnlockHint =>
      'Authenticates with Face ID, Touch ID, or your device passcode';

  @override
  String get settingsUnlocking => 'Unlocking…';

  @override
  String get settingsUnlock => 'Unlock DJL';

  @override
  String get settingsLockSetup =>
      'Set up Face ID, Touch ID, or a device passcode to unlock DJL.';

  @override
  String get settingsLockStillLocked =>
      'DJL is still locked. Unlock DJL to continue.';

  @override
  String get settingsLockCancelled =>
      'Authentication was cancelled or unavailable. Unlock DJL to continue.';

  @override
  String get settingsBridgeUnknown => 'Unknown';

  @override
  String get settingsBridgeInstalled => 'Installed';

  @override
  String get settingsBridgeUpToDate => 'Up to date';

  @override
  String get settingsBridgeUpdateAvailable => 'Update available';

  @override
  String get settingsBridgeDifferentBuild => 'Different build';

  @override
  String get settingsBridgeConnectHint =>
      'Connect to your Mac to see its DJL version.';

  @override
  String get settingsBridgeStaleHint =>
      'Last known version. Reconnect to check again.';

  @override
  String get settingsBridgeMatches =>
      'DJL on your Mac matches the latest release.';

  @override
  String get settingsBridgeNewer =>
      'A newer DJL release is available. Update DJL on your Mac.';

  @override
  String get settingsBridgeDifferent =>
      'Your Mac is running a different build than the latest release.';

  @override
  String get settingsBridgeStatus => 'Status';

  @override
  String settingsBridgeLastKnown(String status) {
    return 'Last known · $status';
  }

  @override
  String get settingsVersion => 'Version';

  @override
  String get settingsBridgeLatest => 'Latest';

  @override
  String get settingsBridgeUpdate => 'Update DJL on your Mac';

  @override
  String get settingsBridgeCheck => 'Check for a DJL update';

  @override
  String settingsElapsedDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days days',
      one: '1 day',
    );
    return '$_temp0';
  }

  @override
  String settingsElapsedHours(int hours, int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: '$hours hrs',
      one: '1 hr',
    );
    return '$_temp0, $minutes mins';
  }

  @override
  String settingsElapsedMinutes(int minutes, int seconds) {
    return '$minutes mins, $seconds secs';
  }

  @override
  String settingsElapsedSeconds(int seconds) {
    return '$seconds secs';
  }

  @override
  String get settingsArchived => 'Archived';

  @override
  String get settingsArchivedChats => 'Archived Chats';

  @override
  String settingsArchivedSaved(int count) {
    return '$count saved locally';
  }

  @override
  String get settingsArchivedActions => 'Archived chat actions';

  @override
  String get settingsUnarchive => 'Unarchive';

  @override
  String get settingsRemoveFromPhone => 'Remove from Phone';

  @override
  String get settingsRemove => 'Remove';

  @override
  String get settingsNoArchived => 'No archived chats';

  @override
  String settingsRemoveTitle(String title) {
    return 'Remove \"$title\" from this phone?';
  }

  @override
  String get settingsRemoveBody =>
      'This only removes the chat from DJL on this phone. Nothing is removed from your paired desktop.';

  @override
  String get settingsCloudRefreshFailed =>
      'Could not refresh account and Cloud settings.';

  @override
  String get settingsLinkFailed => 'Could not open this link. Try again.';

  @override
  String get settingsOpenNotificationsFailed =>
      'Could not open notification settings. Try again.';

  @override
  String get settingsAlertsUnavailable => 'Unavailable';

  @override
  String get settingsAlertsOff => 'Off';

  @override
  String get settingsAlertsEnabled => 'Enabled';

  @override
  String get settingsAlertsNotEnabled => 'Not enabled';

  @override
  String get settingsBack => 'Back';

  @override
  String get settingsOpenNavigation => 'Open navigation';

  @override
  String get settingsRetry => 'Retry';

  @override
  String get settingsAccount => 'Account';

  @override
  String get settingsDjlAccount => 'DJL account';

  @override
  String get settingsAvailableCredits => 'Available credits';

  @override
  String get settingsConversations => 'Conversations';

  @override
  String get settingsArchivedChatsRow => 'Archived chats';

  @override
  String get settingsRemoteAccess => 'Remote access';

  @override
  String get settingsBackgroundAlerts => 'Background alerts';

  @override
  String get settingsEnableBackgroundAlerts => 'Enable background alerts';

  @override
  String get settingsOpenNotificationSettings => 'Open notification settings';

  @override
  String get settingsVoiceIos =>
      'Dictation stays on your iPhone. Review the text before sending. Replies use the iPhone voice.';

  @override
  String get settingsVoiceDevice =>
      'Dictation stays on your device. Review the text before sending. Replies use your device’s voice.';

  @override
  String get settingsAbout => 'About';

  @override
  String get settingsTerms => 'Terms';

  @override
  String get settingsPrivacy => 'Privacy';

  @override
  String get settingsRetryLocalPrefs => 'Retry local preferences';

  @override
  String get settingsDeviceNameOnPhone => 'Device name on this phone';

  @override
  String get settingsEditDeviceNameTooltip => 'Edit device name';

  @override
  String get settingsClose => 'Close';

  @override
  String get settingsEditDeviceNameTitle => 'Edit Device Name';

  @override
  String get settingsDeviceName => 'Device name';

  @override
  String get settingsNicknameNote =>
      'This nickname stays on this phone and appears anywhere this device is shown.';

  @override
  String get settingsDeviceChanged =>
      'This saved device changed. Close and reopen the editor.';

  @override
  String get settingsUseDefault => 'Use Default';

  @override
  String get settingsSave => 'Save';

  @override
  String get settingsAboutFooter =>
      'Chats are end-to-end encrypted between your phone and paired device.';

  @override
  String get settingsHowDjlWorks => 'How DJL Works';

  @override
  String get settingsChatSupport => 'Chat & Support';

  @override
  String get settingsPrivacyPolicy => 'Privacy Policy';

  @override
  String get settingsTermsOfUse => 'Terms of Use';

  @override
  String get settingsAboutRouteBridgeDevice => 'Bridge on your paired device';

  @override
  String get settingsAboutRouteBridge => 'Bridge';

  @override
  String settingsAboutRouteLabel(String from, String to, String via) {
    return '$from to $to via $via';
  }

  @override
  String get settingsAboutIntro => 'Control **Codex** from your phone.';

  @override
  String get settingsAboutIntroNote =>
      'The Codex runtime stays on your paired device. Your phone is a secure remote control connected through a relay.';

  @override
  String get settingsAboutHowItWorks => 'How It Works';

  @override
  String get settingsAboutBridge =>
      'Your paired device runs a lightweight **bridge** that connects to a **relay server** over WebSocket.';

  @override
  String get settingsAboutStep1 => 'You send a prompt from your phone.';

  @override
  String get settingsAboutStep2 =>
      'It travels through the relay to the bridge on your paired device.';

  @override
  String get settingsAboutStep3 =>
      'The bridge forwards it to `codex app-server` via JSON-RPC.';

  @override
  String get settingsAboutStep4 =>
      'Responses stream back along the same path in real time.';

  @override
  String get settingsAboutWorkspaceNote =>
      'Workspace tools and file edits run on your paired device. The relay routes encrypted traffic; it does not run your workspace.';

  @override
  String get settingsAboutArchitecture => 'Architecture';

  @override
  String get settingsAboutRelay => 'The Relay';

  @override
  String get settingsAboutRelayIntro =>
      'A lightweight WebSocket server routes messages between your phone and paired device.';

  @override
  String get settingsAboutRelayDiscovery =>
      'Handles session discovery so your phone finds the device\'s live session.';

  @override
  String get settingsAboutRelayPrivate =>
      'Never sees decrypted message contents after the handshake.';

  @override
  String get settingsAboutRelayMetadata =>
      'Observes connection metadata such as session IDs, device IDs, and timing.';

  @override
  String get settingsAboutRelaySelfHost =>
      'You can **self-host** the relay or use the hosted endpoint configured by your bridge.';

  @override
  String get settingsAboutAppServerIntro =>
      'For the Codex runtime, the bridge connects to **`codex app-server`**, the JSON-RPC interface used by Codex clients.';

  @override
  String get settingsAboutAppServerSessions =>
      'Phone conversations are first-class Codex sessions.';

  @override
  String get settingsAboutAppServerRollout =>
      'Codex produces JSONL rollout files under `~/.codex/sessions/`.';

  @override
  String get settingsAboutAppServerHandoff =>
      'Use DJL\'s desktop handoff action to continue a phone thread on the paired device.';

  @override
  String get settingsAboutPairing => 'Pairing & Security';

  @override
  String get settingsAboutPairingQr =>
      'On first connection, scan the bridge\'s **QR code**. It identifies the relay, session, paired device, and bridge identity public key.';

  @override
  String get settingsAboutPairingAfter => 'After the secure handshake:';

  @override
  String get settingsAboutPairingTrusted =>
      'Your phone saves the bridge as a **trusted device** in platform-backed secure storage.';

  @override
  String get settingsAboutPairingIdentity =>
      'The bridge persists your phone\'s identity locally.';

  @override
  String get settingsAboutPairingReconnect =>
      'Saved trusted devices can reconnect without scanning again.';

  @override
  String get settingsAboutPairingRecovery =>
      'The QR remains a recovery path if trust changes or the current session cannot be resolved. A one-time code is another pairing option when the same relay is configured.';

  @override
  String get settingsAboutEncryption => 'End-to-End Encryption';

  @override
  String get settingsAboutEncryptionIntro =>
      'After pairing, messages use encrypted envelopes.';

  @override
  String get settingsAboutCipher => 'Cipher';

  @override
  String get settingsAboutKeyDerivation => 'Key derivation';

  @override
  String get settingsAboutKeyDerivationValue =>
      'HKDF-SHA256, per-direction keys';

  @override
  String get settingsAboutKeyExchange => 'Key exchange';

  @override
  String get settingsAboutKeyExchangeValue => 'X25519 ephemeral keys';

  @override
  String get settingsAboutIdentity => 'Identity';

  @override
  String get settingsAboutIdentityValue => 'Ed25519 signatures';

  @override
  String get settingsAboutReplayProtection => 'Replay protection';

  @override
  String get settingsAboutReplayProtectionValue => 'Monotonic counters';

  @override
  String get settingsAboutCacheKey => 'Phone cache key';

  @override
  String get settingsAboutCacheKeyValue =>
      'Protected by platform-backed secure storage';

  @override
  String get settingsAboutEncryptionNote =>
      'This describes **paired-device mode**. DJL Cloud is a separate service and account workflow.';

  @override
  String get settingsAboutGit => 'Git & Workspace';

  @override
  String get settingsAboutGitIntro =>
      'The bridge handles Git commands locally on the paired device:';

  @override
  String get settingsAboutGitRevert =>
      'DJL also supports **workspace revert**: preview and apply reverse patches when you want to undo assistant changes. Review the confirmation before applying changes.';

  @override
  String get settingsAboutResilience => 'Connection Resilience';

  @override
  String get settingsAboutReconnect =>
      'Automatic reconnect uses bounded backoff.';

  @override
  String get settingsAboutReplay =>
      'Encrypted replay cursors help recover missed events. Uncertain actions are not silently resent after a disconnect.';

  @override
  String get settingsAboutRuntimeDrop =>
      'The runtime can keep working through a transient phone connection drop.';

  @override
  String get settingsAboutShutdown =>
      'The bridge handles clean shutdown on `SIGINT` and `SIGTERM`.';

  @override
  String get settingsAboutDesktop => 'Desktop App Integration';

  @override
  String get settingsAboutDesktopRollout =>
      'Codex persists phone threads as session rollout files on the paired device.';

  @override
  String get settingsAboutDesktopHandoff =>
      'The desktop app may not live-reload external writes. Use **Continue on desktop** in DJL to hand off the current thread.';

  @override
  String get settingsAboutDjl => 'About DJL';

  @override
  String get settingsOpenSource => 'Open source';

  @override
  String get settingsMitLicense => 'MIT License';

  @override
  String get hostYourMac => 'Your Mac';

  @override
  String get hostUpdating =>
      'DJL is updating on your Mac. This phone reconnects when it is back.';

  @override
  String get hostCheckingVersion => 'Checking the DJL version on your Mac…';

  @override
  String hostNowVersion(String version) {
    return 'DJL on your Mac is now $version.';
  }

  @override
  String hostStillVersion(String version) {
    return 'DJL on your Mac is still $version. It may already be up to date.';
  }

  @override
  String get hostConnectedFooter =>
      'Your chats go straight to DJL on your Mac, encrypted end to end.';

  @override
  String get hostReconnectFooter => 'Open DJL on your Mac to reconnect.';

  @override
  String get hostDjlVersion => 'DJL version';

  @override
  String get hostCheckFailedNow => 'Couldn\'t check your Mac just now.';

  @override
  String get hostReconnecting => 'Reconnecting…';

  @override
  String get hostWakeScreen => 'Wake the screen';

  @override
  String get hostWakeScreenDetail =>
      'Turns your Mac\'s display on while DJL is running.';

  @override
  String get hostKeepAwake => 'Keep Mac awake';

  @override
  String get hostKeepAwakeDetail =>
      'Stops your Mac from sleeping while DJL is open. Best while it is charging.';

  @override
  String get hostUpdates => 'Updates';

  @override
  String get hostUpdateDjl => 'Update DJL';

  @override
  String get hostUpdateDjlDetail =>
      'Installs the newest DJL on your Mac, then reconnects.';

  @override
  String get hostNotConnected => 'Not connected';

  @override
  String get hostConnectedChecking => 'Connected · checking';

  @override
  String get hostConnected => 'Connected';

  @override
  String hostStatusLabel(String status) {
    return 'DJL on your Mac, $status';
  }

  @override
  String get hostDjlOnYourMac => 'DJL on your Mac';

  @override
  String get hostUpdateTitle => 'Update DJL on your Mac?';

  @override
  String hostUpdateCurrent(String version) {
    return 'Your Mac has DJL $version.';
  }

  @override
  String get hostUpdateBody =>
      'DJL restarts on your Mac to install the newest version. This phone disconnects for a moment and reconnects by itself.';

  @override
  String get hostUpdate => 'Update';

  @override
  String get hostContinueOnDesktop => 'Continue on desktop';

  @override
  String get hostContinueTitle => 'Continue on desktop?';

  @override
  String get hostContinueBody => 'Open this chat in DJL on your Mac.';

  @override
  String get hostContinue => 'Continue';

  @override
  String get hostActionFinished => 'Host action finished.';

  @override
  String get hostErrorUnsupported =>
      'DJL on your Mac can\'t do this yet. Update DJL on your Mac.';

  @override
  String get hostErrorRefused =>
      'Your Mac turned this down. Check DJL on your Mac and try again.';

  @override
  String get hostErrorUncertain =>
      'We could not tell whether this worked. Check your Mac before trying again.';

  @override
  String get hostCheckFailed => 'Could not check your Mac. Try again.';

  @override
  String get hostCheckingFirst =>
      'Checking your Mac first. Try again in a moment.';

  @override
  String get hostConnectFirst => 'Connect to your Mac first.';

  @override
  String get hostNotConfirmed =>
      'Your Mac did not confirm this. Check it before trying again.';

  @override
  String get hostOpenedOnMac => 'Opened in DJL on your Mac.';

  @override
  String get hostReconnectFirst => 'Reconnect to your Mac first.';

  @override
  String get hostReachFailed =>
      'Could not reach DJL on your Mac. Check that it is open, then try again.';

  @override
  String get hostWaking => 'Your Mac\'s screen is waking up.';

  @override
  String get hostPrefReadFailed =>
      'Could not read the saved preference. Retry.';

  @override
  String get hostPrefSaveFailed =>
      'Could not save this preference. Your previous choice is unchanged. Try again.';

  @override
  String get hostPrefUnconfirmed =>
      'Saved on this phone, but your Mac has not confirmed it yet.';

  @override
  String get pushTitle => 'Push notifications';

  @override
  String get pushUnsupported =>
      'This phone can\'t get push notifications from DJL yet. Open DJL to see when an agent is done.';

  @override
  String get pushDenied =>
      'Notifications are off for DJL in your phone\'s Settings.';

  @override
  String get pushReady =>
      'Get a notification when an agent finishes or needs your answer.';

  @override
  String get pushSimulator =>
      'This simulator can\'t receive push notifications.';

  @override
  String get pushUnavailableVersion =>
      'Push notifications aren\'t available in this version.';

  @override
  String get pushFailed =>
      'Couldn\'t turn on notifications. Try again when you\'re online.';

  @override
  String get pushUnavailableNow =>
      'Push notifications aren\'t available right now.';

  @override
  String get pushReadFailed => 'Could not read notification preference. Retry.';

  @override
  String get pushUpdateFailed =>
      'Could not update notification preference. Retry.';

  @override
  String get whatsNewTitle => 'What\'s New';

  @override
  String get whatsNewIntro => 'Here\'s what\'s new in DJL.';

  @override
  String get whatsNewOnce => 'We\'ll only show this once for each app version.';

  @override
  String get whatsNewGotIt => 'Got It';

  @override
  String get whatsNewDismiss => 'Dismiss release notes';

  @override
  String get whatsNew100Design => 'A calmer black and white design.';

  @override
  String get whatsNew100Groups =>
      'Group chats: talk to several agents at once and watch them reply live.';

  @override
  String get whatsNew100Files => 'Send files and photos in a group chat.';

  @override
  String get whatsNew100Mac => 'Chats go straight to DJL on your Mac.';

  @override
  String get accountSomethingWrong => 'Something went wrong';

  @override
  String get accountTypeDeleteToConfirm => 'Type DELETE to confirm.';

  @override
  String get accountOk => 'OK';

  @override
  String get accountDone => 'Done';

  @override
  String get accountEmail => 'Email';

  @override
  String get accountPlan => 'Plan';

  @override
  String get accountCredits => 'Credits';

  @override
  String get accountUsageFooter =>
      'A banked reset starts both limits over and restarts your week. Banks expire 90 days after they\'re granted.';

  @override
  String get accountFiveHourLimit => '5-hour limit';

  @override
  String get accountWeeklyLimit => 'Weekly limit';

  @override
  String get accountBankedResets => 'Banked resets';

  @override
  String accountNextExpires(String date, String year) {
    return 'Next expires $date, $year';
  }

  @override
  String get accountNone => 'None';

  @override
  String accountUseOne(int count) {
    return 'Use 1 of $count';
  }

  @override
  String get accountDeleteFooter =>
      'Deleting your account removes your chats, files, and credits. You have 30 days to change your mind by contacting support.';

  @override
  String get accountSignOut => 'Sign out';

  @override
  String get accountDelete => 'Delete account';

  @override
  String accountUsedPercent(int percent) {
    return '$percent% used';
  }

  @override
  String get accountResetsNow => 'Resets now';

  @override
  String get accountResetsTomorrow => 'Resets tomorrow';

  @override
  String get accountResetsYesterday => 'Resets yesterday';

  @override
  String get accountResetsNextWeek => 'Resets next week';

  @override
  String get accountResetsLastWeek => 'Resets last week';

  @override
  String accountResetsIn(String quantity) {
    return 'Resets in $quantity';
  }

  @override
  String accountResetsAgo(String quantity) {
    return 'Resets $quantity ago';
  }

  @override
  String accountSeconds(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count seconds',
      one: '1 second',
    );
    return '$_temp0';
  }

  @override
  String accountMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count minutes',
      one: '1 minute',
    );
    return '$_temp0';
  }

  @override
  String accountHours(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count hours',
      one: '1 hour',
    );
    return '$_temp0';
  }

  @override
  String accountDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days',
      one: '1 day',
    );
    return '$_temp0';
  }

  @override
  String accountWeeks(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count weeks',
      one: '1 week',
    );
    return '$_temp0';
  }

  @override
  String get accountDeleteTitle => 'Delete your account?';

  @override
  String get accountDeleteBody =>
      'This can\'t be undone after 30 days. Type DELETE to confirm.';

  @override
  String get accountTypeDelete => 'Type DELETE';

  @override
  String get accountSignOutTitle => 'Sign out of DJL Cloud?';

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get notificationsMarkAllRead => 'Mark all read';

  @override
  String get notificationsCaughtUp => 'You’re all caught up';

  @override
  String get notificationsEmptyHint => 'Completed tasks will appear here.';

  @override
  String get notificationsTaskComplete => 'Task complete';

  @override
  String get notificationsLoadMore => 'Load more';

  @override
  String notificationsStatus(String status) {
    String _temp0 = intl.Intl.selectLogic(status, {
      'succeeded': 'succeeded',
      'failed': 'failed',
      'other': '$status',
    });
    return '$_temp0';
  }

  @override
  String get notificationsTaskStopped => 'Task stopped';

  @override
  String get notificationsTaskFinished => 'Task finished';

  @override
  String get notificationsOpenResult => 'Open DJL to see the result';

  @override
  String get notificationsDismiss => 'Dismiss notification';

  @override
  String get reportOffensive => 'Offensive or hateful';

  @override
  String get reportHarmful => 'Harmful or dangerous';

  @override
  String get reportWrong => 'Wrong or misleading';

  @override
  String get reportOther => 'Something else';

  @override
  String get reportThanks => 'Thanks. We\'ll review this answer.';

  @override
  String get reportTitle => 'Report this answer';

  @override
  String get reportRateLimited =>
      'Too many reports right now. Try again later.';

  @override
  String get reportFailed => 'Couldn\'t send the report. Try again.';

  @override
  String get reportIntro =>
      'DJL reviews reports to keep answers safe. What is wrong with it?';

  @override
  String get reportDetailsHint => 'Add details (optional)';

  @override
  String get reportSending => 'Sending…';

  @override
  String get reportSend => 'Send report';

  @override
  String get attachmentsNoApp =>
      'No app here opens this file. Pick one to send it to.';

  @override
  String get attachmentsOpenFailed => 'Couldn\'t open this file';

  @override
  String get attachmentsCheckMac =>
      'Check that your Mac is connected, then try again.';

  @override
  String get attachmentsImageUnshowable => 'This image can\'t be shown here';

  @override
  String get attachmentsOpenElsewhere => 'Open in another app';

  @override
  String get attachmentsOpen => 'Open';

  @override
  String get attachmentsShare => 'Share';

  @override
  String get imagesSquare => 'Square';

  @override
  String get imagesLandscape => 'Landscape';

  @override
  String get imagesPortrait => 'Portrait';

  @override
  String get imagesOnePerRequest =>
      'One image per request. You can leave the chat while DJL works.';

  @override
  String get imagesCreate => 'Create image';

  @override
  String get imagesMakeYours => 'Make something yours.';

  @override
  String get imagesDescribe =>
      'Describe the subject, style, and details you have in mind.';

  @override
  String get imagesPromptHint => 'A quiet studio in morning light…';

  @override
  String get imagesShape => 'Shape';

  @override
  String get imagesNotConfigured =>
      'Image generation isn\'t configured on this server yet. Your saved images are still available.';

  @override
  String get imagesStarting => 'Starting…';

  @override
  String get imagesOpenImage => 'Open image';

  @override
  String get imagesGenerated => 'Generated image';

  @override
  String get imagesOpenChat => 'Open chat';

  @override
  String get imagesActions => 'Image actions';

  @override
  String get imagesEditInChat => 'Edit in chat';

  @override
  String get imagesTitle => 'Images';

  @override
  String get imagesYourImages => 'Your images';

  @override
  String get imagesEmpty =>
      'Create an image and find it here, ready to save or share.';

  @override
  String get imagesEmptyNotConfigured =>
      'Image creation is not configured yet. Saved images will appear here.';

  @override
  String get imagesLoadMore => 'Load more';

  @override
  String get imagesYourImage => 'Your image';

  @override
  String get imagesShare => 'Share';

  @override
  String get imagesSaveToPhotos => 'Save to Photos';

  @override
  String get imagesSaved => 'Saved to Photos.';

  @override
  String get authSocialNotConfigured =>
      'Sign-in is not configured for this app. Continue with email.';

  @override
  String get authSocialOpenFailed => 'Could not open sign-in. Try again.';

  @override
  String get authSignInOptionsFailed => 'Could not load sign-in options.';

  @override
  String get authCloudSignInFailed =>
      'Could not sign in to DJL Cloud. Try again.';

  @override
  String get authSecureStorageFailed =>
      'Could not open secure storage. Unlock your device and try again.';

  @override
  String get authCheckEmailForCode =>
      'Check your email for a verification code.';

  @override
  String get authRequestSent => 'Request sent. Check your email.';

  @override
  String get authCloudDataNotCleared =>
      'Some saved Cloud data could not be cleared.';

  @override
  String get authLinkOpenFailed => 'Could not open this link. Try again.';

  @override
  String get authWelcomeTitle => 'Welcome to DJL';

  @override
  String get authWelcomeSubtitle =>
      'Your ideas, conversations, and Mac.\nTogether in DJL.';

  @override
  String get authRetrySignInOptions => 'Retry sign-in options';

  @override
  String get authLoadingSignInOptions => 'Loading sign-in options';

  @override
  String get authContinueWithApple => 'Continue with Apple';

  @override
  String get authContinueWithGoogle => 'Continue with Google';

  @override
  String get authContinueWithEmail => 'Continue with email';

  @override
  String get authPairWithMac => 'Pair with a Mac';

  @override
  String get authNoMacHint => 'No Mac? Sign in to chat with DJL Cloud.';

  @override
  String get authTerms => 'Terms';

  @override
  String get authPrivacy => 'Privacy';

  @override
  String get authVerifyAndContinue => 'Verify and continue';

  @override
  String get authSignIn => 'Sign in';

  @override
  String get authEmailMeCode => 'Email me a code';

  @override
  String get authCreateAccount => 'Create account';

  @override
  String get authSignInIncomplete => 'Could not complete sign-in. Try again.';

  @override
  String get authPassword => 'Password';

  @override
  String get authEmailCode => 'Email code';

  @override
  String get authName => 'Name';

  @override
  String get authEmail => 'Email';

  @override
  String get authSixDigitCode => '6-digit code';

  @override
  String authCodeSent(String email) {
    return 'We sent a code to $email. It expires in 10 minutes.';
  }

  @override
  String get authCreateAccountHint =>
      'Use at least 10 characters. We\'ll email you a code to confirm your address.';

  @override
  String get authResendCode => 'Resend code';

  @override
  String authResendIn(int seconds) {
    return 'Resend in ${seconds}s';
  }

  @override
  String get authUseAnotherEmail => 'Use another email';

  @override
  String get authForgotPassword => 'Forgot password?';

  @override
  String get authResetPassword => 'Reset password';

  @override
  String get authPasswordUpdated => 'Password updated';

  @override
  String get authSignInWithNewPassword => 'Sign in with your new password.';

  @override
  String get authBackToSignIn => 'Back to sign in';

  @override
  String get authNewPassword => 'New password';

  @override
  String get authRecoveryHint =>
      'We\'ll send a recovery code if an account exists for this email.';

  @override
  String get authRecoveryCodeHint =>
      'Enter your recovery code and a password with 10–256 characters.';

  @override
  String get authSendRecoveryCode => 'Send recovery code';

  @override
  String get chatUiWorktreeHandoffFailed => 'Worktree Handoff Failed';

  @override
  String get chatUiOk => 'OK';

  @override
  String get chatUiSelectFolder => 'Select folder';

  @override
  String get chatUiBrowseFolders => 'Browse local folders…';

  @override
  String get chatUiBranchOpenElsewhere => 'Branch already open elsewhere';

  @override
  String chatUiBranchOpenElsewhereChat(String branch) {
    return '\'$branch\' is already checked out in another worktree. Open that chat to continue there.';
  }

  @override
  String chatUiBranchOpenElsewhereSidebar(String branch) {
    return '\'$branch\' is already checked out in another worktree. Open that chat from the sidebar to continue there.';
  }

  @override
  String get chatUiOpenChat => 'Open Chat';

  @override
  String get chatUiWorktreeChatGone =>
      'The worktree chat is no longer available. Open it from the sidebar.';

  @override
  String get chatUiPhotoLibrary => 'Photo library';

  @override
  String get chatUiTakePhoto => 'Take a photo';

  @override
  String get chatUiPlanMode => 'Plan mode';

  @override
  String get chatUiFastMode => 'Fast mode';

  @override
  String get chatUiImage => 'Image';

  @override
  String get chatUiOpensThreadLocation => 'Opens thread location';

  @override
  String get chatUiDesktopChat => 'Desktop chat';

  @override
  String get chatUiNewThread => 'New thread';

  @override
  String get chatUiHandOffToDesktop => 'Hand off to Desktop';

  @override
  String get chatUiHandOffToLocal => 'Hand off to Local';

  @override
  String get chatUiHandOffToWorktree => 'Hand off to Worktree';

  @override
  String get chatUiGoal => 'Goal';

  @override
  String get chatUiForkChat => 'Fork this chat';

  @override
  String get chatUiForkIntoFolder => 'Fork into another folder';

  @override
  String get chatUiForkIntoWorktree => 'Fork into new worktree';

  @override
  String get chatUiWorkspaceFiles => 'Workspace files';

  @override
  String get chatUiTurnChanges => 'Turn changes and restore';

  @override
  String get chatUiRefreshFromDesktop => 'Refresh from desktop';

  @override
  String get chatUiDesktopDisconnected =>
      'Desktop disconnected. Your message has not been resent.';

  @override
  String get chatUiLinkedPositionUnavailable =>
      'Linked position is not available in the loaded history.';

  @override
  String get chatUiReviewResponseChanges => 'Review exact response changes';

  @override
  String get chatUiResponseUndone => 'Response undone';

  @override
  String get chatUiUndoResponse => 'Undo this response';

  @override
  String get chatUiApprovalRequired => 'Approval required';

  @override
  String get chatUiApprovalSent => 'Response sent. Waiting for the desktop.';

  @override
  String get chatUiDecline => 'Decline';

  @override
  String get chatUiApproveOnce => 'Approve once';

  @override
  String get chatUiBranch => 'Branch';

  @override
  String get chatUiPreparingWorktree => 'Preparing worktree...';

  @override
  String get chatUiNewWorktree => 'New worktree';

  @override
  String chatUiGoalChip(String status, String elapsed) {
    return 'Goal $status · $elapsed';
  }

  @override
  String get chatUiReturnToParent => 'Return to parent chat';

  @override
  String chatUiReturnTo(String title) {
    return 'Return to $title';
  }

  @override
  String get chatUiAskDjl => 'Ask DJL';

  @override
  String get chatUiFollowUp => 'Follow up';

  @override
  String get workspaceRestoreFailed =>
      'The desktop did not confirm the restore. Refresh before retrying.';

  @override
  String workspaceRestoredFiles(int count) {
    return 'Restored $count files.';
  }

  @override
  String get workspaceBackupSaved =>
      ' A backup checkpoint was saved on your Mac.';

  @override
  String get workspaceNoLocalFolders =>
      'No local folders are available from this device.';

  @override
  String get workspaceUndoReviewChanged =>
      'The response or connection changed. Reopen this review.';

  @override
  String get workspaceUndoPreviewFailed =>
      'Could not preview the exact patch. Refresh the review before trying again.';

  @override
  String get workspaceUndoRepositoryChanged =>
      'The response or repository changed. Reopen this review.';

  @override
  String get workspaceUndoResultUnknownChanged =>
      'The connection or response changed. The undo result is unknown; refresh and review it.';

  @override
  String get workspaceUndoRefused =>
      'The desktop did not undo the response. Review the current conflicts and staged files.';

  @override
  String get workspaceUndoResultUnknown =>
      'The undo result is unknown. Refresh and review the exact patch before another attempt.';

  @override
  String get workspaceUndoSaveAfterSuccessFailed =>
      'Undo succeeded, but saving or refreshing its local result failed. Reconnect to verify the files.';

  @override
  String get workspaceUndoSaveFailed =>
      'Could not save the undo result. Reconnect and review the current files.';

  @override
  String get workspaceUndoTitle => 'Undo this response';

  @override
  String workspaceUndoWorkspace(String path) {
    return 'Workspace: $path';
  }

  @override
  String get workspaceUndoIntro =>
      'Review the exact changes from this response. Later edits stay in place where the reverse patch can apply. The desktop checks conflicts again when you confirm.';

  @override
  String get workspaceUndoOverlap =>
      'Other responses touch these files. Review carefully: undo may overlap changes in this or another chat.';

  @override
  String get workspaceUndoUncertain =>
      'A previous undo result is unknown. Refresh this review and inspect the current files before confirming another attempt.';

  @override
  String get workspaceUndoStale =>
      'This review is no longer current. Close it and reopen the response.';

  @override
  String get workspaceUndoDone => 'This response was undone.';

  @override
  String workspaceUndoStagedBlock(String files) {
    return 'Staged files block undo: $files';
  }

  @override
  String workspaceUndoConflict(String conflict) {
    return 'Conflict: $conflict';
  }

  @override
  String get workspaceUndoCannotReverse =>
      'The desktop cannot safely reverse this patch.';

  @override
  String get workspaceClose => 'Close';

  @override
  String get workspaceRefreshReview => 'Refresh review';

  @override
  String get workspaceUndoResponse => 'Undo response';

  @override
  String get workspaceConflictFallback => 'Conflict';

  @override
  String get workspaceAlreadyUndone => 'This response was already undone.';

  @override
  String get workspaceStillRunning => 'This response is still running.';

  @override
  String get workspaceNoDesktopWorkspace =>
      'The response has no desktop workspace.';

  @override
  String get workspaceNoPatchCaptured =>
      'No supported exact response patch was captured.';

  @override
  String get workspaceRestoreTitle => 'Restore workspace before this turn?';

  @override
  String get workspaceRestoreBody =>
      'This replaces current workspace files and removes untracked files. Review the affected files before restoring. The Mac saves a backup checkpoint first.';

  @override
  String get workspaceNoAffectedFiles => 'No affected files reported.';

  @override
  String get workspaceStagedFiles => 'Staged files';

  @override
  String get workspaceUntrackedFiles => 'Untracked files';

  @override
  String get workspaceRestoreFiles => 'Restore files';

  @override
  String get workspaceTurnChanges => 'Turn changes';

  @override
  String get workspaceReloadTurnChanges => 'Reload turn changes';

  @override
  String get workspaceConversationTurn => 'Conversation turn';

  @override
  String workspaceTurnNumber(int number) {
    return 'Turn $number';
  }

  @override
  String get workspaceNoSavedChanges => 'No saved changes for this turn.';

  @override
  String get workspaceNoCompletedTurns => 'No completed turns yet.';

  @override
  String get workspaceChooseTurn =>
      'Choose a turn to view its saved workspace changes.';

  @override
  String get workspaceStopBeforeRestore =>
      'Stop the running turn before restoring files.';

  @override
  String get workspacePreviewRestore => 'Preview restore before this turn';

  @override
  String get workspaceFileFallbackTitle => 'Workspace file';

  @override
  String get workspaceCopyFileContents => 'Copy file contents';

  @override
  String get workspaceFileContentsCopied => 'File contents copied.';

  @override
  String get workspaceReloadFile => 'Reload file';

  @override
  String get workspaceFilePathOnMac => 'File path on your Mac';

  @override
  String get workspaceSegmentText => 'Text';

  @override
  String get workspaceSegmentImage => 'Image';

  @override
  String get workspaceOpen => 'Open';

  @override
  String get workspaceSvgRenderFailed => 'This SVG could not be rendered.';

  @override
  String get workspaceImageRenderFailed =>
      'This image format could not be rendered on this device.';

  @override
  String get workspaceOpenFileToPreview =>
      'Open a workspace file to preview it.';

  @override
  String get workspaceSavedToPhotos => 'Saved to Photos.';

  @override
  String get workspaceImageTitle => 'Image';

  @override
  String get workspaceOk => 'OK';

  @override
  String get workspaceLoadingFile => 'Loading file';

  @override
  String get workspaceUnableToLoadFile => 'Unable to load file.';

  @override
  String get workspaceRetry => 'Retry';

  @override
  String get workspaceCloseFilePreview => 'Close file preview';

  @override
  String get workspaceDone => 'Done';

  @override
  String get workspaceFindInFile => 'Find in file';

  @override
  String workspaceLineCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lines',
      one: '1 line',
    );
    return '$_temp0';
  }

  @override
  String workspaceByteCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count bytes',
      one: '1 byte',
    );
    return '$_temp0';
  }

  @override
  String get workspaceCloseSvgPreview => 'Close SVG preview';

  @override
  String get workspaceReloadSvgPreview => 'Reload SVG preview';

  @override
  String get workspaceShare => 'Share';

  @override
  String get workspaceSaveToPhotos => 'Save to Photos';

  @override
  String get workspaceUnableToDisplayImage => 'Unable to display image.';

  @override
  String get workspaceFileContents => 'File contents';

  @override
  String get workspaceSearching => 'Searching…';

  @override
  String workspaceMatchPosition(int index, int total) {
    return '$index of $total';
  }

  @override
  String get workspacePreviousMatch => 'Previous match';

  @override
  String get workspaceNextMatch => 'Next match';

  @override
  String get workspaceCloseFind => 'Close find';

  @override
  String get workspaceAddLocalFolder => 'Add Local Folder';

  @override
  String get workspaceCreateFolderOnMac => 'Create folder on Mac';

  @override
  String get workspaceUse => 'Use';

  @override
  String get workspaceParentFolder => 'Parent Folder';

  @override
  String get workspaceSearchingFolders => 'Searching folders...';

  @override
  String get workspaceLoading => 'Loading';

  @override
  String get workspaceNoMatchingFolders =>
      'No matching folders under this folder.';

  @override
  String get workspaceNoChildFolders => 'No child folders here.';

  @override
  String get workspaceSearchFolders => 'Search folders';

  @override
  String get workspaceClearFolderSearch => 'Clear folder search';

  @override
  String get workspaceLocations => 'Locations';

  @override
  String get workspaceCurrentFolder => 'Current Folder';

  @override
  String get workspaceLoadingFolders => 'Loading folders...';

  @override
  String get workspaceNoFolderSelected => 'No folder selected.';

  @override
  String get workspaceMatchingFolders => 'Matching Folders';

  @override
  String get workspaceFolders => 'Folders';

  @override
  String get workspaceNewFolder => 'New Folder';

  @override
  String get workspaceNewFolderBody =>
      'Create this folder on your device and start a chat there.';

  @override
  String get workspaceFolderName => 'Folder name';

  @override
  String get workspaceCreate => 'Create';

  @override
  String get workspaceDesktopChangedPicker =>
      'Connected desktop changed. Reopen the project picker.';

  @override
  String get workspaceDesktopChanged =>
      'Connected desktop changed. Reopen this workspace.';

  @override
  String get workspaceChooseWorkspaceFirst =>
      'Choose a workspace on your desktop first.';

  @override
  String get workspaceNoTextInPreview =>
      'The file preview did not include text. Reload it from the workspace.';

  @override
  String get workspaceNoImageInPreview =>
      'The image preview did not include image data. Reload it from the workspace.';

  @override
  String get workspaceRestorePreviewOtherWorkspace =>
      'This restore preview belongs to another workspace. Preview it again.';

  @override
  String get cloudChatNewChat => 'New chat';

  @override
  String get cloudChatLostConnection =>
      'Lost connection. Tap Reconnect to resume this response.';

  @override
  String get cloudChatImageToEdit => 'Image to edit';

  @override
  String get cloudChatNoContent => 'No response content.';

  @override
  String get cloudChatThinking => 'Thinking…';

  @override
  String get cloudChatResponseStopped => 'Response stopped.';

  @override
  String get cloudChatResponseFailed => 'Response failed.';

  @override
  String get cloudChatWaitingForUsageReset => 'Waiting for usage reset.';

  @override
  String get cloudChatModelChoiceLoadFailed =>
      'Could not load your saved model choice. Retry.';

  @override
  String get cloudChatModelChoiceSaveFailed =>
      'Could not save your model choice. Retry.';

  @override
  String get cloudChatDraftSaveFailed =>
      'Could not save your draft. Keep the text here and retry.';

  @override
  String get cloudChatDraftLoadFailed =>
      'Could not load your saved draft. Retry before editing.';

  @override
  String get cloudChatInterruptedImage =>
      'An interrupted image request is saved securely. Retry to check its result.';

  @override
  String get cloudChatInterruptedMessage =>
      'An interrupted message is saved securely. Retry to check its result.';

  @override
  String get cloudChatModelCannotViewImages =>
      'Choose a model that can view images before sending this attachment.';

  @override
  String get cloudChatImageGenerationUnavailable =>
      'Image generation is not configured for this service.';

  @override
  String get cloudChatUseBankedResetTitle => 'Use a banked reset?';

  @override
  String get cloudChatUseBankedResetBody =>
      'Both your 5-hour and weekly limits start over now, and your week restarts today.';

  @override
  String get cloudChatUseReset => 'Use reset';

  @override
  String get cloudChatLimitFreesSoon => 'Your limit frees up again soon.';

  @override
  String get cloudChatResetsNow => 'It resets now.';

  @override
  String get cloudChatResetsTomorrow => 'It resets tomorrow.';

  @override
  String cloudChatResetsInDays(int days) {
    return 'It resets in $days days.';
  }

  @override
  String cloudChatResetsOn(String date) {
    return 'It resets $date.';
  }

  @override
  String get cloudChatResetsInAMoment => 'It resets in a moment.';

  @override
  String cloudChatResetsInMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'It resets in $minutes minutes.',
      one: 'It resets in 1 minute.',
    );
    return '$_temp0';
  }

  @override
  String cloudChatResetsInHours(int hours) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: 'It resets in $hours hours.',
      one: 'It resets in 1 hour.',
    );
    return '$_temp0';
  }

  @override
  String get cloudChatUsageLimitReached => 'You\'ve reached your usage limit';

  @override
  String get cloudChatRetryUsage => 'Retry usage';

  @override
  String cloudChatUseBankedReset(int count) {
    return 'Use a banked reset ($count left)';
  }

  @override
  String get cloudChatPickerFailed =>
      'Could not open the picker. Please try again.';

  @override
  String get cloudChatModel => 'Model';

  @override
  String get cloudChatShareLink => 'Share link';

  @override
  String get cloudChatTaskPrompt => 'What should DJL work on?';

  @override
  String get cloudChatHowCanIHelp => 'How can I help?';

  @override
  String get cloudChatTaskHint =>
      'Start a task and return to the result when it\'s ready.';

  @override
  String cloudChatStepProgress(String step, String total) {
    return 'Step $step of $total';
  }

  @override
  String get cloudChatRetry => 'Retry';

  @override
  String get cloudChatRetryDraft => 'Retry draft';

  @override
  String get cloudChatRetryModelChoice => 'Retry model choice';

  @override
  String get cloudChatMessageHint => 'Message DJL';

  @override
  String get cloudChatAttachTooltip => 'Attach file or image';

  @override
  String get cloudChatCreateImage => 'Create image';

  @override
  String get cloudChatChooseFile => 'Choose file';

  @override
  String get cloudChatPhotoLibrary => 'Photo library';

  @override
  String get cloudChatCamera => 'Camera';

  @override
  String get cloudChatTaskMode => 'Task mode';

  @override
  String get cloudChatTask => 'Task';

  @override
  String get cloudChatStopDictation => 'Stop dictation';

  @override
  String get cloudChatStartDictation => 'Start dictation';

  @override
  String get cloudChatStopResponse => 'Stop response';

  @override
  String get cloudChatSendMessage => 'Send message';

  @override
  String get cloudChatEditMessage => 'Edit message';

  @override
  String get cloudChatSend => 'Send';

  @override
  String get cloudChatDisableWordWrap => 'Disable word wrap';

  @override
  String get cloudChatEnableWordWrap => 'Enable word wrap';

  @override
  String get cloudChatCopied => 'Copied';

  @override
  String get cloudChatCopyCode => 'Copy code';

  @override
  String get cloudChatCodeLabel => 'Code';

  @override
  String get cloudChatEdit => 'Edit';

  @override
  String get cloudChatPreviousBranch => 'Previous branch';

  @override
  String get cloudChatNextBranch => 'Next branch';

  @override
  String get cloudChatCopyMessage => 'Copy message';

  @override
  String get cloudChatRegenerateReply => 'Regenerate reply';

  @override
  String get cloudChatStopReading => 'Stop reading';

  @override
  String get cloudChatReadAloud => 'Read aloud';

  @override
  String get cloudChatReportAnswer => 'Report this answer';

  @override
  String cloudChatToolResult(String name, String status) {
    return '$name · $status';
  }

  @override
  String get cloudChatToolFailed => 'Failed';

  @override
  String get cloudChatToolDone => 'Done';

  @override
  String get cloudChatNeedsNewerVersion =>
      'This message contains content requiring a newer version.';

  @override
  String get cloudChatImageUnavailableRetry => 'Image unavailable · Retry';

  @override
  String get cloudChatConversationImage => 'Conversation image';

  @override
  String get cloudChatImageDisplayFailed => 'Could not display this image.';

  @override
  String get cloudChatShareFailed => 'Could not open sharing. Try again.';

  @override
  String get cloudChatShareLinkCreated => 'Share link created';

  @override
  String get cloudChatShareLinkBody =>
      'Anyone with the link can read this chat as it is now. Messages you send later aren\'t shared.';

  @override
  String get cloudChatCopyLink => 'Copy link';

  @override
  String get cloudChatShare => 'Share';

  @override
  String get conversationsPinned => 'Pinned';

  @override
  String get conversationsPinnedEmpty => 'Touch and hold a chat to pin it.';

  @override
  String get conversationsRecentEmpty => 'Your conversations appear here.';

  @override
  String get conversationsCloudConversationHint => 'Cloud conversation';

  @override
  String get conversationsChat => 'Chat';

  @override
  String get conversationsSearchChats => 'Search chats';

  @override
  String get conversationsRemote => 'Remote';

  @override
  String get conversationsRecentChats => 'Recent chats';

  @override
  String get conversationsLoadMore => 'Load more';

  @override
  String get conversationsSettings => 'Settings';

  @override
  String get conversationsArchivedChats => 'Archived chats';

  @override
  String get conversationsRestore => 'Restore';

  @override
  String get conversationsNoArchivedChats => 'No archived chats';

  @override
  String get conversationsPin => 'Pin';

  @override
  String get conversationsUnpin => 'Unpin';

  @override
  String get conversationsRename => 'Rename';

  @override
  String get conversationsArchive => 'Archive';

  @override
  String get conversationsDelete => 'Delete';

  @override
  String get conversationsDeleteChatQuestion => 'Delete this chat?';

  @override
  String get plansCompleted => 'Completed';

  @override
  String get plansInProgress => 'In progress';

  @override
  String get plansPending => 'Pending';

  @override
  String get plansOpenActivePlan => 'Open active plan';

  @override
  String get plansPlan => 'Plan';

  @override
  String plansStepOf(int current, int total) {
    return 'Step $current of $total';
  }

  @override
  String plansStepFraction(int current, int total) {
    return 'Step $current / $total';
  }

  @override
  String plansStatusValue(String status, String position) {
    return '$status, $position';
  }

  @override
  String get plansImage => 'Image';

  @override
  String get plansActivePlan => 'Active plan';

  @override
  String get plansDone => 'Done';

  @override
  String get plansNoLongerAvailable => 'This plan is no longer available.';

  @override
  String get plansProposedPlan => 'Proposed plan';

  @override
  String get plansCollapsePlan => 'Collapse plan';

  @override
  String get plansExpandPlan => 'Expand plan';

  @override
  String get plansCollapse => 'Collapse';

  @override
  String get plansExpand => 'Expand';

  @override
  String get plansStarting => 'Starting...';

  @override
  String get plansImplement => 'Implement';

  @override
  String get plansNextStepQuestion => 'What should Codex produce next?';

  @override
  String get plansNextStepHeader => 'Next step';

  @override
  String get voiceAllowMicrophone =>
      'Allow microphone and speech access in device settings to dictate.';

  @override
  String get voiceDictationUnavailable =>
      'On-device dictation is unavailable for this language or device. You can still type your message.';

  @override
  String get voiceSpeechAccessRequired =>
      'Allow microphone and speech access in device settings. On-device speech must be available for your language.';

  @override
  String get voiceInputUnavailable =>
      'Voice input is unavailable. You can still type your message.';

  @override
  String get voiceStopFailed => 'Could not stop voice input.';

  @override
  String get voicePlaybackUnavailable =>
      'Speech playback is unavailable on this device.';

  @override
  String get voiceStopUnclean =>
      'Voice could not stop cleanly. Close this screen before continuing.';

  @override
  String get goalsStatusActive => 'Active';

  @override
  String get goalsStatusPaused => 'Paused';

  @override
  String get goalsStatusBlocked => 'Blocked';

  @override
  String get goalsStatusUsageLimited => 'Usage limited';

  @override
  String get goalsStatusBudgetLimited => 'Budget limited';

  @override
  String get goalsStatusComplete => 'Complete';

  @override
  String goalsTokenUsage(String used, String budget) {
    return '$used / $budget tokens';
  }

  @override
  String get goalsUnsupported =>
      'Goals are unavailable on this runtime. Update Codex on your Mac and enable goals.';

  @override
  String get goalsEphemeral =>
      'Goals need a saved chat. This chat is temporary.';

  @override
  String get goalsDesktopChanged =>
      'Connected desktop changed. Reopen this goal.';

  @override
  String get goalsOtherChatGoal => 'The runtime returned another chat’s goal.';

  @override
  String get goalsBudgetInvalid =>
      'Token budget must be a positive whole number.';

  @override
  String get goalsUnexpectedResponse =>
      'The runtime returned an unexpected goal response.';

  @override
  String get goalsReconnect => 'Reconnect to your desktop to manage this goal.';

  @override
  String get goalsDescribeFirst => 'Describe the goal first.';

  @override
  String get goalsReplaceTitle => 'Replace the current goal?';

  @override
  String get goalsReplaceBody =>
      'This objective is not complete. Replacing it starts a new goal and resets its usage accounting.';

  @override
  String get goalsReplaceAction => 'Replace goal';

  @override
  String get goalsClearTitle => 'Clear this goal?';

  @override
  String get goalsClearBody =>
      'The desktop stops pursuing this objective and clears its progress accounting.';

  @override
  String get goalsClearAction => 'Clear goal';

  @override
  String get goalsTitle => 'Goal';

  @override
  String get goalsReload => 'Reload goal';

  @override
  String get goalsShowingLastKnown =>
      'Showing the last known goal. Reconnect to manage it.';

  @override
  String get goalsNewGoal => 'New goal';

  @override
  String get goalsEditGoal => 'Edit goal';

  @override
  String get goalsDescribeHint =>
      'Describe the outcome, how to verify it, and what must not regress.';

  @override
  String get goalsObjective => 'Objective';

  @override
  String get goalsBudgetLabel => 'Token budget (optional)';

  @override
  String get goalsBudgetHelper => 'Leave empty for no token budget.';

  @override
  String get goalsStart => 'Start goal';

  @override
  String get goalsSave => 'Save goal';

  @override
  String get goalsCancelEditing => 'Cancel editing';

  @override
  String goalsTokensRemaining(String tokens) {
    return '$tokens tokens remaining';
  }

  @override
  String get goalsActiveExplainer =>
      'The desktop keeps working toward this goal when the chat is idle, until it completes, pauses, or reaches a limit.';

  @override
  String get goalsPause => 'Pause goal';

  @override
  String get goalsResume => 'Resume goal';

  @override
  String get goalsEditObjective => 'Edit objective';

  @override
  String get groupsKindSpreadsheet => 'Spreadsheet';

  @override
  String get groupsKindText => 'Text';

  @override
  String get groupsKindArchive => 'Archive';

  @override
  String get groupsKindImage => 'Image';

  @override
  String get groupsKindVideo => 'Video';

  @override
  String get groupsKindAudio => 'Audio';

  @override
  String get groupsKindFile => 'File';

  @override
  String get groupsMacUnreachable => 'Couldn\'t reach your Mac. Try again.';

  @override
  String get groupsCreateFailed => 'Couldn\'t create the group. Try again.';

  @override
  String get groupsNewGroup => 'New group';

  @override
  String get groupsChooseMembers => 'Choose who is in the chat.';

  @override
  String get groupsNameOptional => 'Name (optional)';

  @override
  String get groupsCreateGroup => 'Create group';

  @override
  String groupsCreateGroupWith(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Create group with $count agents',
      one: 'Create group with 1 agent',
    );
    return '$_temp0';
  }

  @override
  String get groupsSignInOnMac => 'Sign in on your Mac to use it';

  @override
  String get groupsUpdateMacTitle => 'Update DJL on your Mac';

  @override
  String get groupsUpdateMacBody =>
      'Group chats need the latest DJL on your Mac. Update it there, then come back.';

  @override
  String get groupsConnectMacTitle => 'Connect to your Mac';

  @override
  String get groupsConnectMacBody =>
      'Group chats live on your Mac. They appear here once it is connected.';

  @override
  String get groupsLoadFailed => 'Couldn\'t load your groups';

  @override
  String get groupsEmptyTitle => 'Put your agents in one chat';

  @override
  String get groupsEmptyBody =>
      'Ask a question once and let Claude, Codex and the others answer together.';

  @override
  String groupsMemberWriting(String name) {
    return '$name is writing';
  }

  @override
  String groupsAgentsWriting(int count) {
    return '$count agents are writing';
  }

  @override
  String get groupsPausedWaiting => 'Paused, waiting for you';

  @override
  String groupsAgentCount(int count) {
    return '$count agents';
  }

  @override
  String get groupsMacDidNotKeepFile => 'Your Mac did not keep the file.';

  @override
  String get groupsFileStillSending => 'This file is still sending.';

  @override
  String get groupsMacTimeout =>
      'Your Mac did not answer in time. Check that DJL is open on it.';

  @override
  String get groupsMacNotConnected => 'Your Mac is not connected right now.';

  @override
  String groupsRemoveAttachment(String name) {
    return 'Remove $name';
  }

  @override
  String get groupsSendingFiles => 'Sending files';

  @override
  String groupsImageNamed(String name) {
    return 'Image $name';
  }

  @override
  String get groupsAttach => 'Attach';

  @override
  String get groupsPhotos => 'Photos';

  @override
  String get groupsFiles => 'Files';

  @override
  String groupsFileUnsupported(String name) {
    return '$name can\'t be sent. Photos, PDFs, Word, Excel, PowerPoint, text and code files work.';
  }

  @override
  String groupsFileTooLarge(String name, String size) {
    return '$name is larger than $size.';
  }

  @override
  String groupsTooManyFiles(int count) {
    return 'A message can carry $count files.';
  }

  @override
  String get groupsOpenFailed => 'Couldn\'t open that. Please try again.';

  @override
  String get groupsAskEveryoneTitle => 'Ask everyone?';

  @override
  String groupsAskEveryoneBody(int count) {
    return 'All $count agents will answer this message.';
  }

  @override
  String get groupsDontAskAgain => 'Don\'t ask again';

  @override
  String get groupsAskEveryone => 'Ask everyone';

  @override
  String get groupsGroupGone => 'This group is no longer on your Mac.';

  @override
  String groupsSayHelloPrompt(String everyone) {
    return '$everyone Say hello in one line.';
  }

  @override
  String get groupsReconnectingToMac => 'Reconnecting to your Mac…';

  @override
  String groupsHeaderLabel(String name, int count) {
    return '$name, $count agents';
  }

  @override
  String get groupsMembers => 'Members';

  @override
  String get groupsYou => 'You';

  @override
  String get groupsCouldNotReply => 'Couldn\'t reply';

  @override
  String get groupsNothingToAdd => 'Nothing to add';

  @override
  String get groupsImageOnMac => 'Image on your Mac';

  @override
  String get groupsRemovedAgent => 'Removed agent';

  @override
  String get groupsWaitingTurn => 'Waiting for its turn';

  @override
  String get groupsWriting => 'Writing';

  @override
  String get groupsAttachTooltip => 'Attach files or photos';

  @override
  String get groupsMentionAgent => 'Mention an agent';

  @override
  String get groupsMessageHint => 'Message';

  @override
  String get groupsStopAgents => 'Stop the agents';

  @override
  String get groupsEveryone => 'Everyone';

  @override
  String get groupsPausedTitle => 'The agents paused';

  @override
  String get groupsPausedBody =>
      'They have been talking to each other for a while and have more to say.';

  @override
  String get groupsEndItHere => 'End it here';

  @override
  String get groupsLetThemContinue => 'Let them continue';

  @override
  String get groupsOfflineHint =>
      'Messages appear here once your Mac is connected.';

  @override
  String get groupsLoadingMessages => 'Loading messages';

  @override
  String get groupsEveryoneIsHere => 'Everyone is here';

  @override
  String get groupsEmptyChatHint =>
      'Type @ to choose who answers. Your first message goes to everyone.';

  @override
  String get groupsAskEveryoneToSayHello => 'Ask everyone to say hello';

  @override
  String get groupsManageOnMac => 'Add or remove agents in DJL on your Mac.';

  @override
  String get groupsReady => 'Ready';

  @override
  String get groupsStop => 'Stop';

  @override
  String get guardianLiveReason =>
      'Retry approvals are available only during the live session.';

  @override
  String get guardianExpiredReason =>
      'This retry is no longer available. Wait for Codex to request the action again.';

  @override
  String get guardianDesktopReason => 'Approve this retry in Codex Desktop.';

  @override
  String get guardianUnsafeReason =>
      'This action cannot be retried safely here. Approve it in Codex.';

  @override
  String get guardianSubmittedReason =>
      'Retry approval submitted. Check Codex before trying again.';

  @override
  String get guardianUncertainReason =>
      'Retry approval may not have reached Codex. Check Codex before trying again.';

  @override
  String get guardianRequestedAction => 'Requested action';

  @override
  String get guardianRunCommand => 'Run command';

  @override
  String get guardianApplyFileChanges => 'Apply file changes';

  @override
  String guardianEditFile(String file) {
    return 'Edit $file';
  }

  @override
  String guardianEditFiles(int count, String files) {
    return 'Edit $count files: $files';
  }

  @override
  String get guardianAccessNetwork => 'Access the network';

  @override
  String guardianAccessHost(String host) {
    return 'Access $host';
  }

  @override
  String get guardianRequestPermissions => 'Request additional permissions';

  @override
  String get guardianRequestNetwork => 'Request network';

  @override
  String get guardianRequestFileAccess => 'Request file access';

  @override
  String get guardianRequestNetworkAndFileAccess =>
      'Request network and file access';

  @override
  String get guardianReviewing => 'Reviewing';

  @override
  String get guardianApproved => 'Approved';

  @override
  String get guardianDenied => 'Denied';

  @override
  String get guardianTimedOut => 'Timed out';

  @override
  String get guardianStopped => 'Stopped';

  @override
  String guardianUpdatedStatus(String status) {
    return 'Updated ($status)';
  }

  @override
  String get guardianDetailsUnavailable => 'Review details unavailable.';

  @override
  String guardianAutoReviewTitle(String status) {
    return 'Auto-review · $status';
  }

  @override
  String get guardianRiskLow => 'Low risk';

  @override
  String get guardianRiskMedium => 'Medium risk';

  @override
  String get guardianRiskHigh => 'High risk';

  @override
  String guardianRiskOther(String level) {
    return '$level risk';
  }

  @override
  String guardianAuthorization(String value) {
    return 'Authorization: $value';
  }

  @override
  String get guardianApprovalRecorded =>
      'Approval recorded; the retry will still be reviewed';

  @override
  String get guardianSubmittingApproval => 'Submitting retry approval…';

  @override
  String get guardianApproveOneRetry => 'Approve one retry';

  @override
  String get subagentsSubagent => 'Subagent';

  @override
  String get subagentsSpawnAgent => 'Spawn agent';

  @override
  String get subagentsWaitForAgents => 'Wait for agents';

  @override
  String get subagentsUpdateAgent => 'Update agent';

  @override
  String get subagentsResumeAgent => 'Resume agent';

  @override
  String get subagentsCloseAgent => 'Close agent';

  @override
  String get subagentsActivity => 'Subagent activity';

  @override
  String get subagentsMetadataUnavailable => 'Subagent metadata unavailable';

  @override
  String get activityCommand => 'Command';

  @override
  String get activityFileChanges => 'File changes';

  @override
  String activityFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count files changed',
      one: '1 file changed',
    );
    return '$_temp0';
  }

  @override
  String get activityToolActivity => 'Tool activity';

  @override
  String get activityReadFile => 'Read file';

  @override
  String activityReadValue(String value) {
    return 'Read $value';
  }

  @override
  String get activitySearchFiles => 'Search files';

  @override
  String activitySearchValue(String value) {
    return 'Search $value';
  }

  @override
  String get activityListFiles => 'List files';

  @override
  String activityListFilesValue(String value) {
    return 'List files $value';
  }

  @override
  String get statusTaskStatus => 'Task status';

  @override
  String get statusAllowed => 'Task status is allowed on this device.';

  @override
  String get statusDenied =>
      'Allow local task status in your device settings. Chat works without it.';

  @override
  String get statusUnsupported => 'Task status is unavailable on this device.';

  @override
  String get statusChecking => 'Checking device permission…';

  @override
  String get statusEnable => 'Turn on';

  @override
  String get statusRefresh => 'Refresh task status';

  @override
  String get statusSystemSettings => 'Open Settings';

  @override
  String pairingStateLabel(String state) {
    String _temp0 = intl.Intl.selectLogic(state, {
      'disconnected': 'disconnected',
      'resolving': 'resolving',
      'connecting': 'connecting',
      'connected': 'connected',
      'offline': 'desktop offline',
      'suspended': 'suspended',
      'other': '$state',
    });
    return '$_temp0';
  }

  @override
  String get settingsLanguage => 'Language';

  @override
  String get settingsLanguageSystem => 'System default';

  @override
  String get workspaceUndoNoExactPatch =>
      'No complete exact unified patch was captured.';

  @override
  String get workspaceUndoRenames => 'Renames cannot be undone here.';

  @override
  String get workspaceUndoBinary =>
      'Binary, rename, mode or symlink changes cannot be undone here.';
}
