import 'package:flutter/widgets.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// The app's single icon family. Screens name what an icon means; the glyph
/// set is chosen here.
abstract final class DjlIcons {
  // Navigation
  static const IconData back = PhosphorIconsRegular.caretLeft;
  static const IconData chevronLeft = PhosphorIconsRegular.caretLeft;
  static const IconData chevronRight = PhosphorIconsRegular.caretRight;
  static const IconData chevronUp = PhosphorIconsRegular.caretUp;
  static const IconData chevronDown = PhosphorIconsRegular.caretDown;
  static const IconData expandVertical = PhosphorIconsRegular.caretUpDown;
  static const IconData menu = PhosphorIconsRegular.list;
  static const IconData more = PhosphorIconsRegular.dotsThree;
  static const IconData close = PhosphorIconsRegular.x;
  static const IconData clear = PhosphorIconsFill.xCircle;
  static const IconData search = PhosphorIconsRegular.magnifyingGlass;
  static const IconData arrowUp = PhosphorIconsRegular.arrowUp;
  static const IconData arrowDown = PhosphorIconsRegular.arrowDown;
  static const IconData arrowRight = PhosphorIconsRegular.arrowRight;
  static const IconData arrowUpRight = PhosphorIconsRegular.arrowUpRight;
  static const IconData arrowCircleRight = PhosphorIconsFill.arrowCircleRight;
  static const IconData arrowBendLeft = PhosphorIconsRegular.arrowBendDownLeft;
  static const IconData arrowBendRight =
      PhosphorIconsRegular.arrowBendDownRight;
  static const IconData expand = PhosphorIconsRegular.arrowsOutSimple;
  static const IconData swap = PhosphorIconsRegular.arrowsLeftRight;
  static const IconData openExternal = PhosphorIconsRegular.arrowSquareOut;
  static const IconData openBrowser = PhosphorIconsRegular.browser;

  // Actions
  static const IconData add = PhosphorIconsRegular.plus;
  static const IconData check = PhosphorIconsRegular.check;
  static const IconData checkCircle = PhosphorIconsRegular.checkCircle;
  static const IconData checkCircleFill = PhosphorIconsFill.checkCircle;
  static const IconData circle = PhosphorIconsRegular.circle;
  static const IconData circleFill = PhosphorIconsFill.circle;
  static const IconData edit = PhosphorIconsRegular.pencilSimple;
  static const IconData compose = PhosphorIconsRegular.notePencil;
  static const IconData copy = PhosphorIconsRegular.copy;
  static const IconData delete = PhosphorIconsRegular.trash;
  static const IconData archive = PhosphorIconsRegular.archive;
  static const IconData pin = PhosphorIconsRegular.pushPin;
  static const IconData unpin = PhosphorIconsRegular.pushPinSlash;
  static const IconData share = PhosphorIconsRegular.export;
  static const IconData upload = PhosphorIconsRegular.uploadSimple;
  static const IconData download = PhosphorIconsRegular.downloadSimple;
  static const IconData update = PhosphorIconsRegular.arrowLineDown;
  static const IconData refresh = PhosphorIconsRegular.arrowClockwise;
  static const IconData sync = PhosphorIconsRegular.arrowsClockwise;
  static const IconData undo = PhosphorIconsRegular.arrowCounterClockwise;
  static const IconData restore = PhosphorIconsRegular.clockCounterClockwise;
  static const IconData link = PhosphorIconsRegular.link;
  static const IconData scan = PhosphorIconsRegular.qrCode;
  static const IconData power = PhosphorIconsRegular.power;

  // Playback and voice
  static const IconData play = PhosphorIconsFill.play;
  static const IconData pause = PhosphorIconsFill.pause;
  static const IconData pauseCircle = PhosphorIconsFill.pauseCircle;
  static const IconData stop = PhosphorIconsFill.stop;
  static const IconData stopCircle = PhosphorIconsRegular.stopCircle;
  static const IconData mic = PhosphorIconsRegular.microphone;
  static const IconData micActive = PhosphorIconsFill.microphone;
  static const IconData speaker = PhosphorIconsRegular.speakerHigh;
  static const IconData keyboard = PhosphorIconsRegular.keyboard;

