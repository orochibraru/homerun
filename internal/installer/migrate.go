package installer

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// VolumeDefinition is one Docker volume as `docker volume inspect` reports it.
type VolumeDefinition struct {
	Driver  string            `json:"Driver"`
	Labels  map[string]string `json:"Labels"`
	Name    string            `json:"Name"`
	Options map[string]string `json:"Options"`
}

// MigrationParams is everything --migrate-to-rootful needs.
type MigrationParams struct {
	AdvertiseAddress string
	Domain           string
	DryRun           bool
	Image            string
	// ResolveHost falls back to the detected or prompted host when neither
	// --domain= nor the existing files say where the instance is reached.
	ResolveHost func() (string, error)
	Run         Runner
	Username    string
	Version     string
}

// MigrationReport is what the operator still has to deal with by hand.
type MigrationReport struct {
	BindMounts      []string
	ComposePath     string
	OtherContainers []string
	RootlessSocket  string
	UID             string
}

var (
	anonymousVolume   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	composeOriginHost = regexp.MustCompile(`ORIGIN: \$\{ORIGIN:-https?://([^:/}]+)`)
	configBaseDomain  = regexp.MustCompile(`(?m)^baseDomain:\s*(\S+)\s*$`)
	configSocketPath  = regexp.MustCompile(`(?m)^(\s*socketPath:).*$`)
	loopbackHost      = regexp.MustCompile(`^(localhost|127\.)`)
)

// SwitchToSwarmSQL stores swarm mode, drops a stored rootless socket override
// and queues every service for a redeploy.
const SwitchToSwarmSQL = "UPDATE instance_settings SET orchestration_mode = 'swarm', pending_service_redeploy = true, docker_socket_path = CASE WHEN docker_socket_path LIKE '/run/user/%' THEN NULL ELSE docker_socket_path END"

// CopyableVolumes are the volumes worth copying: every named volume, never an
// anonymous one (64 hex characters), which only ever belonged to a container
// that won't exist on the new daemon.
func CopyableVolumes(names []string) []string {
	copyable := []string{}
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" || anonymousVolume.MatchString(trimmed) {
			continue
		}
		copyable = append(copyable, trimmed)
	}
	return copyable
}

// HostFromCompose is the host an installer-generated compose file bakes into
// its ORIGIN default, empty when there's none or it's a loopback address.
func HostFromCompose(compose string) string {
	match := composeOriginHost.FindStringSubmatch(compose)
	if match == nil || loopbackHost.MatchString(match[1]) {
		return ""
	}
	return match[1]
}

// BaseDomainFromConfig is homerun.yaml's baseDomain, empty when unset or loopback.
func BaseDomainFromConfig(config string) string {
	match := configBaseDomain.FindStringSubmatch(config)
	if match == nil || loopbackHost.MatchString(match[1]) {
		return ""
	}
	return match[1]
}

// RootfulConfig is homerun.yaml pointed at the system daemon's socket instead
// of the rootless one.
func RootfulConfig(config string) string {
	if !configSocketPath.MatchString(config) {
		return config
	}
	return configSocketPath.ReplaceAllString(config, "${1} "+SystemDockerSocket)
}

// EnvValue is one KEY=value from a docker compose .env file, empty when absent.
func EnvValue(envFile, key string) string {
	for _, line := range strings.Split(envFile, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, key+"=") {
			continue
		}
		return strings.Trim(trimmed[len(key)+1:], `"'`)
	}
	return ""
}

// VolumeCreateCommand recreates a volume with its driver, labels and driver
// options, so compose still recognises the ones it created.
func VolumeCreateCommand(volume VolumeDefinition) []string {
	driver := volume.Driver
	if driver == "" {
		driver = "local"
	}
	command := []string{"docker", "volume", "create", "--driver", driver}
	for _, key := range SortedKeys(volume.Labels) {
		command = append(command, "--label", key+"="+volume.Labels[key])
	}
	for _, key := range SortedKeys(volume.Options) {
		command = append(command, "--opt", key+"="+volume.Options[key])
	}
	return append(command, volume.Name)
}

