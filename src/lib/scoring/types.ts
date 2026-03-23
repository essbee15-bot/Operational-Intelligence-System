export interface ScoreConfig {
  rolling_window_months: number
  min_meetings_human: number
  min_actions_system: number
}

export interface DimensionScore {
  dimension_key: string
  score: number
  band_key: string | null
  data_points: number
  is_ntr: boolean
}

export interface Band {
  band_key: string
  label: string
  min_score: number
  max_score: number
  color: string
}
