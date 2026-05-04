#!/usr/bin/env node
// A11y icon-button auto-labeler, second pass.
//
// Pass 1's regex assumed `[^>]` for opening-tag attrs, but JSX often
// contains `=>` (arrow functions in onPress) which contained `>`. That
// caused most multi-line TouchableOpacity declarations to be skipped.
// This pass uses a balanced-brace state machine to properly find the
// opening tag boundary, then applies the same icon → label mapping.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

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

// Find the index of the closing `>` of a JSX opening tag, starting at
// `start` which points at `<`. Tracks JSX expression braces so `=>` and
// `{a > b}` inside attrs don't terminate early. Returns -1 if not found.
function findOpenTagEnd(src, start) {
  let depth = 0;        // brace depth (JSX expressions)
  let inString = null;  // quote char if inside attr string
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      continue;
    }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (depth === 0 && c === '>') return i;
  }
  return -1;
}

// Find a single self-closing JSX child after the open tag. Returns
// { iconName, end } or null. We want EXACTLY one `<IconName ... />` with
// only whitespace before/after the close tag.
function findLoneIconChild(src, after) {
  // Skip whitespace
  let i = after;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '<') return null;
  const tagStart = i;
  // Read identifier
  let j = i + 1;
  while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
  const iconName = src.slice(i + 1, j);
  if (!iconName || !/^[A-Z]/.test(iconName)) return null;
  // Find self-closing end `/>`
  // Reuse findOpenTagEnd then check the char before `>` is `/`
  // Actually we need to find the `/>` boundary. Use brace-aware scan.
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
      return null;  // not self-closing — has children
    }
  }
  if (end === -1) return null;
  // Check whitespace then `</TouchableOpacity>` follows
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

  let i = 0;
  let out = '';
  let pos = 0;

  while (true) {
    const idx = src.indexOf('<TouchableOpacity', pos);
    if (idx < 0) {
      out += src.slice(pos);
      break;
    }
    // Word boundary check (next char must be whitespace, not part of identifier)
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

    // Skip if already has accessibilityLabel
    if (/\baccessibilityLabel\b/.test(openTag)) {
      out += src.slice(pos, openEnd + 1);
      pos = openEnd + 1;
      continue;
    }
    // Must have onPress
    if (!/\bonPress\s*=/.test(openTag)) {
      out += src.slice(pos, openEnd + 1);
      pos = openEnd + 1;
      continue;
    }

    // Look for a lone icon child
    const lone = findLoneIconChild(src, openEnd + 1);
    if (!lone || !ICON_TO_LABEL[lone.iconName]) {
      out += src.slice(pos, openEnd + 1);
      pos = openEnd + 1;
      continue;
    }

    const label = ICON_TO_LABEL[lone.iconName];
    // Inject `accessibilityRole="button" accessibilityLabel="..."` before closing >
    // openTag ends with `>` (or `/>` — but TouchableOpacity with children won't be self-closing here)
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

console.log(`A11y v2: added ${totalLabels} accessibilityLabels across ${touchedFiles} files (multi-line TouchableOpacity).`);
