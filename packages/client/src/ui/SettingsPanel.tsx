import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  areUiSoundsEnabled,
  getMusicVolume,
  getVolume,
  isMusicEnabled,
  isMuted,
  playUiClick,
  playUiHover,
  setMusicEnabled,
  setMusicVolume,
  setMuted,
  setUiSoundsEnabled,
  setVolume,
  startLobbyMusic,
  stopLobbyMusic,
} from "../game/audio";
import { FieldOfViewSlider } from "../game/FieldOfViewSlider";
import {
  GRAPHICS_LABEL,
  GRAPHICS_PREFERENCES,
  type GraphicsPreference,
} from "../game/graphicsTier";
import { LookSensitivitySlider } from "../game/LookSensitivitySlider";
import {
  graphicsPreference,
  isPerfHudEnabled,
  setGraphicsPreference,
  setPerfHudEnabled,
} from "../game/prefs";
import { Dropdown } from "./Dropdown";
import {
  DEFAULT_SECTION,
  isLivePreview,
  SETTING_COPY,
  SETTINGS_SECTIONS,
  type SettingId,
  type SettingsContext,
  type SettingsSectionId,
  sectionById,
  sectionForKey,
  settingHint,
} from "./settingsSections";

const VOLUME_SLIDER_MAX = 100;
const GRAPHICS_OPTIONS = GRAPHICS_PREFERENCES.map((pref) => ({
  value: pref,
  label: GRAPHICS_LABEL[pref],
}));
const LIVE_TAG = "Live";

interface ToggleProps {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: () => void;
}

function Toggle({ on, onLabel, offLabel, onToggle }: ToggleProps) {
  return (
    <button
      type="button"
      className={`menu-toggle${on ? " on" : ""}`}
      onClick={onToggle}
      onPointerEnter={playUiHover}
      aria-pressed={on}
      aria-label={on ? offLabel : onLabel}
    />
  );
}

function LevelSlider({
  value,
  label,
  onChange,
  onRelease,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
  onRelease?: () => void;
}) {
  return (
    <input
      type="range"
      className="menu-slider"
      min={0}
      max={VOLUME_SLIDER_MAX}
      value={Math.round(value * VOLUME_SLIDER_MAX)}
      onChange={(e) => onChange(Number(e.target.value) / VOLUME_SLIDER_MAX)}
      onPointerUp={onRelease}
      aria-label={label}
    />
  );
}

export interface SettingsPanelProps {
  context: SettingsContext;
  /** Moves focus to the selected section's tab as the panel mounts. */
  autoFocus?: boolean;
  /** Hears the master switch, for a mute button elsewhere on screen to follow it. */
  onMutedChange?: (muted: boolean) => void;
}

/**
 * The game's options, grouped into Audio, Video and Controls: a rail of section tabs, the
 * section's title and its rows, one label with a muted hint and one control each. The menu's
 * Options slice and a match's pause card both render this, `context` choosing the copy (the menu
 * tags what previews live, a match says what waits for the next one) and whether the music
 * switch starts the lobby theme. Every control writes the same pref the game reads, so there is
 * one place a setting lives on screen.
 */
