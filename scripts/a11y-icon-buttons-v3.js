#!/usr/bin/env node
// A11y icon-button auto-labeler, third pass.
//
// Same brace-aware scanner as v2, with a much-expanded label dictionary
// covering construction-specific Lucide icons (HardHat, Hammer, Wrench),
// money/data icons (DollarSign, TrendingUp, BarChart3, Receipt), and
// the long tail used in MAGE.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

const ICON_TO_LABEL = {
  // Navigation
  ChevronLeft: 'Back',
  ChevronRight: 'Open',
  ChevronDown: 'Expand',
  ChevronUp: 'Collapse',
  ChevronsLeft: 'First',
  ChevronsRight: 'Last',
  ArrowLeft: 'Back',
  ArrowRight: 'Next',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowUpRight: 'Open',
  X: 'Close',
  XCircle: 'Close',
  Menu: 'Open menu',
  ExternalLink: 'Open link',
  Link: 'Open link',
  Link2: 'Open link',
  Unlink: 'Remove link',

  // CRUD / actions
  Plus: 'Add',
  PlusCircle: 'Add',
  PlusSquare: 'Add',
  Minus: 'Remove',
  MinusCircle: 'Remove',
  Edit: 'Edit',
  Edit2: 'Edit',
  Edit3: 'Edit',
  Pencil: 'Edit',
  PenTool: 'Edit',
  Trash: 'Delete',
  Trash2: 'Delete',
  Save: 'Save',
  Copy: 'Copy',
  Send: 'Send',
  Share: 'Share',
  Share2: 'Share',
  Download: 'Download',
  Upload: 'Upload',
  RefreshCw: 'Refresh',
  RefreshCcw: 'Refresh',
  RotateCw: 'Rotate',
  RotateCcw: 'Rotate',

  // Search / filter
  Search: 'Search',
  SearchX: 'Clear search',
  Filter: 'Filter',
  FilterX: 'Clear filter',
  SlidersHorizontal: 'Filter',

  // Settings / config
  Settings: 'Settings',
  Settings2: 'Settings',
  MoreHorizontal: 'More options',
  MoreVertical: 'More options',

  // Communication
  Bell: 'Notifications',
  BellOff: 'Mute notifications',
  BellRing: 'Notifications',
  Mail: 'Email',
  MailOpen: 'Email',
  MessageCircle: 'Message',
  MessageSquare: 'Message',
  Phone: 'Call',
  PhoneCall: 'Call',
  Mic: 'Record',
  MicOff: 'Stop recording',
  Inbox: 'Inbox',

  // Status / feedback
  Check: 'Confirm',
  CheckCircle: 'Confirm',
  CheckCircle2: 'Confirm',
  CheckSquare: 'Confirm',
  AlertCircle: 'Alert',
  AlertTriangle: 'Warning',
  AlertOctagon: 'Warning',
  Info: 'More info',
  HelpCircle: 'Help',
  Lightbulb: 'Tip',
  Flag: 'Flag',

  // Time / calendar
  Calendar: 'Open calendar',
  CalendarDays: 'Open calendar',
  CalendarCheck: 'Open calendar',
  CalendarClock: 'Open calendar',
  Clock: 'Open time',

  // Location / map
  MapPin: 'View location',
  Map: 'View map',
  Globe: 'Open website',
  Compass: 'Directions',
  Navigation: 'Navigation',

  // User / team
  User: 'Profile',
  UserCircle: 'Profile',
  UserPlus: 'Add user',
  Users: 'Team',

  // Auth
  LogIn: 'Sign in',
  LogOut: 'Sign out',
  Lock: 'Locked',
  Unlock: 'Unlocked',
  Key: 'Key',
  Shield: 'Security',
  ShieldCheck: 'Security verified',
  ShieldAlert: 'Security alert',

  // Files / docs
  Folder: 'Open folder',
  FolderOpen: 'Open folder',
  FolderDown: 'Download folder',
  FolderPlus: 'Add folder',
  File: 'Open file',
  FileText: 'Open document',
  FileDown: 'Download file',
  FilePlus: 'Add file',
  FileUp: 'Upload file',
  FileSignature: 'Sign document',
  FileCheck: 'Document verified',
  ClipboardList: 'Open list',
  Clipboard: 'Copy',
  BookOpen: 'Open book',

  // Money / business
  DollarSign: 'Currency',
  Wallet: 'Wallet',
  CreditCard: 'Payment method',
  Receipt: 'Receipt',
  Banknote: 'Cash',
  Percent: 'Percentage',
  TrendingUp: 'Trending up',
  TrendingDown: 'Trending down',
  BarChart: 'Chart',
  BarChart2: 'Chart',
  BarChart3: 'Chart',
  PieChart: 'Chart',
  LineChart: 'Chart',
  ShoppingCart: 'Cart',
  Store: 'Store',
  Truck: 'Shipping',
  Package: 'Package',

  // Construction (MAGE-specific)
  HardHat: 'Crew',
  Hammer: 'Tool',
  Wrench: 'Tool',
  Ruler: 'Measure',
  Building2: 'Building',
  Building: 'Building',
  Briefcase: 'Work',

  // Media
  Camera: 'Take photo',
  Image: 'Add image',
  ImageIcon: 'Add image',
  Video: 'Video',
  Play: 'Play',
  Pause: 'Pause',
  StopCircle: 'Stop',
  SkipForward: 'Skip',
  SkipBack: 'Previous',
  Volume2: 'Volume',
  VolumeX: 'Mute',

  // View
  Eye: 'Show',
  EyeOff: 'Hide',
  Maximize: 'Expand',
  Maximize2: 'Expand',
  Minimize: 'Collapse',
  Minimize2: 'Collapse',
  ZoomIn: 'Zoom in',
  ZoomOut: 'Zoom out',

  // Misc
  Heart: 'Favorite',
  Star: 'Star',
  Bookmark: 'Bookmark',
  Tag: 'Tag',
  Sparkles: 'AI',
  Crown: 'Premium',
  Award: 'Achievement',
  Trophy: 'Trophy',
  Zap: 'Power',
  Sun: 'Light mode',
  Moon: 'Dark mode',
  Cloud: 'Cloud',
  CloudOff: 'Offline',
  GitBranch: 'Branch',
  Target: 'Target',
};

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function findOpenTagEnd(src, start) {
  let depth = 0;
  let inString = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (depth === 0 && c === '>') return i;
  }
  return -1;
}

