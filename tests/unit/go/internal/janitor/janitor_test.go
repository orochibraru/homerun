package janitor_test

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/janitor"
)

var now = time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)

type fakeDocker struct {
	mu         sync.Mutex
	containers []dockerapi.ContainerListEntry
	label      string
	removals   []string
	wedged     map[string]bool
}

// ListContainers implements janitor.Docker.
func (f *fakeDocker) ListContainers(_ context.Context, _ bool, label string) ([]dockerapi.ContainerListEntry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.label = label
	return append([]dockerapi.ContainerListEntry(nil), f.containers...), nil
}

// RemoveContainer implements janitor.Docker: a wedged container times out,
// anything else disappears from the list.
func (f *fakeDocker) RemoveContainer(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removals = append(f.removals, id)
	if f.wedged[id] {
		return &dockerapi.StallError{Call: "DELETE /containers/" + id, Container: id, Idle: time.Minute}
	}
	kept := f.containers[:0]
	for _, c := range f.containers {
		if c.ID != id {
			kept = append(kept, c)
		}
	}
	f.containers = kept
	return nil
}

// helper is a helper container in state, created age ago.
func helper(id, state string, age time.Duration) dockerapi.ContainerListEntry {
	return dockerapi.ContainerListEntry{
		ID: id, Names: []string{"/" + id}, State: state,
		Labels: map[string]string{
			dockerapi.HelperLabel:        "true",
			dockerapi.HelperCreatedLabel: now.Add(-age).Format(time.RFC3339),
		},
	}
}

func TestSweepRemovesStoppedAndOverdueHelpersOnly(t *testing.T) {
	docker := &fakeDocker{containers: []dockerapi.ContainerListEntry{
		helper("fresh-exited", "exited", time.Minute),
		helper("old-exited", "exited", 11*time.Minute),
		helper("old-created", "created", time.Hour),
		helper("busy", "running", 2*time.Hour),
		helper("forgotten", "running", 26*time.Hour),
	}}
	sweeper := &janitor.Janitor{Docker: docker, Now: func() time.Time { return now }}
	sweeper.Sweep(context.Background())

	sort.Strings(docker.removals)
	if want := []string{"forgotten", "old-created", "old-exited"}; !reflect.DeepEqual(docker.removals, want) {
		t.Fatalf("removed %v, want %v", docker.removals, want)
	}
	if docker.label != dockerapi.HelperLabel+"=true" {
		t.Errorf("only helpers must be listed, filtered on %q", docker.label)
	}
	if len(sweeper.Wedged()) != 0 {
		t.Errorf("nothing is wedged, got %v", sweeper.Wedged())
	}
}

func TestAHelperWhoseRemovalTimesOutIsWedgedAndNotRetriedInALoop(t *testing.T) {
	docker := &fakeDocker{
		containers: []dockerapi.ContainerListEntry{helper("stuck", "created", time.Hour)},
		wedged:     map[string]bool{"stuck": true},
	}
	clock := now
	sweeper := &janitor.Janitor{Docker: docker, Now: func() time.Time { return clock }}
	sweeper.Sweep(context.Background())

	wedged := sweeper.Wedged()
	if len(wedged) != 1 || wedged[0].ID != "stuck" || wedged[0].Name != "stuck" || !wedged[0].Since.Equal(now) {
		t.Fatalf("want stuck reported as wedged, got %+v", wedged)
	}
	clock = now.Add(10 * time.Minute)
	sweeper.Sweep(context.Background())
	if len(docker.removals) != 1 {
		t.Fatalf("a wedged helper must not be retried every sweep, tried %v", docker.removals)
	}

	clock = now.Add(2 * time.Hour)
	docker.wedged = nil
	sweeper.Sweep(context.Background())
	if len(docker.removals) != 2 || len(sweeper.Wedged()) != 0 {
		t.Fatalf("once Docker answers again the retry clears it, tried %v wedged %v", docker.removals, sweeper.Wedged())
	}
}

func TestAWedgedHelperTheDaemonNoLongerListsIsForgotten(t *testing.T) {
	docker := &fakeDocker{
		containers: []dockerapi.ContainerListEntry{helper("stuck", "created", time.Hour)},
		wedged:     map[string]bool{"stuck": true},
	}
	sweeper := &janitor.Janitor{Docker: docker, Now: func() time.Time { return now }}
	sweeper.Sweep(context.Background())
	docker.containers = nil
	sweeper.Sweep(context.Background())
	if len(sweeper.Wedged()) != 0 {
		t.Fatalf("a restarted daemon that dropped it clears the report, got %v", sweeper.Wedged())
	}
}

func TestAnOrdinaryRemovalErrorIsNotWedged(t *testing.T) {
	docker := &erroringDocker{fakeDocker: fakeDocker{containers: []dockerapi.ContainerListEntry{helper("gone", "exited", time.Hour)}}}
	sweeper := &janitor.Janitor{Docker: docker, Now: func() time.Time { return now }}
	sweeper.Sweep(context.Background())
	if len(sweeper.Wedged()) != 0 {
		t.Fatalf("only a timeout means wedged, got %v", sweeper.Wedged())
	}
}

type erroringDocker struct{ fakeDocker }

// RemoveContainer implements janitor.Docker, failing fast.
func (e *erroringDocker) RemoveContainer(context.Context, string) error {
	return errors.New("removal of container gone is already in progress")
}
