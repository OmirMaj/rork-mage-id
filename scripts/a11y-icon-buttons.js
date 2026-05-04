#!/usr/bin/env node
// Auto-label icon-only TouchableOpacity buttons.
//
// Pattern targeted:
//   <TouchableOpacity onPress=... [no accessibilityLabel]>
//     <SomeLucideIcon ... />
//   </TouchableOpacity>
//
// We add `accessibilityRole="button"` + `accessibilityLabel="<inferred>"`
// where the label comes from a name → label dictionary keyed on the
// Lucide icon component. Icons we don't recognize are skipped (the
// missing-label warning stays so a human reviews them).
//
// Heuristics:
//   1. The TouchableOpacity must already have `onPress=`.
//   2. The first JSX child must be ONE Lucide icon (no Text child mixed
//      in). Buttons with text children are handled separately — their
//      text already labels them for VoiceOver via the inner Text node.
//   3. The opening tag must NOT already include `accessibilityLabel`.
//
// Limitations: the regex is line-based and doesn't handle TouchableOpacities
// that span 5+ lines with attributes spread out. Those need manual review.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

// Lucide icon name → spoken label. Verbs over nouns ("Open settings,"
// "Delete project," not "Settings icon").
const ICON_TO_LABEL = {
  ChevronLeft: 'Back',
  ChevronRight: 'Open',
  ChevronDown: 'Expand',
  ChevronUp: 'Collapse',
  ArrowLeft: 'Back',
  ArrowRight: 'Next',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  X: 'Close',
  XCircle: 'Close',
  Plus: 'Add',
  PlusCircle: 'Add',
  Minus: 'Remove',
  Search: 'Search',
  SearchX: 'Clear search',
  Filter: 'Filter',
  Settings: 'Settings',
  MoreHorizontal: 'More options',
  MoreVertical: 'More options',
  Edit: 'Edit',
  Edit2: 'Edit',
  Edit3: 'Edit',
  Pencil: 'Edit',
  Trash: 'Delete',
  Trash2: 'Delete',
  Bell: 'Notifications',
  BellOff: 'Mute notifications',
  Share: 'Share',
  Share2: 'Share',
  Download: 'Download',
  Upload: 'Upload',
  Heart: 'Favorite',
  Star: 'Star',
  Check: 'Confirm',
  CheckCircle: 'Confirm',
  CheckCircle2: 'Confirm',
  Camera: 'Take photo',
  Image: 'Add image',
  ImageIcon: 'Add image',
  Send: 'Send',
  Save: 'Save',
  Copy: 'Copy',
  Eye: 'Show',
  EyeOff: 'Hide',
  Mic: 'Record',
  MicOff: 'Stop recording',
  Phone: 'Call',
  Mail: 'Email',
  MessageCircle: 'Message',
  MessageSquare: 'Message',
  Calendar: 'Open calendar',
  CalendarDays: 'Open calendar',
  Clock: 'Open time',
  MapPin: 'View location',
  Map: 'View map',
  RefreshCw: 'Refresh',
  RefreshCcw: 'Refresh',
  RotateCw: 'Rotate',
  RotateCcw: 'Rotate',
  Menu: 'Open menu',
  HelpCircle: 'Help',
  Info: 'More info',
  AlertCircle: 'Alert',
  AlertTriangle: 'Warning',
  AlertOctagon: 'Warning',
  LogOut: 'Sign out',
  LogIn: 'Sign in',
  User: 'Profile',
  UserCircle: 'Profile',
  Users: 'Team',
  Folder: 'Open folder',
  FolderOpen: 'Open folder',
  File: 'Open file',
  FileText: 'Open document',
  FileDown: 'Download file',
  FilePlus: 'Add file',
  FileUp: 'Upload file',
  Lock: 'Locked',
  Unlock: 'Unlocked',
  Play: 'Play',
  Pause: 'Pause',
  StopCircle: 'Stop',
  SkipForward: 'Skip',
  SkipBack: 'Previous',
  Volume2: 'Volume',
  VolumeX: 'Mute',
  Sun: 'Light mode',
  Moon: 'Dark mode',
  Maximize: 'Expand',
  Maximize2: 'Expand',
  Minimize: 'Collapse',
  Minimize2: 'Collapse',
  ZoomIn: 'Zoom in',
  ZoomOut: 'Zoom out',
  ExternalLink: 'Open link',
  Link: 'Open link',
  Unlink: 'Remove link',
  Bookmark: 'Bookmark',
  Flag: 'Flag',
  Tag: 'Tag',
  Sparkles: 'AI',
  Crown: 'Premium',
  Zap: 'Power',
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

let totalLabels = 0;
let touchedFiles = 0;

const files = ROOTS.flatMap(r => fs.existsSync(r) ? walk(r) : []);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let labels = 0;

  // Match a TouchableOpacity opening tag (no accessibilityLabel) followed
  // by ONE Lucide icon child, followed by the closing tag. Allow
  // arbitrary whitespace and a few attributes.
  //
  // Pattern: <TouchableOpacity ...onPress=...>\s*<IconName ... />\s*</TouchableOpacity>
  //
  // We capture the opening attrs so we can inject the new ones.
  const re = /<TouchableOpacity\b((?:[^>]|\n)*?)>\s*<(\w+)\s+([^>]*?)\/>\s*<\/TouchableOpacity>/g;

  src = src.replace(re, (full, openAttrs, iconName, iconAttrs) => {
    if (/accessibilityLabel/.test(openAttrs)) return full;
    if (!/onPress\s*=/.test(openAttrs)) return full;
    const label = ICON_TO_LABEL[iconName];
    if (!label) return full;
    labels++;
    // Inject before the closing `>` of the opening tag.
    const newAttrs = openAttrs.trimEnd()
      + (openAttrs.trimEnd().endsWith('\n') ? '' : ' ')
      + `accessibilityRole="button" accessibilityLabel=${JSON.stringify(label)}`;
    return `<TouchableOpacity${newAttrs}><${iconName} ${iconAttrs}/></TouchableOpacity>`;
  });

  if (labels > 0) {
    fs.writeFileSync(file, src);
    totalLabels += labels;
    touchedFiles++;
  }
}

console.log(`A11y: added ${totalLabels} accessibilityLabels to icon-only TouchableOpacity across ${touchedFiles} files.`);
