package com.riskcontrol.control.service;

/**
 * Result of recomputing a control's hash chain. {@code checked} counts assessments that verified
 * before the first problem; {@code firstBrokenAssessmentId} is null when the problem is at the end
 * of the chain (missing assessments) or there is no problem.
 */
public record ChainVerification(boolean valid, int checked, String firstBrokenAssessmentId, String reason) {

    static ChainVerification ok(int checked) {
        return new ChainVerification(true, checked, null, null);
    }

    static ChainVerification broken(int checked, String assessmentId, String reason) {
        return new ChainVerification(false, checked, assessmentId, reason);
    }
}
