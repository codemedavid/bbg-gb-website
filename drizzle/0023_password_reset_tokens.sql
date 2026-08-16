--- Forgotten-password resets.
---
--- Until now the only way to change a password was /api/auth/password, which
--- demands the current one. A customer who forgot theirs had no route back into
--- their account at all — they had to message the admin, who has no supported
--- way to set it for them either.
---
--- The reset link mailed to the account address is a bearer credential: whoever
--- holds it can take the account over. So this table stores the SHA-256 hash of
--- the token and never the token itself, exactly like users.password_hash — a
--- dump of this table must not yield a single usable link.
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  --- 64 hex characters of SHA-256. UNIQUE so a lookup by hash can never match
  --- two rows, and so a repeated insert fails loudly instead of forking.
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  --- Stamped when the token is spent. Single use: a link that still works after
  --- the password changed is a second key left under the mat.
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

--- Requesting a reset invalidates the account's earlier outstanding links, which
--- reads every live token of one user.
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id");
