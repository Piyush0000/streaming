import type { GuidelinesResponse } from '@streaming/shared-types';

/**
 * Current community guidelines. BUMP `GUIDELINES_VERSION` whenever the rules
 * change materially: every host must then re-accept before starting a stream.
 */
export const GUIDELINES_VERSION = 1;

export const GUIDELINES_RULES: string[] = [
  'No illegal activity of any kind, including fraud, scams, market manipulation and pump-and-dump schemes.',
  'No harassment, threats, hate speech or discrimination against any person or group.',
  "Do not share other people's private or personal information without their consent.",
  'No spam, impersonation or misleading promotion of products, services or accounts.',
  'Do not present financial advice as guaranteed returns or risk-free profit.',
  'Follow the instructions of the stream host and moderators at all times.',
  'Consequences: a host may warn you. After 2 warnings, the next warning removes you from the stream and bans you from it. Hosts may also mute, remove or ban participants, and delete messages. Everything in a stream is moderated.',
];

export function getGuidelines(): GuidelinesResponse {
  return { version: GUIDELINES_VERSION, rules: GUIDELINES_RULES };
}