export function SettingsPanel({ context, autoFocus = false, onMutedChange }: SettingsPanelProps) {
  const id = useId();
  const [section, setSection] = useState<SettingsSectionId>(DEFAULT_SECTION[context]);
  const [muted, setMutedState] = useState(() => isMuted());
  const [volume, setVolumeState] = useState(() => getVolume());
  const [uiSounds, setUiSoundsState] = useState(() => areUiSoundsEnabled());
  const [musicOn, setMusicOnState] = useState(() => isMusicEnabled());
  const [musicVol, setMusicVolState] = useState(() => getMusicVolume());
  const [perfHud, setPerfHudState] = useState(() => isPerfHudEnabled());
  const [graphics, setGraphicsState] = useState<GraphicsPreference>(() => graphicsPreference());
  const tabs = useRef(new Map<SettingsSectionId, HTMLButtonElement>());

  useEffect(() => {
    if (autoFocus) tabs.current.get(DEFAULT_SECTION[context])?.focus();
  }, [autoFocus, context]);

  const selectSection = useCallback((next: SettingsSectionId, focus: boolean) => {
    setSection(next);
    if (focus) tabs.current.get(next)?.focus();
  }, []);

  const handleRailKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const next = sectionForKey(e.key, section);
      if (next === null) return;
      e.preventDefault();
      if (next !== section) playUiClick();
      selectSection(next, true);
    },
    [section, selectSection],
  );

  const toggleAudio = useCallback(() => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
    onMutedChange?.(next);
    playUiClick();
  }, [onMutedChange]);

  const toggleUiSounds = useCallback(() => {
    const next = !areUiSoundsEnabled();
    setUiSoundsEnabled(next);
    setUiSoundsState(next);
    if (next) playUiClick();
  }, []);

  const toggleMusic = useCallback(() => {
    const next = !isMusicEnabled();
    setMusicEnabled(next);
    setMusicOnState(next);
    if (context === "menu") {
      if (next) startLobbyMusic();
      else stopLobbyMusic();
    }
    playUiClick();
  }, [context]);

  const togglePerfHud = useCallback(() => {
    const next = !isPerfHudEnabled();
    setPerfHudEnabled(next);
    setPerfHudState(next);
    playUiClick();
  }, []);

  const changeGraphics = useCallback((value: GraphicsPreference) => {
    setGraphicsPreference(value);
    setGraphicsState(value);
    playUiClick();
  }, []);

  const changeVolume = useCallback((value: number) => {
    setVolume(value);
    setVolumeState(value);
  }, []);

  const changeMusicVolume = useCallback((value: number) => {
    setMusicVolume(value);
    setMusicVolState(value);
  }, []);

  const control = (setting: SettingId) => {
    switch (setting) {
      case "audio":
        return (
          <Toggle on={!muted} onLabel="Unmute audio" offLabel="Mute audio" onToggle={toggleAudio} />
        );
      case "volume":
        return (
          <LevelSlider
            value={volume}
            label="Master volume"
            onChange={changeVolume}
            onRelease={playUiClick}
          />
        );
      case "music":
        return (
          <Toggle
            on={musicOn}
            onLabel="Enable music"
            offLabel="Disable music"
            onToggle={toggleMusic}
          />
        );
      case "musicVolume":
        return <LevelSlider value={musicVol} label="Music volume" onChange={changeMusicVolume} />;
      case "uiSounds":
        return (
          <Toggle
            on={uiSounds}
            onLabel="Enable interface sounds"
            offLabel="Disable interface sounds"
            onToggle={toggleUiSounds}
          />
        );
      case "graphics":
        return (
          <Dropdown
            value={graphics}
            options={GRAPHICS_OPTIONS}
            onChange={changeGraphics}
            label="Graphics quality"
          />
        );
      case "perfHud":
        return (
          <Toggle
            on={perfHud}
            onLabel="Enable performance readout"
            offLabel="Disable performance readout"
            onToggle={togglePerfHud}
          />
        );
      case "lookSensitivity":
        return <LookSensitivitySlider />;
      case "fieldOfView":
        return <FieldOfViewSlider />;
    }
  };

  const current = sectionById(section);
  const panelId = `${id}panel`;

  return (
    <div className={`settings settings-${context}`}>
      <div
        className="settings-rail"
        role="tablist"
        aria-label="Options sections"
        aria-orientation={context === "menu" ? "vertical" : "horizontal"}
        onKeyDown={handleRailKey}
      >
        {SETTINGS_SECTIONS.map((entry) => {
          const selected = entry.id === section;
          return (
            <button
              type="button"
              key={entry.id}
              ref={(node) => {
                if (node) tabs.current.set(entry.id, node);
                else tabs.current.delete(entry.id);
              }}
              role="tab"
              id={`${id}tab-${entry.id}`}
              className={`settings-tab${selected ? " sel" : ""}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (!selected) playUiClick();
                selectSection(entry.id, false);
              }}
              onPointerEnter={playUiHover}
            >
              <span>{entry.title}</span>
            </button>
          );
        })}
      </div>
      <div
        className="settings-body"
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${id}tab-${section}`}
      >
        <h2 className="settings-title">{current.title}</h2>
        <div className="settings-rows">
          {current.settings.map((setting) => (
            <div className="settings-row" key={setting}>
              <span className="l">
                <b>
                  {SETTING_COPY[setting].label}
                  {isLivePreview(setting, context) && (
                    <span className="settings-live">{LIVE_TAG}</span>
                  )}
                </b>
                <span>{settingHint(setting, context)}</span>
              </span>
              {control(setting)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
