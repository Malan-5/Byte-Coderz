export const EMERGENCY_TYPES = ['flood', 'fire', 'medical', 'trapped', 'collapse', 'other'] as const;
export type EmergencyType = typeof EMERGENCY_TYPES[number];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Severity = typeof SEVERITIES[number];
export type Channel = 'text' | 'voice' | 'image';
export type VulnerableGroup = 'children' | 'elderly' | 'pregnant' | 'disabled';
export type LocationSource = 'gazetteer' | 'nominatim' | 'gps' | 'unverified';
export type UnitType = 'ambulance' | 'fire_engine' | 'rescue_boat' | 'ndrf_team' | 'general_rescue';
export type UnitStatus = 'available' | 'en_route' | 'on_scene' | 'returning';
export type DispatchStatus = Exclude<UnitStatus, 'available'> | 'completed';

export interface Coordinates { lat: number; lng: number }

export interface ExtractedEntities {
  location_mentions: string[];
  emergency_type: EmergencyType;
  people_count: number | null;
  vulnerable_groups: VulnerableGroup[];
}

export interface LlmAnalysis extends ExtractedEntities {
  urgency_score: number;
  explanation: string;
  image_description: string | null;
}

export type LlmStatus = 'used' | 'unavailable' | 'timeout' | 'invalid' | 'error';
export interface WeightedHit { label: string; weight: number }
export interface SeverityReasoning {
  version: 'hybrid-v1';
  keyword_hits: WeightedHit[];
  negated_keywords: string[];
  modifiers: WeightedHit[];
  rule_score: number;
  llm_status: LlmStatus;
  llm_output: LlmAnalysis | null;
  llm_weight: number;
  rule_weight: number;
  weighted_score: number;
  safety_floor: number;
  final_score: number;
  severity: Severity;
}

export interface Incident {
  id: string;
  incident_number: number;
  emergency_type: EmergencyType;
  status: 'open' | 'resolved';
  severity: Severity;
  final_score: number;
  location_label: string;
  lat: number | null;
  lng: number | null;
  report_count: number;
  created_at: string;
  last_report_at: string;
  resolved_at: string | null;
  is_demo: boolean;
  cluster_reasoning: Record<string, unknown>;
}

export interface Report {
  id: string;
  client_request_id: string;
  incident_id: string;
  channel: Channel;
  raw_text: string;
  image_description: string | null;
  image_data_url: string | null;
  location_label: string;
  location_source: LocationSource;
  lat: number | null;
  lng: number | null;
  emergency_type: EmergencyType;
  people_count: number | null;
  vulnerable_groups: VulnerableGroup[];
  severity: Severity;
  final_score: number;
  entities: ExtractedEntities;
  reasoning: SeverityReasoning | Record<string, unknown>;
  cluster_outcome: 'new' | 'merged';
  match_distance_m: number | null;
  created_at: string;
  is_demo: boolean;
}

export interface Unit extends Coordinates {
  id: string;
  name: string;
  unit_type: UnitType;
  status: UnitStatus;
  station_name: string;
  station_lat: number;
  station_lng: number;
  current_incident_id: string | null;
  last_moved_at: string;
  is_demo: boolean;
}

export interface Dispatch {
  id: string;
  incident_id: string;
  unit_id: string;
  status: DispatchStatus;
  distance_m: number;
  eta_seconds: number;
  reasoning: string;
  is_auto: boolean;
  dispatched_at: string;
  arrived_at: string | null;
  returning_at: string | null;
  completed_at: string | null;
  is_demo: boolean;
}

// Only the API constructs this after validation, extraction and scoring.
// It is not the public request body; citizens cannot choose scores or demo flags.
export interface PreparedReport {
  client_request_id: string;
  channel: Channel;
  raw_text: string;
  image_description?: string | null;
  image_data_url?: string | null;
  location_label: string;
  location_source: LocationSource;
  lat: number | null;
  lng: number | null;
  emergency_type: EmergencyType;
  people_count: number | null;
  vulnerable_groups: VulnerableGroup[];
  final_score: number;
  entities: ExtractedEntities;
  reasoning: SeverityReasoning | Record<string, unknown>;
  is_demo: boolean;
}
