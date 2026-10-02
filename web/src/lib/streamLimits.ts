// shared-types ships as CommonJS, which Vite's production build can't import
// *values* from across the workspace boundary (types are fine). Mirror the
// constant here; the annotation makes `tsc` fail if the shared value changes.
export const STREAM_MAX_WARNINGS: typeof import('@streaming/shared-types').STREAM_MAX_WARNINGS = 2;
