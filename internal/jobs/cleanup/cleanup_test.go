package cleanup

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/registryapi"
)

type fakeDaemon struct {
	mu      sync.Mutex
	calls   []string
	execs   [][]string
	exits   map[int]int
	routes  map[string]string
	execOut func(cmd []string) (stdout string, exit int)
}

func frame(stream byte, text string) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
	return append(header, text...)
}

func newFakeDaemon(t *testing.T, routes map[string]string) (*dockerapi.Client, *fakeDaemon) {
	t.Helper()
	d := &fakeDaemon{exits: map[int]int{}, routes: routes, execOut: func([]string) (string, int) { return "", 0 }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.mu.Lock()
		defer d.mu.Unlock()
		call := r.Method + " " + r.URL.Path
		if r.URL.RawQuery != "" {
			call += "?" + r.URL.RawQuery
		}
		d.calls = append(d.calls, call)
		switch {
		case strings.HasSuffix(r.URL.Path, "/exec") && r.Method == http.MethodPost:
			var body struct{ Cmd []string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			d.execs = append(d.execs, body.Cmd)
			_, _ = fmt.Fprintf(w, `{"Id":"exec%d"}`, len(d.execs)-1)
			return
		case strings.HasPrefix(r.URL.Path, "/exec/"):
			var index int
			_, _ = fmt.Sscanf(strings.Split(r.URL.Path, "/")[2], "exec%d", &index)
			if strings.HasSuffix(r.URL.Path, "/start") {
				stdout, exit := d.execOut(d.execs[index])
				d.exits[index] = exit
				_, _ = w.Write(frame(1, stdout))
				return
			}
			_, _ = fmt.Fprintf(w, `{"ExitCode":%d}`, d.exits[index])
			return
		}
		if body, ok := d.routes[r.Method+" "+r.URL.Path]; ok {
			_, _ = io.WriteString(w, body)
			return
		}
		if r.Method == http.MethodDelete || r.Method == http.MethodPost {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Error(w, `{"message":"no such thing"}`, http.StatusNotFound)
	}))
	t.Cleanup(server.Close)
	return dockerapi.NewWithHTTP(server.Client(), server.URL), d
}

func (d *fakeDaemon) sent(prefix string) []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var matching []string
	for _, call := range d.calls {
		if strings.HasPrefix(call, prefix) {
			matching = append(matching, call)
		}
	}
	return matching
}

func runSpec(t *testing.T, docker *dockerapi.Client, spec Spec) (map[string]any, []string) {
	t.Helper()
	job, lines, err := jobs.Recorder("docker_cleanup", spec)
	if err != nil {
		t.Fatal(err)
	}
	result, err := run(context.Background(), job, docker)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return result, lines()
}

const df = `{
	"Images": [
		{"Id": "sha256:used", "Containers": 1, "RepoTags": ["app:1"], "Size": 1},
		{"Id": "sha256:dangling", "Containers": 0, "RepoTags": ["<none>:<none>"], "Size": 10},
		{"Id": "sha256:tagged", "Containers": 0, "RepoTags": ["old:1"], "Size": 20},
		{"Id": "sha256:retained", "Containers": 0, "RepoTags": null, "Size": 40}
	],
	"Volumes": [
		{"Name": "in-use", "UsageData": {"RefCount": 1, "Size": 10}},
		{"Name": "orphan", "UsageData": {"RefCount": 0, "Size": 20}},
		{"Name": "homerun-vol-db", "UsageData": {"RefCount": 0, "Size": 30}},
		{"Name": "unknown-usage", "UsageData": null}
	]
}`

func TestVolumesNeverPruneAMountedVolume(t *testing.T) {
	docker, daemon := newFakeDaemon(t, map[string]string{"GET /system/df": df})
	result, _ := runSpec(t, docker, Spec{Action: "pruneVolumes", KeepVolumeNames: []string{"homerun-vol-db"}})
	removed := daemon.sent("DELETE /volumes/")
	if want := []string{"DELETE /volumes/orphan?force=1", "DELETE /volumes/unknown-usage?force=1"}; !reflect.DeepEqual(removed, want) {
		t.Errorf("removed = %v, want %v", removed, want)
	}
	if len(daemon.sent("POST /volumes/prune")) != 0 {
		t.Error("the daemon's own prune must not run while volumes are kept")
	}
	if !reflect.DeepEqual(result, pruneSummary(2, 20)) {
		t.Errorf("result = %v", result)
	}
}

