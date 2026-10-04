// components/whoson — "who is on this project" (whoson spec, section 4).
// Every component here returns null while WHOS_ON_ENABLED is false and while
// the read is unknown. Strings live in hooks/useWhosOnCopy.ts.
export { PersonAvatar, PeopleOverflowChip, PresenceDot, type PersonAvatarProps, type PersonAvatarSize } from './PersonAvatar';
export { ProjectPeopleStack, type ProjectPeopleStackProps } from './ProjectPeopleStack';
export { ProjectPeopleBlock, type ProjectPeopleBlockProps } from './ProjectPeopleBlock';
export { PersonRowExtras, type PersonRowExtrasProps } from './PersonRowExtras';
export { PresenceChoiceCard } from './PresenceChoiceCard';
export { SharePresenceSwitchRow, type SharePresenceSwitchRowProps } from './SharePresenceSwitchRow';
export { SharePresenceSettingRow } from './SharePresenceSettingRow';
export { ProjectPresenceBeacon } from './ProjectPresenceBeacon';
export { WhosOnBoundary } from './WhosOnBoundary';
