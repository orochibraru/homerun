package logship

import (
	"context"
	"time"

	"github.com/orochibraru/homerun/internal/logging"
)

const (
	batchSize           = 500
	deploymentsMaxAge   = 30 * time.Second
	defaultRetentionDay = 7
)

// follower tails one workload's logs into the store until its context ends.
type follower struct {
	shipper  *Shipper
	workload Workload

	last          time.Time
	deployments   []Deployment
	deploymentsAt time.Time
}

// run opens the workload's stream from the last line stored, ships it, and
// reopens it after a pause whenever it ends, backing off while nothing new
// arrives (a stopped container's stream ends straight away).
func (f *follower) run(ctx context.Context) {
	s := f.shipper
	retry := orDefault(s.Retry, 5*time.Second)
	maxRetry := orDefault(s.MaxRetry, time.Minute)
	wait := retry
	if err := f.resume(ctx); err != nil {
		if ctx.Err() != nil {
			return
		}
		logging.Warnf(scope, "couldn't read where %s's logs stopped: %s", f.workload.ServiceID, err)
	}
	for ctx.Err() == nil {
		shipped, err := f.ship(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			logging.Debugf(scope, "log stream of %s ended: %s", ShortID(f.workload.ID), err)
		}
		if shipped > 0 {
			wait = retry
		} else {
			wait = min(wait*2, maxRetry)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// resume sets where to start from: just after the last line stored for this
// workload, and never further back than the retention, so a container's whole
// history isn't copied in only to be pruned.
func (f *follower) resume(ctx context.Context) error {
	s := f.shipper
	days, err := s.Store.RetentionDays(ctx)
	if err != nil || days <= 0 {
		days = defaultRetentionDay
	}
	floor := s.now().Add(-time.Duration(days) * 24 * time.Hour).UTC()
	instance := f.workload.ID
	if !f.workload.Swarm {
		instance = ShortID(instance)
	}
	last, lastErr := s.Store.LastTime(ctx, f.workload.ServiceID, instance, f.workload.Swarm)
	f.last = floor
	if lastErr == nil && last.After(floor) {
		f.last = last
	}
	if lastErr != nil {
		return lastErr
	}
	return err
}

// ship opens the stream once and stores its lines until it ends, returning
// how many it stored.
func (f *follower) ship(ctx context.Context) (int, error) {
	s := f.shipper
	open := s.Docker.ContainerLogsSince
	if f.workload.Swarm {
		open = s.Docker.SwarmServiceLogsSince
	}
	stream, err := open(ctx, f.workload.ID, f.last)
	if err != nil {
		return 0, err
	}
	defer stream.Close()

	chunks := make(chan Chunk, 64)
	done := make(chan error, 1)
	go func() {
		done <- ReadChunks(stream, func(chunk Chunk) {
			select {
			case chunks <- chunk:
			case <-ctx.Done():
			}
		})
		close(chunks)
	}()

	ticker := time.NewTicker(orDefault(s.FlushInterval, time.Second))
	defer ticker.Stop()
	var splitter Splitter
	var batch []Line
	shipped := 0
	collect := func(name, text string) {
		if line, ok := f.line(ctx, name, text); ok {
			batch = append(batch, line)
		}
	}
	flush := func() {
		if len(batch) == 0 {
			return
		}
		insertCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		err := s.Store.Insert(insertCtx, batch)
		cancel()
		if err != nil {
			logging.Warnf(scope, "dropped %d log lines of %s: %s", len(batch), f.workload.ServiceID, err)
		} else {
			shipped += len(batch)
		}
		batch = batch[:0]
	}
	for {
		select {
		case chunk, ok := <-chunks:
			if !ok {
				splitter.Flush(collect)
				flush()
				return shipped, <-done
			}
			splitter.Feed(chunk, collect)
			if len(batch) >= batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// line turns one raw line into a row, skipping what was already stored: the
// daemon's since is inclusive, so a reopened stream repeats its last line.
func (f *follower) line(ctx context.Context, stream, raw string) (Line, bool) {
	parsed, ok := ParseLine(raw, f.workload.Swarm)
	if !ok || !parsed.Time.After(f.last) {
		return Line{}, false
	}
	f.last = parsed.Time
	instance := ShortID(f.workload.ID)
	if f.workload.Swarm {
		instance = parsed.TaskID
	}
	return Line{
		DeploymentID: DeploymentAt(f.revisions(ctx), parsed.Time),
		Instance:     instance,
		ServiceID:    f.workload.ServiceID,
		Stream:       stream,
		Text:         Clean(parsed.Text),
		Time:         parsed.Time,
	}, true
}

// revisions is the workload's deployments, re-read at most every 30 seconds
// so a swarm service update's new revision is picked up.
func (f *follower) revisions(ctx context.Context) []Deployment {
	s := f.shipper
	if !f.deploymentsAt.IsZero() && s.now().Sub(f.deploymentsAt) < deploymentsMaxAge {
		return f.deployments
	}
	f.deploymentsAt = s.now()
	deployments, err := s.Store.Deployments(ctx, f.workload.ServiceID, f.workload.ID)
	if err != nil {
		if ctx.Err() == nil {
			logging.Warnf(scope, "couldn't read %s's deployments: %s", f.workload.ServiceID, err)
		}
		return f.deployments
	}
	f.deployments = deployments
	return deployments
}