func TestVolumesFallBackToTheDaemonPrune(t *testing.T) {
	docker, daemon := newFakeDaemon(t, map[string]string{
		"POST /volumes/prune": `{"VolumesDeleted":["a","b"],"SpaceReclaimed":7}`,
	})
	result, _ := runSpec(t, docker, Spec{Action: "pruneVolumes"})
	if got := daemon.sent("POST /volumes/prune"); len(got) != 1 || !strings.Contains(got[0], "filters=") {
		t.Errorf("prune calls = %v", got)
	}
	if !reflect.DeepEqual(result, pruneSummary(2, 7)) {
		t.Errorf("result = %v", result)
	}
}

func TestImagesKeepRetainedRevisions(t *testing.T) {
	docker, daemon := newFakeDaemon(t, map[string]string{"GET /system/df": df})
	result, _ := runSpec(t, docker, Spec{Action: "pruneImages", All: true, KeepImageIDs: []string{"sha256:retained"}})
	if want := []string{"DELETE /images/sha256:dangling?force=0", "DELETE /images/sha256:tagged?force=0"}; !reflect.DeepEqual(daemon.sent("DELETE"), want) {
		t.Errorf("removed = %v, want %v", daemon.sent("DELETE"), want)
	}
	if !reflect.DeepEqual(result, pruneSummary(2, 30)) {
		t.Errorf("result = %v", result)
	}

	docker, daemon = newFakeDaemon(t, map[string]string{"GET /system/df": df})
	runSpec(t, docker, Spec{Action: "pruneImages", KeepImageIDs: []string{"sha256:retained"}})
	if want := []string{"DELETE /images/sha256:dangling?force=0"}; !reflect.DeepEqual(daemon.sent("DELETE"), want) {
		t.Errorf("dangling-only removed = %v", daemon.sent("DELETE"))
	}
}

func TestSystemPruneSummarisesEachPart(t *testing.T) {
	docker, _ := newFakeDaemon(t, map[string]string{
		"POST /containers/prune": `{"ContainersDeleted":["c"],"SpaceReclaimed":5}`,
		"POST /images/prune":     `{"ImagesDeleted":[{"Deleted":"x"}],"SpaceReclaimed":6}`,
		"POST /networks/prune":   `{"NetworksDeleted":["n1","n2"]}`,
		"POST /build/prune":      `{"CachesDeleted":["a"],"SpaceReclaimed":9}`,
	})
	result, lines := runSpec(t, docker, Spec{Action: "pruneSystem"})
	want := map[string]any{
		"buildCache": pruneSummary(0, 9),
		"containers": pruneSummary(1, 5),
		"images":     pruneSummary(1, 6),
		"networks":   pruneSummary(2, 0),
	}
	if !reflect.DeepEqual(result, want) {
		t.Errorf("result = %v", result)
	}
	if len(lines) != 4 {
		t.Errorf("log = %v", lines)
	}
}

func TestReclaimStackNetworksOnlyTakesOrphans(t *testing.T) {
	docker, daemon := newFakeDaemon(t, map[string]string{"GET /networks": `[
		{"Id": "n1", "Name": "homerun-stack-live"},
		{"Id": "n2", "Name": "homerun-stack-gone"},
		{"Id": "n3", "Name": "homerun-stack-busy", "Containers": {"c": {}}},
		{"Id": "n4", "Name": "bridge"}
	]`})
	result, _ := runSpec(t, docker, Spec{Action: "reclaimStackNetworks", LiveStackIDs: []string{"live"}, StackNetworkPrefix: "homerun-stack-"})
	if want := []string{"DELETE /networks/n2"}; !reflect.DeepEqual(daemon.sent("DELETE"), want) {
		t.Errorf("removed = %v", daemon.sent("DELETE"))
	}
	if !reflect.DeepEqual(result, pruneSummary(1, 0)) {
		t.Errorf("result = %v", result)
	}
}

func TestUnknownAction(t *testing.T) {
	docker, _ := newFakeDaemon(t, nil)
	job, _, _ := jobs.Recorder("docker_cleanup", Spec{Action: "pruneEverything"})
	if _, err := run(context.Background(), job, docker); err == nil {
		t.Error("an unknown action should fail")
	}
}

