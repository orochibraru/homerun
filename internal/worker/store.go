package worker

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/orochibraru/homerun/internal/db"
)

const leaseTimeoutSQL = "interval '60 seconds'"

// ClaimedJob is one job row leased by a worker: its id, type, encrypted spec
// and attempt count.
type ClaimedJob struct {
	Attempts int
	ID       string
	JobType  string
	Spec     string
}

// Store leases and settles job rows for a Worker. PGStore is the real,
// Postgres-backed implementation; a test fakes it instead of a database.
type Store interface {
	Claim(ctx context.Context, workerID string) (*ClaimedJob, error)
	Heartbeat(ctx context.Context, jobID, workerID string) (bool, error)
	Finish(ctx context.Context, jobID, workerID string, result map[string]any, execErr error) error
	Release(ctx context.Context, jobID, workerID string) error
}

// PGStore is Store backed by the app's own Postgres job table.
type PGStore struct {
	Pool *pgxpool.Pool
}

// Claim leases the highest-priority, oldest claimable job row (queued for
// execution and either unleased or whose lease has expired) to workerID.
func (s PGStore) Claim(ctx context.Context, workerID string) (*ClaimedJob, error) {
	row := s.Pool.QueryRow(ctx, `
		with next as (
			select id from job
			where status = 'running' and stage = 'execute'
				and (worker_id is null or heartbeat_at is null or heartbeat_at < `+db.UTCNow+` - `+leaseTimeoutSQL+`)
			order by priority desc, created_at
			for update skip locked
			limit 1
		)
		update job set worker_id = $1, heartbeat_at = `+db.UTCNow+`
		from next where job.id = next.id
		returning job.id, job.type, coalesce(job.spec, ''), job.attempts`, workerID)
	var job ClaimedJob
	if err := row.Scan(&job.ID, &job.JobType, &job.Spec, &job.Attempts); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &job, nil
}

// Heartbeat refreshes jobID's lease and reports whether workerID still owns it.
func (s PGStore) Heartbeat(ctx context.Context, jobID, workerID string) (bool, error) {
	tag, err := s.Pool.Exec(ctx, `
		update job set heartbeat_at = `+db.UTCNow+`
		where id = $1 and worker_id = $2 and status = 'running' and stage = 'execute'`, jobID, workerID)
	if err != nil {
		return true, err
	}
	return tag.RowsAffected() == 1, nil
}

// Finish records a leased job's outcome and moves it to the finalize stage.
func (s PGStore) Finish(ctx context.Context, jobID, workerID string, result map[string]any, execErr error) error {
	var resultJSON *string
	if result != nil {
		encoded, err := json.Marshal(result)
		if err != nil {
			return err
		}
		text := string(encoded)
		resultJSON = &text
	}
	var message *string
	if execErr != nil {
		text := execErr.Error()
		message = &text
	}
	_, err := s.Pool.Exec(ctx, `
		update job set stage = 'finalize', executor_result = $3::jsonb, executor_error = $4,
			worker_id = null, heartbeat_at = null
		where id = $1 and worker_id = $2 and status = 'running' and stage = 'execute'`,
		jobID, workerID, resultJSON, message)
	return err
}

// Release drops jobID's lease without recording an outcome, so another
// worker (or this one, after a restart) can claim it again.
func (s PGStore) Release(ctx context.Context, jobID, workerID string) error {
	_, err := s.Pool.Exec(ctx, `
		update job set worker_id = null, heartbeat_at = null
		where id = $1 and worker_id = $2`, jobID, workerID)
	return err
}
