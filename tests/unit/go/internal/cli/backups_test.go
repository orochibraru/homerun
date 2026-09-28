package cli_test

import (
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/cli"
)

func TestBackupRowsTimesARunningRunUpToNow(t *testing.T) {
	now := time.Date(2026, 9, 28, 9, 0, 0, 0, time.UTC)
	status, progress, attempts := "running", "2026-09-28T08:40:00.000Z", 2
	failed, finished, errText, size := false, "2026-09-28T03:25:00Z", "S3 PUT failed:\n504", int64(3<<20)
	rows := cli.BackupRows([]cli.BackupRun{
		{ID: "r1", JobAttempts: &attempts, JobProgressAt: &progress, JobStatus: &status, Kind: "backup",
			StartedAt: "2026-09-28T07:00:00.000Z", VolumeName: "gitea"},
		{Error: &errText, FinishedAt: &finished, ID: "r2", Kind: "backup", SizeBytes: &size,
			StartedAt: "2026-09-28T03:00:00Z", Success: &failed, VolumeName: "penombre"},
	}, now)
	if got := rows[0]; got["outcome"] != "running" || got["took"] != "2h0m0s" || got["progress"] != "20m0s ago" || got["job"] != "running #2" {
		t.Fatalf("running row = %v", got)
	}
	if got := rows[1]; got["outcome"] != "failed" || got["took"] != "25m0s" || got["error"] != "S3 PUT failed: 504" || got["size"] != "3.0 MiB" || got["progress"] != "" {
		t.Fatalf("failed row = %v", got)
	}
}
