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

type claimed struct {
	attempts int
	id       string
	jobType  string
	spec     string
}

type store interface {
	claim(ctx context.Context, workerID string) (*claimed, error)
	heartbeat(ctx context.Context, jobID, workerID string) (bool, error)
	finish(ctx context.Context, jobID, workerID string, result map[string]any, execErr error) error
	release(ctx context.Context, jobID, workerID string) error
}

type pgStore struct {
	pool *pgxpool.Pool
}

func (s pgStore) claim(ctx context.Context, workerID string) (*claimed, error) {
	row := s.pool.QueryRow(ctx, `
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
	var job claimed
	if err := row.Scan(&job.id, &job.jobType, &job.spec, &job.attempts); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &job, nil
}

func (s pgStore) heartbeat(ctx context.Context, jobID, workerID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		update job set heartbeat_at = `+db.UTCNow+`
		where id = $1 and worker_id = $2 and status = 'running' and stage = 'execute'`, jobID, workerID)
	if err != nil {
		return true, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s pgStore) finish(ctx context.Context, jobID, workerID string, result map[string]any, execErr error) error {
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
	_, err := s.pool.Exec(ctx, `
		update job set stage = 'finalize', executor_result = $3::jsonb, executor_error = $4,
			worker_id = null, heartbeat_at = null
		where id = $1 and worker_id = $2 and status = 'running' and stage = 'execute'`,
		jobID, workerID, resultJSON, message)
	return err
}

func (s pgStore) release(ctx context.Context, jobID, workerID string) error {
	_, err := s.pool.Exec(ctx, `
		update job set worker_id = null, heartbeat_at = null
		where id = $1 and worker_id = $2`, jobID, workerID)
	return err
}
