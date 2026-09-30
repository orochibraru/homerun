package backup_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/jobs/backup"
	"github.com/orochibraru/homerun/internal/rclone"
)

// remoteSpec is a backup of volume "data" to an rclone remote under "base".
func remoteSpec() backup.Spec {
	return backup.Spec{
		HelperImage: "alpine:3", Key: "p/data.tar.gz", MountPath: "/homerun-backup-source",
		Remote: &rclone.Remote{Image: "rclone/rclone:1", Label: "sftp://bob@nas/base", Path: "base"},
		Source: "data", VolumeName: "data",
	}
}

func TestABackupToAnRcloneRemoteLandsUnderItsKeyAndRestores(t *testing.T) {
	engine, socket := newFakeEngine(t, map[string]string{"a.txt": "hi", "sub/b": "x"})
	spec := remoteSpec()

	result, err := runJob(t, "backup", socket, spec)
	if err != nil {
		t.Fatal(err)
	}
	if result["key"] != spec.Key || result["sizeBytes"].(int64) <= 0 {
		t.Fatalf("result = %v", result)
	}
	engine.mu.Lock()
	stored := len(engine.remote["dest:base/p/data.tar.gz"])
	objects := len(engine.remote)
	engine.volumes["data"] = map[string]string{"stray": "y"}
	engine.mu.Unlock()
	if int64(stored) != result["sizeBytes"].(int64) || objects != 1 {
		t.Fatalf("want only the renamed archive, of the reported size, got %d bytes in %d objects", stored, objects)
	}

	spec.Wipe = true
	if _, err := runJob(t, "backup_restore", socket, spec); err != nil {
		t.Fatal(err)
	}
	if got := engine.files("data"); !reflect.DeepEqual(got, []string{"a.txt", "sub/b"}) {
		t.Fatalf("restored files = %v", got)
	}
}

func TestAFailedTarLeavesNothingOnAnRcloneRemote(t *testing.T) {
	engine, socket := newFakeEngine(t, map[string]string{"secret": "s"})
	engine.failTar = true

	_, err := runJob(t, "backup", socket, remoteSpec())
	if err == nil || !strings.Contains(err.Error(), "tar exited 1") {
		t.Fatalf("want tar's own error, got %v", err)
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.remote) != 0 {
		t.Fatalf("a failed archive must leave no object behind, got %v", engine.remote)
	}
}

func TestRestoringAMissingRcloneObjectFailsWithRclonesError(t *testing.T) {
	_, socket := newFakeEngine(t, map[string]string{})

	_, err := runJob(t, "backup_restore", socket, remoteSpec())
	if err == nil || !strings.Contains(err.Error(), "rclone cat exited 4: object not found") {
		t.Fatalf("want rclone's error, got %v", err)
	}
}
