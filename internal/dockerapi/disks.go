package dockerapi

import (
	"context"
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/moby/moby/client"
)

const (
	hostRoot         = "/host"
	diskVolumesDir   = "homerun-volumes"
	diskListSplitter = "---homerun-df---"
)

var diskFilesystems = map[string]bool{
	"bcachefs": true, "btrfs": true, "exfat": true, "ext2": true, "ext3": true, "ext4": true,
	"f2fs": true, "jfs": true, "ntfs": true, "ntfs3": true, "reiserfs": true, "vfat": true,
	"xfs": true, "zfs": true,
}

var skippedDiskPrefixes = []string{
	"/boot", "/dev", "/efi", "/etc", "/proc", "/run", "/snap", "/sys", "/usr", "/var/lib/docker",
	"/var/lib/containerd", "/var/lib/kubelet", "/var/snap",
}

// HostDisk is one filesystem mounted on the host that a volume can live on.
type HostDisk struct {
	Device     string `json:"device"`
	Filesystem string `json:"filesystem"`
	FreeBytes  int64  `json:"freeBytes"`
	MountPoint string `json:"mountPoint"`
	TotalBytes int64  `json:"totalBytes"`
}

// ListHostDisks lists the host's disk filesystems from a helper container that
// mounts the host's root read-only, so the worker sees the host's mounts
// rather than its own container's.
func (c *Client) ListHostDisks(ctx context.Context, image string) ([]HostDisk, error) {
	result, err := c.RunHelper(ctx, HelperConfig{
		Binds:           []string{"/:" + hostRoot + ":ro"},
		Cmd:             []string{"sh", "-c", "cat /proc/self/mounts; echo " + diskListSplitter + "; df -Pk"},
		Image:           image,
		NetworkDisabled: true,
	})
	if err != nil {
		return nil, err
	}
	if result.ExitCode != 0 && !strings.Contains(result.Stdout, diskListSplitter) {
		return nil, fmt.Errorf("listing disks exited %d: %s", result.ExitCode, strings.TrimSpace(result.Stderr))
	}
	return ParseHostDisks(result.Stdout), nil
}

// ParseHostDisks reads the helper's /proc/self/mounts and `df -Pk` output into
// the host's disks: real filesystems under the host root, system mounts
// skipped, one entry per device (its shortest mount point), the root first.
func ParseHostDisks(output string) []HostDisk {
	mounts, usage, _ := strings.Cut(output, diskListSplitter)
	sizes := map[string][2]int64{}
	for _, line := range strings.Split(usage, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		total, totalErr := strconv.ParseInt(fields[1], 10, 64)
		free, freeErr := strconv.ParseInt(fields[3], 10, 64)
		if totalErr != nil || freeErr != nil {
			continue
		}
		sizes[strings.Join(fields[5:], " ")] = [2]int64{total * 1024, free * 1024}
	}

	byDevice := map[string]HostDisk{}
	for _, line := range strings.Split(mounts, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || !diskFilesystems[fields[2]] {
			continue
		}
		inside := unescapeMount(fields[1])
		mountPoint, ok := hostMountPoint(inside)
		if !ok || skippedDisk(mountPoint) {
			continue
		}
		size, ok := sizes[inside]
		if !ok || size[0] == 0 {
			continue
		}
		disk := HostDisk{Device: fields[0], Filesystem: fields[2], FreeBytes: size[1], MountPoint: mountPoint, TotalBytes: size[0]}
		if existing, seen := byDevice[disk.Device]; seen && len(existing.MountPoint) <= len(mountPoint) {
			continue
		}
		byDevice[disk.Device] = disk
	}

	disks := make([]HostDisk, 0, len(byDevice))
	for _, disk := range byDevice {
		disks = append(disks, disk)
	}
	sort.Slice(disks, func(i, j int) bool {
		if disks[i].MountPoint == "/" || disks[j].MountPoint == "/" {
			return disks[i].MountPoint == "/"
		}
		return disks[i].MountPoint < disks[j].MountPoint
	})
	return disks
}

// hostMountPoint maps a mount point inside the helper to the host's, false for
// one outside the host root.
func hostMountPoint(inside string) (string, bool) {
	if inside == hostRoot {
		return "/", true
	}
	if rest, ok := strings.CutPrefix(inside, hostRoot+"/"); ok {
		return "/" + rest, true
	}
	return "", false
}

// skippedDisk reports a system mount no volume belongs on.
func skippedDisk(mountPoint string) bool {
	for _, prefix := range skippedDiskPrefixes {
		if mountPoint == prefix || strings.HasPrefix(mountPoint, prefix+"/") {
			return true
		}
	}
	return false
}

// unescapeMount decodes /proc/mounts' octal escapes (\040 for a space).
func unescapeMount(field string) string {
	if !strings.Contains(field, `\`) {
		return field
	}
	var out strings.Builder
	for i := 0; i < len(field); i++ {
		if field[i] == '\\' && i+3 < len(field) {
			if code, err := strconv.ParseUint(field[i+1:i+4], 8, 8); err == nil {
				out.WriteByte(byte(code))
				i += 3
				continue
			}
		}
		out.WriteByte(field[i])
	}
	return out.String()
}

// DiskVolumePath is where a named volume placed on disk keeps its data.
func DiskVolumePath(disk, name string) string {
	return path.Join(disk, diskVolumesDir, name)
}

// EnsureVolumeOnDisk creates the named volume as a local bind onto its own
// directory on disk (a host mount point), creating that directory through a
// helper first. A volume that already exists is left as it is, wherever it
// lives.
func (c *Client) EnsureVolumeOnDisk(ctx context.Context, name, disk, image string) error {
	if !path.IsAbs(disk) {
		return fmt.Errorf("disk %q isn't an absolute path", disk)
	}
	if strings.ContainsAny(name, "/\\") || name == "" || name == "." || name == ".." {
		return fmt.Errorf("volume name %q can't be placed on a disk", name)
	}
	exists, err := c.VolumeExists(ctx, name)
	if err != nil || exists {
		return err
	}
	result, err := c.RunHelper(ctx, HelperConfig{
		Binds:           []string{disk + ":/disk"},
		Cmd:             []string{"mkdir", "-p", path.Join("/disk", diskVolumesDir, name)},
		Image:           image,
		NetworkDisabled: true,
	})
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("couldn't create %s on %s: %s", name, disk, strings.TrimSpace(result.Stderr))
	}
	return discard(control(ctx, ControlTimeout, "create volume "+name, "", func(ctx context.Context) (client.VolumeCreateResult, error) {
		return c.api.VolumeCreate(ctx, client.VolumeCreateOptions{
			Driver:     "local",
			DriverOpts: map[string]string{"device": DiskVolumePath(disk, name), "o": "bind", "type": "none"},
			Name:       name,
		})
	}))
}
