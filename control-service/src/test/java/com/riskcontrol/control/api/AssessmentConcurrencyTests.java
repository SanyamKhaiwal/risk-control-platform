package com.riskcontrol.control.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.riskcontrol.control.domain.Assessment;
import com.riskcontrol.control.domain.AssessmentResult;
import com.riskcontrol.control.service.AssessmentService;
import com.riskcontrol.control.service.ChainVerification;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** Several testers assess the same control at once: every assessment is kept and the chain stays linear. */
class AssessmentConcurrencyTests extends ApiTestSupport {

    private static final int TESTERS = 6;

    @Autowired
    private AssessmentService assessmentService;

    @Test
    void concurrentAssessmentsOfOneControlAllSucceedAndChainVerifies() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Assessment>> results = new ArrayList<>();

        try (ExecutorService pool = Executors.newFixedThreadPool(TESTERS)) {
            for (int i = 0; i < TESTERS; i++) {
                String tester = "tester-" + i;
                results.add(pool.submit(() -> {
                    start.await();
                    return assessmentService.record(controlId, AssessmentResult.EFFECTIVE, tester, null, null);
                }));
            }
            start.countDown();
            for (Future<Assessment> result : results) {
                result.get();
            }
        }

        assertThat(results).extracting(f -> f.get().getSequence())
                .containsExactlyInAnyOrder(1L, 2L, 3L, 4L, 5L, 6L);
        ChainVerification verification = assessmentService.verify(controlId);
        assertThat(verification.valid()).isTrue();
        assertThat(verification.checked()).isEqualTo(TESTERS);
    }
}
