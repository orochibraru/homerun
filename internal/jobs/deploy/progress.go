package deploy

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/jobs"
)

const (
	// PhaseSource is the deploy log line marking the start of a git build's
	// clone.
	PhaseSource = "▸ Cloning repository"
	// PhaseImage is the deploy log line marking the start of the image's pull
	// or build.
	PhaseImage = "▸ Fetching image"
	// PhaseScan is the deploy log line marking the start of the image scan.
	PhaseScan = "▸ Scanning image"
	// PhaseContainer is the deploy log line marking the start of container
	// provisioning.
	PhaseContainer = "▸ Provisioning container"
	// PhaseHealth is the deploy log line marking the wait for the new workload
	// to become ready.
	PhaseHealth = "▸ Waiting until healthy"
	// PhaseNetwork is the deploy log line marking the start of Traefik routing.
	PhaseNetwork = "▸ Routing traffic"
)

type progress struct {
	deploymentID string
	job          jobs.Job
	serviceID    string
}

// line appends one line to the deployment's log, the one the Overview's
// progress panel polls, and records it on the job's current trace span. A failed write is logged, never returned. Without a
// database (a test's Recorder job) the line goes to the job's own log.
func (p progress) line(line string) {
	pool := p.job.DB()
	if pool == nil {
		p.job.AppendLog(line)
		return
	}
	p.job.Trace(line)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := pool.Exec(ctx,
		`update deployment set log = coalesce(log, '') || $2 || E'\n' where id = $1`,
		p.deploymentID, line); err != nil {
		log.Printf("[homerun-worker] couldn't append to deployment %s's log: %s", p.deploymentID, err)
	}
}

// building passes a builder's output on to line, writing PhaseImage once the
// clone is done and the build itself starts.
func (p progress) building() func(string) {
	started := false
	return func(line string) {
		if !started && strings.HasPrefix(line, "Building with ") {
			started = true
			p.line(PhaseImage)
		}
		p.line(line)
	}
}

// serviceStatus sets the service's live status, which its page polls.
func (p progress) serviceStatus(ctx context.Context, status string) {
	pool := p.job.DB()
	if pool == nil {
		return
	}
	if _, err := pool.Exec(ctx, `update service set current_status = $2 where id = $1`, p.serviceID, status); err != nil {
		log.Printf("[homerun-worker] couldn't set service %s's status: %s", p.serviceID, err)
	}
}
