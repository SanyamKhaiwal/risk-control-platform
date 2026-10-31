import type { AssessmentResult, ControlFrequency, ControlType, Rating, RiskCategory, RiskStatus, Role } from './api/types';

/** Bands: LOW 1–5, MEDIUM 6–11, HIGH 12–19, CRITICAL 20–25 (ARCHITECTURE.md §6). */
export function ratingOf(score: number): Rating {
  if (score <= 5) return 'LOW';
  if (score <= 11) return 'MEDIUM';
  if (score <= 19) return 'HIGH';
  return 'CRITICAL';
}

export const RATING_LABEL: Record<Rating, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const RATING_RANGE: Record<Rating, string> = {
  LOW: '1–5',
  MEDIUM: '6–11',
  HIGH: '12–19',
  CRITICAL: '20–25',
};

export const STATUS_LABEL: Record<RiskStatus, string> = {
  OPEN: 'Open',
  MITIGATED: 'Mitigated',
  ACCEPTED: 'Accepted',
  CLOSED: 'Closed',
};

export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  OPERATIONAL: 'Operational',
  CYBER: 'Cyber',
  FRAUD: 'Fraud',
  COMPLIANCE: 'Compliance',
  FINANCIAL: 'Financial',
  THIRD_PARTY: 'Third party',
};

export const CONTROL_TYPE_LABEL: Record<ControlType, string> = {
  PREVENTIVE: 'Preventive',
  DETECTIVE: 'Detective',
  CORRECTIVE: 'Corrective',
};

/** What each control type does, in plain words. */
export const CONTROL_TYPE_EFFECT: Record<ControlType, string> = {
  PREVENTIVE: 'stops it happening, so it lowers how likely',
  DETECTIVE: 'spots it quickly, so it lowers how bad',
  CORRECTIVE: 'limits the damage, so it lowers how bad',
};

/** Short form for tight spaces. */
export const CONTROL_TYPE_SHORT: Record<ControlType, string> = {
  PREVENTIVE: 'Stops it happening',
  DETECTIVE: 'Spots it quickly',
  CORRECTIVE: 'Limits the damage',
};

/** Words for the 1–5 scales, so a number is never the only explanation. */
export const LIKELIHOOD_WORD = ['', 'Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
export const IMPACT_WORD = ['', 'Minor', 'Moderate', 'Significant', 'Major', 'Severe'];

export const FREQUENCY_LABEL: Record<ControlFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMI_ANNUALLY: 'Semi-annually',
  ANNUALLY: 'Annually',
};

export const RESULT_LABEL: Record<AssessmentResult, string> = {
  EFFECTIVE: 'Works',
  PARTIALLY_EFFECTIVE: 'Works partly',
  INEFFECTIVE: "Doesn't work",
};

/** How much a result counts towards lowering the risk. */
export const RESULT_COUNTS: Record<AssessmentResult, string> = {
  EFFECTIVE: 'counts in full',
  PARTIALLY_EFFECTIVE: 'counts as half',
  INEFFECTIVE: 'counts for nothing',
};

export const ROLE_LABEL: Record<Role, string> = {
  RISK_OWNER: 'Risk owner',
  CONTROL_OWNER: 'Control owner',
  CONTROL_TESTER: 'Control tester',
  VIEWER: 'Viewer',
};

const dateTime = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
export const formatTime = (date: Date) => timeOnly.format(date);

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Never';
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(iso);
}

export const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/** Short, monospaced references for ids and hashes; the full value goes in a title attribute. */
export const shortRef = (value: string) => value.slice(0, 8);
