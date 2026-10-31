import type { AssessmentResult } from '../api/types';
import { RESULT_LABEL } from '../format';

const TONE: Record<AssessmentResult, string> = {
  EFFECTIVE: 'badge--accent',
  PARTIALLY_EFFECTIVE: 'badge--MEDIUM',
  INEFFECTIVE: 'badge--alert',
};

export function ResultBadge({ result }: { result: AssessmentResult }) {
  return <span className={`badge ${TONE[result]}`}>{RESULT_LABEL[result]}</span>;
}
