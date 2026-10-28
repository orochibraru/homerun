// Package logship keeps every deployed service's logs past the life of its
// container: one follower per workload (a standalone container or a swarm
// service) tails the daemon's log stream with timestamps and copies the lines
// into the service_log table in batches, so a service's history survives its
// next deploy. The app prunes the table past the retention it's configured
// with. See .agents/notes/observability.md.
package logship

import (
	"context"
	"io"
	"sort"
	"sync"
	"time"

	"github.com/orochibraru/homerun/internal/logging"
)

const scope = "logship"

// Docker is the part of the Docker client the shipper needs.
type Docker interface {
	ContainerLogsSince(ctx context.Context, id string, since time.Time) (io.ReadCloser, error)
	SwarmServiceLogsSince(ctx context.Context, id string, since time.Time) (io.ReadCloser, error)
}

// Store is where the shipper reads what to follow and writes what it read.
type Store interface {
	Workloads(ctx context.Context) ([]Workload, error)
	RetentionDays(ctx context.Context) (int, error)
	LastTime(ctx context.Context, serviceID, instance string, swarm bool) (time.Time, error)
	Deployments(ctx context.Context, serviceID, workloadID string) ([]Deployment, error)
	Insert(ctx context.Context, lines []Line) error
}

// Workload is one deployed service's container or swarm service.
type Workload struct {
	ServiceID string
	ID        string
	Swarm     bool
}

// Deployment is one revision of a workload and when it started running.
type Deployment struct {
	ID    string
	Since time.Time
}

// Line is one stored log line.
type Line struct {
	ServiceID    string
	DeploymentID string
	Instance     string
	Stream       string
	Time         time.Time
	Text         string
}

// Shipper follows every deployed workload. The zero durations fall back to
// the defaults: the workload list re-read every 15 seconds, lines flushed
// every second (or every 500 lines), a broken or finished stream reopened
// after 5 seconds, backing off to a minute while it stays quiet.
type Shipper struct {
	Docker        Docker
	Store         Store
	Interval      time.Duration
	FlushInterval time.Duration
	Retry         time.Duration
	MaxRetry      time.Duration
	Now           func() time.Time

	mu        sync.Mutex
	followers map[string]context.CancelFunc
	wg        sync.WaitGroup
}

// now is s.Now() or the wall clock.
func (s *Shipper) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// orDefault returns value, or fallback when value is zero.
func orDefault(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

// Run syncs the followers straight away, then every Interval until ctx is
// cancelled, and waits for every follower to flush and stop before returning.
func (s *Shipper) Run(ctx context.Context) {
	ticker := time.NewTicker(orDefault(s.Interval, 15*time.Second))
	defer ticker.Stop()
	for {
		s.Sync(ctx)
		select {
		case <-ctx.Done():
			s.wg.Wait()
			return
		case <-ticker.C:
		}
	}
}

// Sync starts a follower for every deployed workload that has none and stops
// the followers of workloads that are gone.
func (s *Shipper) Sync(ctx context.Context) {
	workloads, err := s.Store.Workloads(ctx)
	if err != nil {
		if ctx.Err() == nil {
			logging.Warnf(scope, "couldn't list the deployed services: %s", err)
		}
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.followers == nil {
		s.followers = map[string]context.CancelFunc{}
	}
	wanted := map[string]Workload{}
	for _, workload := range workloads {
		wanted[workload.ServiceID+"/"+workload.ID] = workload
	}
	for key, cancel := range s.followers {
		if _, ok := wanted[key]; !ok {
			cancel()
			delete(s.followers, key)
		}
	}
	keys := make([]string, 0, len(wanted))
	for key := range wanted {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if _, ok := s.followers[key]; ok {
			continue
		}
		followCtx, cancel := context.WithCancel(ctx)
		s.followers[key] = cancel
		f := &follower{shipper: s, workload: wanted[key]}
		s.wg.Go(func() { f.run(followCtx) })
	}
}

// Following is how many workloads have a follower right now.
func (s *Shipper) Following() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.followers)
}