// HoldsDataElsewhere reports whether a volume's data lives outside Docker's own
// volume directory (a local volume with a device option), so there's nothing to
// copy.
func HoldsDataElsewhere(volume VolumeDefinition) bool {
	return volume.Options["device"] != ""
}

// VolumeCopyScript is a bash script streaming one volume's files from the
// rootless daemon into the same-named volume on the system daemon, through a
// throwaway alpine container on each side. Ownership is carried numerically as
// the containers see it, so a file owned by uid 70 inside a rootless container
// is owned by uid 70 in the rootful volume too, not by the subuid it mapped to
// on disk.
func VolumeCopyScript(name, rootlessSocket string) string {
	return fmt.Sprintf(
		"set -euo pipefail\ndocker -H unix://%s run --rm -v %s:/from:ro alpine:3 tar -C /from --numeric-owner -cf - . | docker -H unix://%s run --rm -i -v %s:/to alpine:3 tar -C /to --numeric-owner -xf -",
		rootlessSocket, name, SystemDockerSocket, name,
	)
}

// Migrate moves a rootless --mode=full install onto the system daemon in swarm
// mode. It stops everything on the rootless daemon, copies every named volume
// across, makes the system daemon a swarm manager with the shared and overlay
// networks, rewrites homerun.yaml and the compose file (keeping .env), starts
// the stack, switches the instance to swarm with a redeploy of every service
// queued, and finally disables the rootless daemon without deleting its data.
//
// Re-runnable: finished volume copies and the instance switch are recorded
// under <compose dir>/.rootful-migration, so a second run only redoes what
// didn't finish.
//
// Fails when there's no --mode=full install to migrate, when the rootless
// daemon can't be reached while volumes still need copying, or when any command
// fails.
func Migrate(params MigrationParams) (MigrationReport, error) {
	run := params.Run
	composeDir := HomeOf(params.Username) + "/homerun"
	composePath := composeDir + "/compose.yaml"
	stateDir := composeDir + "/.rootful-migration"
	report := MigrationReport{ComposePath: composePath}

	if !params.DryRun && !FileExists(composePath) {
		return report, fmt.Errorf("No --mode=full install found at %s : nothing to migrate.", composePath)
	}
	uid, err := UIDOf(run, params.Username)
	if err != nil {
		return report, err
	}
	report.UID = uid
	rootlessSocket := "/run/user/" + uid + "/docker.sock"
	report.RootlessSocket = rootlessSocket
	rootless := Opts{Env: map[string]string{"DOCKER_HOST": "unix://" + rootlessSocket}}
	if _, err := run.Run([]string{"mkdir", "-p", stateDir}, Opts{}); err != nil {
		return report, err
	}

	fmt.Println("\n== 1/6 System Docker daemon ==")
	if err := InstallDockerEngine(run); err != nil {
		return report, err
	}
	if _, err := EnableRootfulDocker(run); err != nil {
		return report, err
	}
	if err := AddUserToDockerGroup(run, params.Username); err != nil {
		return report, err
	}

	fmt.Println("\n== 2/6 Stop everything on the rootless daemon ==")
	volumesFile := stateDir + "/volumes.json"
	pending, err := CopyPending(volumesFile, stateDir)
	if err != nil {
		return report, err
	}
	reachable, err := EnsureRootlessDaemon(run, pending, rootless, params.Username, uid)
	if err != nil {
		return report, err
	}
	if reachable {
		bindMounts, otherContainers, err := inventory(run, rootless)
		if err != nil {
			return report, err
		}
		report.BindMounts = bindMounts
		report.OtherContainers = otherContainers
		if err := StopAll(run, rootless); err != nil {
			return report, err
		}
	}

	fmt.Println("\n== 3/6 Copy volumes to the system daemon ==")
	if err := CopyVolumes(run, reachable, rootless, rootlessSocket, stateDir, volumesFile); err != nil {
		return report, err
	}

	fmt.Println("\n== 4/6 Swarm manager and networks ==")
	if err := EnsureHomerunNetwork(run, "", SystemDockerSocket); err != nil {
		return report, err
	}
	if err := EnsureSwarmManager(run, params.AdvertiseAddress); err != nil {
		return report, err
	}
	if err := EnsureOverlayNetwork(run); err != nil {
		return report, err
	}

	fmt.Println("\n== 5/6 Start the stack on the system daemon ==")
	host, err := MigrationHost(params, composeDir)
	if err != nil {
		return report, err
	}
	if err := rewriteConfig(run, composeDir); err != nil {
		return report, err
	}
	if _, err := BringUpFullStack(FullStackParams{
		DockerSocket: SystemDockerSocket,
		Host:         host,
		Image:        params.Image,
		Rootful:      true,
		Run:          run,
		Swarm:        true,
		Username:     params.Username,
		Version:      params.Version,
	}); err != nil {
		return report, err
	}

	fmt.Println("\n== 6/6 Switch the instance to swarm mode ==")
	if err := SwitchInstance(run, composeDir, stateDir); err != nil {
		return report, err
	}
	disableRootlessDaemon(run, params.Username, uid)
	return report, nil
}

