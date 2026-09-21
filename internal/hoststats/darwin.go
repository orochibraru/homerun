package hoststats

import (
	"runtime"
	"strconv"
	"strings"
)

// darwinMemory reads total and available memory on a host with no /proc, in
// kB, to match what the /proc/meminfo path returns.
//
// This exists for the developer machine, not for production: Homerun runs on
// Linux, where /proc is read directly. But `bun run dev` runs the worker
// natively on macOS, and without this the dashboard's Host Resources panel
// reports 0 MB of 0 MB there, which reads as a bug rather than as an
// unsupported platform.
//
// Both commands have to answer: knowing the machine's capacity but not how
// much of it is in use would render as a full-size bar at zero, which reads
// as an idle machine rather than as a missing measurement.
//
// Total comes from `sysctl hw.memsize`. Used is the sum of the page classes
// `vm_stat` reports as actually occupied — active, wired and compressed —
// which is what Activity Monitor calls memory used; inactive and speculative
// pages are reclaimable, so counting them would report a Mac as permanently
// near full.
func (s *StatsSampler) darwinMemory() (int, int, bool) {
	output, ok := s.RunCommand("sysctl", "-n", "hw.memsize")
	if !ok {
		return 0, 0, false
	}
	bytes, err := strconv.ParseInt(strings.TrimSpace(output), 10, 64)
	if err != nil || bytes <= 0 {
		return 0, 0, false
	}
	totalKb := int(bytes / 1024)

	stat, ok := s.RunCommand("vm_stat")
	if !ok {
		return 0, 0, false
	}
	pageSize, pages := parseVmStat(stat)
	if pageSize == 0 {
		return 0, 0, false
	}
	usedKb := int(int64(pages) * pageSize / 1024)
	if usedKb > totalKb {
		usedKb = totalKb
	}
	return totalKb, totalKb - usedKb, true
}

// parseVmStat pulls the page size and the number of occupied pages out of
// `vm_stat`'s output.
func parseVmStat(output string) (int64, int64) {
	var pageSize, pages int64
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, "Mach Virtual Memory Statistics") {
			pageSize = pageSizeFrom(line)
			continue
		}
		name, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		switch strings.TrimSpace(name) {
		case "Pages active", "Pages wired down", "Pages occupied by compressor":
			pages += countFrom(value)
		}
	}
	return pageSize, pages
}

// pageSizeFrom reads the page size out of vm_stat's header line, which reads
// "(page size of 16384 bytes)".
func pageSizeFrom(line string) int64 {
	_, rest, found := strings.Cut(line, "page size of ")
	if !found {
		return 0
	}
	size, _, _ := strings.Cut(rest, " ")
	parsed, err := strconv.ParseInt(strings.TrimSpace(size), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// countFrom reads one of vm_stat's page counts, which end in a period.
func countFrom(value string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(value), ".")), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// darwinCPUPercent approximates host CPU use on a machine with no /proc, by
// summing every process's share and dividing by the core count.
//
// Deliberately an approximation, and only ever used on a developer machine:
// `ps` reports each process's CPU as a percentage of one core averaged over
// its lifetime, so this tracks sustained load well and a brief spike poorly.
// Getting it exact would mean host_processor_info through cgo, which is not
// worth carrying for a platform Homerun doesn't deploy to.
func (s *StatsSampler) darwinCPUPercent() (int, bool) {
	output, ok := s.RunCommand("ps", "-A", "-o", "%cpu=")
	if !ok {
		return 0, false
	}
	var total float64
	for _, line := range strings.Split(output, "\n") {
		field := strings.TrimSpace(line)
		if field == "" {
			continue
		}
		if parsed, err := strconv.ParseFloat(field, 64); err == nil {
			total += parsed
		}
	}
	cores := runtime.NumCPU()
	if cores < 1 {
		cores = 1
	}
	return Clamp(int(total/float64(cores)), 0, 100), true
}
