// English wording for the SDK itself (business component wording lives in rise-global @theriseunion/business).
//
// Casing follows freeland 流程/国际化与英文文案开发规范 §2.3: navigation items and page
// titles use Title Case; buttons, column headers, field labels, hints and body text use
// sentence case. Scope pickers are field labels and filter dimensions, so sentence case.
//
// Apostrophes must be written as ’ (U+2019) or doubled ('') — ASCII ' is the ICU escape
// character and would swallow the rest of the segment.

export default {
  resourceApi: {
    error: {
      network: 'Network request failed. Check your connection.',
      unauthorized: 'Not authorised. Sign in again.',
    },
  },
} as const