// CopyPending reports whether any volume still needs copying: true until the
// volume list has been recorded and every one of them has its done marker.
func CopyPending(volumesFile, stateDir string) (bool, error) {
	if !FileExists(volumesFile) {
		return true, nil
	}
	body, err := os.ReadFile(volumesFile)
	if err != nil {
		return true, err
	}
	var volumes []VolumeDefinition
	if err := json.Unmarshal(body, &volumes); err != nil {
		return false, err
	}
	for _, volume := range volumes {
		if !FileExists(stateDir + "/" + volume.Name + ".copied") {
			return true, nil
		}
	}
	return false, nil
}

// EnsureRootlessDaemon reports whether the rootless daemon answers, starting it
// through its systemd --user unit when copying is still pending (a re-run after
// the daemon was already disabled).
//
// Fails when copying is pending and the daemon can't be started.
func EnsureRootlessDaemon(run Runner, pending bool, rootless Opts, username, uid string) (bool, error) {
	if run.RunOK([]string{"docker", "version", "--format", "{{.Server.Version}}"}, rootless) {
		return true, nil
	}
	if !pending {
		fmt.Println("The rootless daemon is already stopped, nothing to stop.")
		return false, nil
	}
	if _, err := run.Run([]string{"systemctl", "--user", "start", "docker"}, userSession(username, uid)); err != nil {
		return false, err
	}
	if _, err := run.Run([]string{
		"bash", "-c",
		"for attempt in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
	}, rootless); err != nil {
		return false, err
	}
	return true, nil
}

// inventory is what the operator has to look at by hand afterwards: containers
// that are neither this stack's nor a Homerun service (they won't come back on
// their own), and host paths bind-mounted into services (their file ownership
// was mapped through the rootless user's subuids).
func inventory(run Runner, rootless Opts) ([]string, []string, error) {
	listing, err := run.Run([]string{
		"docker", "ps", "-a", "--format",
		`{{.Names}}	{{.Image}}	{{.Label "com.docker.compose.project"}}	{{.Label "homerun.managed"}}	{{.Label "homerun.infra"}}`,
	}, rootless)
	if err != nil {
		return nil, nil, err
	}
	otherContainers := []string{}
	managed := []string{}
	for _, line := range strings.Split(listing.Stdout, "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		for len(fields) < 5 {
			fields = append(fields, "")
		}
		name, image, project, isManaged, infra := fields[0], fields[1], fields[2], fields[3], fields[4]
		if isManaged == "true" {
			managed = append(managed, name)
		} else if project != "homerun" && infra == "" {
			otherContainers = append(otherContainers, fmt.Sprintf("%s (%s)", name, image))
		}
	}
	if len(managed) == 0 {
		return []string{}, otherContainers, nil
	}
	mounts, err := run.Run(append([]string{
		"docker", "inspect", "--format",
		`{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\n"}}{{end}}{{end}}`,
	}, managed...), rootless)
	if err != nil {
		return nil, nil, err
	}
	bindMounts := []string{}
	seen := map[string]bool{}
	for _, line := range strings.Split(mounts.Stdout, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		bindMounts = append(bindMounts, trimmed)
	}
	return bindMounts, otherContainers, nil
}

