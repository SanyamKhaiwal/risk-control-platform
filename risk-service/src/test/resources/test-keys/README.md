Test-only keys. Never use them outside tests.

- `jwt-*.pem`: RSA pair used to sign and verify JWTs in tests.
- `events-risk-*.pem`, `events-control-*.pem`: Ed25519 pairs for signed Kafka events. Both private keys are here so
  tests can publish events as the other service would; in a real deployment each service only holds its own.
