/**
 * What the Options panel holds and how it is grouped, with no React and no DOM, so the menu's
 * slice and the match's pause card list the same settings in the same order from one record.
 */

export type SettingsSectionId = "audio" | "video" | "controls";

export type SettingId =
  | "audio"
  | "volume"
  | "music"
  | "musicVolume"
  | "uiSounds"
  | "graphics"
  | "perfHud"
  | "lookSensitivity"
  | "fieldOfView";

/** Where the panel is open: the menu, over the live stage, or a match's pause card. */
export type SettingsContext = "menu" | "match";

export interface SettingsSection {
  id: SettingsSectionId;
  title: string;
  settings: readonly SettingId[];
}

export interface SettingCopy {
  label: string;
  hint: string;
  /** Whether the menu shows a change on the stage or through the speakers as it is made. */
  live: boolean;
  /** Whether a match reads it only as it begins, so a change from the pause card waits for the next. */
  nextMatch: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "audio",
    title: "Audio",
    settings: ["audio", "volume", "music", "musicVolume", "uiSounds"],
  },
  { id: "video", title: "Video", settings: ["graphics", "perfHud"] },
  { id: "controls", title: "Controls", settings: ["lookSensitivity", "fieldOfView"] },
];

export const SETTING_COPY: Record<SettingId, SettingCopy> = {
  audio: {
    label: "Audio",
    hint: "Master switch for every sound",
    live: false,
    nextMatch: false,
  },
  volume: {
    label: "Volume",
    hint: "Master level for effects, music and interface",
    live: true,
    nextMatch: false,
  },
  music: { label: "Music", hint: "Lobby theme by alkakrab", live: false, nextMatch: false },
  musicVolume: {
    label: "Music volume",
    hint: "Level of the lobby theme",
    live: true,
    nextMatch: false,
  },
  uiSounds: {
    label: "Interface sounds",
    hint: "Menu ticks and clicks",
    live: false,
    nextMatch: false,
  },
  graphics: {
    label: "Graphics quality",
    hint: "Auto reads your GPU and steps down after a slow round",
    live: true,
    nextMatch: true,
  },
  perfHud: {
    label: "Performance readout",
    hint: "FPS and ping in the corner of the match HUD",
    live: false,
    nextMatch: true,
  },
  lookSensitivity: {
    label: "Look sensitivity",
    hint: "Mouse and trackpad aim speed",
    live: false,
    nextMatch: false,
  },
  fieldOfView: {
    label: "Field of view",
    hint: "How wide the match camera sees; drag to preview it here",
    live: true,
    nextMatch: false,
  },
};

const NEXT_MATCH_HINT = "Applies from the next match";
const MATCH_FIELD_OF_VIEW_HINT = "How wide the match camera sees";

/** The section a context opens on: the menu starts with sound, a match with what it changes most. */
export const DEFAULT_SECTION: Record<SettingsContext, SettingsSectionId> = {
  menu: "audio",
  match: "controls",
};

export function sectionById(id: SettingsSectionId): SettingsSection {
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === id);
  if (section === undefined) throw new Error(`Unknown settings section "${id}"`);
  return section;
}

/** The muted line under a setting's label, which in a match says when a change takes effect. */
export function settingHint(id: SettingId, context: SettingsContext): string {
  const copy = SETTING_COPY[id];
  if (context === "match" && copy.nextMatch) return NEXT_MATCH_HINT;
  if (context === "match" && id === "fieldOfView") return MATCH_FIELD_OF_VIEW_HINT;
  return copy.hint;
}

/** Whether a setting carries the live tag: only the menu previews, a match simply applies. */
export function isLivePreview(id: SettingId, context: SettingsContext): boolean {
  return context === "menu" && SETTING_COPY[id].live;
}

/**
 * The section a key moves the rail to from `current`, or null when the key is not the rail's.
 * Either axis of arrows steps and wraps, since the rail is vertical on the menu and horizontal
 * on the pause card; Home and End jump to the ends.
 */
export function sectionForKey(key: string, current: SettingsSectionId): SettingsSectionId | null {
  const count = SETTINGS_SECTIONS.length;
  const index = SETTINGS_SECTIONS.findIndex((entry) => entry.id === current);
  let next: number;
  if (key === "ArrowDown" || key === "ArrowRight") next = (index + 1) % count;
  else if (key === "ArrowUp" || key === "ArrowLeft") next = (index - 1 + count) % count;
  else if (key === "Home") next = 0;
  else if (key === "End") next = count - 1;
  else return null;
  return SETTINGS_SECTIONS[next]?.id ?? null;
}