// StopAll stops every running container on the rootless daemon, the stack and
// every deployed service, so nothing writes to a volume while it's copied.
func StopAll(run Runner, rootless Opts) error {
	running, err := run.Run([]string{"docker", "ps", "-q"}, rootless)
	if err != nil {
		return err
	}
	ids := []string{}
	for _, id := range strings.Split(running.Stdout, "\n") {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, strings.TrimSpace(id))
		}
	}
	if len(ids) == 0 {
		fmt.Println("Nothing is running on the rootless daemon.")
		return nil
	}
	_, err = run.Run(append([]string{"docker", "stop"}, ids...), rootless)
	return err
}

// CopyVolumes records the rootless daemon's named volumes once, then recreates
// and fills each one on the system daemon that doesn't have its done marker
// yet. A volume left half-copied by an earlier run is removed and copied again
// from scratch.
//
// Fails when volumes still need copying but the rootless daemon isn't reachable.
func CopyVolumes(run Runner, reachable bool, rootless Opts, rootlessSocket, stateDir, volumesFile string) error {
	volumes, err := RecordVolumes(run, reachable, rootless, volumesFile)
	if err != nil {
		return err
	}
	for _, volume := range volumes {
		marker := stateDir + "/" + volume.Name + ".copied"
		if FileExists(marker) {
			fmt.Printf("%s already copied, skipping.\n", volume.Name)
			continue
		}
		if !reachable {
			return fmt.Errorf(
				"%s still needs copying, but the rootless daemon at %s isn't reachable.",
				volume.Name, rootlessSocket,
			)
		}
		run.RunOK([]string{"docker", "volume", "rm", volume.Name}, systemDocker)
		if _, err := run.Run(VolumeCreateCommand(volume), systemDocker); err != nil {
			return err
		}
		if HoldsDataElsewhere(volume) {
			fmt.Printf("%s keeps its data at %s, recreated without copying.\n", volume.Name, volume.Options["device"])
		} else if _, err := run.Run(
			[]string{"bash", "-c", VolumeCopyScript(volume.Name, rootlessSocket)},
			Opts{},
		); err != nil {
			return err
		}
		if err := run.WriteFile(marker, ""); err != nil {
			return err
		}
	}
	return nil
}

// RecordVolumes is the volume definitions to copy, read from the state
// directory, or listed from the rootless daemon and written there on the first
// run.
func RecordVolumes(run Runner, reachable bool, rootless Opts, volumesFile string) ([]VolumeDefinition, error) {
	if body, err := os.ReadFile(volumesFile); err == nil {
		var volumes []VolumeDefinition
		if err := json.Unmarshal(body, &volumes); err != nil {
			return nil, err
		}
		return volumes, nil
	}
	if !reachable {
		return nil, nil
	}
	listed, err := run.Run([]string{"docker", "volume", "ls", "-q"}, rootless)
	if err != nil {
		return nil, err
	}
	names := CopyableVolumes(strings.Split(listed.Stdout, "\n"))
	if len(names) == 0 {
		return nil, run.WriteFile(volumesFile, "[]")
	}
	inspected, err := run.Run(append([]string{"docker", "volume", "inspect"}, names...), rootless)
	if err != nil {
		return nil, err
	}
	volumes := []VolumeDefinition{}
	if strings.TrimSpace(inspected.Stdout) != "" {
		if err := json.Unmarshal([]byte(inspected.Stdout), &volumes); err != nil {
			return nil, err
		}
	}
	encoded, err := json.MarshalIndent(volumes, "", "  ")
	if err != nil {
		return nil, err
	}
	return volumes, run.WriteFile(volumesFile, string(encoded))
}

