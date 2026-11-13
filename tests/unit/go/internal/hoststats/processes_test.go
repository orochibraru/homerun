package hoststats_test

import (
	"strings"
	"testing"

	"github.com/zedensix/homerun/internal/hoststats"
)

const splitter = "@@homerun-processes@@"

func statLine(pid, name string, user, system string) string {
	return pid + " (" + name + ") S 1 1 1 0 -1 4194560 100 0 0 0 " + user + " " + system + " 0 0 20 0 1 0 100 1000000 250 18446744073709551615"
}

func scriptOutput(sections ...string) string {
	return strings.Join(sections, "\n"+splitter+"\n")
}

func TestParseProcessesGroupsAndMeasures(t *testing.T) {
	containerPath := "0::/user.slice/user-1000.slice/user@1000.service/user.slice/docker-" + strings.Repeat("ab", 32) + ".scope"
	output := scriptOutput(
		"cpu  1000 0 1000 8000 0 0 0 0 0 0",
		strings.Join([]string{
			statLine("10", "slirp4netns", "100", "100"),
			statLine("20", "php fpm (pool)", "10", "0"),
			statLine("21", "php fpm (pool)", "10", "0"),
			statLine("30", "postgres", "50", "0"),
			statLine("40", "gone", "5", "5"),
		}, "\n"),
		strings.Join([]string{
			"/proc/10/status:VmRSS:\t   20480 kB",
			"/proc/20/status:VmRSS:\t   10240 kB",
			"/proc/21/status:VmRSS:\t   10240 kB",
			"/proc/30/status:VmRSS:\t  102400 kB",
		}, "\n"),
		strings.Join([]string{
			"/proc/10/cgroup:0::/user.slice/user-1000.slice/user@1000.service/app.slice/docker.service",
			"/proc/20/cgroup:0::/system.slice/php-fpm.service",
			"/proc/21/cgroup:0::/system.slice/php-fpm.service",
			"/proc/30/cgroup:" + containerPath,
		}, "\n"),
		"cpu  1500 0 1500 9000 0 0 0 0 0 0",
		strings.Join([]string{
			statLine("10", "slirp4netns", "500", "300"),
			statLine("20", "php fpm (pool)", "30", "0"),
			statLine("21", "php fpm (pool)", "30", "0"),
			statLine("30", "postgres", "70", "0"),
			statLine("50", "new", "40", "0"),
		}, "\n"),
	)

	processes := hoststats.ParseProcesses(output)
	if len(processes) != 4 {
		t.Fatalf("want 4 groups, got %+v", processes)
	}
	slirp := processes[0]
	if slirp.Name != "slirp4netns" || slirp.Group != "docker.service" || slirp.Container || slirp.Count != 1 {
		t.Errorf("busiest first, named after its unit, got %+v", slirp)
	}
	if slirp.CPUPercent != 30 || slirp.MemUsedMb != 20 {
		t.Errorf("600 of 2000 ticks is 30%% of the host, got %+v", slirp)
	}
	php := processes[1]
	if php.Name != "php fpm (pool)" || php.Count != 2 || php.CPUPercent != 2 || php.MemUsedMb != 20 {
		t.Errorf("same name and unit are summed, got %+v", php)
	}
	postgres := processes[2]
	if !postgres.Container || postgres.Group != "abababababab" || postgres.CPUPercent != 1 {
		t.Errorf("a docker scope is a container's, got %+v", postgres)
	}
	if processes[3].Name != "new" || processes[3].CPUPercent != 0 {
		t.Errorf("a process missing from the first reading has no CPU to measure, got %+v", processes[3])
	}
}

func TestParseProcessesRejectsOtherOutput(t *testing.T) {
	if got := hoststats.ParseProcesses("sh: head: not found"); len(got) != 0 {
		t.Errorf("want none, got %+v", got)
	}
	if got := hoststats.ParseProcesses(""); got == nil {
		t.Error("want an empty list, not nil, so it answers []")
	}
}

func TestSamplerProcessesRunsTheScript(t *testing.T) {
	sampler := &hoststats.StatsSampler{RunCommand: func(name string, args ...string) (string, bool) {
		if name != "sh" || len(args) != 2 || args[1] != hoststats.ProcessScript {
			t.Errorf("unexpected command %s %v", name, args)
		}
		return scriptOutput("cpu 0 0 0 100", statLine("1", "init", "1", "1"), "", "", "cpu 0 0 0 200", statLine("1", "init", "11", "1")), true
	}}
	processes := sampler.Processes()
	if len(processes) != 1 || processes[0].CPUPercent != 10 || processes[0].Group != "" {
		t.Errorf("got %+v", processes)
	}
}
