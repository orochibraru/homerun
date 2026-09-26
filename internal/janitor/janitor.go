// Package janitor removes the throwaway helper containers Homerun leaves
// behind (a backup's tar, an env file read, a one-off run) once they've
// stopped or outlived any job, and remembers the ones the daemon won't remove
// in time: a wedged container, which only restarting Docker clears, and which
// the worker reports on its health endpoint instead of retrying in a loop.
package janitor

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/logging"
)

const scope = "janitor"

// Docker is the part of the Docker client the janitor needs.
type Docker interface {
	ListContainers(ctx context.Context, all bool, label string) ([]dockerapi.ContainerListEntry, error)
	RemoveContainer(ctx context.Context, id string) error
}

// Wedged is a helper the daemon wouldn't remove in time.
type Wedged struct {
	ID    string    `json:"id"`
	Name  string    `json:"name"`
	Since time.Time `json:"since"`
}

// Janitor sweeps helper containers. The zero durations fall back to the
// defaults: a sweep every 5 minutes, stopped helpers removed after 10
// minutes, running ones after 25 hours (past the longest cron job timeout),
// and a wedged one retried once an hour.
type Janitor struct {
	Docker     Docker
	Interval   time.Duration
	MaxRunning time.Duration
	MaxStopped time.Duration
	RetryAfter time.Duration
	Now        func() time.Time

	mu     sync.Mutex
	tried  map[string]time.Time
	wedged map[string]Wedged
}

// now is j.Now() or the wall clock.
func (j *Janitor) now() time.Time {
	if j.Now != nil {
		return j.Now()
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

// Run sweeps once straight away, then every Interval until ctx is cancelled.
func (j *Janitor) Run(ctx context.Context) {
	ticker := time.NewTicker(orDefault(j.Interval, 5*time.Minute))
	defer ticker.Stop()
	for {
		j.Sweep(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Sweep removes every helper that's stopped and older than MaxStopped, or
// still running past MaxRunning, one at a time, each bounded by the Docker
// client's control timeout. A removal that times out marks the container
// wedged (logged once) and it's only retried after RetryAfter; one that
// succeeds, or that the daemon no longer lists, stops being wedged.
func (j *Janitor) Sweep(ctx context.Context) {
	helpers, err := j.Docker.ListContainers(ctx, true, dockerapi.HelperLabel+"=true")
	if err != nil {
		logging.Warnf(scope, "couldn't list helper containers: %s", err)
		return
	}
	now := j.now()
	j.forgetGone(helpers)
	for _, helper := range helpers {
		if ctx.Err() != nil {
			return
		}
		if !j.due(helper, now) {
			continue
		}
		j.remove(ctx, helper, now)
	}
}

// due reports whether helper should be removed now: old enough for its state,
// and not a wedged one tried less than RetryAfter ago.
func (j *Janitor) due(helper dockerapi.ContainerListEntry, now time.Time) bool {
	age := now.Sub(createdAt(helper))
	limit := orDefault(j.MaxStopped, 10*time.Minute)
	if helper.State == "running" {
		limit = orDefault(j.MaxRunning, 25*time.Hour)
	}
	if age < limit {
		return false
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	last, tried := j.tried[helper.ID]
	return !tried || now.Sub(last) >= orDefault(j.RetryAfter, time.Hour)
}

// remove force-removes helper, recording it as wedged when the daemon doesn't
// answer in time.
func (j *Janitor) remove(ctx context.Context, helper dockerapi.ContainerListEntry, now time.Time) {
	err := j.Docker.RemoveContainer(ctx, helper.ID)
	j.mu.Lock()
	defer j.mu.Unlock()
	if err == nil {
		delete(j.tried, helper.ID)
		delete(j.wedged, helper.ID)
		logging.Infof(scope, "removed leftover helper %s (%s, %s)", nameOf(helper), helper.State, short(helper.ID))
		return
	}
	if j.tried == nil {
		j.tried = map[string]time.Time{}
		j.wedged = map[string]Wedged{}
	}
	j.tried[helper.ID] = now
	if !dockerapi.IsStall(err) {
		logging.Warnf(scope, "couldn't remove helper %s: %s", short(helper.ID), err)
		return
	}
	if _, known := j.wedged[helper.ID]; !known {
		j.wedged[helper.ID] = Wedged{ID: helper.ID, Name: nameOf(helper), Since: now}
		logging.Errorf(scope, "helper %s (%s) is wedged: the Docker daemon didn't answer while removing it. "+
			"Traefik's docker provider stalls on it too; restarting Docker clears it (sudo systemctl restart docker)",
			nameOf(helper), short(helper.ID))
	}
}

// forgetGone drops wedged and retry entries for containers the daemon no
// longer lists (Docker was restarted, or someone removed them by hand).
func (j *Janitor) forgetGone(helpers []dockerapi.ContainerListEntry) {
	present := make(map[string]bool, len(helpers))
	for _, helper := range helpers {
		present[helper.ID] = true
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	for id := range j.tried {
		if !present[id] {
			delete(j.tried, id)
			delete(j.wedged, id)
		}
	}
}

// Wedged lists the helpers the daemon wouldn't remove, oldest first.
func (j *Janitor) Wedged() []Wedged {
	j.mu.Lock()
	defer j.mu.Unlock()
	list := make([]Wedged, 0, len(j.wedged))
	for _, wedged := range j.wedged {
		list = append(list, wedged)
	}
	sort.Slice(list, func(a, b int) bool { return list[a].Since.Before(list[b].Since) })
	return list
}

// createdAt is when helper was created: its HelperCreatedLabel, else the
// daemon's own creation time.
func createdAt(helper dockerapi.ContainerListEntry) time.Time {
	if stamp, err := time.Parse(time.RFC3339, helper.Labels[dockerapi.HelperCreatedLabel]); err == nil {
		return stamp
	}
	return time.Unix(helper.Created, 0)
}

// nameOf is the container's name without Docker's leading slash, or its
// short id when it has none.
func nameOf(helper dockerapi.ContainerListEntry) string {
	if len(helper.Names) > 0 {
		return strings.TrimPrefix(helper.Names[0], "/")
	}
	return short(helper.ID)
}

// short is a container id cut to the 12 characters `docker ps` shows.
func short(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
