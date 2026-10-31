# syntax=docker/dockerfile:1.7
# One image recipe for the three Java services. Build from the repo root:
#   docker build -f deploy/docker/java-service.Dockerfile --build-arg MODULE=risk-service .

# Compiled for Java 21 (pom.xml), run on Java 25 for its ahead-of-time cache (below).
ARG JDK_IMAGE=eclipse-temurin:25.0.4_7-jdk-noble
ARG JRE_IMAGE=eclipse-temurin:25.0.4_7-jre-noble

# ---- Build: compile the module and split the jar into layers ----
FROM ${JDK_IMAGE} AS build
ARG MODULE
WORKDIR /src

# POMs first, so the dependency download is cached until a POM changes.
COPY mvnw pom.xml ./
COPY .mvn .mvn
COPY risk-service/pom.xml risk-service/
COPY control-service/pom.xml control-service/
COPY gateway/pom.xml gateway/
RUN chmod +x mvnw
COPY ${MODULE}/src ${MODULE}/src

# Tests run in CI, not in the image build. The Maven cache is shared by the three service builds, which run
# in parallel; "locked" makes them take turns so they don't race to unpack the same files.
RUN --mount=type=cache,target=/root/.m2,sharing=locked \
    ./mvnw -B -ntp -q -pl ${MODULE} -am package -DskipTests \
 && cp ${MODULE}/target/${MODULE}-*.jar /app.jar \
 && java -Djarmode=tools -jar /app.jar extract --layers --destination /extracted

# ---- Run: small JRE image, non-root, layers ordered from least to most often changed ----
FROM ${JRE_IMAGE}
ARG MODULE
RUN groupadd --system app && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /extracted/dependencies/ ./
COPY --from=build /extracted/spring-boot-loader/ ./
COPY --from=build /extracted/snapshot-dependencies/ ./
COPY --from=build /extracted/application/ ./
# Ahead-of-time cache (JEP 483/514/515): a training start at build time records the classes Spring loads and links,
# and how hot methods were used; every real start then maps them in instead of redoing that work (docs/kubernetes.md,
# "Faster restarts"). The training run stops once the application context is ready, before anything connects
# (spring.context.exit=onRefresh), so it needs no database, Kafka or Redis: migrations, schema checks and index
# creation are switched off for it, and it uses the test keys, mounted for this step only (never in the image).
# A cache that doesn't match the JVM it's used with is ignored with a warning, never an error.
RUN --mount=type=bind,from=build,source=/src/${MODULE}/src/test/resources/test-keys,target=/app/deploy/keys \
    java -XX:AOTCacheOutput=/app/app.aot -Xlog:aot=error -Dspring.context.exit=onRefresh \
      -Dspring.flyway.enabled=false -Dspring.jpa.hibernate.ddl-auto=none \
      -Dspring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect \
      -Dspring.jpa.properties.hibernate.boot.allow_jdbc_metadata_access=false \
      -Dspring.data.mongodb.auto-index-creation=false \
      -jar app.jar > /dev/null \
 && test -s /app/app.aot
USER app
# Size the heap from the container's memory limit; exit (and get restarted) rather than limp on after OOM.
# The JVM picks the garbage collector itself (Serial, with this little memory). G1 and Parallel were tried and measured
# worse on a 4-core laptop: more GC threads competing for the same cores (docs/performance.md).
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-XX:AOTCache=/app/app.aot", "-jar", "app.jar"]