func TestMirrorGarbageCollection(t *testing.T) {
	restartGrace = time.Millisecond
	digestOf := func(char string) string { return "sha256:" + strings.Repeat(char, 64) }
	var deleted []string
	var mu sync.Mutex
	registry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.Method + " " + r.URL.Path {
		case "GET /v2/":
		case "GET /v2/_catalog":
			_, _ = io.WriteString(w, `{"repositories":["docker.io/library/alpine","docker.io/library/nginx"]}`)
		case "GET /v2/docker.io/library/alpine/tags/list":
			_, _ = io.WriteString(w, `{"tags":["3.20","3.18"]}`)
		case "GET /v2/docker.io/library/nginx/tags/list":
			_, _ = io.WriteString(w, `{"tags":["1"]}`)
		case "HEAD /v2/docker.io/library/alpine/manifests/3.20":
			w.Header().Set("Docker-Content-Digest", digestOf("1"))
		case "HEAD /v2/docker.io/library/alpine/manifests/3.18":
			w.Header().Set("Docker-Content-Digest", digestOf("3"))
		case "HEAD /v2/docker.io/library/nginx/manifests/1":
			w.Header().Set("Docker-Content-Digest", digestOf("5"))
		default:
			if r.Method == http.MethodDelete {
				deleted = append(deleted, r.URL.Path)
				w.WriteHeader(http.StatusAccepted)
				return
			}
			http.NotFound(w, r)
		}
	}))
	defer registry.Close()

	docker, daemon := newFakeDaemon(t, map[string]string{
		"GET /containers/homerun-mirror/json": `{"State":{"Running":true}}`,
	})
	usage := []string{"300\t/var/lib/registry\n", "100\t/var/lib/registry\n"}
	daemon.execOut = func(cmd []string) (string, int) {
		if cmd[0] == "du" {
			out := usage[0]
			usage = usage[1:]
			return out, 0
		}
		return "", 0
	}
	spec := Spec{Action: "pruneMirror", Mirror: &MirrorSpec{
		ConfigPath:      "/etc/docker/registry/config.yml",
		Container:       "homerun-mirror",
		Keep:            registryapi.KeepSet{Tags: []registryapi.TagRef{{Repository: "docker.io/library/alpine", Tag: "3.20"}}},
		RepositoriesDir: "/var/lib/registry/docker/registry/v2/repositories",
		StorageDir:      "/var/lib/registry",
		URLs:            []string{"http://127.0.0.1:1", registry.URL},
	}}
	result, lines := runSpec(t, docker, spec)

	want := map[string]any{"itemsDeleted": 2, "keptManifests": 1, "removedRepositories": 1, "spaceReclaimedBytes": int64(200 * 1024)}
	if !reflect.DeepEqual(result, want) {
		t.Errorf("result = %v", result)
	}
	if len(deleted) != 2 {
		t.Errorf("deleted = %v", deleted)
	}
	var commands []string
	for _, cmd := range daemon.execs {
		commands = append(commands, cmd[0])
	}
	if want := []string{"du", "registry", "rm", "find", "du"}; !reflect.DeepEqual(commands, want) {
		t.Errorf("exec order = %v, want %v", commands, want)
	}
	if rm := daemon.execs[2]; rm[len(rm)-1] != spec.Mirror.RepositoriesDir+"/docker.io/library/nginx" {
		t.Errorf("rm = %v", rm)
	}
	if len(daemon.sent("POST /containers/homerun-mirror/restart")) != 1 {
		t.Error("the mirror was not restarted")
	}
	if len(lines) == 0 || !strings.HasPrefix(lines[len(lines)-1], "Mirror cleanup done") {
		t.Errorf("log = %v", lines)
	}
}

func TestMirrorFailsWhenGarbageCollectFails(t *testing.T) {
	registry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/_catalog" {
			_, _ = io.WriteString(w, `{"repositories":[]}`)
		}
	}))
	defer registry.Close()
	docker, daemon := newFakeDaemon(t, map[string]string{
		"GET /containers/homerun-mirror/json": `{"State":{"Running":true}}`,
	})
	daemon.execOut = func(cmd []string) (string, int) {
		if cmd[0] == "registry" {
			return "level=error msg=\"boom\"\nbye", 1
		}
		return "", 0
	}
	job, _, _ := jobs.Recorder("docker_cleanup", Spec{Action: "pruneMirror", Mirror: &MirrorSpec{Container: "homerun-mirror", URLs: []string{registry.URL}}})
	_, err := run(context.Background(), job, docker)
	if err == nil || !strings.Contains(err.Error(), `level=error msg="boom"`) {
		t.Errorf("err = %v", err)
	}
}

func TestParsers(t *testing.T) {
	if value, ok := parseDuKilobytes("24676\t/var/lib/registry\n"); !ok || value != 24676*1024 {
		t.Errorf("du = %d, %v", value, ok)
	}
	if _, ok := parseDuKilobytes(""); ok {
		t.Error("empty du output should not parse")
	}
	if got := lastErrorLine("fine\nERROR: denied\nlast\n"); got != "ERROR: denied" {
		t.Errorf("lastErrorLine = %q", got)
	}
	if got := lastErrorLine(""); got != "no output" {
		t.Errorf("lastErrorLine = %q", got)
	}
}
