package agent

import (
	"bufio"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// GPUStats is the first NVIDIA GPU's reading.
type GPUStats struct {
	MemTotalMb         int    `json:"memTotalMb"`
	MemUsedMb          int    `json:"memUsedMb"`
	Name               string `json:"name"`
	UtilizationPercent int    `json:"utilizationPercent"`
}

// SystemStats is GET /v1/stats's answer, the same shape as the main app's own
// host stats so the dashboard renders a remote host exactly like the local one.
type SystemStats struct {
	CPUPercent  int       `json:"cpuPercent"`
	DiskPercent *int      `json:"diskPercent"`
	DiskTotalMb *int      `json:"diskTotalMb"`
	DiskUsedMb  *int      `json:"diskUsedMb"`
	GPU         *GPUStats `json:"gpu"`
	MemPercent  int       `json:"memPercent"`
	MemTotalMb  int       `json:"memTotalMb"`
	MemUsedMb   int       `json:"memUsedMb"`
}

type cpuSample struct {
	idle  uint64
	total uint64
}

// StatsSampler samples host usage. CPU% is a delta against the previous
// sample, so the sampler keeps the last one; the first call reports 0.
type StatsSampler struct {
	mu         sync.Mutex
	last       *cpuSample
	procRoot   string
	runCommand func(name string, args ...string) (string, bool)
}

// NewStatsSampler builds a sampler reading the real /proc and running the real
// df and nvidia-smi.
func NewStatsSampler() *StatsSampler {
	return &StatsSampler{procRoot: "/proc", runCommand: runCommand}
}

func runCommand(name string, args ...string) (string, bool) {
	output, err := exec.Command(name, args...).Output()
	if err != nil {
		return "", false
	}
	return string(output), true
}

// Sample reads CPU, memory, disk and GPU usage. Every call replaces the stored
// CPU sample. On a host without /proc (a macOS dev machine), CPU and memory
// read as zero rather than failing.
func (s *StatsSampler) Sample() SystemStats {
	stats := SystemStats{}

	if sample, ok := s.sampleCPU(); ok {
		s.mu.Lock()
		if s.last != nil && sample.total > s.last.total {
			idle := float64(sample.idle - s.last.idle)
			total := float64(sample.total - s.last.total)
			stats.CPUPercent = clamp(int(math.Round(100*(1-idle/total))), 0, 100)
		}
		s.last = &sample
		s.mu.Unlock()
	}

	if total, available, ok := s.memory(); ok {
		stats.MemTotalMb = int(math.Round(float64(total) / 1024))
		stats.MemUsedMb = stats.MemTotalMb - int(math.Round(float64(available)/1024))
		if total > 0 {
			stats.MemPercent = int(math.Round(float64(total-available) / float64(total) * 100))
		}
	}

	if totalMb, usedMb, percent, ok := s.disk(); ok {
		stats.DiskTotalMb, stats.DiskUsedMb, stats.DiskPercent = &totalMb, &usedMb, &percent
	}
	stats.GPU = s.gpu()
	return stats
}

func clamp(value, low, high int) int {
	return max(low, min(high, value))
}

// sampleCPU reads the aggregate line of /proc/stat. Total is user, nice,
// system, idle and irq, the same five counters the main app sums.
func (s *StatsSampler) sampleCPU() (cpuSample, bool) {
	file, err := os.Open(s.procRoot + "/stat")
	if err != nil {
		return cpuSample{}, false
	}
	defer func() { _ = file.Close() }()
	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return cpuSample{}, false
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 7 || fields[0] != "cpu" {
		return cpuSample{}, false
	}
	values := make([]uint64, 7)
	for index := 1; index < 7; index++ {
		parsed, err := strconv.ParseUint(fields[index], 10, 64)
		if err != nil {
			return cpuSample{}, false
		}
		values[index] = parsed
	}
	user, nice, system, idle, irq := values[1], values[2], values[3], values[4], values[6]
	return cpuSample{idle: idle, total: user + nice + system + idle + irq}, true
}

// memory reads MemTotal and MemAvailable from /proc/meminfo, in kB.
// MemAvailable, not MemFree: page cache the kernel would hand back on demand
// isn't memory in use.
func (s *StatsSampler) memory() (int, int, bool) {
	file, err := os.Open(s.procRoot + "/meminfo")
	if err != nil {
		return 0, 0, false
	}
	defer func() { _ = file.Close() }()
	values := map[string]int{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		if key == "MemTotal" || key == "MemAvailable" {
			if parsed, err := strconv.Atoi(fields[1]); err == nil {
				values[key] = parsed
			}
		}
	}
	total, hasTotal := values["MemTotal"]
	available, hasAvailable := values["MemAvailable"]
	return total, available, hasTotal && hasAvailable
}

// disk reads usage of the filesystem holding the working directory via df.
func (s *StatsSampler) disk() (int, int, int, bool) {
	output, ok := s.runCommand("df", "-Pk", ".")
	if !ok {
		return 0, 0, 0, false
	}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	fields := strings.Fields(lines[len(lines)-1])
	if len(fields) < 5 {
		return 0, 0, 0, false
	}
	totalKb, totalErr := strconv.Atoi(fields[1])
	usedKb, usedErr := strconv.Atoi(fields[2])
	if totalErr != nil || usedErr != nil || totalKb == 0 {
		return 0, 0, 0, false
	}
	percent := int(math.Round(float64(usedKb) / float64(totalKb) * 100))
	return int(math.Round(float64(totalKb) / 1024)), int(math.Round(float64(usedKb) / 1024)), percent, true
}

// gpu reads the first NVIDIA GPU's name, memory and utilisation via
// nvidia-smi, or nil when there's none.
func (s *StatsSampler) gpu() *GPUStats {
	output, ok := s.runCommand(
		"nvidia-smi",
		"--query-gpu=name,memory.total,memory.used,utilization.gpu",
		"--format=csv,noheader,nounits",
	)
	if !ok {
		return nil
	}
	first := strings.Split(strings.TrimSpace(output), "\n")[0]
	parts := strings.Split(first, ",")
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	if len(parts) < 4 || parts[0] == "" {
		return nil
	}
	atoi := func(value string) int {
		parsed, _ := strconv.Atoi(value)
		return parsed
	}
	return &GPUStats{
		MemTotalMb:         atoi(parts[1]),
		MemUsedMb:          atoi(parts[2]),
		Name:               parts[0],
		UtilizationPercent: atoi(parts[3]),
	}
}
