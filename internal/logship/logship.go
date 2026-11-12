// Package logship keeps container logs past the life of their container: one
// follower per workload (a deployed service's standalone container or swarm
// service, a workstation's container on this daemon, one of Homerun's own
// containers) tails the daemon's log stream with timestamps and copies the
// lines into the service_log table in batches, so the history survives the
// next deploy or recreate. The app prunes the table past the retention it's
// configured with. See .agents/notes/observability.md.
package logship

import (
	"context"
	"io"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/zedensix/homerun/internal/dockerapi"
	"github.com/zedensix/homerun/internal/logging"
	"github.com/zedensix/homerun/internal/workstation"
)

const scope = "logship"

const (
	coreLabel           = "homerun.core"
	composeProjectLabel = "com.docker.compose.project"
	composeServiceLabel = "com.docker.compose.service"
)

// Docker is the part of the Docker client the shipper needs.
type Docker interface {
	ContainerLogsSince(ctx context.Context, id string, since time.Time) (io.ReadCloser, error)
	SwarmServiceLogsSince(ctx context.Context, id string, since time.Time) (io.ReadCloser, error)
	ListContainers(ctx context.Context, all bool, label string) ([]dockerapi.ContainerListEntry, error)
}

// Store is where the shipper reads what to follow and writes what it read.
type Store interface {
	Workloads(ctx context.Context) ([]Workload, error)
	LocalWorkstations(ctx context.Context) ([]string, error)
	RetentionDays(ctx context.Context) (int, error)
	LastTime(ctx context.Context, owner Owner, instance string, swarm bool) (time.Time, error)
	Deployments(ctx context.Context, serviceID, workloadID string) ([]Deployment, error)
	Insert(ctx context.Context, lines []Line) error
}

// Owner is whose output a line is: exactly one of a service, a workstation or
// one of Homerun's own containers, named by its compose service (or core
// label, or container name) so its history carries over a recreate.
type Owner struct {
	ServiceID     string
	WorkstationID string
	System        string
}

// String names the owner for a follower key and a log message.
func (o Owner) String() string {
	switch {
	case o.ServiceID != "":
		return "service " + o.ServiceID
	case o.WorkstationID != "":
		return "workstation " + o.WorkstationID
	}
	return "system " + o.System
}

// Workload is one container or swarm service whose output is kept.
type Workload struct {
	Owner Owner
	ID    string
	Swarm bool
}

// Deployment is one revision of a workload and when it started running.
type Deployment struct {
	ID    string
	Since time.Time
}

// Line is one stored log line.
type Line struct {
	Owner        Owner
	DeploymentID string
	Instance     string
	Stream       string
	Time         time.Time
	Text         string
}

// ContainerWorkloads picks, among every container on the daemon, the ones
// whose output is kept besides services': the container of each workstation
// in workstationIDs, and Homerun's own containers, the same set the app's
// system logs list: anything with the homerun.core label, plus every
// container of the compose project the container named hostname (the worker
// itself) belongs to, or of any compose project when the worker isn't in one.
// Containers Homerun deployed (the homerun.managed label) are never its own.
func ContainerWorkloads(containers []dockerapi.ContainerListEntry, workstationIDs []string, hostname string) []Workload {
	ownProject := ""
	for _, entry := range containers {
		if isContainer(entry, hostname) {
			ownProject = entry.Labels[composeProjectLabel]
			break
		}
	}
	local := map[string]bool{}
	for _, id := range workstationIDs {
		local[id] = true
	}
	var workloads []Workload
	for _, entry := range containers {
		labels := entry.Labels
		if id := labels[workstation.IDLabel]; id != "" {
			if local[id] {
				workloads = append(workloads, Workload{ID: entry.ID, Owner: Owner{WorkstationID: id}})
			}
			continue
		}
		if labels[dockerapi.ManagedLabel] != "" {
			continue
		}
		project := labels[composeProjectLabel]
		own := project != "" && (ownProject == "" || project == ownProject)
		if labels[coreLabel] == "" && !own {
			continue
		}
		workloads = append(workloads, Workload{ID: entry.ID, Owner: Owner{System: systemName(entry)}})
	}
	return workloads
}

// isContainer reports whether entry is the container named hostname, which
// Docker sets to the container's short id unless told otherwise.
func isContainer(entry dockerapi.ContainerListEntry, hostname string) bool {
	if hostname == "" {
		return false
	}
	if len(hostname) >= 12 && strings.HasPrefix(entry.ID, hostname) {
		return true
	}
	for _, name := range entry.Names {
		if strings.TrimPrefix(name, "/") == hostname {
			return true
		}
	}
	return false
}

// systemName is how one of Homerun's own containers is named in its history,
// the way the system logs page names it: its compose service, else its core
// label, else its container name.
func systemName(entry dockerapi.ContainerListEntry) string {
	if name := entry.Labels[composeServiceLabel]; name != "" {
		return name
	}
	if name := entry.Labels[coreLabel]; name != "" {
		return name
	}
	if len(entry.Names) > 0 {
		return strings.TrimPrefix(entry.Names[0], "/")
	}
	return ShortID(entry.ID)
}

// Shipper follows every workload whose output is kept. The zero durations
// fall back to the defaults: the workload list re-read every 15 seconds,
// lines flushed every second (or every 500 lines), a broken or finished
// stream reopened after 5 seconds, backing off to a minute while it stays
// quiet. An empty Hostname reads the worker's own.
type Shipper struct {
	Docker        Docker
	Store         Store
	Hostname      string
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

// hostname is s.Hostname or the machine's, which inside a container is the
// container's own.
func (s *Shipper) hostname() string {
	if s.Hostname != "" {
		return s.Hostname
	}
	name, _ := os.Hostname()
	return name
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

// Sync starts a follower for every workload that has none and stops the
// followers of workloads that are gone. A failed listing changes nothing.
func (s *Shipper) Sync(ctx context.Context) {
	workloads, err := s.workloads(ctx)
	if err != nil {
		if ctx.Err() == nil {
			logging.Warnf(scope, "couldn't list what to follow: %s", err)
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
		wanted[workload.Owner.String()+"/"+workload.ID] = workload
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

// workloads is every deployed service's workload, then every workstation and
// Homerun container on this daemon.
func (s *Shipper) workloads(ctx context.Context) ([]Workload, error) {
	workloads, err := s.Store.Workloads(ctx)
	if err != nil {
		return nil, err
	}
	workstations, err := s.Store.LocalWorkstations(ctx)
	if err != nil {
		return nil, err
	}
	containers, err := s.Docker.ListContainers(ctx, true, "")
	if err != nil {
		return nil, err
	}
	return append(workloads, ContainerWorkloads(containers, workstations, s.hostname())...), nil
}

// Following is how many workloads have a follower right now.
func (s *Shipper) Following() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.followers)
}
