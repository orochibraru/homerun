package hoststats

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// processSplitter separates the sections ProcessScript prints.
const processSplitter = "@@homerun-processes@@"

// ProcessScript prints two readings of every process on the host a second
// apart, for ParseProcesses: the host's CPU line, every /proc/<pid>/stat, each
// process's resident memory and cgroup, then the CPU line and the stats again.
// A process that exits between the glob and the read only costs a line on
// stderr, and the final `true` keeps the exit code clean.
const ProcessScript = "head -n1 /proc/stat; echo " + processSplitter +
	"; cat /proc/[0-9]*/stat 2>/dev/null; echo " + processSplitter +
	"; grep -H VmRSS /proc/[0-9]*/status 2>/dev/null; echo " + processSplitter +
	"; grep -H . /proc/[0-9]*/cgroup 2>/dev/null; echo " + processSplitter +
	"; sleep 1; head -n1 /proc/stat; echo " + processSplitter +
	"; cat /proc/[0-9]*/stat 2>/dev/null; true"

// Process is every process sharing a name and a cgroup unit, summed.
type Process struct {
	// Container is whether they run inside a container.
	Container bool `json:"container"`
	// Count is how many processes were summed.
	Count int `json:"count"`
	// CPUPercent is their share of every core together over the second
	// measured, the scale the host's own CPU% is on.
	CPUPercent float64 `json:"cpuPercent"`
	// Group is the last part of their cgroup path: a systemd unit such as
	// docker.service, or a container's short id.
	Group     string  `json:"group"`
	MemUsedMb float64 `json:"memUsedMb"`
	Name      string  `json:"name"`
}

var containerID = regexp.MustCompile(`[0-9a-f]{64}`)

// processTicks is one process's name and CPU time in clock ticks.
type processTicks struct {
	name  string
	ticks uint64
}

// Processes reads every process on this host natively, the way agent mode
// does: it runs on the host itself, so /proc is the host's.
func (s *StatsSampler) Processes() []Process {
	output, _ := s.RunCommand("sh", "-c", ProcessScript)
	return ParseProcesses(output)
}

// ParseProcesses turns ProcessScript's output into the host's processes,
// grouped by name and cgroup unit, busiest CPU first. Only processes alive at
// both readings count toward CPU; empty when the output isn't ProcessScript's.
func ParseProcesses(output string) []Process {
	sections := strings.Split(output, processSplitter)
	if len(sections) != 6 {
		return []Process{}
	}
	totalBefore, okBefore := cpuLineTotal(sections[0])
	totalAfter, okAfter := cpuLineTotal(sections[4])
	if !okBefore || !okAfter || totalAfter <= totalBefore {
		return []Process{}
	}
	elapsed := float64(totalAfter - totalBefore)
	before := parseProcessStats(sections[1])
	after := parseProcessStats(sections[5])
	memory := parseProcessMemory(sections[2])
	cgroups := parseProcessCgroups(sections[3])

	type groupKey struct {
		container bool
		group     string
		name      string
	}
	grouped := map[groupKey]*Process{}
	for pid, now := range after {
		cgroup := cgroups[pid]
		key := groupKey{container: cgroup.container, group: cgroup.group, name: now.name}
		entry, ok := grouped[key]
		if !ok {
			entry = &Process{Container: key.container, Group: key.group, Name: key.name}
			grouped[key] = entry
		}
		entry.Count++
		entry.MemUsedMb += float64(memory[pid]) / 1024
		if then, seen := before[pid]; seen && now.ticks >= then.ticks {
			entry.CPUPercent += float64(now.ticks-then.ticks) / elapsed * 100
		}
	}
	processes := make([]Process, 0, len(grouped))
	for _, entry := range grouped {
		processes = append(processes, *entry)
	}
	sort.Slice(processes, func(i, j int) bool {
		if processes[i].CPUPercent != processes[j].CPUPercent {
			return processes[i].CPUPercent > processes[j].CPUPercent
		}
		if processes[i].MemUsedMb != processes[j].MemUsedMb {
			return processes[i].MemUsedMb > processes[j].MemUsedMb
		}
		return processes[i].Name < processes[j].Name
	})
	return processes
}

