package dockerapi

import (
	"context"
	"strings"
	"sync"
)

// ContainerUsage is one running container's share of the host right now, for
// telling what is using the CPU or the memory. CPUPercent counts 100 per core
// the way `docker stats` does; HostCPUPercent is the same share of every core
// together, comparable with the host's own CPU percentage.
type ContainerUsage struct {
	CPUPercent     float64           `json:"cpuPercent"`
	HostCPUPercent float64           `json:"hostCpuPercent"`
	ID             string            `json:"id"`
	Image          string            `json:"image"`
	Labels         map[string]string `json:"labels"`
	MemUsedMb      float64           `json:"memUsedMb"`
	Name           string            `json:"name"`
}

// usageSamplers is how many containers ContainersUsage samples at once: each
// stats answer waits out the daemon's own second reading, so one at a time
// would take a second per container.
const usageSamplers = 16

// ContainersUsage samples every running container's CPU and memory at once.
// Only the homerun.* labels are kept, which is how the app names the
// container after its service, workstation or job. A container that can't be
// sampled (it just stopped) is left out rather than failing the sweep.
func (c *Client) ContainersUsage(ctx context.Context) ([]ContainerUsage, error) {
	listed, err := c.listContainers(ctx, false, "")
	if err != nil {
		return nil, err
	}
	results := make([]*ContainerUsage, len(listed))
	slots := make(chan struct{}, usageSamplers)
	var wait sync.WaitGroup
	for index, entry := range listed {
		wait.Add(1)
		slots <- struct{}{}
		go func() {
			defer wait.Done()
			defer func() { <-slots }()
			sample, err := c.ContainerStats(ctx, entry.ID)
			if err != nil {
				return
			}
			labels := map[string]string{}
			for key, value := range entry.Labels {
				if strings.HasPrefix(key, "homerun.") || strings.HasPrefix(key, "com.docker.swarm.service.name") {
					labels[key] = value
				}
			}
			name := entry.ID[:min(12, len(entry.ID))]
			if len(entry.Names) > 0 {
				name = strings.TrimPrefix(entry.Names[0], "/")
			}
			results[index] = &ContainerUsage{
				CPUPercent:     sample.CPUPercent,
				HostCPUPercent: sample.CPUPercent / float64(max(1, sample.Cores)),
				ID:             entry.ID,
				Image:          entry.Image,
				Labels:         labels,
				MemUsedMb:      sample.MemUsedMb,
				Name:           name,
			}
		}()
	}
	wait.Wait()
	usage := make([]ContainerUsage, 0, len(results))
	for _, result := range results {
		if result != nil {
			usage = append(usage, *result)
		}
	}
	return usage, nil
}
