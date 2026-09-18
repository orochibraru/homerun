package deploy

import (
	"context"
	"errors"
	"fmt"
	"log"
	"maps"
	"strings"
	"time"
)

// startSwarm creates or updates the swarm service backing the Homerun
// service, mirroring createAndStartSwarmService in docker/swarm.ts: an existing
// one is rolled onto the new spec in place, health-gated, anything else is
// created.
func (r *run) startSwarm(ctx context.Context, image resolvedImage) (string, error) {
	workload := r.spec.Workload
	env, err := r.workloadEnv(ctx)
	if err != nil {
		return "", err
	}
	if _, err := r.docker.EnsureNetwork(ctx, map[string]any{
		"Attachable": true,
		"Driver":     "overlay",
		"Name":       workload.Overlay,
	}); err != nil {
		return "", err
	}
	existing, err := r.docker.SwarmServicesByLabel(ctx, serviceIDLabel+"="+r.spec.ServiceID)
	if err != nil {
		return "", err
	}
	if err := r.pull(ctx, image.ref(), r.spec.Image.Auth); err != nil {
		log.Printf("[homerun-worker] pull before service create failed for %s: %s", image.ref(), err)
	}
	if workload.Privileged {
		r.progress.line("Swarm services can't run privileged or map devices : those settings are ignored under swarm mode.")
	}
	r.multiNodeWarnings(ctx, image)
	check := r.planReadiness(ctx, image.ref(), "task")

	spec := maps.Clone(workload.Template)
	task, _ := spec["TaskTemplate"].(map[string]any)
	task = maps.Clone(task)
	containerSpec, _ := task["ContainerSpec"].(map[string]any)
	containerSpec = maps.Clone(containerSpec)
	if containerSpec == nil {
		containerSpec = map[string]any{}
	}
	containerSpec["Env"] = env
	containerSpec["Image"] = image.ref()
	containerSpec["Labels"] = withLabels(containerSpec["Labels"], readinessLabels(check))
	if healthcheck := r.healthcheck(check); healthcheck != nil {
		containerSpec["Healthcheck"] = healthcheck
	}
	task["ContainerSpec"] = containerSpec
	spec["TaskTemplate"] = task
	spec["Name"] = workload.NamePrefix + "-" + randomSuffix()

	if len(existing) > 0 {
		return r.rollOutSwarm(ctx, existing[0].ID, spec)
	}
	r.progress.line("Creating swarm service...")
	id, err := r.docker.CreateSwarmService(ctx, spec)
	if err != nil {
		return "", err
	}
	log.Printf("[homerun-worker] swarm service created: id=%s service=%s", id, r.spec.ServiceID)
	return id, nil
}

// multiNodeWarnings says what stops working once the swarm has more than one
// node: a locally built image has no registry another node can pull from, and
// volumes are local to each node.
func (r *run) multiNodeWarnings(ctx context.Context, image resolvedImage) {
	nodes, err := r.docker.CountSwarmNodes(ctx)
	if err != nil || nodes < 2 {
		return
	}
	if strings.HasPrefix(image.image, "homerun-build-") {
		r.progress.line("This image was built on this host and never pushed to a registry : replicas placed on another swarm node can't pull it. Set a build cache registry on the Source tab.")
	}
	if len(r.spec.Volumes) > 0 {
		r.progress.line("Volumes are local to each swarm node : a replica placed on another node gets its own empty copy.")
	}
}

// rollOutSwarm updates an existing swarm service to spec in place (keeping its
// name, forcing new tasks) and waits for swarm to finish, mirroring
// rollOutSwarmService in docker/swarm-rollout.ts.
func (r *run) rollOutSwarm(ctx context.Context, id string, spec map[string]any) (string, error) {
	inspected, err := r.docker.InspectSwarmService(ctx, id)
	if err != nil {
		return "", err
	}
	order := swarmUpdateOrder(r.spec.Volumes)
	if order == "start-first" {
		r.progress.line("Updating the swarm service : each new task starts first, and swarm stops the old one once the new one is running (healthy, when it has a healthcheck)...")
	} else {
		r.progress.line("Updating the swarm service : a writable volume means each old task stops before its replacement starts...")
	}
	task, _ := spec["TaskTemplate"].(map[string]any)
	task = maps.Clone(task)
	task["ForceUpdate"] = inspected.Spec.TaskTemplate.ForceUpdate + 1
	update := maps.Clone(spec)
	update["Name"] = inspected.Spec.Name
	update["TaskTemplate"] = task
	update["RollbackConfig"] = map[string]any{"Order": order, "Parallelism": 1}
	update["UpdateConfig"] = map[string]any{
		"FailureAction":   "rollback",
		"MaxFailureRatio": 0,
		"Monitor":         swarmUpdateMonitorN,
		"Order":           order,
		"Parallelism":     1,
	}
	previousStartedAt := ""
	if inspected.UpdateStatus != nil {
		previousStartedAt = inspected.UpdateStatus.StartedAt
	}
	if err := r.docker.UpdateSwarmService(ctx, id, inspected.Version.Index, update); err != nil {
		return "", err
	}
	if err := r.awaitSwarmUpdate(ctx, id, previousStartedAt); err != nil {
		return "", err
	}
	r.progress.line("Swarm finished rolling out the new tasks; Traefik picks them up on its next swarm poll, within 2 seconds.")
	return id, nil
}

func (r *run) awaitSwarmUpdate(ctx context.Context, id, previousStartedAt string) error {
	started := time.Now()
	for {
		if time.Since(started) > swarmUpdateMaxWait {
			return &kindError{kind: FailureRolloutFailed, err: fmt.Errorf(
				"Swarm didn't finish updating the service within %d minutes.", int(swarmUpdateMaxWait.Minutes()))}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(rolloutPoll):
		}
		inspected, err := r.docker.InspectSwarmService(ctx, id)
		if err != nil {
			return err
		}
		switch outcome := swarmUpdateOutcome(inspected, previousStartedAt); outcome.state {
		case "completed":
			return nil
		case "failed":
			return &kindError{kind: FailureRolloutFailed, err: errors.New(outcome.reason)}
		}
	}
}
