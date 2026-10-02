import type { Response } from 'express';
import { z } from 'zod';

/**
 * Formats zod issues into a human-readable "field: message" list so API
 * consumers know exactly which field was wrong and why, instead of a bare
 * "invalid_input". (Same pattern as auth-service's formatIssues.)
 */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`);
}

/** Sends a 400 `invalid_input` with a specific `message` and the raw zod `details`. */
export function sendInvalidInput(res: Response, error: z.ZodError): Response {
  return res
    .status(400)
    .json({ error: 'invalid_input', message: formatIssues(error).join('; '), details: error.issues });
}

export const uuidSchema = z.string().uuid('must be a valid UUID');
