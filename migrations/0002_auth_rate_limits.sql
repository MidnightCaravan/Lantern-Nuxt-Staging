CREATE TABLE auth_rate_limits (
    key_hash TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_rate_limits_expires_at
    ON auth_rate_limits(expires_at);