function findLoneIconChild(src, after) {
  let i = after;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '<') return null;
  let j = i + 1;
  while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
  const iconName = src.slice(i + 1, j);
  if (!iconName || !/^[A-Z]/.test(iconName)) return null;
  let depth = 0;
  let inString = null;
  let end = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (depth === 0 && c === '>') {
      if (src[k - 1] === '/') { end = k; break; }
      return null;
    }
  }
  if (end === -1) return null;
  let m = end + 1;
  while (m < src.length && /\s/.test(src[m])) m++;
  if (!src.slice(m).startsWith('</TouchableOpacity>')) return null;
  return { iconName, tagEnd: end + 1, closeEnd: m + '</TouchableOpacity>'.length };
}

let totalLabels = 0;
let touchedFiles = 0;

const files = ROOTS.flatMap(r => fs.existsSync(r) ? walk(r) : []);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let labels = 0;
  let out = '';
  let pos = 0;

  while (true) {
    const idx = src.indexOf('<TouchableOpacity', pos);
    if (idx < 0) {
      out += src.slice(pos);
      break;
    }
    const next = src[idx + '<TouchableOpacity'.length];
    if (next && /[A-Za-z0-9_]/.test(next)) {
      out += src.slice(pos, idx + 1);
      pos = idx + 1;
      continue;
    }
    const openEnd = findOpenTagEnd(src, idx);
    if (openEnd < 0) {
      out += src.slice(pos);
      break;
    }
    const openTag = src.slice(idx, openEnd + 1);
    if (/\baccessibilityLabel\b/.test(openTag)) {
      out += src.slice(pos, openEnd + 1);
      pos = openEnd + 1;
      continue;
    }
    if (!/\bonPress\s*=/.test(openTag)) {
      out += src.slice(pos, openEnd + 1);
      pos = openEnd + 1;
      continue;
    }
    const lone = findLoneIconChild(src, openEnd + 1);
    if (!lone || !ICON_TO_LABEL[lone.iconName]) {
      out += src.slice(pos, openEnd + 1);
      pos = openEnd + 1;
      continue;
    }
    const label = ICON_TO_LABEL[lone.iconName];
    const insert = ` accessibilityRole="button" accessibilityLabel=${JSON.stringify(label)}`;
    const newOpenTag = openTag.slice(0, -1).trimEnd() + insert + '>';
    out += src.slice(pos, idx) + newOpenTag;
    pos = openEnd + 1;
    labels++;
  }

  if (labels > 0) {
    fs.writeFileSync(file, out);
    totalLabels += labels;
    touchedFiles++;
  }
}

console.log(`A11y v3: added ${totalLabels} accessibilityLabels across ${touchedFiles} files (expanded icon dictionary).`);