  // Conversation
  static const IconData chat = PhosphorIconsRegular.chatCircle;
  static const IconData chatText = PhosphorIconsRegular.chatText;
  static const IconData chats = PhosphorIconsRegular.chats;
  static const IconData group = PhosphorIconsRegular.usersThree;
  static const IconData mention = PhosphorIconsRegular.at;
  static const IconData send = PhosphorIconsBold.arrowUp;
  static const IconData feedback = PhosphorIconsRegular.chatCircleDots;
  static const IconData report = PhosphorIconsRegular.flag;

  // Status
  static const IconData info = PhosphorIconsRegular.info;
  static const IconData error = PhosphorIconsRegular.warningCircle;
  static const IconData warning = PhosphorIconsRegular.warning;
  static const IconData warningFill = PhosphorIconsFill.warning;
  static const IconData clock = PhosphorIconsRegular.clock;
  static const IconData timer = PhosphorIconsRegular.timer;
  static const IconData hourglass = PhosphorIconsRegular.hourglass;
  static const IconData bell = PhosphorIconsRegular.bell;
  static const IconData bellRinging = PhosphorIconsRegular.bellRinging;
  static const IconData lock = PhosphorIconsRegular.lock;
  static const IconData shieldCheck = PhosphorIconsRegular.shieldCheck;
  static const IconData hand = PhosphorIconsRegular.hand;
  static const IconData hidden = PhosphorIconsRegular.eyeSlash;
  static const IconData hiddenFill = PhosphorIconsFill.eyeSlash;

  // Things
  static const IconData laptop = PhosphorIconsRegular.laptop;
  static const IconData desktop = PhosphorIconsRegular.desktop;
  static const IconData cloud = PhosphorIconsRegular.cloud;
  static const IconData globe = PhosphorIconsRegular.globe;
  static const IconData account = PhosphorIconsRegular.userCircle;
  static const IconData settings = PhosphorIconsRegular.gearSix;
  static const IconData appearance = PhosphorIconsRegular.paintBrush;
  static const IconData sun = PhosphorIconsRegular.sun;
  static const IconData image = PhosphorIconsRegular.image;
  static const IconData images = PhosphorIconsRegular.images;
  static const IconData document = PhosphorIconsRegular.fileText;
  static const IconData folder = PhosphorIconsRegular.folder;
  static const IconData folderAdd = PhosphorIconsRegular.folderPlus;
  static const IconData quick = PhosphorIconsRegular.lightning;
  static const IconData inbox = PhosphorIconsRegular.tray;
  static const IconData book = PhosphorIconsRegular.bookOpen;
  static const IconData mail = PhosphorIconsFill.envelope;
  static const IconData mailCode = PhosphorIconsFill.envelopeSimpleOpen;
  static const IconData tag = PhosphorIconsFill.tag;
  static const IconData diamond = PhosphorIconsFill.diamond;
  static const IconData textAlign = PhosphorIconsRegular.textAlignLeft;
  static const IconData apple = PhosphorIconsFill.appleLogo;
  static const IconData google = PhosphorIconsBold.googleLogo;

  // Developer tools, shown under "More"
  static const IconData tool = PhosphorIconsRegular.wrench;
  static const IconData terminal = PhosphorIconsRegular.terminalWindow;
  static const IconData code = PhosphorIconsRegular.code;
  static const IconData branch = PhosphorIconsRegular.gitBranch;
  static const IconData diff = PhosphorIconsRegular.gitDiff;
  static const IconData goal = PhosphorIconsRegular.target;
  static const IconData checklist = PhosphorIconsRegular.listChecks;
  static const IconData chip = PhosphorIconsRegular.cpu;
  static const IconData storage = PhosphorIconsRegular.hardDrives;
}
