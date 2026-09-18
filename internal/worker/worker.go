package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/secrets"
)

type worker struct {
	box               *secrets.Box
	concurrency       int
	executors         map[string]Executor
	heartbeatInterval time.Duration
	id                string
	newJob            func(c *claimed, spec json.RawMessage) jobs.Job
	pollInterval      time.Duration
	shutdownGrace     time.Duration
	store             store

	lastErr string
}

// run claims and executes jobs until ctx is cancelled, then gives in-flight
// executions shutdownGrace to finish before cancelling them and releasing
// their leases, so a restarted worker picks them straight back up.
func (w *worker) run(ctx context.Context) {
	execCtx, cancelExec := context.WithCancel(context.Background())
	defer cancelExec()

	slots := make(chan struct{}, w.concurrency)
	var inFlight sync.WaitGroup
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for ctx.Err() == nil {
		w.fill(ctx, execCtx, slots, &inFlight)
		select {
		case <-ctx.Done():
		case <-ticker.C:
		}
	}

	done := make(chan struct{})
	go func() {
		inFlight.Wait()
		close(done)
	}()
	select {
	case <-done:
		return
	case <-time.After(w.shutdownGrace):
		log.Printf("[homerun-worker] in-flight jobs outlived the %s shutdown grace, cancelling them.", w.shutdownGrace)
		cancelExec()
	}
	<-done
}

// fill claims jobs until every slot is busy or nothing is claimable.
func (w *worker) fill(ctx, execCtx context.Context, slots chan struct{}, inFlight *sync.WaitGroup) {
	for ctx.Err() == nil {
		select {
		case slots <- struct{}{}:
		default:
			return
		}
		job, err := w.store.claim(ctx, w.id)
		if err != nil || job == nil {
			<-slots
			w.reportClaimError(err)
			return
		}
		w.lastErr = ""
		inFlight.Add(1)
		go func() {
			defer inFlight.Done()
			defer func() { <-slots }()
			w.execute(ctx, execCtx, job)
		}()
	}
}

// reportClaimError logs a claim failure once per distinct message rather than
// every poll, so a Postgres outage doesn't flood the log.
func (w *worker) reportClaimError(err error) {
	if err == nil || err.Error() == w.lastErr {
		return
	}
	w.lastErr = err.Error()
	log.Printf("[homerun-worker] couldn't claim a job: %s", err)
}

// execute runs one leased job with a heartbeat, then hands the outcome back
// for the TypeScript finalize step. A lost lease (the row was cancelled or
// taken over) cancels the execution and writes nothing; a shutdown that
// cancels it releases the lease instead of recording a failure.
func (w *worker) execute(ctx, execCtx context.Context, job *claimed) {
	log.Printf("[homerun-worker] job started: type=%s job=%s attempt=%d", job.jobType, job.id, job.attempts)
	runCtx, cancel := context.WithCancel(execCtx)
	defer cancel()

	lost := make(chan struct{})
	stopHeartbeat := make(chan struct{})
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		w.heartbeat(runCtx, job.id, cancel, lost, stopHeartbeat)
	}()

	result, execErr := w.dispatch(runCtx, job)
	close(stopHeartbeat)
	<-heartbeatDone

	bookkeeping, done := context.WithTimeout(context.Background(), 10*time.Second)
	defer done()
	select {
	case <-lost:
		log.Printf("[homerun-worker] job %s is no longer leased to this worker, dropping its result.", job.id)
		return
	default:
	}
	if execErr != nil && execCtx.Err() != nil && ctx.Err() != nil {
		log.Printf("[homerun-worker] job %s interrupted by shutdown, releasing it for re-execution.", job.id)
		if err := w.store.release(bookkeeping, job.id, w.id); err != nil {
			log.Printf("[homerun-worker] couldn't release job %s: %s", job.id, err)
		}
		return
	}
	if err := w.store.finish(bookkeeping, job.id, w.id, result, execErr); err != nil {
		log.Printf("[homerun-worker] couldn't record job %s's outcome: %s", job.id, err)
		return
	}
	if execErr != nil {
		log.Printf("[homerun-worker] job failed: type=%s job=%s : %s", job.jobType, job.id, execErr)
		return
	}
	log.Printf("[homerun-worker] job executed: type=%s job=%s", job.jobType, job.id)
}

// heartbeat refreshes the lease every heartbeatInterval until stop closes. When
// the row stops being this worker's, it closes lost and cancels the execution.
func (w *worker) heartbeat(ctx context.Context, jobID string, cancel context.CancelFunc, lost, stop chan struct{}) {
	ticker := time.NewTicker(w.heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}
		ours, err := w.store.heartbeat(ctx, jobID, w.id)
		if err != nil {
			log.Printf("[homerun-worker] heartbeat for job %s failed: %s", jobID, err)
			continue
		}
		if !ours {
			close(lost)
			cancel()
			return
		}
	}
}

// dispatch decrypts the spec and runs the job's executor, turning a missing
// executor, an undecryptable spec or a panic into an ordinary error.
func (w *worker) dispatch(ctx context.Context, job *claimed) (result map[string]any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			result, err = nil, fmt.Errorf("executor panicked: %v", recovered)
		}
	}()
	executor, ok := w.executors[job.jobType]
	if !ok {
		return nil, fmt.Errorf("the worker has no executor for job type %q", job.jobType)
	}
	spec, err := w.box.Decrypt(job.spec)
	if err != nil {
		return nil, fmt.Errorf("couldn't decrypt the job spec (is AUTH_SECRET the same as the app's?): %w", err)
	}
	return executor(ctx, w.newJob(job, json.RawMessage(spec)))
}
