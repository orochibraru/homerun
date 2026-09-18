// Package cleanup executes docker_cleanup jobs for the homerun worker: the
// Docker Cleanup page's prunes, the orphan stack network sweep and the
// homerun-mirror garbage collection. Every retention list comes resolved in
// the spec from the app's prepare step.
package cleanup

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs"
)

// Spec is what the app's prepare step hands over for one cleanup.
type Spec struct {
	Action             string      `json:"action"`
	All                bool        `json:"all"`
	KeepImageIDs       []string    `json:"keepImageIds"`
	KeepVolumeNames    []string    `json:"keepVolumeNames"`
	LiveStackIDs       []string    `json:"liveStackIds"`
	Mirror             *MirrorSpec `json:"mirror"`
	StackNetworkPrefix string      `json:"stackNetworkPrefix"`
}

type summary = map[string]any

func pruneSummary(deleted int, reclaimed int64) summary {
	return summary{"itemsDeleted": deleted, "spaceReclaimedBytes": reclaimed}
}

// Run executes one docker_cleanup job against the local daemon.
func Run(ctx context.Context, job jobs.Job) (map[string]any, error) {
	return run(ctx, job, dockerapi.New(job.DockerSocket))
}

func run(ctx context.Context, job jobs.Job, docker *dockerapi.Client) (map[string]any, error) {
	var spec Spec
	if err := job.DecodeSpec(&spec); err != nil {
		return nil, err
	}
	c := cleaner{docker: docker, job: job}
	switch spec.Action {
	case "pruneBuildCache":
		return c.buildCache(ctx)
	case "pruneContainers":
		return c.containers(ctx)
	case "pruneImages":
		return c.images(ctx, spec.All, spec.KeepImageIDs)
	case "pruneMirror":
		if spec.Mirror == nil {
			return nil, errors.New("pruneMirror spec carries no mirror")
		}
		return c.mirror(ctx, *spec.Mirror)
	case "pruneNetworks":
		return c.networks(ctx)
	case "pruneSystem":
		return c.system(ctx, spec.KeepImageIDs)
	case "pruneVolumes":
		return c.volumes(ctx, spec.KeepVolumeNames)
	case "reclaimStackNetworks":
		return c.stackNetworks(ctx, spec.StackNetworkPrefix, spec.LiveStackIDs)
	}
	return nil, fmt.Errorf("unknown cleanup action %q", spec.Action)
}

type cleaner struct {
	docker *dockerapi.Client
	job    jobs.Job
}

func (c cleaner) logf(format string, args ...any) {
	c.job.AppendLog(fmt.Sprintf(format, args...))
}

func (c cleaner) containers(ctx context.Context) (summary, error) {
	report, err := c.docker.PruneContainers(ctx)
	if err != nil {
		return nil, err
	}
	c.logf("Pruned %d stopped container(s), reclaimed %d bytes", report.Deleted, report.SpaceReclaimed)
	return pruneSummary(report.Deleted, report.SpaceReclaimed), nil
}

func (c cleaner) networks(ctx context.Context) (summary, error) {
	report, err := c.docker.PruneNetworks(ctx)
	if err != nil {
		return nil, err
	}
	c.logf("Pruned %d unused network(s)", report.Deleted)
	return pruneSummary(report.Deleted, 0), nil
}

func (c cleaner) buildCache(ctx context.Context) (summary, error) {
	report, err := c.docker.PruneBuildCache(ctx)
	if err != nil {
		return nil, err
	}
	c.logf("Pruned build cache, reclaimed %d bytes", report.SpaceReclaimed)
	return pruneSummary(0, report.SpaceReclaimed), nil
}

func isDangling(tags []string) bool {
	return len(tags) == 0 || (len(tags) == 1 && tags[0] == "<none>:<none>")
}

func shortID(id string) string {
	id = strings.TrimPrefix(id, "sha256:")
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func setOf(values []string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value] = true
	}
	return set
}

