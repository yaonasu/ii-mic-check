/**
 * Copyright (c) 2026 八百茄子 (yaonasu)
 * SPDX-License-Identifier: MIT
 */

/**
 * Centralized URL query parameter parser for switching between general-user mode
 * and debug detail mode (?debug=1).
 *
 * - Default is 'simple' (general-user mode).
 * - Only `?debug=1` activates 'debug' mode; all other values stay 'simple'.
 * - Display-only switch; never alters scoring, DSP analysis, or stored recordings.
 */

export type AppDisplayMode = 'simple' | 'debug';

export function parseDebugModeFromSearch(search: string | null | undefined): boolean {
  if (!search || typeof search !== 'string') {
    return false;
  }
  const trimmed = search.trim();
  if (!trimmed) {
    return false;
  }
  const query = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
  const params = new URLSearchParams(query);
  return params.get('debug') === '1';
}

export function resolveDisplayModeFromSearch(
  search: string | null | undefined
): AppDisplayMode {
  return parseDebugModeFromSearch(search) ? 'debug' : 'simple';
}

export function getCurrentDisplayMode(): AppDisplayMode {
  if (typeof window === 'undefined' || !window.location) {
    return 'simple';
  }
  return resolveDisplayModeFromSearch(window.location.search);
}
