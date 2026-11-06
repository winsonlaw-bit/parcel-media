-- Flyway migration (OceanBase / MySQL dialect).
-- Visitor access log: "who has reviewed the proposal, and which tab".
-- Mirrors the Shippers Volume Alert project's audit_log pattern.

CREATE TABLE IF NOT EXISTS access_log (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    actor       VARCHAR(255),   -- SSO email from x-forwarded-email; 'anonymous' if none
    actor_ip    VARCHAR(64),
    tab         VARCHAR(64),    -- guide / chassis / geo / merchant / driver
    user_agent  TEXT,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_access_actor (actor),
    KEY idx_access_created (created_at)
) DEFAULT CHARSET=utf8mb4;