func (c cleaner) images(ctx context.Context, all bool, keepIDs []string) (summary, error) {
	suffix := ""
	if all {
		suffix = " (including tagged)"
	}
	if len(keepIDs) == 0 {
		report, err := c.docker.PruneImages(ctx, all)
		if err != nil {
			return nil, err
		}
		c.logf("Pruned %d unused image(s)%s, reclaimed %d bytes", report.Deleted, suffix, report.SpaceReclaimed)
		return pruneSummary(report.Deleted, report.SpaceReclaimed), nil
	}
	usage, err := c.docker.SystemDiskUsage(ctx)
	if err != nil {
		return nil, err
	}
	keep := setOf(keepIDs)
	deleted, reclaimed := 0, int64(0)
	for _, image := range usage.Images {
		if image.ID == "" || keep[image.ID] || image.Containers > 0 || (!all && !isDangling(image.RepoTags)) {
			continue
		}
		if err := c.docker.RemoveUnusedImage(ctx, image.ID); err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			c.logf("Skipped image %s during prune: %s", shortID(image.ID), err)
			continue
		}
		deleted++
		reclaimed += image.Size
	}
	c.logf("Pruned %d unused image(s)%s, kept %d retained revision image(s), reclaimed %d bytes", deleted, suffix, len(keep), reclaimed)
	return pruneSummary(deleted, reclaimed), nil
}

func prunableVolumes(volumes []dockerapi.DiskUsageVolume, keep map[string]bool) []dockerapi.DiskUsageVolume {
	var prunable []dockerapi.DiskUsageVolume
	for _, volume := range volumes {
		if (volume.UsageData == nil || volume.UsageData.RefCount <= 0) && !keep[volume.Name] {
			prunable = append(prunable, volume)
		}
	}
	return prunable
}

func (c cleaner) volumes(ctx context.Context, keepNames []string) (summary, error) {
	if len(keepNames) == 0 {
		report, err := c.docker.PruneVolumes(ctx)
		if err != nil {
			return nil, err
		}
		c.logf("Pruned %d unused volume(s), reclaimed %d bytes", report.Deleted, report.SpaceReclaimed)
		return pruneSummary(report.Deleted, report.SpaceReclaimed), nil
	}
	usage, err := c.docker.SystemDiskUsage(ctx)
	if err != nil {
		return nil, err
	}
	keep := setOf(keepNames)
	deleted, reclaimed := 0, int64(0)
	for _, volume := range prunableVolumes(usage.Volumes, keep) {
		if volume.Name == "" {
			continue
		}
		if err := c.docker.RemoveVolume(ctx, volume.Name); err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			c.logf("Skipped volume %s during prune: %s", volume.Name, err)
			continue
		}
		deleted++
		if volume.UsageData != nil && volume.UsageData.Size > 0 {
			reclaimed += volume.UsageData.Size
		}
	}
	c.logf("Pruned %d unused volume(s), kept %d volume(s) mounted by Homerun services, reclaimed %d bytes", deleted, len(keep), reclaimed)
	return pruneSummary(deleted, reclaimed), nil
}

func (c cleaner) system(ctx context.Context, keepImageIDs []string) (summary, error) {
	containers, err := c.containers(ctx)
	if err != nil {
		return nil, err
	}
	images, err := c.images(ctx, false, keepImageIDs)
	if err != nil {
		return nil, err
	}
	networks, err := c.networks(ctx)
	if err != nil {
		return nil, err
	}
	buildCache, err := c.buildCache(ctx)
	if err != nil {
		return nil, err
	}
	return summary{"buildCache": buildCache, "containers": containers, "images": images, "networks": networks}, nil
}

func (c cleaner) stackNetworks(ctx context.Context, prefix string, liveIDs []string) (summary, error) {
	if prefix == "" {
		return nil, errors.New("reclaimStackNetworks spec carries no network prefix")
	}
	networks, err := c.docker.NetworkList(ctx)
	if err != nil {
		return nil, err
	}
	live := setOf(liveIDs)
	var removed []string
	for _, network := range networks {
		stackID, ok := strings.CutPrefix(network.Name, prefix)
		if !ok || stackID == "" || live[stackID] || len(network.Containers) > 0 {
			continue
		}
		if err := c.docker.NetworkRemove(ctx, network.ID); err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			c.logf("Couldn't remove orphan network %s: %s", network.Name, err)
			continue
		}
		removed = append(removed, network.Name)
	}
	if len(removed) > 0 {
		c.logf("Reclaimed %d orphan stack network(s): %s", len(removed), strings.Join(removed, ", "))
	}
	return pruneSummary(len(removed), 0), nil
}
