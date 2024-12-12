DROP TABLE tokens;
CREATE TABLE IF NOT EXISTS tokens (user_name TEXT PRIMARY KEY, token_count INTEGER);
CREATE INDEX IF NOT EXISTS idx_tokens_user_name ON tokens(user_name)