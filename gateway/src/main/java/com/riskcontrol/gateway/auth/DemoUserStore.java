package com.riskcontrol.gateway.auth;

import com.riskcontrol.gateway.auth.AuthProperties.DemoUser;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

@Component
class DemoUserStore {

    static final Set<String> ROLES = Set.of("RISK_OWNER", "CONTROL_OWNER", "CONTROL_TESTER", "VIEWER");

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    private final Map<String, DemoUser> users;
    /** Checked for unknown usernames so they take as long as wrong passwords (no user enumeration by timing). */
    private final String dummyHash = encoder.encode(UUID.randomUUID().toString());

    DemoUserStore(AuthProperties properties) {
        for (DemoUser user : properties.users()) {
            if (!ROLES.containsAll(user.roles())) {
                throw new IllegalStateException("User " + user.username() + " has an unknown role: " + user.roles());
            }
        }
        this.users = properties.users().stream().collect(Collectors.toMap(DemoUser::username, Function.identity()));
    }

    /** Blocking (bcrypt is deliberately slow); call off the event loop. */
    Optional<DemoUser> authenticate(String username, String password) {
        DemoUser user = users.get(username);
        boolean matches = encoder.matches(password, user != null ? user.passwordHash() : dummyHash);
        return user != null && matches ? Optional.of(user) : Optional.empty();
    }
}
