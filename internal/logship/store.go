package logship

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore is the Store over the app's Postgres.
type PGStore struct {
	Pool *pgxpool.Pool
}

// Workloads is every service with a container or a swarm service.
func (s PGStore) Workloads(ctx context.Context) ([]Workload, error) {
	rows, err := s.Pool.Query(ctx, `select id, container_id, swarm_service_id from service
		where container_id is not null or swarm_service_id is not null`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var workloads []Workload
	for rows.Next() {
		var id string
		var containerID, swarmID *string
		if err := rows.Scan(&id, &containerID, &swarmID); err != nil {
			return nil, err
		}
		if swarmID != nil && *swarmID != "" {
			workloads = append(workloads, Workload{ID: *swarmID, ServiceID: id, Swarm: true})
		} else if containerID != nil && *containerID != "" {
			workloads = append(workloads, Workload{ID: *containerID, ServiceID: id})
		}
	}
	return workloads, rows.Err()
}

// RetentionDays is how many days of logs the instance keeps, 0 when unset.
func (s PGStore) RetentionDays(ctx context.Context) (int, error) {
	var days *int
	err := s.Pool.QueryRow(ctx, `select log_retention_days from instance_settings limit 1`).Scan(&days)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && days == nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return *days, nil
}

// LastTime is the newest line stored for one container of a service, or for
// the whole service when it runs in swarm mode (whose task ids change with
// every update), the zero time when there's none.
func (s PGStore) LastTime(ctx context.Context, serviceID, instance string, swarm bool) (time.Time, error) {
	var last *time.Time
	var err error
	if swarm {
		err = s.Pool.QueryRow(ctx, `select max(time) from service_log where service_id = $1`, serviceID).Scan(&last)
	} else {
		err = s.Pool.QueryRow(ctx, `select max(time) from service_log where service_id = $1 and instance = $2`, serviceID, instance).Scan(&last)
	}
	if err != nil || last == nil {
		return time.Time{}, err
	}
	return utcWall(*last), nil
}

// utcWall reads a timestamp column's wall clock as UTC, which is how the app
// writes every timestamp without a time zone.
func utcWall(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC)
}

// Deployments is every deployment that ran this workload, oldest first, each
// with when it started.
func (s PGStore) Deployments(ctx context.Context, serviceID, workloadID string) ([]Deployment, error) {
	rows, err := s.Pool.Query(ctx, `select id, coalesce(started_at, created_at) from deployment
		where service_id = $1 and container_id = $2 order by 2`, serviceID, workloadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var deployments []Deployment
	for rows.Next() {
		var d Deployment
		if err := rows.Scan(&d.ID, &d.Since); err != nil {
			return nil, err
		}
		d.Since = utcWall(d.Since)
		deployments = append(deployments, d)
	}
	return deployments, rows.Err()
}

// Insert copies a batch of lines in.
func (s PGStore) Insert(ctx context.Context, lines []Line) error {
	_, err := s.Pool.CopyFrom(ctx, pgx.Identifier{"service_log"},
		[]string{"service_id", "deployment_id", "instance", "stream", "time", "line"},
		pgx.CopyFromSlice(len(lines), func(i int) ([]any, error) {
			line := lines[i]
			var deploymentID *string
			if line.DeploymentID != "" {
				deploymentID = &line.DeploymentID
			}
			return []any{line.ServiceID, deploymentID, line.Instance, line.Stream, line.Time.UTC(), line.Text}, nil
		}))
	return err
}
