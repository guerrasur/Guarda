CREATE TABLE authorizations (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires INTEGER NOT NULL
);
CREATE INDEX authorizations_expiry ON authorizations(expires);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires INTEGER NOT NULL,
  refreshing_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires);
