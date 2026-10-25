package dockerapi

import (
	"context"
	"encoding/json"
	"math"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

// ContainerSample is one container's resource use at a moment, in the units
// the dashboard renders: a CPU percentage across every core, memory in MB and
// the interface totals summed over every network the container is on.
type ContainerSample struct {
	CPUPercent float64 `json:"cpuPercent"`
	MemLimitMb float64 `json:"memLimitMb"`
	MemUsedMb  float64 `json:"memUsedMb"`
	NetRxBytes float64 `json:"netRxBytes"`
	NetTxBytes float64 `json:"netTxBytes"`
}

// ContainerStats reads one container's resource use.
//
// It's the daemon's one-shot answer, which doesn't wait out a second sample,
// so a percentage comes out of one request with no sampler state to keep on
// this side.
func (c *Client) ContainerStats(ctx context.Context, id string) (*ContainerSample, error) {
	stats, err := control(ctx, ControlTimeout, "stats "+shortID(id), id, func(ctx context.Context) (container.StatsResponse, error) {
		var stats container.StatsResponse
		result, err := c.api.ContainerStats(ctx, id, client.ContainerStatsOptions{})
		if err != nil {
			return stats, err
		}
		defer func() { _ = result.Body.Close() }()
		err = json.NewDecoder(result.Body).Decode(&stats)
		return stats, err
	})
	if err != nil {
		return nil, err
	}
	sample := sampleFromStats(stats)
	return &sample, nil
}

// sampleFromStats reduces a stats answer to a ContainerSample, the direct port
// of the TypeScript sampleContainerStats: the CPU delta is scaled by the
// system-wide delta and the core count, and a non-positive delta reports 0
// rather than a negative or infinite percentage.
func sampleFromStats(stats container.StatsResponse) ContainerSample {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage) - float64(stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage) - float64(stats.PreCPUStats.SystemUsage)
	cores := int(stats.CPUStats.OnlineCPUs)
	if cores == 0 {
		cores = len(stats.CPUStats.CPUUsage.PercpuUsage)
	}
	if cores == 0 {
		cores = 1
	}
	var cpuPercent float64
	if systemDelta > 0 && cpuDelta > 0 {
		cpuPercent = (cpuDelta / systemDelta) * float64(cores) * 100
	}
	sample := ContainerSample{
		CPUPercent: cpuPercent,
		MemLimitMb: float64(stats.MemoryStats.Limit) / 1024 / 1024,
		MemUsedMb:  float64(stats.MemoryStats.Usage) / 1024 / 1024,
	}
	for _, network := range stats.Networks {
		sample.NetRxBytes += float64(network.RxBytes)
		sample.NetTxBytes += float64(network.TxBytes)
	}
	return sample
}

// toInt64 converts a daemon counter, saturating rather than wrapping.
func toInt64(value uint64) int64 {
	if value > math.MaxInt64 {
		return math.MaxInt64
	}
	return int64(value)
}

// toInt converts a daemon counter, saturating rather than wrapping.
func toInt(value uint64) int {
	if value > math.MaxInt {
		return math.MaxInt
	}
	return int(value)
}
