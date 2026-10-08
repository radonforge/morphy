import assert from "node:assert/strict";
import { test } from "node:test";

const {
  DEFAULT_SECTION,
  isLivePreview,
  SETTING_COPY,
  SETTINGS_SECTIONS,
  sectionById,
  sectionForKey,
  settingHint,
} = await import("../packages/client/src/ui/settingsSections.ts");

const sectionOf = (id) => SETTINGS_SECTIONS.find((section) => section.settings.includes(id))?.id;

test("every setting sits in exactly one section", () => {
  const listed = SETTINGS_SECTIONS.flatMap((section) => section.settings);
  assert.deepEqual([...listed].sort(), Object.keys(SETTING_COPY).sort());
  assert.equal(new Set(listed).size, listed.length);
});

test("the sections are Audio, Video and Controls with the agreed members", () => {
  assert.deepEqual(
    SETTINGS_SECTIONS.map((section) => section.id),
    ["audio", "video", "controls"],
  );
  assert.deepEqual(sectionById("audio").settings, [
    "audio",
    "volume",
    "music",
    "musicVolume",
    "uiSounds",
  ]);
  assert.deepEqual(sectionById("video").settings, ["graphics", "perfHud"]);
  assert.deepEqual(sectionById("controls").settings, ["lookSensitivity", "fieldOfView"]);
  assert.equal(sectionOf("fieldOfView"), "controls");
});

test("an unknown section is refused by name", () => {
  assert.throws(() => sectionById("network"), /network/);
});

test("the menu opens on Audio and a match on Controls", () => {
  assert.equal(DEFAULT_SECTION.menu, "audio");
  assert.equal(DEFAULT_SECTION.match, "controls");
});

test("only the menu tags settings as live, and only those that preview", () => {
  const live = Object.keys(SETTING_COPY).filter((id) => isLivePreview(id, "menu"));
  assert.deepEqual(live.sort(), ["fieldOfView", "graphics", "musicVolume", "volume"]);
  for (const id of Object.keys(SETTING_COPY)) assert.equal(isLivePreview(id, "match"), false);
});

test("a match says which settings wait for the next one", () => {
  assert.equal(settingHint("graphics", "match"), "Applies from the next match");
  assert.equal(settingHint("perfHud", "match"), "Applies from the next match");
  assert.equal(settingHint("graphics", "menu"), SETTING_COPY.graphics.hint);
  assert.equal(settingHint("volume", "match"), SETTING_COPY.volume.hint);
  assert.doesNotMatch(settingHint("fieldOfView", "match"), /preview/);
});

test("the rail's arrows step and wrap on either axis", () => {
  assert.equal(sectionForKey("ArrowDown", "audio"), "video");
  assert.equal(sectionForKey("ArrowRight", "video"), "controls");
  assert.equal(sectionForKey("ArrowDown", "controls"), "audio");
  assert.equal(sectionForKey("ArrowUp", "audio"), "controls");
  assert.equal(sectionForKey("ArrowLeft", "controls"), "video");
});

test("Home and End jump to the ends, and other keys are not the rail's", () => {
  assert.equal(sectionForKey("Home", "controls"), "audio");
  assert.equal(sectionForKey("End", "audio"), "controls");
  for (const key of ["Enter", " ", "Tab", "a", "Escape"]) {
    assert.equal(sectionForKey(key, "video"), null);
  }
});
