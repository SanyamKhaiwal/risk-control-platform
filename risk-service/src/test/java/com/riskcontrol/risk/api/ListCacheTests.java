package com.riskcontrol.risk.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.jayway.jsonpath.JsonPath;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/** The short-lived list cache (RiskListCache): your own changes show at once; others' after at most the TTL. */
@TestPropertySource(properties = "risk.list-cache.ttl=1s")
class ListCacheTests extends ApiTestSupport {

    private List<String> ids() throws Exception {
        String body = mvc.perform(get("/api/risks").param("size", "100")).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.content[*].id");
    }

    @Test
    void changesMadeThroughTheServiceShowImmediately() throws Exception {
        ids(); // fills the cache
        String id = createRisk("alice", 5, 5);
        assertThat(ids()).contains(id);
    }

    @Test
    void aChangeTheServiceDidNotMakeShowsWithinTheTtl() throws Exception {
        String id = createRisk("alice", 5, 5);
        ids(); // cached now
        jdbc.update("update risk set status = 'CLOSED' where id = ?::uuid", id);

        String cached = mvc.perform(get("/api/risks").param("size", "100")).andReturn().getResponse().getContentAsString();
        assertThat((List<String>) JsonPath.read(cached, "$.content[?(@.id == '" + id + "')].status")).containsExactly("OPEN");
        // Same thread: the signed-in test user (@WithMockUser) lives in this thread's security context.
        await().pollInSameThread().atMost(Duration.ofSeconds(3)).until(() -> {
            String body = mvc.perform(get("/api/risks").param("size", "100")).andReturn().getResponse().getContentAsString();
            return ((List<String>) JsonPath.read(body, "$.content[?(@.id == '" + id + "')].status")).contains("CLOSED");
        });
    }
}