// cpuLineTotal sums every counter on /proc/stat's aggregate cpu line, in clock
// ticks across every core.
func cpuLineTotal(section string) (uint64, bool) {
	fields := strings.Fields(section)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, false
	}
	var total uint64
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return 0, false
		}
		total += value
	}
	return total, true
}

// parseProcessStats reads /proc/<pid>/stat lines into each process's name and
// user plus system ticks. The name sits in parentheses and may hold spaces or
// parentheses itself, so the fields after it are counted from the last ")".
func parseProcessStats(section string) map[int]processTicks {
	stats := map[int]processTicks{}
	for _, line := range strings.Split(section, "\n") {
		open := strings.Index(line, " (")
		closing := strings.LastIndex(line, ")")
		if open < 0 || closing < open {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(line[:open]))
		if err != nil {
			continue
		}
		rest := strings.Fields(line[closing+1:])
		if len(rest) < 13 {
			continue
		}
		user, userErr := strconv.ParseUint(rest[11], 10, 64)
		system, systemErr := strconv.ParseUint(rest[12], 10, 64)
		if userErr != nil || systemErr != nil {
			continue
		}
		stats[pid] = processTicks{name: line[open+2 : closing], ticks: user + system}
	}
	return stats
}

// pidFromPath reads the pid out of a `/proc/<pid>/<file>:` prefix grep -H
// writes, along with what follows the colon.
func pidFromPath(line string) (int, string, bool) {
	path, value, found := strings.Cut(line, ":")
	if !found {
		return 0, "", false
	}
	parts := strings.Split(path, "/")
	if len(parts) < 3 {
		return 0, "", false
	}
	pid, err := strconv.Atoi(parts[2])
	return pid, value, err == nil
}

// parseProcessMemory reads `/proc/<pid>/status:VmRSS: 1234 kB` lines into each
// process's resident memory in kB. Kernel threads have none.
func parseProcessMemory(section string) map[int]int {
	memory := map[int]int{}
	for _, line := range strings.Split(section, "\n") {
		pid, value, ok := pidFromPath(line)
		if !ok {
			continue
		}
		fields := strings.Fields(strings.TrimPrefix(value, "VmRSS:"))
		if len(fields) == 0 {
			continue
		}
		if kb, err := strconv.Atoi(fields[0]); err == nil {
			memory[pid] = kb
		}
	}
	return memory
}

// processCgroup is where a process sits: whether in a container, and the unit
// or container naming it.
type processCgroup struct {
	container bool
	group     string
}

// parseProcessCgroups reads `/proc/<pid>/cgroup:<hierarchy>:<controllers>:<path>`
// lines. A path holding a 64-hex id is a container's, whatever the cgroup
// driver or the rootless nesting around it; the group is the path's last part,
// the unified hierarchy's line winning over a v1 controller's.
func parseProcessCgroups(section string) map[int]processCgroup {
	cgroups := map[int]processCgroup{}
	for _, line := range strings.Split(section, "\n") {
		pid, value, ok := pidFromPath(line)
		if !ok {
			continue
		}
		parts := strings.SplitN(value, ":", 3)
		if len(parts) < 3 {
			continue
		}
		path := parts[2]
		current, seen := cgroups[pid]
		if id := containerID.FindString(path); id != "" {
			cgroups[pid] = processCgroup{container: true, group: id[:12]}
			continue
		}
		if current.container || (seen && parts[0] != "0") {
			continue
		}
		segments := strings.Split(strings.TrimRight(path, "/"), "/")
		group := segments[len(segments)-1]
		if group == "" || group == ".." {
			group = "/"
		}
		cgroups[pid] = processCgroup{group: group}
	}
	return cgroups
}
