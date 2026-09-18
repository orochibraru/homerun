package worker

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL isn't set, skipping the real-Postgres lease test")
	}
	ctx := context.Background()
	schema := fmt.Sprintf("worker_test_%d", time.Now().UnixNano())
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if err := admin.Ping(ctx); err != nil {
		admin.Close()
		t.Skipf("Postgres isn't reachable: %s", err)
	}
	if _, err := admin.Exec(ctx, "create schema "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "drop schema "+schema+" cascade")
		admin.Close()
	})

	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `create table job (
		id text primary key, type text not null, status text not null, stage text, spec text,
		attempts integer not null default 1, priority integer not null default 0,
		created_at timestamp not null default now(), worker_id text, heartbeat_at timestamp,
		executor_result jsonb, executor_error text, log text not null default '')`); err != nil {
		t.Fatal(err)
	}
	return pool
}

func TestPgStoreLeaseLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := pgStore{pool: pool}
	if _, err := pool.Exec(ctx, `insert into job (id, type, status, stage, spec, priority, created_at) values
		('queued', 'deploy', 'queued', null, null, 9, now()),
		('prepared', 'deploy', 'running', 'execute', 'sealed', 0, now() - interval '1 minute'),
		('urgent', 'backup', 'running', 'execute', 'sealed2', 5, now()),
		('finalizing', 'deploy', 'running', 'finalize', null, 9, now())`); err != nil {
		t.Fatal(err)
	}

	first, err := s.claim(ctx, "w1")
	if err != nil || first == nil || first.id != "urgent" || first.spec != "sealed2" {
		t.Fatalf("priority wins, got %+v, %v", first, err)
	}
	second, _ := s.claim(ctx, "w2")
	if second == nil || second.id != "prepared" {
		t.Fatalf("then the oldest, got %+v", second)
	}
	if none, _ := s.claim(ctx, "w3"); none != nil {
		t.Fatalf("a live lease isn't claimable, got %+v", none)
	}

	if ours, err := s.heartbeat(ctx, "urgent", "w1"); err != nil || !ours {
		t.Errorf("the owner's heartbeat lands, got %v %v", ours, err)
	}
	if ours, _ := s.heartbeat(ctx, "urgent", "w2"); ours {
		t.Error("a heartbeat from another worker doesn't")
	}

	if _, err := pool.Exec(ctx, `update job set heartbeat_at = now() at time zone 'utc' - interval '2 minutes' where id = 'prepared'`); err != nil {
		t.Fatal(err)
	}
	stolen, _ := s.claim(ctx, "w3")
	if stolen == nil || stolen.id != "prepared" {
		t.Fatalf("an expired lease is taken over, got %+v", stolen)
	}
	if ours, _ := s.heartbeat(ctx, "prepared", "w2"); ours {
		t.Error("the previous owner learns its lease is gone")
	}

	if err := s.finish(ctx, "urgent", "w1", map[string]any{"key": "b.tar"}, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.finish(ctx, "prepared", "w3", nil, fmt.Errorf("pull failed")); err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx, `select id, stage, coalesce(executor_result::text, ''), coalesce(executor_error, ''), worker_id is null from job where stage = 'finalize' order by id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string][3]string{}
	for rows.Next() {
		var id, stage, result, message string
		var released bool
		if err := rows.Scan(&id, &stage, &result, &message, &released); err != nil {
			t.Fatal(err)
		}
		if !released {
			t.Errorf("%s still has a worker after finishing", id)
		}
		got[id] = [3]string{stage, result, message}
	}
	if got["urgent"][1] != `{"key": "b.tar"}` || got["prepared"][2] != "pull failed" {
		t.Errorf("unexpected finalize rows %+v", got)
	}

	if _, err := pool.Exec(ctx, `insert into job (id, type, status, stage, spec) values ('again', 'deploy', 'running', 'execute', 's')`); err != nil {
		t.Fatal(err)
	}
	leased, _ := s.claim(ctx, "w1")
	if err := s.release(ctx, leased.id, "w1"); err != nil {
		t.Fatal(err)
	}
	if reclaimed, _ := s.claim(ctx, "w2"); reclaimed == nil || reclaimed.id != "again" {
		t.Errorf("a released job is immediately claimable again, got %+v", reclaimed)
	}
}