// MigrationHost is where the instance is reached: --domain=, else the host the
// old compose file's ORIGIN default carries, else homerun.yaml's baseDomain,
// else detected.
func MigrationHost(params MigrationParams, composeDir string) (string, error) {
	if params.Domain != "" {
		return params.Domain, nil
	}
	compose, _ := os.ReadFile(composeDir + "/compose.yaml")
	if host := HostFromCompose(string(compose)); host != "" {
		return host, nil
	}
	config, _ := os.ReadFile(composeDir + "/homerun.yaml")
	if host := BaseDomainFromConfig(string(config)); host != "" {
		return host, nil
	}
	return params.ResolveHost()
}

// rewriteConfig keeps a copy of the rootless compose file (once) and points
// homerun.yaml's socketPath at the system daemon.
func rewriteConfig(run Runner, composeDir string) error {
	backup := composeDir + "/compose.rootless.yaml"
	if !FileExists(backup) {
		if _, err := run.Run([]string{"cp", composeDir + "/compose.yaml", backup}, Opts{}); err != nil {
			return err
		}
	}
	configPath := composeDir + "/homerun.yaml"
	if !FileExists(configPath) {
		return nil
	}
	config, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	return run.WriteFile(configPath, RootfulConfig(string(config)))
}

// SwitchInstance waits for the app to answer (it has run its migrations by
// then), then stores swarm mode, drops a stored rootless socket override and
// asks for every service to be redeployed, and restarts the app so its boot
// picks that up. Only done once: a re-run doesn't queue the redeploys again.
func SwitchInstance(run Runner, composeDir, stateDir string) error {
	marker := stateDir + "/instance-switched"
	if FileExists(marker) {
		fmt.Println("The instance was already switched to swarm mode, skipping.")
		return nil
	}
	composePath := composeDir + "/compose.yaml"
	compose := systemDocker
	compose.Cwd = composeDir

	if _, err := run.Run([]string{
		"bash", "-c",
		`for attempt in $(seq 1 90); do code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:3000/ || true); case "$code" in 2*|3*|4*) exit 0;; esac; sleep 2; done; echo "The app never answered on :3000" >&2; exit 1`,
	}, Opts{}); err != nil {
		return err
	}
	envFile, _ := os.ReadFile(composeDir + "/.env")
	user := EnvValue(string(envFile), "POSTGRES_USER")
	if user == "" {
		user = "homerun"
	}
	database := EnvValue(string(envFile), "POSTGRES_DB")
	if database == "" {
		database = "homerun"
	}
	if _, err := run.Run([]string{
		"docker", "compose", "-f", composePath, "exec", "-T", "postgres",
		"psql", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database, "-c", SwitchToSwarmSQL,
	}, compose); err != nil {
		return err
	}
	if _, err := run.Run([]string{"docker", "compose", "-f", composePath, "restart", "app"}, compose); err != nil {
		return err
	}
	return run.WriteFile(marker, "")
}

// disableRootlessDaemon stops the rootless daemon and keeps it from starting at
// boot. Its images, containers and volumes stay on disk.
func disableRootlessDaemon(run Runner, username, uid string) {
	session := userSession(username, uid)
	run.RunOK([]string{"systemctl", "--user", "disable", "--now", "docker.socket"}, session)
	run.RunOK([]string{"systemctl", "--user", "disable", "--now", "docker.service"}, session)
}

// userSession runs as the rootless user inside its own systemd --user session.
func userSession(username, uid string) Opts {
	return Opts{
		As:  username,
		Env: map[string]string{"HOME": HomeOf(username), "XDG_RUNTIME_DIR": "/run/user/" + uid},
	}
}
