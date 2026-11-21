// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appName => 'DJL';

  @override
  String get commonCancel => '取消';

  @override
  String get commonTryAgain => '重试';

  @override
  String get chatUiAccessAskTitle => '需要批准';

  @override
  String get chatUiAccessAskDetail => '编辑外部文件和联网前总是先询问';

  @override
  String get chatUiAccessAutoTitle => '替我批准';

  @override
  String get chatUiAccessAutoDetail => '仅在操作可能不安全时询问';

  @override
  String get chatUiAccessFullTitle => '完全访问';

  @override
  String get chatUiAccessFullDetail => '完全访问电脑（风险较高）';

  @override
  String get chatUiAccessHint => '更改 Codex 请求权限的方式';

  @override
  String get chatUiAccessFullConfirmTitle => '允许完全访问电脑？';

  @override
  String get chatUiAccessFullConfirmBody => '智能体可以在工作区之外修改文件、运行命令，且无需你批准。';

  @override
  String get chatUiAccessFullConfirm => '允许完全访问';

  @override
  String get chatUiAttentionNoMatches => '没有匹配的待处理事项';

  @override
  String get chatUiAttentionAllCaughtUp => '都处理完了';

  @override
  String get chatUiAttentionNoMatchesHint => '换个项目、对话或状态试试。';

  @override
  String get chatUiAttentionEmptyHint => '待批准的操作、智能体的提问、失败的运行和已完成的工作会显示在这里。';

  @override
  String get chatUiAttentionNeedsYou => '需要你处理';

  @override
  String get chatUiAttentionReadyToReview => '可以查看';

  @override
  String get chatUiAgoNow => '刚刚';

  @override
  String chatUiAgoMinutes(int minutes) {
    return '$minutes 分钟前';
  }

  @override
  String chatUiAgoHours(int hours) {
    return '$hours 小时前';
  }

  @override
  String chatUiAgoDays(int days) {
    return '$days 天前';
  }

  @override
  String get chatUiAttentionTitle => '待处理';

  @override
  String get chatUiAttentionConnectionChanged => '连接已变化。请返回后重新打开“待处理”。';

  @override
  String get chatUiAttentionSearch => '搜索待处理事项';

  @override
  String get appSavedConnectionsUnreadable => '无法读取已保存的电脑连接信息。你已保存的连接仍然保留。';

  @override
  String get appRestoreMacsFailed => '无法恢复已保存的 Mac。请解锁设备后重试。';

  @override
  String get appLinkedConversationFailed => '无法打开链接中的对话。请检查网络连接后重试。';

  @override
  String get appLinkedAccountUnavailable => '账号信息仍不可用。加载完成后，请重新打开链接中的对话。';

  @override
  String get appAccountStillLoading => '账号信息仍在加载，请稍后重试。';

  @override
  String get appRenameChat => '重命名对话';

  @override
  String get appRenameChatPlaceholder => '标题';

  @override
  String get appSave => '保存';

  @override
  String get appOpenNavigation => '打开导航';

  @override
  String get appAccountUnavailable => '账号信息不可用。';

  @override
  String get appRetryAccount => '重新加载账号';

  @override
  String get appImages => '图片';

  @override
  String get appNotifications => '通知';

  @override
  String get appRetryLinkedConversation => '重新打开链接中的对话';

  @override
  String get coreBack => '返回';

  @override
  String get coreMenu => '菜单';

  @override
  String get coreChatActions => '对话操作';

  @override
  String get coreSessionEnded => '登录已失效，请重新登录。';

  @override
  String coreCloudRequestFailed(int status) {
    return 'DJL Cloud 请求失败（$status）。';
  }

  @override
  String get coreAccountChanged => '账号已切换。';

  @override
  String get corePleaseSignIn => '请登录。';

  @override
  String get coreNoAccessToken => 'DJL Cloud 没有返回访问令牌。';

  @override
  String get coreCloudTimeout => 'DJL Cloud 响应超时。';

  @override
  String get coreCloudUnreachable => '无法连接到 DJL Cloud，请检查网络连接。';

  @override
  String get corePleaseSignInAgain => '请重新登录。';

  @override
  String get coreInvalidPushRegistration => '通知注册信息无效。';

  @override
  String get corePushNotAcknowledged => '通知注册未获确认。';

  @override
  String get coreCloudResponseUnreadable => '当前版本无法读取 DJL Cloud 的响应。';

  @override
  String get coreInvalidDesktopEnvelope => '来自电脑的消息无效或已被重复发送。';

  @override
  String get coreDesktopMessageUnauthenticated => '无法验证来自电脑的消息。';

  @override
  String get gitThreadChangedReopenAction => '对话状态已变化，请重新打开此分支或工作树操作。';

  @override
  String get gitWaitForThread => '请等这个对话完成后，再切换分支或工作树。';

  @override
  String get gitWaitForOperation => '请等当前 Git 操作完成后，再切换分支或工作树。';

  @override
  String get gitNotRepositorySentence => '此文件夹不是 Git 仓库。';

  @override
  String get gitNotRepository => '此文件夹不是 Git 仓库';

  @override
  String get gitNoLongerRepository => '此文件夹已不再是 Git 仓库。请先刷新，再创建分支或工作树。';

  @override
  String get gitContinue => '继续';

  @override
  String get gitOk => '好';

  @override
  String get gitCreate => '创建';

  @override
  String get gitClose => '关闭';

  @override
  String get gitDone => '完成';

  @override
  String get gitGenerating => '正在生成…';

  @override
  String get gitGenerateMessage => '生成提交说明';

  @override
  String get gitCommitAllTitle => '提交当前所有改动';

  @override
  String get gitCommitPublishTitle => '提交并发布改动';

  @override
  String get gitCommitMessageLabel => '提交说明';

  @override
  String get gitPublishBranchTitle => '发布此分支？';

  @override
  String get gitPublishCommitPushBody => '提交当前所有改动，并将此分支推送到远程仓库。';

  @override
  String get gitPublishFeatureBranchPrBody =>
      '准备一个功能分支，提交所有改动，推送分支，并在 GitHub 上创建拉取请求。';

  @override
  String get gitPublishCommitPrBody => '提交所有改动，推送分支，并在 GitHub 上创建拉取请求。';

  @override
  String get gitCommitCreateSwitch => '提交、创建并切换';

  @override
  String get gitCreateManagedWorktree => '创建托管工作树';

  @override
  String get gitCreateWorktree => '创建工作树';

  @override
  String get gitBranchName => '分支名称';

  @override
  String get gitBaseBranch => '基础分支';

  @override
  String get gitMoveCurrentChanges => '移动当前改动';

  @override
  String get gitCopyCurrentChanges => '复制当前改动';

  @override
  String get gitLeaveChangesHere => '改动留在这里';

  @override
  String get gitInitializeTitle => '初始化 Git？';

  @override
  String get gitInitializeBody => '在此工作区中创建 Git 仓库。';

  @override
  String get gitPushTitle => '推送分支？';

  @override
  String get gitPushBody => '将已提交的改动推送到已配置的远程仓库。';

  @override
  String get gitLocalChangesNeedAttention => '本地改动需要处理';

  @override
  String get gitUpdateRepositoryTitle => '更新仓库？';

  @override
  String get gitDirtyAndBehindBody =>
      '你有本地改动，而远程分支也有了新提交。只有准备好处理这些改动时，才使用变基拉取。';

  @override
  String get gitPullBody => '将远程提交拉取到此分支。';

  @override
  String get gitPullAndRebase => '拉取并变基';

  @override
  String get gitUpdate => '更新';

  @override
  String get gitTransferChangesTitle => '转移改动';

  @override
  String get gitTargetWorkspacePath => '目标工作区路径';

  @override
  String get gitRemoveWorktreeTitle => '移除此工作树？';

  @override
  String get gitRemoveWorktreeBody => '移除此分支的托管工作树。电脑端不会移除主检出目录。';

  @override
  String get gitDiscardTitle => '放弃本地改动？';

  @override
  String get gitDiscardBody => '放弃本地文件改动，并将此分支重置为远程版本。';

  @override
  String get gitPrDraftTitle => '拉取请求草稿';

  @override
  String get gitCopyDraft => '复制草稿';

  @override
  String get gitCreatePrTitle => '创建拉取请求？';

  @override
  String get gitCreatePrBody =>
      '电脑端会在需要时推送此分支，根据已提交的改动生成标题和描述，并在 GitHub 上创建拉取请求。';

  @override
  String get gitNoChangesToShow => '仓库没有可显示的改动。';

  @override
  String get gitBranchSwitchFailed => '无法切换分支';

  @override
  String get gitBranchOpenElsewhere => '无法切换分支：此分支已在另一个工作树中打开。';

  @override
  String get gitErrorTitle => 'Git 出错';

  @override
  String get gitOpenPr => '打开 PR';

  @override
  String get gitLoadingChanges => '正在加载改动';

  @override
  String get gitLoadingChangesEllipsis => '正在加载改动…';

  @override
  String get gitChangesUnavailable => '无法获取改动';

  @override
  String get gitNoChanges => '没有改动';

  @override
  String get gitDesktopChanged => '已连接的电脑已变化，请从对应的工作区重新打开 Git。';

  @override
  String get gitChooseWorkspace => '请先选择电脑上的工作区，再使用 Git。';

  @override
  String get gitWorking => '正在处理…';

  @override
  String get gitRetryStatus => '重新获取 Git 状态';

  @override
  String get gitWorktreeUnavailable => '工作树不可用';

  @override
  String get gitActionsLabel => 'Git 操作';

  @override
  String get gitRefreshStatus => '刷新 Git 状态';

  @override
  String get gitShowMenu => '显示菜单';

  @override
  String get gitInitializeRepository => '初始化仓库';

  @override
  String get gitCreateBranch => '创建分支';

  @override
  String get gitTransferToWorkspace => '将改动转移到工作区';

  @override
  String get gitRemoveManagedWorktree => '移除托管工作树';

  @override
  String get gitGeneratePrDraft => '生成 PR 草稿';

  @override
  String get gitCreatePullRequest => '创建拉取请求';

  @override
  String get gitCommitAndPushMenu => '提交并推送';

  @override
  String get gitCommitPushCreatePrMenu => '提交、推送并创建 PR';

  @override
  String get gitDiscardAndReset => '放弃改动并重置为远程版本';

  @override
  String get gitWorktreeReady => '工作树已就绪';

  @override
  String get gitOpenChat => '打开对话';

  @override
  String get gitOpenPullRequest => '打开拉取请求';

  @override
  String get gitDetachedHead => '游离 HEAD';

  @override
  String get gitNoUpstream => '没有上游分支';

  @override
  String gitAheadBehind(int ahead, int behind) {
    return '领先 $ahead · 落后 $behind';
  }

  @override
  String get gitCommitChanges => '提交改动';

  @override
  String get gitPush => '推送';

  @override
  String get gitPullTitle => '拉取改动？';

  @override
  String get gitPull => '拉取';

  @override
  String get gitViewDiff => '查看改动';

  @override
  String get gitCurrentBranch => '当前分支';

  @override
  String get gitBranchFallback => '分支';

  @override
  String get gitWriterModel => 'Git 撰写模型';

  @override
  String get gitConnectCodexModel => '在你的 Mac 上连接 Codex 模型，即可生成提交说明和 PR 草稿。';

  @override
  String gitChangedFilesCount(int count) {
    return '共 $count 个文件有改动';
  }

  @override
  String get gitActionInitialize => '初始化 Git';

  @override
  String get gitActionChanges => '改动';

  @override
  String get gitActionCommit => '提交';

  @override
  String get gitActionCommitAndPush => '提交并推送';

  @override
  String get gitActionCommitPushPr => '提交、推送并创建 PR';

  @override
  String get gitActionCreatePr => '创建 PR';

  @override
  String get gitSectionSetup => '准备';

  @override
  String get gitSectionWrite => '写入';

  @override
  String get gitStatusNotInitialized => 'Git 尚未初始化';

  @override
  String get gitStatusUpToDate => '仓库已是最新';

  @override
  String get gitStatusAheadOnly => '本地分支领先于远程';

  @override
  String get gitStatusBehindOnly => '远程分支领先于本地分支';

  @override
  String get gitStatusDiverged => '本地与远程分支已分叉';

  @override
  String get gitStatusDirty => '本地仓库有未提交的改动';

  @override
  String get gitStatusDirtyAndBehind => '有本地改动，且远程分支已有新提交';

  @override
  String get gitStatusNoUpstream => '分支尚未发布';

  @override
  String get gitStatusDetachedHead => '无法获取当前分支';

  @override
  String get gitStatusUnavailable => '无法获取仓库状态';

  @override
  String gitReviewLocalCommits(int count) {
    return '$count 个本地提交';
  }

  @override
  String get gitReviewTheCurrentBranch => '当前分支';

  @override
  String gitReviewCreatingFrom(String name, String source) {
    return '你正在从 $source 创建“$name”。可以把本地改动带到新分支，也可以先提交，再创建并切换。';
  }

  @override
  String gitReviewCommitsStayPrefix(
    String base,
    String commits,
    String message,
  ) {
    return '$base 上有 $commits尚未推送到远程，这些提交会保留在 $base 的历史中。$message';
  }

  @override
  String get gitReviewFilesWithChanges => '有本地改动的文件：';

  @override
  String gitReviewMoreFiles(int count) {
    return '另有 $count 个文件';
  }

  @override
  String gitReviewBringChangesTitle(String name) {
    return '把本地改动带到“$name”？';
  }

  @override
  String get gitReviewCarryToNewBranch => '带到新分支';

  @override
  String gitReviewCommitsStayTitle(String base) {
    return '本地提交会保留在 $base';
  }

  @override
  String gitReviewBranchCommitsStay(String base, String commits, String name) {
    return '$base 上有 $commits尚未推送到远程。现在创建“$name”会从当前 HEAD 开始新分支，但这些提交仍会保留在 $base 的历史中。';
  }

  @override
  String get gitReviewCreateAnyway => '仍然创建';

  @override
  String get gitReviewManagedWorktreeNoun => '托管工作树';

  @override
  String gitReviewQuotedName(String name) {
    return '“$name”';
  }

  @override
  String get gitReviewCopyTitle => '从当前分支复制本地改动';

  @override
  String get gitReviewMoveTitle => '从当前分支移动本地改动';

  @override
  String get gitReviewVerbCopy => '复制';

  @override
  String get gitReviewVerbMove => '移动';

  @override
  String gitReviewOnlyCurrentBranch(
    String target,
    String verb,
    String current,
  ) {
    return '创建$target时，只能$verb当前分支的本地改动。请把基础分支切换为“$current”，或先清理本地改动再创建工作树。';
  }

  @override
  String gitReviewCopiedInto(String worktree) {
    return '本地改动也会复制到$worktree；被忽略的文件会留在这里。';
  }

  @override
  String gitReviewMovedInto(String worktree) {
    return '本地改动会移到$worktree；被忽略的文件会留在这里。';
  }

  @override
  String get gitReviewTheManagedWorktree => '托管工作树';

  @override
  String get gitReviewTheNewWorktree => '新工作树';

  @override
  String gitReviewWorktreeCommitsStay(
    String base,
    String commits,
    String target,
    String from,
    String suffix,
  ) {
    return '$base 上有 $commits尚未推送到远程。从 $from 创建$target会从当前 HEAD 开始，但这些提交也仍会保留在 $base 的历史中。$suffix';
  }

  @override
  String get gitBadgeOpenWorktree => '已在工作树中打开';

  @override
  String get gitBadgeOpenElsewhere => '已在别处打开';

  @override
  String get gitActionCompleted => 'Git 操作已完成。';

  @override
  String gitActionFailed(String error) {
    return '$error 操作结果未知，请先刷新再重试。';
  }

  @override
  String get gitDismissMenu => '关闭菜单';

  @override
  String get gitDiffPatch => '补丁';

  @override
  String gitDiffLine(int line) {
    return '第 $line 行';
  }

  @override
  String gitDiffLines(int first, int last) {
    return '第 $first-$last 行';
  }

  @override
  String get gitDismissBranchPicker => '关闭分支选择器';

  @override
  String get gitBadgeCurrent => '当前';

  @override
  String get gitBadgeDefault => '默认';

  @override
  String get gitCloseBranchPicker => '关闭分支选择器';

  @override
  String get gitBranchPickerStale => '对话或电脑已变化，请关闭后重新打开分支选择器。';

  @override
  String get gitSearchBranches => '搜索分支';

  @override
  String get gitClearBranchSearch => '清除分支搜索';

  @override
  String get gitBranches => '分支';

  @override
  String get gitNoBranchesFound => '未找到分支';

  @override
  String get gitNoBranchesHint => '换个关键词搜索，或刷新分支列表。';

  @override
  String gitCreateAndCheckout(String name) {
    return '创建并切换到“$name”';
  }

  @override
  String get gitNewBranchEllipsis => '新建分支…';

  @override
  String get gitSwitching => '正在切换…';

  @override
  String get gitRefreshing => '正在刷新…';

  @override
  String get gitReloadBranchList => '重新加载分支列表';

  @override
  String get gitCloseWorktreeReview => '关闭工作树确认';

  @override
  String get gitHandoffTitle => '将对话移交到工作树';

  @override
  String get gitForkTitle => '将对话分叉到新工作树';

  @override
  String get gitHandoff => '移交';

  @override
  String get gitFork => '分叉';

  @override
  String get gitHandoffMessage => '在新工作树中创建并检出一个分支，以便并行继续。分支名会自动加上 djl/ 前缀。';

  @override
  String get gitForkMessage => '在新工作树中创建并检出一个分支，然后把此对话分叉到该检出目录，作为一个新对话。';

  @override
  String get gitStartsFromBase => '从此基础分支开始。';

  @override
  String get gitLoadingWorktreeBranches => '正在加载工作树分支';

  @override
  String get gitPreparingWorktree => '正在准备工作树';

  @override
  String get gitNewBranch => '新建分支';

  @override
  String get gitNewBranchBody => '将在本地创建并检出分支。未提交的改动会保留在当前工作副本中。';

  @override
  String get gitThreadChangedReopenGit => '对话状态已变化，请关闭后重新打开此 Git 操作。';

  @override
  String get gitRepositoryChanges => '仓库改动';

  @override
  String gitFilesChanged(int count) {
    return '$count 个文件有改动';
  }

  @override
  String get gitExpandAll => '全部展开';

  @override
  String get gitCollapseAll => '全部收起';

  @override
  String gitPatchIndex(int index, int total) {
    return '补丁 $index/$total';
  }

  @override
  String get chatUiComposerOptions => '输入选项';

  @override
  String get chatUiStopDictation => '停止听写';

  @override
  String get chatUiStartDictation => '开始听写';

  @override
  String get chatUiResumeQueued => '继续发送排队的消息';

  @override
  String get chatUiStopTurn => '停止本轮';

  @override
  String get chatUiSendToDesktop => '发送到电脑';

  @override
  String get chatUiStartingRun => '正在开始运行';

  @override
  String get chatUiRemoveImage => '移除图片';

  @override
  String get chatUiAttachedImage => '已添加的图片';

  @override
  String chatUiDesktopImage(String source) {
    return '电脑上的图片：$source';
  }

  @override
  String get chatUiImagePreviewUnavailable => '无法预览图片';

  @override
  String get chatUiContextSkills => '技能';

  @override
  String get chatUiContextPlugins => '插件';

  @override
  String get chatUiContextFiles => '文件';

  @override
  String chatUiContextUnsupported(String kind) {
    return '电脑上的这个运行环境不支持$kind。';
  }

  @override
  String get chatUiContextStale => '对话已变化，请重新打开上下文选择器。';

  @override
  String get chatUiContextRetry => '重新查找';

  @override
  String chatUiContextSearchFilesIn(String path) {
    return '在 $path 中搜索文件';
  }

  @override
  String get chatUiContextSelectFolder => '选择一个项目文件夹，即可搜索电脑上的文件。';

  @override
  String chatUiContextNoneFound(String kind) {
    return '没有找到$kind。';
  }

  @override
  String get chatUiAddDesktopContext => '添加电脑上的上下文';

  @override
  String get chatUiContextSearchFiles => '搜索电脑上的文件';

  @override
  String chatUiContextSearchKind(String kind) {
    return '搜索$kind';
  }

  @override
  String get chatUiContextDisabled => '已在电脑上停用';

  @override
  String get chatUiContextOnDesktop => '在已配对的电脑上';

  @override
  String get chatUiEmptyGeneralTitle => '今天想做点什么？';

  @override
  String get chatUiEmptyFolderPrefix => '想在 ';

  @override
  String get chatUiEmptyFolderSuffix => ' 里做什么？';

  @override
  String get chatUiEmptyGreeting => '你好！有什么可以帮你？';

  @override
  String get chatUiEncryptedCaption => '对话已端到端加密';

  @override
  String get chatUiUserMessage => '你的消息';

  @override
  String get chatUiAssistantMessage => '助手的回复';

  @override
  String get chatUiThreadActions => '对话操作';

  @override
  String get chatUiBranchesAndWorktrees => '分支和工作树';

  @override
  String get chatUiGitActions => 'Git 操作';

  @override
  String get chatUiWorking => '正在处理…';

  @override
  String get chatUiScrollToLatest => '滚动到最新消息';

  @override
  String get chatUiSavedToPhotos => '已存入相册。';

  @override
  String get chatUiShareImageFailed => '无法分享这张图片，请重试。';

  @override
  String get chatUiSaveImageFailed => '无法保存这张图片，请重试。';

  @override
  String get chatUiLoadImageFailed => '无法加载这张图片。';

  @override
  String get chatUiRetry => '重试';

  @override
  String get chatUiImageReopenWorkspace => '请重新连接，或从它所在的工作区重新打开这张图片。';

  @override
  String get chatUiImageReopenChat => '请从它所在的配对对话中重新打开这张图片。';

  @override
  String chatUiOpenImage(String name) {
    return '打开图片 $name';
  }

  @override
  String get chatUiClose => '关闭';

  @override
  String get chatUiShare => '分享';

  @override
  String get chatUiSaveToPhotos => '存入相册';

  @override
  String get chatUiModelsGroup => '模型';

  @override
  String get chatUiRefreshModels => '刷新模型';

  @override
  String get chatUiProviderAndModel => '服务商和模型';

  @override
  String get chatUiDone => '完成';

  @override
  String get chatUiAllProviders => '全部服务商';

  @override
  String get chatUiModelsConnectionChanged => '连接已变化，请重新打开模型选择。';

  @override
  String get chatUiLoadingModels => '正在加载模型';

  @override
  String get chatUiNoModels => '没有可用的模型';

  @override
  String get chatUiNoModelsHint => '请先在电脑上的 DJL 中连接一个服务商，然后刷新模型列表。';

  @override
  String get chatUiNoMatchingModels => '没有匹配的模型';

  @override
  String get chatUiSearchModels => '搜索服务商或模型';

  @override
  String get chatUiClearModelSearch => '清除模型搜索';

  @override
  String get chatUiNavCloudChat => '云端对话';

  @override
  String get chatUiNavRemote => '远程';

  @override
  String get chatUiNavSearchFailed => '无法搜索对话。';

  @override
  String get chatUiNavRetrySearch => '重新搜索';

  @override
  String get chatUiNavSearching => '正在搜索对话…';

  @override
  String get chatUiNavPinned => '已置顶';

  @override
  String get chatUiNavPinnedEmpty => '把常用的对话放在手边。\n长按对话即可置顶。';

  @override
  String get chatUiNavRecent => '最近的对话';

  @override
  String get chatUiNavRecentEmpty => '你的对话会显示在这里。';

  @override
  String get chatUiNoMatchingChats => '没有匹配的对话';

  @override
  String get chatUiCloseSearch => '关闭搜索';

  @override
  String get chatUiSearchChats => '搜索对话';

  @override
  String get chatUiChatButton => '对话';

  @override
  String get chatUiNewChat => '新对话';

  @override
  String get chatUiSettings => '设置';

  @override
  String get chatUiMoreActions => '更多操作';

  @override
  String get chatUiMenuNewChat => '新对话';

  @override
  String get chatUiMenuQuickChat => '快速对话';

  @override
  String get chatUiMenuNewProject => '新项目';

  @override
  String get chatUiMenuConnections => '连接';

  @override
  String get chatUiMenuSecurePairing => '安全配对详情';

  @override
  String get chatUiMenuYourMac => '你的 Mac';

  @override
  String get chatUiMenuActiveChats => '进行中的对话';

  @override
  String get chatUiArchivedChats => '已归档的对话';

  @override
  String get chatUiMenuRefresh => '刷新';

  @override
  String get chatUiMenuDisconnect => '断开连接';

  @override
  String get chatUiOpenNavigation => '打开导航';

  @override
  String get chatUiSearchConversations => '搜索对话';

  @override
  String get chatUiDismissSearch => '关闭搜索';

  @override
  String get chatUiStatusConnecting => '正在连接';

  @override
  String get chatUiStatusDeviceOffline => '设备离线';

  @override
  String get chatUiStatusOffline => '离线';

  @override
  String chatUiConnectionStatus(String status) {
    return '连接状态：$status';
  }

  @override
  String get chatUiGroups => '群聊';

  @override
  String get chatUiExpandAll => '全部展开';

  @override
  String get chatUiCollapseAll => '全部收起';

  @override
  String chatUiCollapseChildChats(String title) {
    return '收起“$title”的子对话';
  }

  @override
  String chatUiExpandChildChats(String title) {
    return '展开“$title”的子对话';
  }

  @override
  String get chatUiDesktopChatActions => '对话操作';

  @override
  String get chatUiArchiveProject => '归档项目';

  @override
  String get chatUiRemoveFromPhone => '从手机上移除';

  @override
  String chatUiArchiveProjectTitle(String name) {
    return '归档“$name”？';
  }

  @override
  String get chatUiArchiveProjectBody => '这个项目中所有进行中的对话都会被归档。';

  @override
  String chatUiRemoveProjectTitle(String name) {
    return '从这台手机上移除“$name”？';
  }

  @override
  String get chatUiRemoveProjectBody =>
      '这个项目的对话只会从这台手机上的 DJL 中删除，你的电脑和 Codex observer 中的内容不受影响。';

  @override
  String chatUiExpandProject(String name) {
    return '展开项目 $name';
  }

  @override
  String chatUiCollapseProject(String name) {
    return '收起项目 $name';
  }

  @override
  String chatUiNewChatIn(String name) {
    return '在 $name 中新建对话';
  }

  @override
  String get chatUiNewGroup => '新群聊';

  @override
  String get chatUiGroupButton => '群聊';

  @override
  String get chatUiOfflineSavedChats => '离线 · 显示已保存的对话';

  @override
  String get chatUiReconnect => '重新连接';

  @override
  String get chatUiNoMatchingChatsPeriod => '没有匹配的对话。';

  @override
  String get chatUiNoStudioThreads => '没有 Studio 对话';

  @override
  String get chatUiNoProjectChats => '没有项目对话';

  @override
  String get desktopAttentionApproval => '需要批准';

  @override
  String get desktopAttentionQuestion => '智能体有问题要问你';

  @override
  String get desktopAttentionFailedRun => '运行失败';

  @override
  String get desktopAttentionBlockedGoal => '目标需要处理';

  @override
  String get desktopAttentionCompletedRun => '待查看';

  @override
  String get desktopFailurePermission => '请查看申请的权限，或更改此对话的访问模式，然后重新运行。';

  @override
  String get desktopFailureSignIn => '请在你的 Mac 上重新登录，然后重新运行。';

  @override
  String get desktopFailureTimeout => '请检查 Mac 的连接，然后重新运行。';

  @override
  String get desktopFailureNetwork => '请确认 Mac 和中继服务都在线，然后重新运行。';

  @override
  String get desktopFailureCheck => '打开对话查看未通过的检查，修复后重试。';

  @override
  String get desktopFailureGeneric => '打开对话查看最后一步，解决问题后重试。';

  @override
  String desktopAttentionAllowCommand(String command) {
    return '允许 Codex 运行“$command”吗？';
  }

  @override
  String get desktopAttentionAwaitingPermission => 'Codex 正在等待你的许可才能继续。';

  @override
  String get desktopAttentionAnswerAgent => '打开对话回复智能体。';

  @override
  String get desktopGoalBlocked => '目标受阻。打开对话看看智能体需要什么。';

  @override
  String get desktopGoalUsageLimited => '已达用量上限，此目标已暂停。请先查看对话再继续。';

  @override
  String get desktopGoalBudgetLimited => '此目标已用完预算。请先查看结果，再决定下一步。';

  @override
  String get desktopRunFinishedReview => '运行已完成。继续之前，请查看结果和文件改动。';

  @override
  String get desktopScopeStudio => '工作室';

  @override
  String get desktopScopeProjects => '项目';

  @override
  String get desktopNoProject => '无项目';

  @override
  String get desktopGroupPinned => '已置顶';

  @override
  String get desktopUntitledChat => '未命名对话';

  @override
  String get desktopComposerTooManyImages => '最多只能选择 4 张图片。';

  @override
  String get desktopContextIncomplete => '所选的上下文不完整。请移除后重新选择。';

  @override
  String get desktopApproveForMeUnsupported =>
      '此运行环境不支持“替我批准”。请在你的 Mac 上更新 Codex 后重试。';

  @override
  String get desktopEnterChatName => '请输入对话名称。';

  @override
  String get desktopContextPickerStale => '已连接的电脑已更换。请重新打开上下文选择器。';

  @override
  String get desktopNoSkillList => '电脑未返回技能列表。';

  @override
  String get desktopNoPluginList => '电脑未返回插件列表。';

  @override
  String get desktopNoFileMatches => '电脑未返回匹配的文件。';

  @override
  String get desktopPairedDisconnectedOrChanged => '已配对的电脑已断开或已更换。';

  @override
  String get desktopPairedChangedRefreshOverview => '已配对的电脑已更换。请刷新概览。';

  @override
  String get desktopPairedChangedRefreshChats => '已配对的电脑已更换。请刷新对话列表。';

  @override
  String get desktopIdentityMismatch => '电脑的身份或安全协议与配对信息不符。';

  @override
  String get desktopHandshakeUnverified => '无法验证电脑的握手签名。';

  @override
  String get desktopHandshakeTimedOut => '与电脑的安全握手超时。';

  @override
  String get desktopSecureConnectionRefused => '电脑拒绝了安全连接。';

  @override
  String get desktopHandshakeInterrupted => '安全握手期间，与电脑的连接中断。';

  @override
  String get desktopSecureConnectionRejected => '与电脑的安全连接被拒绝。';

  @override
  String get desktopInvalidFrame => '电脑发来的数据无效。';

  @override
  String get desktopSecureTransportFailed => '与电脑的安全传输失败。';

  @override
  String get desktopUnencryptedRejected => '已拒绝来自电脑的未加密数据。';

  @override
  String get desktopPayloadDecodeFailed => '部分来自电脑的数据无法解析。';

  @override
  String get desktopRequestFailed => '电脑请求失败。';

  @override
  String get desktopIsDisconnected => '电脑已断开连接。';

  @override
  String get desktopConnectionChanged => '与电脑的连接已变更。';

  @override
  String get desktopRequestTimedOut => '电脑请求超时，结果未知。请先刷新再重试。';

  @override
  String get desktopDisconnectedRefresh => '电脑已断开连接。请先刷新再重试操作。';

  @override
  String get desktopVerifiedHostRequired => '需要一台已保存且已验证的 Mac。';

  @override
  String get desktopResponseFailed => '电脑未能完成这次回复。请检查服务商设置后重试。';

  @override
  String get desktopWaitBeforeMovingProject => '请等当前对话的操作完成后，再移动它的项目。';

  @override
  String get desktopProviderUnavailable => '此对话的服务商不可用。请在电脑上连接该服务商，或选择其他服务商。';

  @override
  String get desktopReopenBeforeRestore => '请重新打开此对话，确认这一轮后再恢复改动。';

  @override
  String get desktopSwitchCancelled => '已取消切换。请选择要重新连接的设备。';

  @override
  String get desktopSelectionClearUnconfirmed =>
      '无法确认已清除保存的选择。请解锁设备，然后选择一台已保存的 Mac 来恢复。';

  @override
  String get desktopLinkIdentityUnavailable =>
      '找不到此链接对应的 Mac 身份。请从已验证的 Mac 打开对话。';

  @override
  String get desktopChooseMatchingMac => '请选择与此链接匹配的已保存 Mac，其验证身份必须一致。';

  @override
  String get desktopWaitingForMac => '正在等待所选的 Mac。等它可用时再重试。';

  @override
  String get desktopLinkedConversationUnavailable => '链接指向的电脑对话不可用。';

  @override
  String get desktopLinkedConversationLoadFailed =>
      '无法加载链接指向的对话。请在所选的 Mac 上重试。';

  @override
  String get desktopDevicePreferencesLoadFailed => '无法加载本机的设备偏好设置。请解锁设备后重试。';

  @override
  String get desktopSavedDesktopsOpenFailed => '无法打开已保存的电脑。请解锁设备后重试。';

  @override
  String get desktopModelUnavailable => '所选模型在电脑上不可用。请选择一个可用的模型。';

  @override
  String get desktopStopRunsUnconfirmed => '无法确认运行已停止，它们可能仍在另一台 Mac 上运行。';

  @override
  String get desktopPairingIdentityReadFailed =>
      '无法读取你的安全配对身份。请解锁设备，然后选择“重新连接”。';

  @override
  String get desktopRuntimeOtherHistory => '运行环境返回了另一个对话的历史记录。';

  @override
  String get desktopLinkedHistoryUnverified => '无法验证链接对话的历史记录。';

  @override
  String get desktopIdleChatAndProjectRequired => '需要当前对话处于空闲状态，并有一个有效的项目。';

  @override
  String get desktopProjectChangeUnverified => '运行环境未确认此对话的项目变更。';

  @override
  String get desktopForkUnidentified => '运行环境未识别出新建的分叉。请先刷新再重试。';

  @override
  String get desktopForkNotSeparate => '运行环境未创建独立的对话。';

  @override
  String get desktopForkUnsupported => '此运行环境不支持分叉对话。请在电脑上更新 DJL 后重试。';

  @override
  String get desktopReadSettingsFirst => '请先读取已保存的设置，再新建对话。';

  @override
  String get desktopConnectMacWithModels => '请先连接一台有可用模型的 Mac，再新建对话。';

  @override
  String get desktopChatCreatedElsewhere => '电脑在另一个项目文件夹中创建了对话。你的本地草稿已保留。';

  @override
  String get desktopDraftContextOtherFolder => '草稿中的上下文属于另一个项目文件夹。请移除后重新选择。';

  @override
  String get desktopQueuedPlanModelRequired => '发送这条排队的草稿前，请选择一个支持计划模式的可用模型。';

  @override
  String get desktopChooseModelFirst => '请先选择一个可用的模型。';

  @override
  String get desktopRunChangedBeforeQueue => '排队消息发送前，当前运行已变化。请先刷新再继续。';

  @override
  String get desktopRunChangedBeforeSteer => '当前运行已变化。请先刷新再引导。';

  @override
  String get desktopModelBeforeLeavingPlan => '退出计划模式前，请选择一个可用的模型。';

  @override
  String get desktopPlanModeUnsupported => '此运行环境不支持计划模式，已作为普通消息发送。';

  @override
  String get desktopRunIdPending => '当前运行尚未发布 ID，请稍后再试。';

  @override
  String get desktopRuntimeOtherTurnPage => '运行环境返回了另一个对话的轮次。';

  @override
  String get desktopRuntimeNoTurnState => '运行环境未返回此对话的轮次状态。';

  @override
  String get desktopRuntimeInvalidTurnState => '运行环境返回的轮次状态无效。';

  @override
  String get desktopRetryApprovalUnacknowledged => '电脑未确认重试批准。';

  @override
  String get desktopDeviceFallbackName => '设备';

  @override
  String get desktopDeviceChangeUnconfirmed =>
      '无法确认更改。请检查保存的名称后重试。如果此设备已被移除或替换，请关闭并重新打开编辑器。';

  @override
  String get desktopPreferencesReloadFailed =>
      '无法确认或重新加载本机偏好设置。请解锁设备并重试，然后再保存。';

  @override
  String get desktopRunChangedBeforePlan => '当前运行已变化。请先刷新再执行此计划。';

  @override
  String get desktopQueueMessageArrived => '消息已送达。请先查看结果，再继续发送排队的消息。';

  @override
  String get desktopQueueDeliveryUnconfirmed => '未能确认排队消息已送达。请重新打开此对话后再重试。';

  @override
  String get desktopRequestFromEarlierSession => '此请求来自之前的电脑会话。请刷新对话。';

  @override
  String get desktopUndoReconnect => '请先重新连接电脑，再查看撤销。';

  @override
  String get desktopUndoReopen => '请重新打开此对话，确认回复后再撤销改动。';

  @override
  String get desktopUndoRepoBusy => '此仓库中有对话正在运行。请稍候再撤销回复。';

  @override
  String get desktopUndoWaitResponse => '请等当前回复完成后再撤销改动。';

  @override
  String get desktopUndoPersistFailed => '无法保存撤销结果。';

  @override
  String get desktopUndoRepoUnverified => '无法验证此回复所在的仓库。请重新连接后再查看。';

  @override
  String get desktopReconnectToRefreshModels => '请重新连接电脑以刷新模型。';

  @override
  String get desktopAccessModeNotApplied => '电脑未应用所请求的访问模式。';

  @override
  String get desktopSubagentOfflineCached => '离线 · 缓存的详情';

  @override
  String get desktopSubagentLoading => '正在加载智能体详情';

  @override
  String get desktopSubagentLoaded => '详情已加载';

  @override
  String get desktopSubagentIdentityUnknown => '智能体身份未知';

  @override
  String get desktopSubagentLoadFailed => '无法加载智能体详情';

  @override
  String get desktopSavedDeviceChanged => '此已保存的设备有变化。请重新选择。';

  @override
  String get desktopMacIdentityMismatch => '所选 Mac 的身份不匹配。';

  @override
  String get desktopOfflineChatsOpenFailed => '无法打开离线对话。请解锁设备或重新连接以加载。';

  @override
  String get desktopOfflineChatsSaveFailed => '无法保存离线对话。请解锁设备后重试。';

  @override
  String get desktopChoosePairedDesktop => '请选择一台已配对的电脑。';

  @override
  String get desktopSavedLocallyUnconfirmed => '已保存在此设备上。无法确认电脑上的更改，请先刷新再重试。';

  @override
  String get desktopImageEmptyOrTooLarge => '所选图片为空或过大。请选择较小的图片。';

  @override
  String get desktopImageUnsupported => '所选文件不是受支持的图片。';

  @override
  String get desktopImageResizeFailed => '此设备无法调整图片尺寸。请选择不超过 1600 像素的图片。';

  @override
  String get desktopImageTooLarge => '所选图片过大。请选择较小的图片。';

  @override
  String get desktopContextFolderChanged => '项目文件夹已更改。请移除现有上下文，或返回原来的文件夹。';

  @override
  String get desktopPickerOpenFailed => '无法打开选择器。请重试。';

  @override
  String get desktopWorktreeStale => '已连接的电脑或对话有变化。请重新打开此工作树操作。';

  @override
  String get desktopNotGitRepository => '此文件夹已不再是 Git 仓库。';

  @override
  String get desktopBranchAlreadyExists => '分支已存在';

  @override
  String get desktopWorktreeUnidentified => '电脑未识别出新的工作树。请先刷新再重试。';

  @override
  String get desktopForkUnverified => '无法验证分叉结果。';

  @override
  String get desktopHandoffUnverified => '电脑未确认移交目标。请检查两个文件夹后再重试。';

  @override
  String get desktopWorktreePathUnavailable => '工作树路径不可用。';

  @override
  String get desktopLocalCheckoutUnresolved => '无法找到此工作树对应的本地检出。';

  @override
  String get desktopWorktreeHandoffFailed => '工作树移交失败';

  @override
  String get desktopWorktreeForkFailed => '工作树分叉失败';

  @override
  String desktopAccessModeNotAppliedBy(String method) {
    return '$method 未应用所选的访问模式。';
  }

  @override
  String desktopApprovalReviewerNotApplied(String method) {
    return '$method 未应用所选的审批方。';
  }

  @override
  String desktopApprovalPolicyNotApplied(String method) {
    return '$method 未应用所选的审批策略。';
  }

  @override
  String desktopSandboxNotApplied(String method) {
    return '$method 未应用所选的沙盒权限。';
  }

  @override
  String desktopForkResultUnknown(String error) {
    return '$error 无法确定分叉是否成功，请先刷新再重试。';
  }

  @override
  String desktopSendResultUnknown(String error) {
    return '$error 无法确定是否已发送，请先刷新对话再重试。';
  }

  @override
  String desktopQueuePaused(String reason) {
    return '排队已暂停：$reason';
  }

  @override
  String desktopWorktreeExists(String branch) {
    return '“$branch”的工作树已存在。请换一个名称。';
  }

  @override
  String desktopRollbackFailed(String reason) {
    return '无法自动移回已跟踪的改动：$reason。请检查两个文件夹后再重试。';
  }

  @override
  String desktopWorktreeKeptAt(String path) {
    return '新的工作树已保留在 $path。请检查后再重试。';
  }

  @override
  String get desktopWorktreeMayExist => '可能已创建了一个工作树，并已保留。请刷新并检查后再重试。';

  @override
  String get pairingEnterTenCharCode => '请输入电脑端“远程”设置中显示的 10 位配对码。';

  @override
  String get pairingSecureRelayRequired => '配对需要使用安全的中继地址。';

  @override
  String get pairingPairedMac => '已配对的 Mac';

  @override
  String get pairingNotAPairingCode => '这不是 DJL 的配对二维码或配对码。';

  @override
  String get pairingUpdateDesktop => '请更新电脑上的 DJL：此配对使用了不同的协议。';

  @override
  String get pairingInvalidIdentifier => '设备或会话标识无效。';

  @override
  String get pairingInvalidIdentityKey => '电脑身份密钥无效。';

  @override
  String get pairingCodeExpired => '此配对码已过期，请在 Mac 上生成新的配对码。';

  @override
  String get pairingPrefsUnavailable => '已保存的设备偏好设置不可用。';

  @override
  String get pairingDeviceChangedReopen => '此设备的保存信息已变化，请关闭后重新打开编辑页面。';

  @override
  String get pairingRecoverSelectionFailed => '无法恢复已保存的选择。请先解锁设备并重试，再选择 Mac。';

  @override
  String get pairingDeviceChangedChooseAgain => '已保存的设备有变化，请重新选择。';

  @override
  String get pairingConfirmSavedFailed =>
      '无法确认所选 Mac 已保存。请解锁设备，再选择一台已保存的 Mac 来恢复。';

  @override
  String get pairingRelayDifferentIdentity => '可信中继返回了不同的电脑身份，请重新配对。';

  @override
  String get pairingRelayTemporarilyUnavailable => '电脑中继暂时不可用。';

  @override
  String get pairingRelayInvalidResponse => '电脑中继返回了无效的响应。';

  @override
  String get pairingTrustedComputerOffline => '受信任的电脑已离线。';

  @override
  String get pairingServiceUnavailable => '电脑配对服务不可用。';

  @override
  String get pairingRelayUnreachable => '无法连接电脑中继。';

  @override
  String get pairingRelayUnsupportedMethod => '该中继不支持这种配对方式。';

  @override
  String get pairingRelayRequired => '请填写中继地址。';

  @override
  String get pairingEnterOneTimeCode => '输入一次性配对码';

  @override
  String get pairingFindCodeHint => '在电脑版 DJL 的“设置 → 远程”中可以找到配对码。';

  @override
  String get pairingCodeLabel => '配对码';

  @override
  String get pairingRelayConfigured => '中继已设置';

  @override
  String get pairingRelaySettings => '中继设置';

  @override
  String get pairingInProgress => '正在配对…';

  @override
  String get pairingPair => '配对';

  @override
  String get pairingSecureDetailsTitle => '安全配对详情';

  @override
  String get pairingSecureDetailsBody =>
      '打开电脑版 DJL →“设置 → 远程”。粘贴其中的配对内容，或设置一次性配对码所用的中继。';

  @override
  String get pairingPasteCode => '粘贴配对码';

  @override
  String get pairingPayloadHint => 'RMX1:… 或二维码 JSON';

  @override
  String get pairingPairSecurely => '安全配对';

  @override
  String get pairingRelayUrlLabel => '电脑中继地址';

  @override
  String get pairingSwitchDeviceTitle => '要切换设备吗？';

  @override
  String get pairingSwitchDeviceBody =>
      'DJL 会尝试停止这台 Mac 上正在进行的任务，并重新加载另一台设备的对话。';

  @override
  String get pairingSwitch => '切换';

  @override
  String get pairingCancellingSwitch => '正在取消切换…';

  @override
  String get pairingSwitchingDevice => '正在切换设备…';

  @override
  String get pairingCancelSwitch => '取消切换';

  @override
  String get pairingChooseMatchingMac => '请选择与此链接已验证身份相符的 Mac。';

  @override
  String get pairingChooseMacForLink => '请选择一台已保存的 Mac 来打开链接中的对话。';

  @override
  String get pairingOpeningLinkedConversation => '正在打开链接中的电脑对话…';

  @override
  String get pairingRetryDesktopLink => '重新打开链接';

  @override
  String get pairingCancelDesktopLink => '取消打开链接';

  @override
  String get pairingMatchesLinkIdentity => '与此链接的已验证身份相符';

  @override
  String get pairingDifferentIdentity => '电脑身份不同';

  @override
  String get pairingSavedVerifiedIdentity => '已保存并验证的电脑身份';

  @override
  String get pairingReconnect => '重新连接';

  @override
  String get pairingConnections => '连接';

  @override
  String get pairingScanQrCode => '扫描二维码';

  @override
  String get pairingPairWithCode => '用配对码配对';

  @override
  String get pairingConnectToDesktop => '连接电脑版 DJL';

  @override
  String get pairingChooseSavedMac => '选择已保存的 Mac';

  @override
  String get pairingFirstPairingHint =>
      '在你的 Mac 或 Windows 电脑上打开 DJL，然后进入“设置 → 远程”。';

  @override
  String get pairingGetDesktop => '获取电脑版 DJL';

  @override
  String get pairingScanTitle => '扫描电脑版 DJL 二维码';

  @override
  String get pairingCameraDenied => '相机权限已被拒绝。你可以改为粘贴配对码。';

  @override
  String get pairingScanUnsupported => '此设备无法扫描二维码。你可以改为粘贴配对码。';

  @override
  String get pairingCameraUnavailable => '相机不可用。你可以改为粘贴配对码。';

  @override
  String get pairingSwitchDevice => '切换设备';

  @override
  String get pairingSwitchTo => '切换到';

  @override
  String get pairingStatusSwitching => '正在切换…';

  @override
  String get pairingStatusConnected => '已连接';

  @override
  String get pairingStatusSelected => '已选择';

  @override
  String get pairingStatusPrevious => '上次使用';

  @override
  String get pairingStatusSaved => '已保存';

  @override
  String get pairingForget => '移除';

  @override
  String get pairingForgetDeviceTitle => '要移除这台设备吗？';

  @override
  String pairingForgetDeviceBody(String name) {
    return '将从这部手机上移除“$name”。如需重新连接，请再次扫描它的二维码。';
  }

  @override
  String get pairingActiveBadge => '当前';

  @override
  String pairingShowInMenu(String name) {
    return '在设备菜单中显示“$name”';
  }

  @override
  String get pairingMenuVisibilityUnavailable => '无法设置菜单显示';

  @override
  String get pairingClose => '关闭';

  @override
  String get pairingActiveDevice => '当前设备';

  @override
  String pairingActiveDeviceNamed(String name) {
    return '当前设备：$name';
  }

  @override
  String pairingDevicesInMenu(int count) {
    return '菜单中有 $count 台设备';
  }

  @override
  String get pairingDevices => '设备';

  @override
  String get pairingNoDevices => '还没有配对的设备。';

  @override
  String get pairingScanQr => '扫码';

  @override
  String get pairingForgetDesktop => '移除电脑';

  @override
  String get pairingRecencyNow => '刚刚';

  @override
  String pairingRecencyMinutes(int count) {
    return '$count 分钟';
  }

  @override
  String pairingRecencyHours(int count) {
    return '$count 小时';
  }

  @override
  String pairingRecencyDays(int count) {
    return '$count 天';
  }

  @override
  String pairingRecencyAgo(String age) {
    return '$age前';
  }

  @override
  String pairingRecencyIn(String age) {
    return '$age后';
  }

  @override
  String get chatUiCloseNavigation => '关闭导航';

  @override
  String get chatUiRuntime => '运行位置';

  @override
  String get chatUiContinueIn => '继续于';

  @override
  String get chatUiLocal => '本地';

  @override
  String get chatUiWorktree => '工作树';

  @override
  String get chatUiCurrentBranch => '当前分支';

  @override
  String get chatUiCollapseProjectControls => '收起项目控制';

  @override
  String get chatUiExpandProjectControls => '展开项目控制';

  @override
  String get chatUiQueuedMessages => '排队中的消息';

  @override
  String get chatUiQueuedHint => '查看排队中的追问';

  @override
  String get chatUiQueued => '排队中';

  @override
  String get chatUiQueuedNeedsPlanModel => '请先选择支持计划模式的模型，再把这条草稿移到输入框。';

  @override
  String chatUiImageCount(int count) {
    return '$count 张图片';
  }

  @override
  String get chatUiAttachedContext => '已添加的上下文';

  @override
  String get chatUiMoveDraftToInput => '移到输入框';

  @override
  String get chatUiSteerQueued => '立即插入这条排队消息';

  @override
  String get chatUiSteer => '插入';

  @override
  String get chatUiDeleteQueued => '删除排队中的消息';

  @override
  String get chatUiCopyResponse => '复制回复';

  @override
  String get chatUiCopied => '已复制';

  @override
  String get chatUiEffortLow => '低';

  @override
  String get chatUiEffortMedium => '中';

  @override
  String get chatUiEffortHigh => '高';

  @override
  String get chatUiEffortExtraHigh => '极高';

  @override
  String get chatUiLoading => '正在加载…';

  @override
  String get chatUiSelectModel => '选择模型';

  @override
  String get chatUiModel => '模型';

  @override
  String get chatUiSpeed => '速度';

  @override
  String get chatUiSpeedFast => '快速';

  @override
  String get chatUiSpeedNormal => '标准';

  @override
  String get chatUiChatControls => '对话设置';

  @override
  String get chatUiControlsConnectionChanged => '连接已变化，请重新打开对话设置。';

  @override
  String get chatUiLoadingModelsEllipsis => '正在加载模型…';

  @override
  String get chatUiOtherModels => '其他模型…';

  @override
  String get chatUiIntelligence => '推理强度';

  @override
  String get chatUiCopySessionId => '复制会话 ID';

  @override
  String get chatUiRenameChat => '重命名对话';

  @override
  String get chatUiUnpinChat => '取消置顶';

  @override
  String get chatUiPinChat => '置顶对话';

  @override
  String get chatUiUnarchiveChat => '取消归档';

  @override
  String get chatUiArchiveChat => '归档对话';

  @override
  String get chatUiRemoveFromDevice => '从这台设备上移除';

  @override
  String get chatUiSessionIdCopied => '已复制会话 ID。';

  @override
  String get chatUiRemoveChatTitle => '从这台设备上移除这个对话？';

  @override
  String get chatUiRemoveChatBodyArchived => '对话仍会保留在你的电脑上。子智能体的对话会在本地归档。';

  @override
  String get chatUiRemoveChatBody => '对话仍会保留在你的电脑上，并在电脑上归档。子智能体的对话会在本地归档。';

  @override
  String get chatUiRemoveChat => '移除对话';

  @override
  String get chatUiChatName => '对话名称';

  @override
  String get chatUiSaveName => '保存名称';

  @override
  String get chatUiCopyPathFailed => '无法复制路径，请重试。';

  @override
  String get chatUiConversationChanged => '对话已变化';

  @override
  String get chatUiCloseLocation => '关闭位置信息';

  @override
  String get chatUiThreadLabel => '对话';

  @override
  String get chatUiRenameConversation => '重命名对话';

  @override
  String get chatUiPathLabel => '路径';

  @override
  String get chatUiPathCopied => '已复制路径';

  @override
  String get chatUiCopyPath => '复制路径';

  @override
  String get chatUiLocationStale => '请关闭此页面，再重新打开对话位置。';

  @override
  String get chatUiMoreThreadActions => '更多对话操作';

  @override
  String chatUiPreviousMessages(int count) {
    return '更早的 $count 条消息';
  }

  @override
  String chatUiMoreToolCalls(int count) {
    return '另有 $count 次工具调用';
  }

  @override
  String chatUiRanCommands(int count) {
    return '运行了 $count 条命令';
  }

  @override
  String chatUiCommandsFailed(int count) {
    return '$count 条失败';
  }

  @override
  String chatUiCommandsStopped(int count) {
    return '$count 条已停止';
  }

  @override
  String get chatUiCollapsePreviousMessages => '收起更早的消息';

  @override
  String get chatUiExpandPreviousMessages => '展开更早的消息';

  @override
  String get chatUiCollapseCommands => '收起命令';

  @override
  String get chatUiExpandCommands => '展开命令';

  @override
  String get chatUiCollapseToolCalls => '收起工具调用';

  @override
  String get chatUiExpandToolCalls => '展开工具调用';

  @override
  String get chatUiQuestions => '问题';

  @override
  String chatUiQuestionPage(int page, int total) {
    return '第 $page 个，共 $total 个';
  }

  @override
  String get chatUiQuestionResponseUnknown => '之前的回复可能已经发出。请先在电脑上确认，再重新回复。';

  @override
  String get chatUiBack => '上一步';

  @override
  String get chatUiQuestionClosing => '正在关闭…';

  @override
  String get chatUiQuestionEsc => '关闭';

  @override
  String get chatUiNext => '下一步';

  @override
  String get chatUiResponseSent => '回复已发送';

  @override
  String get chatUiSendingDots => '正在发送…';

  @override
  String get chatUiSend => '发送';

  @override
  String chatUiSelectUpTo(int limit) {
    return '最多选择 $limit 项';
  }

  @override
  String get chatUiOtherAnswer => '其他回答';

  @override
  String get chatUiYourAnswer => '你的回答';

  @override
  String get settingsFontSystem => '系统默认';

  @override
  String get settingsUnlockReason => '解锁 DJL 和你的远程编程会话。';

  @override
  String get settingsUsageWeekly => '每周';

  @override
  String settingsUsageWeeks(int count) {
    return '$count 周';
  }

  @override
  String settingsUsageDays(int count) {
    return '$count 天';
  }

  @override
  String settingsUsageHours(int count) {
    return '$count 小时';
  }

  @override
  String settingsUsageMinutes(int count) {
    return '$count 分钟';
  }

  @override
  String get settingsThemeSystem => '跟随系统';

  @override
  String get settingsThemeLight => '浅色';

  @override
  String get settingsThemeDark => '深色';

  @override
  String get settingsAppearance => '外观';

  @override
  String get settingsFont => '字体';

  @override
  String get settingsLiquidGlass => '液态玻璃';

  @override
  String get settingsTheme => '主题';

  @override
  String get settingsNotifications => '通知';

  @override
  String get settingsInAppAlertsFooter => '其他对话的任务完成时显示横幅提醒。';

  @override
  String get settingsInAppAlerts => '应用内提醒';

  @override
  String get settingsVoice => '语音';

  @override
  String get settingsVoiceFooter => '发送前可检查听写内容。回复使用设备的语音朗读。';

  @override
  String get settingsSpeakReplies => '朗读新回复';

  @override
  String get settingsRetryReading => '重新读取设置';

  @override
  String get settingsErrorPartialSave => '部分默认设置可能未完整保存。请检查重新加载的选项后重试。';

  @override
  String get settingsErrorPartialReload => '默认设置可能未完整保存，且无法重新加载偏好设置。请先重新读取设置。';

  @override
  String get settingsErrorRead => '无法读取已保存的设置。请重试以保留你的偏好。';

  @override
  String get settingsErrorSave => '无法保存此设置，之前的选择保持不变。请重试。';

  @override
  String settingsUsageResets(String when) {
    return '$when 重置';
  }

  @override
  String get settingsUsage => '用量';

  @override
  String get settingsUsageFooter => '来自已配对设备的账号整体速率限制。';

  @override
  String get settingsUsageLoading => '正在加载当前限额…';

  @override
  String get settingsUsageConnect => '连接已配对的设备以加载当前限额。';

  @override
  String get settingsUsageUnavailable => '此账号暂无速率限制信息。';

  @override
  String settingsUsageLeft(int percent) {
    return '剩余 $percent%';
  }

  @override
  String get settingsUsageStale => '这是上次获取的限额。重新连接或刷新即可更新。';

  @override
  String get settingsUsageRefreshTooltip => '刷新用量';

  @override
  String get settingsUsageRefreshing => '正在刷新…';

  @override
  String get settingsUsageRefresh => '刷新';

  @override
  String get settingsUsageRuntimeUnavailable => '此运行环境暂无速率限制信息。';

  @override
  String get settingsUsageLoadFailed => '无法加载当前限额。请重试。';

  @override
  String get settingsTitle => '设置';

  @override
  String get settingsOpenCloudChat => '打开 DJL Cloud 对话';

  @override
  String get settingsSignInCloud => '登录 DJL Cloud';

  @override
  String get settingsCloudSubtitle => '无需 Mac，也能对话、生成图片和运行后台任务';

  @override
  String get settingsDevicePermissions => '设备权限';

  @override
  String get settingsDevice => '设备';

  @override
  String get settingsMyMacs => '我的 Mac';

  @override
  String get settingsLocked => 'DJL 已锁定';

  @override
  String get settingsPreparing => '正在准备 DJL';

  @override
  String get settingsStartFailed => '无法启动 DJL';

  @override
  String get settingsPrivateNote => '你离开时，远程会话会保持私密。';

  @override
  String get settingsRetryStartup => '重新启动';

  @override
  String get settingsUnlockHint => '使用面容 ID、触控 ID 或设备密码验证';

  @override
  String get settingsUnlocking => '正在解锁…';

  @override
  String get settingsUnlock => '解锁 DJL';

  @override
  String get settingsLockSetup => '请设置面容 ID、触控 ID 或设备密码来解锁 DJL。';

  @override
  String get settingsLockStillLocked => 'DJL 仍处于锁定状态。请解锁 DJL 以继续。';

  @override
  String get settingsLockCancelled => '验证已取消或不可用。请解锁 DJL 以继续。';

  @override
  String get settingsBridgeUnknown => '未知';

  @override
  String get settingsBridgeInstalled => '已安装';

  @override
  String get settingsBridgeUpToDate => '已是最新';

  @override
  String get settingsBridgeUpdateAvailable => '有可用更新';

  @override
  String get settingsBridgeDifferentBuild => '版本不同';

  @override
  String get settingsBridgeConnectHint => '连接你的 Mac 以查看它的 DJL 版本。';

  @override
  String get settingsBridgeStaleHint => '这是上次获取的版本。重新连接即可再次检查。';

  @override
  String get settingsBridgeMatches => 'Mac 上的 DJL 已是最新版本。';

  @override
  String get settingsBridgeNewer => 'DJL 有新版本可用。请更新 Mac 上的 DJL。';

  @override
  String get settingsBridgeDifferent => '你的 Mac 运行的版本与最新发布版本不同。';

  @override
  String get settingsBridgeStatus => '状态';

  @override
  String settingsBridgeLastKnown(String status) {
    return '上次获取 · $status';
  }

  @override
  String get settingsVersion => '版本';

  @override
  String get settingsBridgeLatest => '最新版本';

  @override
  String get settingsBridgeUpdate => '更新 Mac 上的 DJL';

  @override
  String get settingsBridgeCheck => '检查 DJL 更新';

  @override
  String settingsElapsedDays(int days) {
    return '$days 天';
  }

  @override
  String settingsElapsedHours(int hours, int minutes) {
    return '$hours 小时 $minutes 分钟';
  }

  @override
  String settingsElapsedMinutes(int minutes, int seconds) {
    return '$minutes 分钟 $seconds 秒';
  }

  @override
  String settingsElapsedSeconds(int seconds) {
    return '$seconds 秒';
  }

  @override
  String get settingsArchived => '已归档';

  @override
  String get settingsArchivedChats => '已归档对话';

  @override
  String settingsArchivedSaved(int count) {
    return '本地已保存 $count 个';
  }

  @override
  String get settingsArchivedActions => '已归档对话操作';

  @override
  String get settingsUnarchive => '取消归档';

  @override
  String get settingsRemoveFromPhone => '从手机移除';

  @override
  String get settingsRemove => '移除';

  @override
  String get settingsNoArchived => '没有已归档的对话';

  @override
  String settingsRemoveTitle(String title) {
    return '要从这台手机移除“$title”吗？';
  }

  @override
  String get settingsRemoveBody => '这只会从这台手机上的 DJL 中移除该对话，已配对电脑上的内容不受影响。';

  @override
  String get settingsCloudRefreshFailed => '无法刷新账号和 Cloud 设置。';

  @override
  String get settingsLinkFailed => '无法打开此链接。请重试。';

  @override
  String get settingsOpenNotificationsFailed => '无法打开通知设置。请重试。';

  @override
  String get settingsAlertsUnavailable => '不可用';

  @override
  String get settingsAlertsOff => '已关闭';

  @override
  String get settingsAlertsEnabled => '已开启';

  @override
  String get settingsAlertsNotEnabled => '未开启';

  @override
  String get settingsBack => '返回';

  @override
  String get settingsOpenNavigation => '打开导航';

  @override
  String get settingsRetry => '重试';

  @override
  String get settingsAccount => '账号';

  @override
  String get settingsDjlAccount => 'DJL 账号';

  @override
  String get settingsAvailableCredits => '可用额度';

  @override
  String get settingsConversations => '对话';

  @override
  String get settingsArchivedChatsRow => '已归档对话';

  @override
  String get settingsRemoteAccess => '远程访问';

  @override
  String get settingsBackgroundAlerts => '后台提醒';

  @override
  String get settingsEnableBackgroundAlerts => '开启后台提醒';

  @override
  String get settingsOpenNotificationSettings => '打开通知设置';

  @override
  String get settingsVoiceIos =>
      '听写内容只保留在你的 iPhone 上。发送前可检查文字。回复使用 iPhone 的语音朗读。';

  @override
  String get settingsVoiceDevice => '听写内容只保留在你的设备上。发送前可检查文字。回复使用设备的语音朗读。';

  @override
  String get settingsAbout => '关于';

  @override
  String get settingsTerms => '条款';

  @override
  String get settingsPrivacy => '隐私';

  @override
  String get settingsRetryLocalPrefs => '重新读取本地偏好';

  @override
  String get settingsDeviceNameOnPhone => '这台手机上显示的设备名称';

  @override
  String get settingsEditDeviceNameTooltip => '编辑设备名称';

  @override
  String get settingsClose => '关闭';

  @override
  String get settingsEditDeviceNameTitle => '编辑设备名称';

  @override
  String get settingsDeviceName => '设备名称';

  @override
  String get settingsNicknameNote => '这个昵称只保存在这台手机上，并会显示在所有出现该设备的地方。';

  @override
  String get settingsDeviceChanged => '这个已保存的设备发生了变化。请关闭后重新打开编辑器。';

  @override
  String get settingsUseDefault => '使用默认名称';

  @override
  String get settingsSave => '保存';

  @override
  String get settingsAboutFooter => '你的手机与已配对设备之间的对话采用端到端加密。';

  @override
  String get settingsHowDjlWorks => 'DJL 的工作原理';

  @override
  String get settingsChatSupport => '交流与支持';

  @override
  String get settingsPrivacyPolicy => '隐私政策';

  @override
  String get settingsTermsOfUse => '使用条款';

  @override
  String get settingsAboutRouteBridgeDevice => '已配对设备上的桥接程序';

  @override
  String get settingsAboutRouteBridge => '桥接程序';

  @override
  String settingsAboutRouteLabel(String from, String to, String via) {
    return '$from 通过 $via 连接到 $to';
  }

  @override
  String get settingsAboutIntro => '用手机控制 **Codex**。';

  @override
  String get settingsAboutIntroNote =>
      'Codex 运行环境始终留在已配对的设备上。你的手机是一个通过中继连接的安全遥控器。';

  @override
  String get settingsAboutHowItWorks => '工作原理';

  @override
  String get settingsAboutBridge =>
      '已配对的设备上运行着一个轻量的**桥接程序**，它通过 WebSocket 连接到**中继服务器**。';

  @override
  String get settingsAboutStep1 => '你在手机上发送提示。';

  @override
  String get settingsAboutStep2 => '提示经由中继传到已配对设备上的桥接程序。';

  @override
  String get settingsAboutStep3 => '桥接程序通过 JSON-RPC 把它转发给 `codex app-server`。';

  @override
  String get settingsAboutStep4 => '回复沿同一路径实时传回。';

  @override
  String get settingsAboutWorkspaceNote =>
      '工作区工具和文件编辑都在已配对的设备上运行。中继只转发加密流量，不会运行你的工作区。';

  @override
  String get settingsAboutArchitecture => '架构';

  @override
  String get settingsAboutRelay => '中继';

  @override
  String get settingsAboutRelayIntro =>
      '一个轻量的 WebSocket 服务器，负责在你的手机和已配对设备之间转发消息。';

  @override
  String get settingsAboutRelayDiscovery => '负责会话发现，让你的手机找到设备上正在运行的会话。';

  @override
  String get settingsAboutRelayPrivate => '握手完成后，永远看不到解密后的消息内容。';

  @override
  String get settingsAboutRelayMetadata => '能看到连接元数据，例如会话 ID、设备 ID 和时间信息。';

  @override
  String get settingsAboutRelaySelfHost => '你可以**自行托管**中继，也可以使用桥接程序配置的托管端点。';

  @override
  String get settingsAboutAppServerIntro =>
      '对于 Codex 运行环境，桥接程序会连接到 **`codex app-server`**，也就是 Codex 客户端使用的 JSON-RPC 接口。';

  @override
  String get settingsAboutAppServerSessions => '手机上的对话就是完整的 Codex 会话。';

  @override
  String get settingsAboutAppServerRollout =>
      'Codex 会在 `~/.codex/sessions/` 下生成 JSONL rollout 文件。';

  @override
  String get settingsAboutAppServerHandoff =>
      '使用 DJL 的“在电脑上继续”操作，即可在已配对设备上继续手机上的对话。';

  @override
  String get settingsAboutPairing => '配对与安全';

  @override
  String get settingsAboutPairingQr =>
      '首次连接时，扫描桥接程序的**二维码**。它包含中继、会话、已配对设备以及桥接程序身份公钥的信息。';

  @override
  String get settingsAboutPairingAfter => '安全握手完成后：';

  @override
  String get settingsAboutPairingTrusted => '你的手机会把桥接程序作为**受信任设备**保存在系统安全存储中。';

  @override
  String get settingsAboutPairingIdentity => '桥接程序会在本地保存你手机的身份。';

  @override
  String get settingsAboutPairingReconnect => '已保存的受信任设备无需再次扫码即可重新连接。';

  @override
  String get settingsAboutPairingRecovery =>
      '如果信任关系发生变化或找不到当前会话，仍可扫描二维码恢复连接。配置了同一中继时，也可以使用一次性配对码配对。';

  @override
  String get settingsAboutEncryption => '端到端加密';

  @override
  String get settingsAboutEncryptionIntro => '配对后，消息会通过加密信封传输。';

  @override
  String get settingsAboutCipher => '加密算法';

  @override
  String get settingsAboutKeyDerivation => '密钥派生';

  @override
  String get settingsAboutKeyDerivationValue => 'HKDF-SHA256，每个方向使用独立密钥';

  @override
  String get settingsAboutKeyExchange => '密钥交换';

  @override
  String get settingsAboutKeyExchangeValue => 'X25519 临时密钥';

  @override
  String get settingsAboutIdentity => '身份';

  @override
  String get settingsAboutIdentityValue => 'Ed25519 签名';

  @override
  String get settingsAboutReplayProtection => '重放保护';

  @override
  String get settingsAboutReplayProtectionValue => '单调递增计数器';

  @override
  String get settingsAboutCacheKey => '手机缓存密钥';

  @override
  String get settingsAboutCacheKeyValue => '由系统安全存储保护';

  @override
  String get settingsAboutEncryptionNote =>
      '以上描述的是**配对设备模式**。DJL Cloud 是独立的服务和账号流程。';

  @override
  String get settingsAboutGit => 'Git 与工作区';

  @override
  String get settingsAboutGitIntro => '桥接程序在已配对的设备上本地处理 Git 命令：';

  @override
  String get settingsAboutGitRevert =>
      'DJL 还支持**工作区还原**：想撤销助手的改动时，可以预览并应用反向补丁。应用改动前请先查看确认信息。';

  @override
  String get settingsAboutResilience => '连接稳定性';

  @override
  String get settingsAboutReconnect => '自动重新连接采用有上限的退避策略。';

  @override
  String get settingsAboutReplay => '加密的重放游标有助于找回错过的事件。断线后，无法确认的操作不会被悄悄重新发送。';

  @override
  String get settingsAboutRuntimeDrop => '手机连接短暂中断时，运行环境可以继续工作。';

  @override
  String get settingsAboutShutdown => '桥接程序收到 `SIGINT` 和 `SIGTERM` 时会正常关闭。';

  @override
  String get settingsAboutDesktop => '桌面应用集成';

  @override
  String get settingsAboutDesktopRollout =>
      'Codex 会把手机上的对话保存为已配对设备上的会话 rollout 文件。';

  @override
  String get settingsAboutDesktopHandoff =>
      '桌面应用可能不会实时加载外部写入的内容。请在 DJL 中使用**在电脑上继续**来接续当前对话。';

  @override
  String get settingsAboutDjl => '关于 DJL';

  @override
  String get settingsOpenSource => '开源';

  @override
  String get settingsMitLicense => 'MIT 许可证';

  @override
  String get hostYourMac => '你的 Mac';

  @override
  String get hostUpdating => 'Mac 上的 DJL 正在更新。完成后这台手机会自动重新连接。';

  @override
  String get hostCheckingVersion => '正在检查 Mac 上的 DJL 版本…';

  @override
  String hostNowVersion(String version) {
    return 'Mac 上的 DJL 现在是 $version。';
  }

  @override
  String hostStillVersion(String version) {
    return 'Mac 上的 DJL 仍是 $version，可能已经是最新版本。';
  }

  @override
  String get hostConnectedFooter => '你的对话会直接发送到 Mac 上的 DJL，全程端到端加密。';

  @override
  String get hostReconnectFooter => '在你的 Mac 上打开 DJL 即可重新连接。';

  @override
  String get hostDjlVersion => 'DJL 版本';

  @override
  String get hostCheckFailedNow => '刚才无法检查你的 Mac。';

  @override
  String get hostReconnecting => '正在重新连接…';

  @override
  String get hostWakeScreen => '唤醒屏幕';

  @override
  String get hostWakeScreenDetail => '在 DJL 运行时点亮你的 Mac 屏幕。';

  @override
  String get hostKeepAwake => '让 Mac 保持唤醒';

  @override
  String get hostKeepAwakeDetail => 'DJL 打开期间防止你的 Mac 进入睡眠。建议在充电时使用。';

  @override
  String get hostUpdates => '更新';

  @override
  String get hostUpdateDjl => '更新 DJL';

  @override
  String get hostUpdateDjlDetail => '在你的 Mac 上安装最新版 DJL，然后重新连接。';

  @override
  String get hostNotConnected => '未连接';

  @override
  String get hostConnectedChecking => '已连接 · 正在检查';

  @override
  String get hostConnected => '已连接';

  @override
  String hostStatusLabel(String status) {
    return 'Mac 上的 DJL，$status';
  }

  @override
  String get hostDjlOnYourMac => 'Mac 上的 DJL';

  @override
  String get hostUpdateTitle => '要更新 Mac 上的 DJL 吗？';

  @override
  String hostUpdateCurrent(String version) {
    return '你的 Mac 上的 DJL 版本为 $version。';
  }

  @override
  String get hostUpdateBody => 'DJL 会在你的 Mac 上重启以安装最新版本。这台手机会短暂断开，然后自动重新连接。';

  @override
  String get hostUpdate => '更新';

  @override
  String get hostContinueOnDesktop => '在电脑上继续';

  @override
  String get hostContinueTitle => '要在电脑上继续吗？';

  @override
  String get hostContinueBody => '在 Mac 上的 DJL 中打开这个对话。';

  @override
  String get hostContinue => '继续';

  @override
  String get hostActionFinished => '操作已完成。';

  @override
  String get hostErrorUnsupported => 'Mac 上的 DJL 暂不支持此操作。请更新 Mac 上的 DJL。';

  @override
  String get hostErrorRefused => '你的 Mac 拒绝了此操作。请检查 Mac 上的 DJL 后重试。';

  @override
  String get hostErrorUncertain => '无法确定操作是否成功。请先检查你的 Mac 再重试。';

  @override
  String get hostCheckFailed => '无法检查你的 Mac。请重试。';

  @override
  String get hostCheckingFirst => '正在检查你的 Mac，请稍后再试。';

  @override
  String get hostConnectFirst => '请先连接你的 Mac。';

  @override
  String get hostNotConfirmed => '你的 Mac 没有确认此操作。请先检查再重试。';

  @override
  String get hostOpenedOnMac => '已在 Mac 上的 DJL 中打开。';

  @override
  String get hostReconnectFirst => '请先重新连接你的 Mac。';

  @override
  String get hostReachFailed => '无法连接 Mac 上的 DJL。请确认它已打开，然后重试。';

  @override
  String get hostWaking => '你的 Mac 屏幕正在唤醒。';

  @override
  String get hostPrefReadFailed => '无法读取已保存的偏好。请重试。';

  @override
  String get hostPrefSaveFailed => '无法保存此偏好，之前的选择保持不变。请重试。';

  @override
  String get hostPrefUnconfirmed => '已保存在这台手机上，但你的 Mac 尚未确认。';

  @override
  String get pushTitle => '推送通知';

  @override
  String get pushUnsupported => '这台手机暂时无法接收 DJL 的推送通知。请打开 DJL 查看智能体是否已完成。';

  @override
  String get pushDenied => 'DJL 的通知已在手机“设置”中关闭。';

  @override
  String get pushReady => '智能体完成任务或需要你回复时通知你。';

  @override
  String get pushSimulator => '此模拟器无法接收推送通知。';

  @override
  String get pushUnavailableVersion => '此版本暂不支持推送通知。';

  @override
  String get pushFailed => '无法开启通知。请在联网后重试。';

  @override
  String get pushUnavailableNow => '推送通知暂时不可用。';

  @override
  String get pushReadFailed => '无法读取通知偏好。请重试。';

  @override
  String get pushUpdateFailed => '无法更新通知偏好。请重试。';

  @override
  String get whatsNewTitle => '新功能';

  @override
  String get whatsNewIntro => '以下是 DJL 的新变化。';

  @override
  String get whatsNewOnce => '每个版本只会显示一次。';

  @override
  String get whatsNewGotIt => '知道了';

  @override
  String get whatsNewDismiss => '关闭更新说明';

  @override
  String get whatsNew100Design => '更沉静的黑白设计。';

  @override
  String get whatsNew100Groups => '群聊：同时与多个智能体对话，实时查看它们的回复。';

  @override
  String get whatsNew100Files => '可以在群聊中发送文件和照片。';

  @override
  String get whatsNew100Mac => '对话会直接发送到 Mac 上的 DJL。';

  @override
  String get accountSomethingWrong => '出了点问题';

  @override
  String get accountTypeDeleteToConfirm => '请输入 DELETE 以确认。';

  @override
  String get accountOk => '好';

  @override
  String get accountDone => '完成';

  @override
  String get accountEmail => '邮箱';

  @override
  String get accountPlan => '套餐';

  @override
  String get accountCredits => '额度';

  @override
  String get accountUsageFooter =>
      '使用一次储备重置后，两项限额都会重新计算，并重新开始你的一周。储备重置在发放 90 天后过期。';

  @override
  String get accountFiveHourLimit => '5 小时限额';

  @override
  String get accountWeeklyLimit => '每周限额';

  @override
  String get accountBankedResets => '储备重置';

  @override
  String accountNextExpires(String date, String year) {
    return '下次过期：$year 年 $date';
  }

  @override
  String get accountNone => '无';

  @override
  String accountUseOne(int count) {
    return '使用 1 次（共 $count 次）';
  }

  @override
  String get accountDeleteFooter => '删除账号会移除你的对话、文件和额度。30 天内可联系客服撤销。';

  @override
  String get accountSignOut => '退出登录';

  @override
  String get accountDelete => '删除账号';

  @override
  String accountUsedPercent(int percent) {
    return '已用 $percent%';
  }

  @override
  String get accountResetsNow => '现在重置';

  @override
  String get accountResetsTomorrow => '明天重置';

  @override
  String get accountResetsYesterday => '昨天已重置';

  @override
  String get accountResetsNextWeek => '下周重置';

  @override
  String get accountResetsLastWeek => '上周已重置';

  @override
  String accountResetsIn(String quantity) {
    return '$quantity后重置';
  }

  @override
  String accountResetsAgo(String quantity) {
    return '$quantity前已重置';
  }

  @override
  String accountSeconds(int count) {
    return '$count 秒';
  }

  @override
  String accountMinutes(int count) {
    return '$count 分钟';
  }

  @override
  String accountHours(int count) {
    return '$count 小时';
  }

  @override
  String accountDays(int count) {
    return '$count 天';
  }

  @override
  String accountWeeks(int count) {
    return '$count 周';
  }

  @override
  String get accountDeleteTitle => '要删除你的账号吗？';

  @override
  String get accountDeleteBody => '30 天后将无法撤销。请输入 DELETE 以确认。';

  @override
  String get accountTypeDelete => '输入 DELETE';

  @override
  String get accountSignOutTitle => '要退出 DJL Cloud 吗？';

  @override
  String get notificationsTitle => '通知';

  @override
  String get notificationsMarkAllRead => '全部标为已读';

  @override
  String get notificationsCaughtUp => '没有新通知';

  @override
  String get notificationsEmptyHint => '已完成的任务会显示在这里。';

  @override
  String get notificationsTaskComplete => '任务已完成';

  @override
  String get notificationsLoadMore => '加载更多';

  @override
  String notificationsStatus(String status) {
    String _temp0 = intl.Intl.selectLogic(status, {
      'succeeded': '已完成',
      'failed': '失败',
      'other': '$status',
    });
    return '$_temp0';
  }

  @override
  String get notificationsTaskStopped => '任务已停止';

  @override
  String get notificationsTaskFinished => '任务已完成';

  @override
  String get notificationsOpenResult => '打开 DJL 查看结果';

  @override
  String get notificationsDismiss => '关闭通知';

  @override
  String get reportOffensive => '冒犯或仇恨内容';

  @override
  String get reportHarmful => '有害或危险内容';

  @override
  String get reportWrong => '错误或误导性内容';

  @override
  String get reportOther => '其他问题';

  @override
  String get reportThanks => '感谢反馈，我们会审核这条回复。';

  @override
  String get reportTitle => '举报这条回复';

  @override
  String get reportRateLimited => '举报过于频繁，请稍后再试。';

  @override
  String get reportFailed => '无法发送举报。请重试。';

  @override
  String get reportIntro => 'DJL 会审核举报，确保回复安全。这条回复有什么问题？';

  @override
  String get reportDetailsHint => '补充详情（可选）';

  @override
  String get reportSending => '正在发送…';

  @override
  String get reportSend => '发送举报';

  @override
  String get attachmentsNoApp => '没有可以打开此文件的应用。请选择一个应用来发送。';

  @override
  String get attachmentsOpenFailed => '无法打开此文件';

  @override
  String get attachmentsCheckMac => '请确认你的 Mac 已连接，然后重试。';

  @override
  String get attachmentsImageUnshowable => '此图片无法在这里显示';

  @override
  String get attachmentsOpenElsewhere => '在其他应用中打开';

  @override
  String get attachmentsOpen => '打开';

  @override
  String get attachmentsShare => '分享';

  @override
  String get imagesSquare => '方形';

  @override
  String get imagesLandscape => '横向';

  @override
  String get imagesPortrait => '纵向';

  @override
  String get imagesOnePerRequest => '每次生成一张图片。DJL 处理期间你可以离开对话。';

  @override
  String get imagesCreate => '生成图片';

  @override
  String get imagesMakeYours => '创作属于你的作品。';

  @override
  String get imagesDescribe => '描述你想要的主体、风格和细节。';

  @override
  String get imagesPromptHint => '晨光中安静的工作室…';

  @override
  String get imagesShape => '比例';

  @override
  String get imagesNotConfigured => '此服务器尚未配置图片生成功能。你已保存的图片仍可使用。';

  @override
  String get imagesStarting => '正在开始…';

  @override
  String get imagesOpenImage => '打开图片';

  @override
  String get imagesGenerated => '生成的图片';

  @override
  String get imagesOpenChat => '打开对话';

  @override
  String get imagesActions => '图片操作';

  @override
  String get imagesEditInChat => '在对话中编辑';

  @override
  String get imagesTitle => '图片';

  @override
  String get imagesYourImages => '你的图片';

  @override
  String get imagesEmpty => '生成的图片会显示在这里，可随时保存或分享。';

  @override
  String get imagesEmptyNotConfigured => '尚未配置图片生成功能。已保存的图片会显示在这里。';

  @override
  String get imagesLoadMore => '加载更多';

  @override
  String get imagesYourImage => '你的图片';

  @override
  String get imagesShare => '分享';

  @override
  String get imagesSaveToPhotos => '保存到相册';

  @override
  String get imagesSaved => '已保存到相册。';

  @override
  String get authSocialNotConfigured => '此应用尚未配置该登录方式，请使用邮箱继续。';

  @override
  String get authSocialOpenFailed => '无法打开登录页面，请重试。';

  @override
  String get authSignInOptionsFailed => '无法加载登录方式。';

  @override
  String get authCloudSignInFailed => '无法登录 DJL Cloud，请重试。';

  @override
  String get authSecureStorageFailed => '无法打开安全存储。请解锁设备后重试。';

  @override
  String get authCheckEmailForCode => '请查看邮箱中的验证码。';

  @override
  String get authRequestSent => '请求已发送，请查看邮箱。';

  @override
  String get authCloudDataNotCleared => '部分已保存的 Cloud 数据未能清除。';

  @override
  String get authLinkOpenFailed => '无法打开此链接，请重试。';

  @override
  String get authWelcomeTitle => '欢迎使用 DJL';

  @override
  String get authWelcomeSubtitle => '你的想法、对话和 Mac，\n尽在 DJL。';

  @override
  String get authRetrySignInOptions => '重新加载登录方式';

  @override
  String get authLoadingSignInOptions => '正在加载登录方式';

  @override
  String get authContinueWithApple => '通过 Apple 继续';

  @override
  String get authContinueWithGoogle => '通过 Google 继续';

  @override
  String get authContinueWithEmail => '通过邮箱继续';

  @override
  String get authPairWithMac => '与 Mac 配对';

  @override
  String get authNoMacHint => '没有 Mac？登录后即可通过 DJL Cloud 对话。';

  @override
  String get authTerms => '服务条款';

  @override
  String get authPrivacy => '隐私政策';

  @override
  String get authVerifyAndContinue => '验证并继续';

  @override
  String get authSignIn => '登录';

  @override
  String get authEmailMeCode => '发送验证码到邮箱';

  @override
  String get authCreateAccount => '创建账号';

  @override
  String get authSignInIncomplete => '未能完成登录，请重试。';

  @override
  String get authPassword => '密码';

  @override
  String get authEmailCode => '邮箱验证码';

  @override
  String get authName => '姓名';

  @override
  String get authEmail => '邮箱';

  @override
  String get authSixDigitCode => '6 位验证码';

  @override
  String authCodeSent(String email) {
    return '验证码已发送至 $email，10 分钟内有效。';
  }

  @override
  String get authCreateAccountHint => '密码至少 10 个字符。我们会向你的邮箱发送验证码以确认地址。';

  @override
  String get authResendCode => '重新发送验证码';

  @override
  String authResendIn(int seconds) {
    return '$seconds 秒后可重新发送';
  }

  @override
  String get authUseAnotherEmail => '使用其他邮箱';

  @override
  String get authForgotPassword => '忘记密码？';

  @override
  String get authResetPassword => '重置密码';

  @override
  String get authPasswordUpdated => '密码已更新';

  @override
  String get authSignInWithNewPassword => '请使用新密码登录。';

  @override
  String get authBackToSignIn => '返回登录';

  @override
  String get authNewPassword => '新密码';

  @override
  String get authRecoveryHint => '如果该邮箱已注册账号，我们会发送一个恢复验证码。';

  @override
  String get authRecoveryCodeHint => '请输入恢复验证码，并设置 10–256 个字符的新密码。';

  @override
  String get authSendRecoveryCode => '发送恢复验证码';

  @override
  String get chatUiWorktreeHandoffFailed => '转到工作树失败';

  @override
  String get chatUiOk => '好';

  @override
  String get chatUiSelectFolder => '选择文件夹';

  @override
  String get chatUiBrowseFolders => '浏览本地文件夹…';

  @override
  String get chatUiBranchOpenElsewhere => '分支已在别处打开';

  @override
  String chatUiBranchOpenElsewhereChat(String branch) {
    return '“$branch”已在另一个工作树中检出。请打开那个对话继续。';
  }

  @override
  String chatUiBranchOpenElsewhereSidebar(String branch) {
    return '“$branch”已在另一个工作树中检出。请从侧边栏打开那个对话继续。';
  }

  @override
  String get chatUiOpenChat => '打开对话';

  @override
  String get chatUiWorktreeChatGone => '这个工作树对话已不可用，请从侧边栏打开。';

  @override
  String get chatUiPhotoLibrary => '照片图库';

  @override
  String get chatUiTakePhoto => '拍照';

  @override
  String get chatUiPlanMode => '计划模式';

  @override
  String get chatUiFastMode => '快速模式';

  @override
  String get chatUiImage => '图片';

  @override
  String get chatUiOpensThreadLocation => '打开对话位置';

  @override
  String get chatUiDesktopChat => '电脑对话';

  @override
  String get chatUiNewThread => '新对话';

  @override
  String get chatUiHandOffToDesktop => '转到电脑上继续';

  @override
  String get chatUiHandOffToLocal => '转到本地继续';

  @override
  String get chatUiHandOffToWorktree => '转到工作树继续';

  @override
  String get chatUiGoal => '目标';

  @override
  String get chatUiForkChat => '复刻这个对话';

  @override
  String get chatUiForkIntoFolder => '复刻到另一个文件夹';

  @override
  String get chatUiForkIntoWorktree => '复刻到新的工作树';

  @override
  String get chatUiWorkspaceFiles => '工作区文件';

  @override
  String get chatUiTurnChanges => '每轮改动与恢复';

  @override
  String get chatUiRefreshFromDesktop => '从电脑刷新';

  @override
  String get chatUiDesktopDisconnected => '电脑已断开连接，你的消息尚未重新发送。';

  @override
  String get chatUiLinkedPositionUnavailable => '已加载的历史记录中找不到链接的位置。';

  @override
  String get chatUiReviewResponseChanges => '查看这条回复的具体改动';

  @override
  String get chatUiResponseUndone => '已撤销这条回复';

  @override
  String get chatUiUndoResponse => '撤销这条回复';

  @override
  String get chatUiApprovalRequired => '需要你批准';

  @override
  String get chatUiApprovalSent => '已回复，正在等待电脑。';

  @override
  String get chatUiDecline => '拒绝';

  @override
  String get chatUiApproveOnce => '批准一次';

  @override
  String get chatUiBranch => '分支';

  @override
  String get chatUiPreparingWorktree => '正在准备工作树…';

  @override
  String get chatUiNewWorktree => '新工作树';

  @override
  String chatUiGoalChip(String status, String elapsed) {
    return '目标$status · $elapsed';
  }

  @override
  String get chatUiReturnToParent => '返回上级对话';

  @override
  String chatUiReturnTo(String title) {
    return '返回“$title”';
  }

  @override
  String get chatUiAskDjl => '问问 DJL';

  @override
  String get chatUiFollowUp => '继续追问';

  @override
  String get workspaceRestoreFailed => '电脑端未确认恢复，请先刷新再重试。';

  @override
  String workspaceRestoredFiles(int count) {
    return '已恢复 $count 个文件。';
  }

  @override
  String get workspaceBackupSaved => '备份检查点已保存在你的 Mac 上。';

  @override
  String get workspaceNoLocalFolders => '这台设备上没有可用的本地文件夹。';

  @override
  String get workspaceUndoReviewChanged => '回复或连接已变化，请重新打开此确认页。';

  @override
  String get workspaceUndoPreviewFailed => '无法预览具体补丁。请先刷新确认页再重试。';

  @override
  String get workspaceUndoRepositoryChanged => '回复或仓库已变化，请重新打开此确认页。';

  @override
  String get workspaceUndoResultUnknownChanged => '连接或回复已变化，撤销结果未知；请刷新后查看。';

  @override
  String get workspaceUndoRefused => '电脑端未撤销此回复。请查看当前的冲突和已暂存文件。';

  @override
  String get workspaceUndoResultUnknown => '撤销结果未知。请先刷新并查看具体补丁，再尝试一次。';

  @override
  String get workspaceUndoSaveAfterSuccessFailed =>
      '撤销已成功，但保存或刷新本地结果失败。请重新连接以核对文件。';

  @override
  String get workspaceUndoSaveFailed => '无法保存撤销结果。请重新连接并查看当前文件。';

  @override
  String get workspaceUndoTitle => '撤销此回复';

  @override
  String workspaceUndoWorkspace(String path) {
    return '工作区：$path';
  }

  @override
  String get workspaceUndoIntro =>
      '请查看此回复做出的具体改动。在反向补丁可以应用的地方，之后的编辑会保留。确认时，电脑端会再次检查冲突。';

  @override
  String get workspaceUndoOverlap => '其他回复也改动了这些文件。请仔细查看：撤销可能会影响此对话或其他对话中的改动。';

  @override
  String get workspaceUndoUncertain => '上一次撤销的结果未知。请先刷新此确认页并检查当前文件，再确认重试。';

  @override
  String get workspaceUndoStale => '此确认页已过期。请关闭后重新打开该回复。';

  @override
  String get workspaceUndoDone => '此回复已撤销。';

  @override
  String workspaceUndoStagedBlock(String files) {
    return '已暂存的文件阻止了撤销：$files';
  }

  @override
  String workspaceUndoConflict(String conflict) {
    return '冲突：$conflict';
  }

  @override
  String get workspaceUndoCannotReverse => '电脑端无法安全地撤销此补丁。';

  @override
  String get workspaceClose => '关闭';

  @override
  String get workspaceRefreshReview => '刷新确认页';

  @override
  String get workspaceUndoResponse => '撤销回复';

  @override
  String get workspaceConflictFallback => '冲突';

  @override
  String get workspaceAlreadyUndone => '此回复已经撤销过了。';

  @override
  String get workspaceStillRunning => '此回复仍在进行中。';

  @override
  String get workspaceNoDesktopWorkspace => '此回复没有对应的电脑工作区。';

  @override
  String get workspaceNoPatchCaptured => '未捕获到可支持的回复补丁。';

  @override
  String get workspaceRestoreTitle => '将工作区恢复到这一轮之前？';

  @override
  String get workspaceRestoreBody =>
      '这会替换当前的工作区文件，并删除未跟踪的文件。恢复前请查看受影响的文件。Mac 会先保存一个备份检查点。';

  @override
  String get workspaceNoAffectedFiles => '没有报告受影响的文件。';

  @override
  String get workspaceStagedFiles => '已暂存的文件';

  @override
  String get workspaceUntrackedFiles => '未跟踪的文件';

  @override
  String get workspaceRestoreFiles => '恢复文件';

  @override
  String get workspaceTurnChanges => '本轮改动';

  @override
  String get workspaceReloadTurnChanges => '重新加载本轮改动';

  @override
  String get workspaceConversationTurn => '对话轮次';

  @override
  String workspaceTurnNumber(int number) {
    return '第 $number 轮';
  }

  @override
  String get workspaceNoSavedChanges => '这一轮没有保存的改动。';

  @override
  String get workspaceNoCompletedTurns => '还没有已完成的轮次。';

  @override
  String get workspaceChooseTurn => '选择一个轮次，查看它保存的工作区改动。';

  @override
  String get workspaceStopBeforeRestore => '请先停止正在进行的这一轮，再恢复文件。';

  @override
  String get workspacePreviewRestore => '预览恢复到这一轮之前';

  @override
  String get workspaceFileFallbackTitle => '工作区文件';

  @override
  String get workspaceCopyFileContents => '复制文件内容';

  @override
  String get workspaceFileContentsCopied => '文件内容已复制。';

  @override
  String get workspaceReloadFile => '重新加载文件';

  @override
  String get workspaceFilePathOnMac => '你的 Mac 上的文件路径';

  @override
  String get workspaceSegmentText => '文本';

  @override
  String get workspaceSegmentImage => '图片';

  @override
  String get workspaceOpen => '打开';

  @override
  String get workspaceSvgRenderFailed => '无法显示这个 SVG。';

  @override
  String get workspaceImageRenderFailed => '这台设备无法显示这种图片格式。';

  @override
  String get workspaceOpenFileToPreview => '打开一个工作区文件即可预览。';

  @override
  String get workspaceSavedToPhotos => '已保存到照片。';

  @override
  String get workspaceImageTitle => '图片';

  @override
  String get workspaceOk => '好';

  @override
  String get workspaceLoadingFile => '正在加载文件';

  @override
  String get workspaceUnableToLoadFile => '无法加载文件。';

  @override
  String get workspaceRetry => '重试';

  @override
  String get workspaceCloseFilePreview => '关闭文件预览';

  @override
  String get workspaceDone => '完成';

  @override
  String get workspaceFindInFile => '在文件中查找';

  @override
  String workspaceLineCount(int count) {
    return '$count 行';
  }

  @override
  String workspaceByteCount(int count) {
    return '$count 字节';
  }

  @override
  String get workspaceCloseSvgPreview => '关闭 SVG 预览';

  @override
  String get workspaceReloadSvgPreview => '重新加载 SVG 预览';

  @override
  String get workspaceShare => '分享';

  @override
  String get workspaceSaveToPhotos => '保存到照片';

  @override
  String get workspaceUnableToDisplayImage => '无法显示图片。';

  @override
  String get workspaceFileContents => '文件内容';

  @override
  String get workspaceSearching => '正在搜索…';

  @override
  String workspaceMatchPosition(int index, int total) {
    return '$index/$total';
  }

  @override
  String get workspacePreviousMatch => '上一个匹配';

  @override
  String get workspaceNextMatch => '下一个匹配';

  @override
  String get workspaceCloseFind => '关闭查找';

  @override
  String get workspaceAddLocalFolder => '添加本地文件夹';

  @override
  String get workspaceCreateFolderOnMac => '在 Mac 上新建文件夹';

  @override
  String get workspaceUse => '使用';

  @override
  String get workspaceParentFolder => '上级文件夹';

  @override
  String get workspaceSearchingFolders => '正在搜索文件夹…';

  @override
  String get workspaceLoading => '正在加载';

  @override
  String get workspaceNoMatchingFolders => '此文件夹下没有匹配的文件夹。';

  @override
  String get workspaceNoChildFolders => '这里没有子文件夹。';

  @override
  String get workspaceSearchFolders => '搜索文件夹';

  @override
  String get workspaceClearFolderSearch => '清除文件夹搜索';

  @override
  String get workspaceLocations => '位置';

  @override
  String get workspaceCurrentFolder => '当前文件夹';

  @override
  String get workspaceLoadingFolders => '正在加载文件夹…';

  @override
  String get workspaceNoFolderSelected => '未选择文件夹。';

  @override
  String get workspaceMatchingFolders => '匹配的文件夹';

  @override
  String get workspaceFolders => '文件夹';

  @override
  String get workspaceNewFolder => '新建文件夹';

  @override
  String get workspaceNewFolderBody => '在你的设备上创建这个文件夹，并在其中开始对话。';

  @override
  String get workspaceFolderName => '文件夹名称';

  @override
  String get workspaceCreate => '创建';

  @override
  String get workspaceDesktopChangedPicker => '已连接的电脑已变化，请重新打开项目选择器。';

  @override
  String get workspaceDesktopChanged => '已连接的电脑已变化，请重新打开此工作区。';

  @override
  String get workspaceChooseWorkspaceFirst => '请先在电脑上选择一个工作区。';

  @override
  String get workspaceNoTextInPreview => '文件预览中没有文本。请从工作区重新加载。';

  @override
  String get workspaceNoImageInPreview => '图片预览中没有图片数据。请从工作区重新加载。';

  @override
  String get workspaceRestorePreviewOtherWorkspace => '此恢复预览属于另一个工作区，请重新预览。';

  @override
  String get cloudChatNewChat => '新对话';

  @override
  String get cloudChatLostConnection => '连接已断开。轻点“重新连接”以继续接收回复。';

  @override
  String get cloudChatImageToEdit => '待编辑的图片';

  @override
  String get cloudChatNoContent => '没有回复内容。';

  @override
  String get cloudChatThinking => '正在思考…';

  @override
  String get cloudChatResponseStopped => '回复已停止。';

  @override
  String get cloudChatResponseFailed => '回复失败。';

  @override
  String get cloudChatWaitingForUsageReset => '正在等待用量重置。';

  @override
  String get cloudChatModelChoiceLoadFailed => '无法加载你保存的模型选择，请重试。';

  @override
  String get cloudChatModelChoiceSaveFailed => '无法保存你的模型选择，请重试。';

  @override
  String get cloudChatDraftSaveFailed => '无法保存草稿。请保留这里的文字并重试。';

  @override
  String get cloudChatDraftLoadFailed => '无法加载已保存的草稿，请先重试再编辑。';

  @override
  String get cloudChatInterruptedImage => '中断的图片请求已安全保存。重试即可查看结果。';

  @override
  String get cloudChatInterruptedMessage => '中断的消息已安全保存。重试即可查看结果。';

  @override
  String get cloudChatModelCannotViewImages => '发送此附件前，请选择一个能识别图片的模型。';

  @override
  String get cloudChatImageGenerationUnavailable => '此服务未配置图片生成功能。';

  @override
  String get cloudChatUseBankedResetTitle => '要使用一次储备的重置吗？';

  @override
  String get cloudChatUseBankedResetBody =>
      '你的 5 小时额度和每周额度将立即重新计算，本周也将从今天重新开始。';

  @override
  String get cloudChatUseReset => '使用重置';

  @override
  String get cloudChatLimitFreesSoon => '额度很快就会恢复。';

  @override
  String get cloudChatResetsNow => '额度现在已重置。';

  @override
  String get cloudChatResetsTomorrow => '额度将于明天重置。';

  @override
  String cloudChatResetsInDays(int days) {
    return '额度将于 $days 天后重置。';
  }

  @override
  String cloudChatResetsOn(String date) {
    return '额度将于 $date 重置。';
  }

  @override
  String get cloudChatResetsInAMoment => '额度马上就会重置。';

  @override
  String cloudChatResetsInMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: '额度将于 $minutes 分钟后重置。',
    );
    return '$_temp0';
  }

  @override
  String cloudChatResetsInHours(int hours) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: '额度将于 $hours 小时后重置。',
    );
    return '$_temp0';
  }

  @override
  String get cloudChatUsageLimitReached => '你已达到用量上限';

  @override
  String get cloudChatRetryUsage => '重新加载用量';

  @override
  String cloudChatUseBankedReset(int count) {
    return '使用储备的重置（剩余 $count 次）';
  }

  @override
  String get cloudChatPickerFailed => '无法打开选择器，请重试。';

  @override
  String get cloudChatModel => '模型';

  @override
  String get cloudChatShareLink => '分享链接';

  @override
  String get cloudChatTaskPrompt => '想让 DJL 做什么？';

  @override
  String get cloudChatHowCanIHelp => '有什么可以帮你？';

  @override
  String get cloudChatTaskHint => '开始一个任务，完成后再回来查看结果。';

  @override
  String cloudChatStepProgress(String step, String total) {
    return '第 $step 步，共 $total 步';
  }

  @override
  String get cloudChatRetry => '重试';

  @override
  String get cloudChatRetryDraft => '重试草稿';

  @override
  String get cloudChatRetryModelChoice => '重新加载模型选择';

  @override
  String get cloudChatMessageHint => '给 DJL 发消息';

  @override
  String get cloudChatAttachTooltip => '添加文件或图片';

  @override
  String get cloudChatCreateImage => '生成图片';

  @override
  String get cloudChatChooseFile => '选择文件';

  @override
  String get cloudChatPhotoLibrary => '照片图库';

  @override
  String get cloudChatCamera => '相机';

  @override
  String get cloudChatTaskMode => '任务模式';

  @override
  String get cloudChatTask => '任务';

  @override
  String get cloudChatStopDictation => '停止听写';

  @override
  String get cloudChatStartDictation => '开始听写';

  @override
  String get cloudChatStopResponse => '停止回复';

  @override
  String get cloudChatSendMessage => '发送消息';

  @override
  String get cloudChatEditMessage => '编辑消息';

  @override
  String get cloudChatSend => '发送';

  @override
  String get cloudChatDisableWordWrap => '关闭自动换行';

  @override
  String get cloudChatEnableWordWrap => '开启自动换行';

  @override
  String get cloudChatCopied => '已复制';

  @override
  String get cloudChatCopyCode => '复制代码';

  @override
  String get cloudChatCodeLabel => '代码';

  @override
  String get cloudChatEdit => '编辑';

  @override
  String get cloudChatPreviousBranch => '上一个版本';

  @override
  String get cloudChatNextBranch => '下一个版本';

  @override
  String get cloudChatCopyMessage => '复制消息';

  @override
  String get cloudChatRegenerateReply => '重新生成回复';

  @override
  String get cloudChatStopReading => '停止朗读';

  @override
  String get cloudChatReadAloud => '朗读';

  @override
  String get cloudChatReportAnswer => '举报此回复';

  @override
  String cloudChatToolResult(String name, String status) {
    return '$name · $status';
  }

  @override
  String get cloudChatToolFailed => '失败';

  @override
  String get cloudChatToolDone => '完成';

  @override
  String get cloudChatNeedsNewerVersion => '此消息包含需要新版本才能显示的内容。';

  @override
  String get cloudChatImageUnavailableRetry => '图片不可用 · 重试';

  @override
  String get cloudChatConversationImage => '对话图片';

  @override
  String get cloudChatImageDisplayFailed => '无法显示这张图片。';

  @override
  String get cloudChatShareFailed => '无法打开分享，请重试。';

  @override
  String get cloudChatShareLinkCreated => '分享链接已创建';

  @override
  String get cloudChatShareLinkBody => '任何拿到链接的人都可以查看此对话的当前内容。之后发送的消息不会被分享。';

  @override
  String get cloudChatCopyLink => '复制链接';

  @override
  String get cloudChatShare => '分享';

  @override
  String get conversationsPinned => '已置顶';

  @override
  String get conversationsPinnedEmpty => '长按对话即可置顶。';

  @override
  String get conversationsRecentEmpty => '你的对话会显示在这里。';

  @override
  String get conversationsCloudConversationHint => 'Cloud 对话';

  @override
  String get conversationsChat => '对话';

  @override
  String get conversationsSearchChats => '搜索对话';

  @override
  String get conversationsRemote => '远程';

  @override
  String get conversationsRecentChats => '最近对话';

  @override
  String get conversationsLoadMore => '加载更多';

  @override
  String get conversationsSettings => '设置';

  @override
  String get conversationsArchivedChats => '已归档的对话';

  @override
  String get conversationsRestore => '恢复';

  @override
  String get conversationsNoArchivedChats => '没有已归档的对话';

  @override
  String get conversationsPin => '置顶';

  @override
  String get conversationsUnpin => '取消置顶';

  @override
  String get conversationsRename => '重命名';

  @override
  String get conversationsArchive => '归档';

  @override
  String get conversationsDelete => '删除';

  @override
  String get conversationsDeleteChatQuestion => '要删除此对话吗？';

  @override
  String get plansCompleted => '已完成';

  @override
  String get plansInProgress => '进行中';

  @override
  String get plansPending => '待处理';

  @override
  String get plansOpenActivePlan => '打开当前计划';

  @override
  String get plansPlan => '计划';

  @override
  String plansStepOf(int current, int total) {
    return '第 $current 步，共 $total 步';
  }

  @override
  String plansStepFraction(int current, int total) {
    return '第 $current/$total 步';
  }

  @override
  String plansStatusValue(String status, String position) {
    return '$status，$position';
  }

  @override
  String get plansImage => '图片';

  @override
  String get plansActivePlan => '当前计划';

  @override
  String get plansDone => '完成';

  @override
  String get plansNoLongerAvailable => '此计划已不可用。';

  @override
  String get plansProposedPlan => '建议的计划';

  @override
  String get plansCollapsePlan => '收起计划';

  @override
  String get plansExpandPlan => '展开计划';

  @override
  String get plansCollapse => '收起';

  @override
  String get plansExpand => '展开';

  @override
  String get plansStarting => '正在开始…';

  @override
  String get plansImplement => '开始实施';

  @override
  String get plansNextStepQuestion => '接下来要让 Codex 做什么？';

  @override
  String get plansNextStepHeader => '下一步';

  @override
  String get voiceAllowMicrophone => '请在设备设置中允许使用麦克风和语音识别，以便听写。';

  @override
  String get voiceDictationUnavailable => '此语言或设备不支持本地听写。你仍然可以手动输入消息。';

  @override
  String get voiceSpeechAccessRequired =>
      '请在设备设置中允许使用麦克风和语音识别，并确保你的语言支持本地语音识别。';

  @override
  String get voiceInputUnavailable => '语音输入不可用。你仍然可以手动输入消息。';

  @override
  String get voiceStopFailed => '无法停止语音输入。';

  @override
  String get voicePlaybackUnavailable => '此设备无法朗读。';

  @override
  String get voiceStopUnclean => '语音未能正常停止。请先关闭此页面再继续。';

  @override
  String get goalsStatusActive => '进行中';

  @override
  String get goalsStatusPaused => '已暂停';

  @override
  String get goalsStatusBlocked => '受阻';

  @override
  String get goalsStatusUsageLimited => '已达用量上限';

  @override
  String get goalsStatusBudgetLimited => '已达预算上限';

  @override
  String get goalsStatusComplete => '已完成';

  @override
  String goalsTokenUsage(String used, String budget) {
    return '$used / $budget Token';
  }

  @override
  String get goalsUnsupported => '当前运行环境不支持目标。请在你的 Mac 上更新 Codex 并开启目标功能。';

  @override
  String get goalsEphemeral => '目标需要已保存的对话，而这是一个临时对话。';

  @override
  String get goalsDesktopChanged => '已连接的电脑已变化，请重新打开此目标。';

  @override
  String get goalsOtherChatGoal => '运行环境返回了另一个对话的目标。';

  @override
  String get goalsBudgetInvalid => 'Token 预算必须是正整数。';

  @override
  String get goalsUnexpectedResponse => '运行环境返回了意外的目标响应。';

  @override
  String get goalsReconnect => '请重新连接电脑，再管理此目标。';

  @override
  String get goalsDescribeFirst => '请先描述目标。';

  @override
  String get goalsReplaceTitle => '替换当前目标？';

  @override
  String get goalsReplaceBody => '这个目标尚未完成。替换后会开始一个新目标，并重新计算用量。';

  @override
  String get goalsReplaceAction => '替换目标';

  @override
  String get goalsClearTitle => '清除此目标？';

  @override
  String get goalsClearBody => '电脑端将停止推进这个目标，并清除它的进度记录。';

  @override
  String get goalsClearAction => '清除目标';

  @override
  String get goalsTitle => '目标';

  @override
  String get goalsReload => '重新加载目标';

  @override
  String get goalsShowingLastKnown => '正在显示最近一次获取的目标。重新连接后即可管理。';

  @override
  String get goalsNewGoal => '新目标';

  @override
  String get goalsEditGoal => '编辑目标';

  @override
  String get goalsDescribeHint => '描述想要的结果、如何验证，以及哪些地方不能退步。';

  @override
  String get goalsObjective => '目标内容';

  @override
  String get goalsBudgetLabel => 'Token 预算（可选）';

  @override
  String get goalsBudgetHelper => '留空表示不设 Token 预算。';

  @override
  String get goalsStart => '开始目标';

  @override
  String get goalsSave => '保存目标';

  @override
  String get goalsCancelEditing => '取消编辑';

  @override
  String goalsTokensRemaining(String tokens) {
    return '剩余 $tokens Token';
  }

  @override
  String get goalsActiveExplainer => '对话空闲时，电脑端会继续推进这个目标，直到完成、暂停或达到上限。';

  @override
  String get goalsPause => '暂停目标';

  @override
  String get goalsResume => '继续目标';

  @override
  String get goalsEditObjective => '编辑目标内容';

  @override
  String get groupsKindSpreadsheet => '表格';

  @override
  String get groupsKindText => '文本';

  @override
  String get groupsKindArchive => '压缩包';

  @override
  String get groupsKindImage => '图片';

  @override
  String get groupsKindVideo => '视频';

  @override
  String get groupsKindAudio => '音频';

  @override
  String get groupsKindFile => '文件';

  @override
  String get groupsMacUnreachable => '无法连接你的 Mac，请重试。';

  @override
  String get groupsCreateFailed => '无法创建群聊，请重试。';

  @override
  String get groupsNewGroup => '新建群聊';

  @override
  String get groupsChooseMembers => '选择要加入群聊的成员。';

  @override
  String get groupsNameOptional => '名称（可选）';

  @override
  String get groupsCreateGroup => '创建群聊';

  @override
  String groupsCreateGroupWith(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '创建群聊（$count 个智能体）',
    );
    return '$_temp0';
  }

  @override
  String get groupsSignInOnMac => '请先在 Mac 上登录后再使用';

  @override
  String get groupsUpdateMacTitle => '请更新 Mac 上的 DJL';

  @override
  String get groupsUpdateMacBody => '群聊需要 Mac 上安装最新版 DJL。请先在 Mac 上更新，然后再回来。';

  @override
  String get groupsConnectMacTitle => '连接你的 Mac';

  @override
  String get groupsConnectMacBody => '群聊保存在你的 Mac 上，连接后就会显示在这里。';

  @override
  String get groupsLoadFailed => '无法加载你的群聊';

  @override
  String get groupsEmptyTitle => '把你的智能体拉进同一个群聊';

  @override
  String get groupsEmptyBody => '只需提问一次，Claude、Codex 和其他智能体就会一起回复。';

  @override
  String groupsMemberWriting(String name) {
    return '$name 正在输入';
  }

  @override
  String groupsAgentsWriting(int count) {
    return '$count 个智能体正在输入';
  }

  @override
  String get groupsPausedWaiting => '已暂停，等你决定';

  @override
  String groupsAgentCount(int count) {
    return '$count 个智能体';
  }

  @override
  String get groupsMacDidNotKeepFile => '你的 Mac 没有保存这个文件。';

  @override
  String get groupsFileStillSending => '这个文件仍在发送中。';

  @override
  String get groupsMacTimeout => '你的 Mac 没有及时响应。请确认 Mac 上的 DJL 已打开。';

  @override
  String get groupsMacNotConnected => '你的 Mac 当前未连接。';

  @override
  String groupsRemoveAttachment(String name) {
    return '移除“$name”';
  }

  @override
  String get groupsSendingFiles => '正在发送文件';

  @override
  String groupsImageNamed(String name) {
    return '图片 $name';
  }

  @override
  String get groupsAttach => '添加附件';

  @override
  String get groupsPhotos => '照片';

  @override
  String get groupsFiles => '文件';

  @override
  String groupsFileUnsupported(String name) {
    return '无法发送“$name”。支持照片、PDF、Word、Excel、PowerPoint、文本和代码文件。';
  }

  @override
  String groupsFileTooLarge(String name, String size) {
    return '“$name”超过了 $size。';
  }

  @override
  String groupsTooManyFiles(int count) {
    return '每条消息最多可附带 $count 个文件。';
  }

  @override
  String get groupsOpenFailed => '无法打开，请重试。';

  @override
  String get groupsAskEveryoneTitle => '要问所有人吗？';

  @override
  String groupsAskEveryoneBody(int count) {
    return '全部 $count 个智能体都会回复这条消息。';
  }

  @override
  String get groupsDontAskAgain => '不再询问';

  @override
  String get groupsAskEveryone => '问所有人';

  @override
  String get groupsGroupGone => '这个群聊已不在你的 Mac 上。';

  @override
  String groupsSayHelloPrompt(String everyone) {
    return '$everyone 用一句话打个招呼。';
  }

  @override
  String get groupsReconnectingToMac => '正在重新连接你的 Mac…';

  @override
  String groupsHeaderLabel(String name, int count) {
    return '$name，$count 个智能体';
  }

  @override
  String get groupsMembers => '成员';

  @override
  String get groupsYou => '你';

  @override
  String get groupsCouldNotReply => '未能回复';

  @override
  String get groupsNothingToAdd => '没有要补充的';

  @override
  String get groupsImageOnMac => '图片保存在你的 Mac 上';

  @override
  String get groupsRemovedAgent => '已移除的智能体';

  @override
  String get groupsWaitingTurn => '正在排队';

  @override
  String get groupsWriting => '正在输入';

  @override
  String get groupsAttachTooltip => '添加文件或照片';

  @override
  String get groupsMentionAgent => '提及智能体';

  @override
  String get groupsMessageHint => '消息';

  @override
  String get groupsStopAgents => '停止智能体';

  @override
  String get groupsEveryone => '所有人';

  @override
  String get groupsPausedTitle => '智能体已暂停';

  @override
  String get groupsPausedBody => '它们已经互相讨论了一段时间，还有话要说。';

  @override
  String get groupsEndItHere => '到此为止';

  @override
  String get groupsLetThemContinue => '让它们继续';

  @override
  String get groupsOfflineHint => '连接 Mac 后，消息会显示在这里。';

  @override
  String get groupsLoadingMessages => '正在加载消息';

  @override
  String get groupsEveryoneIsHere => '大家都到齐了';

  @override
  String get groupsEmptyChatHint => '输入 @ 选择由谁回复。你的第一条消息会发给所有人。';

  @override
  String get groupsAskEveryoneToSayHello => '请大家打个招呼';

  @override
  String get groupsManageOnMac => '请在 Mac 上的 DJL 中添加或移除智能体。';

  @override
  String get groupsReady => '就绪';

  @override
  String get groupsStop => '停止';

  @override
  String get guardianLiveReason => '只有在实时会话中才能批准重试。';

  @override
  String get guardianExpiredReason => '此重试已不可用。请等待 Codex 再次请求该操作。';

  @override
  String get guardianDesktopReason => '请在 Codex 桌面端批准此重试。';

  @override
  String get guardianUnsafeReason => '此操作无法在这里安全重试，请在 Codex 中批准。';

  @override
  String get guardianSubmittedReason => '已提交重试批准。再次尝试前请先在 Codex 中确认。';

  @override
  String get guardianUncertainReason => '重试批准可能没有送达 Codex。再次尝试前请先在 Codex 中确认。';

  @override
  String get guardianRequestedAction => '请求的操作';

  @override
  String get guardianRunCommand => '运行命令';

  @override
  String get guardianApplyFileChanges => '应用文件改动';

  @override
  String guardianEditFile(String file) {
    return '编辑 $file';
  }

  @override
  String guardianEditFiles(int count, String files) {
    return '编辑 $count 个文件：$files';
  }

  @override
  String get guardianAccessNetwork => '访问网络';

  @override
  String guardianAccessHost(String host) {
    return '访问 $host';
  }

  @override
  String get guardianRequestPermissions => '请求更多权限';

  @override
  String get guardianRequestNetwork => '请求网络权限';

  @override
  String get guardianRequestFileAccess => '请求文件访问权限';

  @override
  String get guardianRequestNetworkAndFileAccess => '请求网络和文件访问权限';

  @override
  String get guardianReviewing => '正在审查';

  @override
  String get guardianApproved => '已批准';

  @override
  String get guardianDenied => '已拒绝';

  @override
  String get guardianTimedOut => '已超时';

  @override
  String get guardianStopped => '已停止';

  @override
  String guardianUpdatedStatus(String status) {
    return '已更新（$status）';
  }

  @override
  String get guardianDetailsUnavailable => '无法获取审查详情。';

  @override
  String guardianAutoReviewTitle(String status) {
    return '自动审查 · $status';
  }

  @override
  String get guardianRiskLow => '低风险';

  @override
  String get guardianRiskMedium => '中风险';

  @override
  String get guardianRiskHigh => '高风险';

  @override
  String guardianRiskOther(String level) {
    return '$level 风险';
  }

  @override
  String guardianAuthorization(String value) {
    return '授权：$value';
  }

  @override
  String get guardianApprovalRecorded => '已记录批准；重试时仍会再次审查';

  @override
  String get guardianSubmittingApproval => '正在提交重试批准…';

  @override
  String get guardianApproveOneRetry => '批准重试一次';

  @override
  String get subagentsSubagent => '子智能体';

  @override
  String get subagentsSpawnAgent => '创建智能体';

  @override
  String get subagentsWaitForAgents => '等待智能体';

  @override
  String get subagentsUpdateAgent => '更新智能体';

  @override
  String get subagentsResumeAgent => '恢复智能体';

  @override
  String get subagentsCloseAgent => '关闭智能体';

  @override
  String get subagentsActivity => '子智能体活动';

  @override
  String get subagentsMetadataUnavailable => '无法获取子智能体信息';

  @override
  String get activityCommand => '命令';

  @override
  String get activityFileChanges => '文件改动';

  @override
  String activityFilesChanged(int count) {
    return '$count 个文件有改动';
  }

  @override
  String get activityToolActivity => '工具活动';

  @override
  String get activityReadFile => '读取文件';

  @override
  String activityReadValue(String value) {
    return '读取 $value';
  }

  @override
  String get activitySearchFiles => '搜索文件';

  @override
  String activitySearchValue(String value) {
    return '搜索 $value';
  }

  @override
  String get activityListFiles => '列出文件';

  @override
  String activityListFilesValue(String value) {
    return '列出文件 $value';
  }

  @override
  String get statusTaskStatus => '任务状态';

  @override
  String get statusAllowed => '这台设备已允许显示任务状态。';

  @override
  String get statusDenied => '请在设备设置中允许显示本地任务状态。不开启也能正常对话。';

  @override
  String get statusUnsupported => '这台设备不支持任务状态。';

  @override
  String get statusChecking => '正在检查设备权限…';

  @override
  String get statusEnable => '开启任务状态';

  @override
  String get statusRefresh => '刷新任务状态';

  @override
  String get statusSystemSettings => '系统设置';

  @override
  String pairingStateLabel(String state) {
    String _temp0 = intl.Intl.selectLogic(state, {
      'disconnected': '未连接',
      'resolving': '正在查找',
      'connecting': '正在连接',
      'connected': '已连接',
      'offline': '电脑离线',
      'suspended': '已暂停',
      'other': '$state',
    });
    return '$_temp0';
  }
}
