package dockerapi

import (
	"context"
	"net/http"
	"net/url"
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

// statsPayload is the part of the daemon's stats answer a sample reads.
type statsPayload struct {
	CPUStats    cpuStats `json:"cpu_stats"`
	MemoryStats struct {
		Limit float64 `json:"limit"`
		Usage float64 `json:"usage"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RxBytes float64 `json:"rx_bytes"`
		TxBytes float64 `json:"tx_bytes"`
	} `json:"networks"`
	PreCPUStats cpuStats `json:"precpu_stats"`
}

// cpuStats is one side of the daemon's CPU delta.
type cpuStats struct {
	CPUUsage struct {
		PerCPUUsage []float64 `json:"percpu_usage"`
		TotalUsage  float64   `json:"total_usage"`
	} `json:"cpu_usage"`
	OnlineCPUs     int     `json:"online_cpus"`
	SystemCPUUsage float64 `json:"system_cpu_usage"`
}

// ContainerStats reads one container's resource use.
//
// The daemon's own `?stream=false` answer already carries the previous sample
// in precpu_stats, so a percentage comes out of a single request with no
// sampler state to keep on this side. A container the daemon can't stat at all
// (gone, or never started) reports a nil sample rather than an error: a stats
// panel showing one blank row is the right answer there, not a failed page.
func (c *Client) ContainerStats(ctx context.Context, id string) (*ContainerSample, error) {
	var payload statsPayload
	err := c.decode(ctx, http.MethodGet, "/containers/"+id+"/stats",
		url.Values{"one-shot": {"1"}, "stream": {"false"}}, nil, &payload)
	if err != nil {
		return nil, err
	}
	sample := sampleFromStats(payload)
	return &sample, nil
}

// sampleFromStats reduces a raw stats answer to a ContainerSample, the direct
// port of the TypeScript sampleContainerStats: the CPU delta is scaled by the
// system-wide delta and the core count, and a non-positive delta reports 0
// rather than a negative or infinite percentage.
func sampleFromStats(payload statsPayload) ContainerSample {
	cpuDelta := payload.CPUStats.CPUUsage.TotalUsage - payload.PreCPUStats.CPUUsage.TotalUsage
	systemDelta := payload.CPUStats.SystemCPUUsage - payload.PreCPUStats.SystemCPUUsage
	cores := payload.CPUStats.OnlineCPUs
	if cores == 0 {
		cores = len(payload.CPUStats.CPUUsage.PerCPUUsage)
	}
	if cores == 0 {
		cores = 1
	}
	var cpuPercent float64
	if systemDelta > 0 && cpuDelta > 0 {
		cpuPercent = (cpuDelta / systemDelta) * float64(cores) * 100
	}
	if cpuPercent < 0 {
		cpuPercent = 0
	}
	sample := ContainerSample{
		CPUPercent: cpuPercent,
		MemLimitMb: payload.MemoryStats.Limit / 1024 / 1024,
		MemUsedMb:  payload.MemoryStats.Usage / 1024 / 1024,
	}
	for _, network := range payload.Networks {
		sample.NetRxBytes += network.RxBytes
		sample.NetTxBytes += network.TxBytes
	}
	return sample
}
