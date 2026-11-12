package dockerapi_test

import (
	"reflect"
	"testing"

	"github.com/zedensix/homerun/internal/dockerapi"
)

func TestParseHostDisksKeepsRealDisksUnderTheHostRoot(t *testing.T) {
	output := `overlay / overlay rw 0 0
proc /proc proc rw 0 0
/dev/sda2 /host ext4 ro 0 0
/dev/sda1 /host/boot/efi vfat ro 0 0
/dev/sdb1 /host/mnt/big\040disk xfs ro 0 0
/dev/sdb1 /host/mnt/big\040disk/sub xfs ro 0 0
/dev/sda2 /host/var/lib/docker ext4 ro 0 0
tmpfs /host/run tmpfs ro 0 0
/dev/sdc1 /host/srv btrfs ro 0 0
---homerun-df---
Filesystem           1024-blocks    Used Available Capacity Mounted on
overlay                  1000000    5000    995000   1% /
/dev/sda2                1000000  400000    600000  40% /host
/dev/sda1                 500000    1000    499000   1% /host/boot/efi
/dev/sdb1                4000000 1000000   3000000  25% /host/mnt/big disk
/dev/sdb1                4000000 1000000   3000000  25% /host/mnt/big disk/sub
/dev/sda2                1000000  400000    600000  40% /host/var/lib/docker
/dev/sdc1                      0       0         0   0% /host/srv
`
	got := dockerapi.ParseHostDisks(output)
	want := []dockerapi.HostDisk{
		{Device: "/dev/sda2", Filesystem: "ext4", FreeBytes: 600000 * 1024, MountPoint: "/", TotalBytes: 1000000 * 1024},
		{Device: "/dev/sdb1", Filesystem: "xfs", FreeBytes: 3000000 * 1024, MountPoint: "/mnt/big disk", TotalBytes: 4000000 * 1024},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseHostDisks = %+v, want %+v", got, want)
	}
}

func TestDiskVolumePathIsUnderHomerunVolumes(t *testing.T) {
	if got := dockerapi.DiskVolumePath("/mnt/hdd", "homerun-media"); got != "/mnt/hdd/homerun-volumes/homerun-media" {
		t.Fatalf("DiskVolumePath = %q", got)
	}
}
