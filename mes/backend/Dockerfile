# MES server for Render (or any container host). Build: docker build -t caseflow-mes mes/backend
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /src/target/case-assembly-mes-0.0.1-SNAPSHOT.jar app.jar
# DATABASE_URL (postgresql://user:password@host/db?sslmode=require) selects the postgres profile by itself.
ENV MES_PLC_MODE=twin JAVA_TOOL_OPTIONS="-Xmx320m -XX:+UseSerialGC"
EXPOSE 8085
CMD ["java", "-jar", "app.jar"]
