FROM maven:3.8.8-eclipse-temurin-11-alpine AS build
WORKDIR /app

COPY pom.xml .
RUN mvn dependency:go-offline -B -q

COPY src ./src
RUN mvn package -DskipTests -B -q -P deploy && \
    mv target/streaming-1.0-*.war target/app.war

FROM eclipse-temurin:11-jre-alpine
WORKDIR /app

COPY --from=build /app/target/app.war app.war

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.war"]
