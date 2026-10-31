package com.riskcontrol.control.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.data.mongodb.core.query.Criteria.where;
import static org.springframework.data.mongodb.core.query.Query.query;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.jayway.jsonpath.JsonPath;
import com.riskcontrol.control.domain.Control;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.test.context.TestPropertySource;

/** The short-lived list cache (ControlListCache): your own changes show at once; others' after at most the TTL. */
@TestPropertySource(properties = "control.list-cache.ttl=1s")
class ListCacheTests extends ApiTestSupport {

    private List<String> names() throws Exception {
        String body = mvc.perform(get("/api/controls").param("size", "100")).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.content[*].name");
    }

    @Test
    void changesMadeThroughTheServiceShowImmediately() throws Exception {
        names(); // fills the cache
        String id = createControl("bob", "PREVENTIVE");
        String name = mongo.findById(id, Control.class).getName();
        assertThat(names()).contains(name);

        assess(id, "INEFFECTIVE", "carol");
        String body = mvc.perform(get("/api/controls").param("size", "100")).andReturn().getResponse().getContentAsString();
        List<String> latest = JsonPath.read(body, "$.content[?(@.id == '" + id + "')].latestResult");
        assertThat(latest).containsExactly("INEFFECTIVE");
    }

    @Test
    void aChangeTheServiceDidNotMakeShowsWithinTheTtl() throws Exception {
        String id = createControl("bob", "DETECTIVE");
        names(); // cached now
        mongo.updateFirst(query(where("_id").is(id)), Update.update("name", "Renamed behind the service's back"), Control.class);

        assertThat(names()).doesNotContain("Renamed behind the service's back"); // served from the cache
        await().pollInSameThread().atMost(Duration.ofSeconds(3)).until(() -> names().contains("Renamed behind the service's back"));
    }
}
