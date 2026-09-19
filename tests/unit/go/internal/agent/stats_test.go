package agent_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/orochibraru/homerun/internal/agent"
)

// fakeProc writes fake /proc/stat and /proc/meminfo files into a scratch
// directory and returns its path.
func fakeProc(t *testing.T, stat, meminfo string) string {
	t.Helper()
	root := t.TempDir()
	if stat != "" {
		if err := os.WriteFile(filepath.Join(root, "stat"), []byte(stat), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if meminfo != "" {
		if err := os.WriteFile(filepath.Join(root, "meminfo"), []byte(meminfo), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// commands returns a RunCommand stand-in answering from outputs, keyed by
// command name.
func commands(outputs map[string]string) func(string, ...string) (string, bool) {
	return func(name string, _ ...string) (string, bool) {
		output, ok := outputs[name]
		return output, ok
	}
}

func TestSampleReadsProcDfAndNvidiaSmi(t *testing.T) {
	root := fakeProc(t,
		"cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 1 1 1 1 1 1\n",
		"MemTotal:       8192000 kB\nMemFree:  100 kB\nMemAvailable:   2048000 kB\n",
	)
	sampler := &agent.StatsSampler{ProcRoot: root, RunCommand: commands(map[string]string{
		"df":         "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sda1 1048576 262144 786432 25% /\n",
		"nvidia-smi": "NVIDIA RTX 4090, 24564, 1024, 37\n",
	})}

	first := sampler.Sample()
	if first.CPUPercent != 0 {
		t.Errorf("the first sample has nothing to diff against, got %d", first.CPUPercent)
	}
	if first.MemTotalMb != 8000 || first.MemUsedMb != 6000 || first.MemPercent != 75 {
		t.Errorf("memory in use is total minus available, got %+v", first)
	}
	if first.DiskTotalMb == nil || *first.DiskTotalMb != 1024 || *first.DiskUsedMb != 256 || *first.DiskPercent != 25 {
		t.Errorf("disk should read from df, got %v %v %v", first.DiskTotalMb, first.DiskUsedMb, first.DiskPercent)
	}
	if first.GPU == nil || first.GPU.Name != "NVIDIA RTX 4090" || first.GPU.MemTotalMb != 24564 || first.GPU.UtilizationPercent != 37 {
		t.Errorf("the GPU should read from nvidia-smi, got %+v", first.GPU)
	}

	if err := os.WriteFile(filepath.Join(root, "stat"), []byte("cpu  200 0 200 900 0 0 0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	second := sampler.Sample()
	if second.CPUPercent != 67 {
		t.Errorf("CPU is the busy share of the delta (200 of 300), want 67, got %d", second.CPUPercent)
	}
}

func TestSampleDegradesWithoutSources(t *testing.T) {
	sampler := &agent.StatsSampler{ProcRoot: t.TempDir(), RunCommand: commands(nil)}
	stats := sampler.Sample()
	if stats.CPUPercent != 0 || stats.MemTotalMb != 0 {
		t.Errorf("no /proc reads as zero, not a failure, got %+v", stats)
	}
	if stats.DiskTotalMb != nil || stats.GPU != nil {
		t.Errorf("no df or nvidia-smi means null disk and GPU, got %+v", stats)
	}
}

func TestSampleRejectsMalformedSources(t *testing.T) {
	root := fakeProc(t, "intr 1 2 3\n", "MemTotal: 1024 kB\n")
	sampler := &agent.StatsSampler{ProcRoot: root, RunCommand: commands(map[string]string{
		"df":         "garbage\n",
		"nvidia-smi": ",,,\n",
	})}
	stats := sampler.Sample()
	if stats.MemTotalMb != 0 {
		t.Errorf("meminfo without MemAvailable can't give a used figure, got %+v", stats)
	}
	if stats.DiskTotalMb != nil {
		t.Error("unparseable df output is no disk reading")
	}
	if stats.GPU != nil {
		t.Error("an nvidia-smi line with no name is no GPU")
	}

	root = fakeProc(t, "cpu x y z\n", "")
	if (&agent.StatsSampler{ProcRoot: root, RunCommand: commands(nil)}).Sample().CPUPercent != 0 {
		t.Error("a non-numeric stat line is ignored")
	}
	root = fakeProc(t, "cpu 1 2\n", "")
	if (&agent.StatsSampler{ProcRoot: root, RunCommand: commands(nil)}).Sample().CPUPercent != 0 {
		t.Error("a short stat line is ignored")
	}
	if err := os.WriteFile(filepath.Join(root, "stat"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if (&agent.StatsSampler{ProcRoot: root, RunCommand: commands(nil)}).Sample().CPUPercent != 0 {
		t.Error("an empty stat file is ignored")
	}
	zeroDisk := &agent.StatsSampler{ProcRoot: t.TempDir(), RunCommand: commands(map[string]string{
		"df": "h\n/dev/x 0 0 0 0% /\n",
	})}
	if zeroDisk.Sample().DiskTotalMb != nil {
		t.Error("a zero-sized filesystem can't give a percentage")
	}
}

func TestClamp(t *testing.T) {
	if agent.Clamp(-5, 0, 100) != 0 || agent.Clamp(150, 0, 100) != 100 || agent.Clamp(42, 0, 100) != 42 {
		t.Error("clamp should bound to [low, high]")
	}
}

func TestNewStatsSamplerUsesTheRealHost(t *testing.T) {
	sampler := agent.NewStatsSampler()
	if sampler.ProcRoot != "/proc" || sampler.RunCommand == nil {
		t.Errorf("got %+v", sampler)
	}
	stats := sampler.Sample()
	if stats.CPUPercent < 0 || stats.CPUPercent > 100 {
		t.Errorf("a real sample stays in range, got %d", stats.CPUPercent)
	}
	if _, ok := agent.RunCommand("definitely-not-a-command-homerun"); ok {
		t.Error("a missing command reports failure")
	}
}
