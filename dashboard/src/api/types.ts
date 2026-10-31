// Shapes of the gateway's JSON (docs/ARCHITECTURE.md §9).

export type Rating = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskStatus = 'OPEN' | 'MITIGATED' | 'ACCEPTED' | 'CLOSED';
export type RiskCategory = 'OPERATIONAL' | 'CYBER' | 'FRAUD' | 'COMPLIANCE' | 'FINANCIAL' | 'THIRD_PARTY';
export type ControlType = 'PREVENTIVE' | 'DETECTIVE' | 'CORRECTIVE';
export type ControlFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
export type AssessmentResult = 'EFFECTIVE' | 'PARTIALLY_EFFECTIVE' | 'INEFFECTIVE';
export type Role = 'RISK_OWNER' | 'CONTROL_OWNER' | 'CONTROL_TESTER' | 'VIEWER';

export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface Risk {
  id: string;
  title: string;
  description: string | null;
  category: RiskCategory;
  owner: string;
  likelihood: number;
  impact: number;
  inherentScore: number;
  inherentRating: Rating;
  residualLikelihood: number;
  residualImpact: number;
  residualScore: number;
  rating: Rating;
  status: RiskStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RiskLink {
  controlId: string;
  controlType: ControlType;
  latestEffectiveness: number | null;
  lastAssessedAt: string | null;
  linkedAt: string;
}

export interface HistoryEntry {
  inherentScore: number;
  residualScore: number;
  rating: Rating;
  cause: 'CREATED' | 'EDITED' | 'LINKED' | 'UNLINKED' | 'ASSESSMENT';
  causeEventId: string | null;
  /** The control whose link, unlink or test caused the change. */
  causeControlId: string | null;
  changedAt: string;
}

/** Rows are likelihood 1–5, columns impact 1–5: grid[likelihood - 1][impact - 1]. */
export interface Heatmap {
  inherent: number[][];
  residual: number[][];
  totalRisks: number;
}

export interface Control {
  id: string;
  name: string;
  description: string | null;
  type: ControlType;
  owner: string;
  frequency: ControlFrequency;
  latestResult: AssessmentResult | null;
  latestEffectiveness: number | null;
  lastAssessedAt: string | null;
  assessmentCount: number;
  retestRequired: boolean;
  retestReason: string | null;
  /** The risk whose worsening raised the re-test flag. */
  retestRiskId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Assessment {
  id: string;
  controlId: string;
  sequence: number;
  result: AssessmentResult;
  effectiveness: number;
  tester: string;
  evidence: string | null;
  comments: string | null;
  assessedAt: string;
  prevHash: string;
  hash: string;
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  firstBrokenAssessmentId: string | null;
  reason: string | null;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  username: string;
  roles: Role[];
}
