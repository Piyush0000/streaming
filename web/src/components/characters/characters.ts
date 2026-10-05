import type { ComponentType } from 'react';
import { Astronaut, Bear, Bull, Cat, Fox, Gem, Robot, Rocket, Whale, Wizard } from './Mascots';
import type { ArtProps } from './parts';

export type { ArtProps } from './parts';

/**
 * Preset avatar ids. MUST stay in sync with AVATAR_PRESETS in
 * services/api-service/src/profile.ts (server-side allowlist).
 */
export const PRESET_IDS = [
  'bull',
  'bear',
  'robot',
  'whale',
  'astronaut',
  'rocket',
  'gem',
  'fox',
  'cat',
  'wizard',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface CharacterDef {
  id: PresetId;
  label: string;
  /** One-line, purely illustrative personality blurb. */
  tagline: string;
  Component: ComponentType<ArtProps>;
  /** CSS gradient used as the avatar backdrop behind the character. */
  gradient: string;
}

export const CHARACTERS: Record<PresetId, CharacterDef> = {
  bull: { id: 'bull', label: 'Bull', tagline: 'Always eyeing the next leg up.', Component: Bull, gradient: 'linear-gradient(135deg,#34d399,#0f766e)' },
  bear: { id: 'bear', label: 'Bear', tagline: 'Cautious, patient, well-hedged.', Component: Bear, gradient: 'linear-gradient(135deg,#fb7185,#9f1239)' },
  robot: { id: 'robot', label: 'Robot Trader', tagline: 'Runs on rules, not feelings.', Component: Robot, gradient: 'linear-gradient(135deg,#818cf8,#312e81)' },
  whale: { id: 'whale', label: 'Whale', tagline: 'Big picture, deep waters.', Component: Whale, gradient: 'linear-gradient(135deg,#38bdf8,#1e3a8a)' },
  astronaut: { id: 'astronaut', label: 'Astronaut', tagline: 'Scouting the far side of the chart.', Component: Astronaut, gradient: 'linear-gradient(135deg,#6366f1,#111827)' },
  rocket: { id: 'rocket', label: 'Rocket', tagline: 'Fueled up and counting down.', Component: Rocket, gradient: 'linear-gradient(135deg,#f472b6,#6d28d9)' },
  gem: { id: 'gem', label: 'Diamond Hands', tagline: 'Holds steady through the wobble.', Component: Gem, gradient: 'linear-gradient(135deg,#22d3ee,#4338ca)' },
  fox: { id: 'fox', label: 'Fox', tagline: 'Spots the setup before the crowd.', Component: Fox, gradient: 'linear-gradient(135deg,#fbbf24,#c2410c)' },
  cat: { id: 'cat', label: 'Cat', tagline: 'Lands on its feet every time.', Component: Cat, gradient: 'linear-gradient(135deg,#a78bfa,#5b21b6)' },
  wizard: { id: 'wizard', label: 'Wizard', tagline: 'Reads the candles like tea leaves.', Component: Wizard, gradient: 'linear-gradient(135deg,#c084fc,#3b0764)' },
};

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHARACTERS, v);
}

/** Safe lookup: unknown / null / legacy ids return null (callers fall back to the initial avatar). */
export function getCharacter(id: string | null | undefined): CharacterDef | null {
  return isPresetId(id) ? CHARACTERS[id] : null;
}

export const CHARACTER_LIST: CharacterDef[] = PRESET_IDS.map((id) => CHARACTERS[id]);
