// Package db opens the Postgres pool the Go side of Homerun shares with the
// SvelteKit app's own database.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UTCNow is the SQL expression for "now" in the same UTC wall-clock form the
// app's Drizzle `timestamp` columns (no time zone) are written in, so a
// timestamp Go writes compares correctly with one TypeScript wrote.
const UTCNow = "(now() at time zone 'utc')"

// Connect builds a pool for databaseURL. It doesn't dial yet: the first query
// does, so a worker can start before Postgres is reachable.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, databaseURL)
}
