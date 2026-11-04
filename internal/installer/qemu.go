package installer

import "fmt"

// BinfmtImage is the pinned tonistiigi/binfmt image the QEMU unit runs, the
// same pin as internal/agent's builder-tools.json (a unit test keeps them equal).
const BinfmtImage = "tonistiigi/binfmt:qemu-v10.2.3-68@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0"

// qemuUnit is the system unit registering QEMU on the host at boot.
const qemuUnit = "homerun-binfmt"

// QemuSystemdUnit is the root systemd unit that registers every QEMU
// emulator on the host kernel through the system Docker daemon at boot. A
// rootless daemon can't do it itself: since Linux 6.7 binfmt_misc is per user
// namespace, so a privileged binfmt container under rootless Docker registers
// into its own namespace's instance, which is emptied the moment it exits.
func QemuSystemdUnit() string {
	return fmt.Sprintf(`[Unit]
Description=Homerun QEMU emulation for cross-architecture builds
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=docker run --rm --privileged %s --install all

[Install]
WantedBy=multi-user.target
`, BinfmtImage)
}

// InstallQemuUnit writes, enables and starts QemuSystemdUnit so a build server
// can build for another CPU architecture than its own. Starting it is
// best-effort: a host without the system Docker daemon still installs, and only
// a cross-architecture build fails later, naming this unit.
func InstallQemuUnit(run Runner) error {
	if err := run.WriteFile("/etc/systemd/system/"+qemuUnit+".service", QemuSystemdUnit()); err != nil {
		return err
	}
	if _, err := run.Run([]string{"systemctl", "daemon-reload"}, Opts{}); err != nil {
		return err
	}
	if run.RunOK([]string{"systemctl", "enable", qemuUnit}, Opts{}) &&
		run.RunOK([]string{"systemctl", "restart", qemuUnit}, Opts{}) {
		return nil
	}
	fmt.Printf("Couldn't register QEMU on this host: builds for another CPU architecture fail here until `systemctl start %s` works.\n", qemuUnit)
	return nil
}
