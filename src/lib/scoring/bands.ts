import type { Band } from './types'

/**
 * Resolve the band a score falls into.
 * Bands are sorted by min_score descending so the first match wins
 * (highest band the score qualifies for).
 */
export function resolveBand(score: number, bands: Band[]): string | null {
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score)

  for (const band of sorted) {
    if (score >= band.min_score && score <= band.max_score) {
      return band.band_key
    }
  }

  return null
}
