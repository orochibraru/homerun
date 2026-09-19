package imagescan_test

import (
	"context"
	"encoding/json"
	"github.com/orochibraru/homerun/tests/unit/go/internal/testsupport"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/jobs/imagescan"
)

// vulnerability builds one fake Trivy vulnerability entry.
func vulnerability(id, severity, pkg string, fixed bool) map[string]any {
	v := map[string]any{
		"InstalledVersion": "3.0.8",
		"PkgName":          pkg,
		"Severity":         severity,
		"Title":            id + " title",
		"VulnerabilityID":  id,
	}
	if fixed {
		v["FixedVersion"] = "3.0.9"
	}
	return v
}

// report builds a fake Trivy report JSON body from results.
func report(t *testing.T, results ...any) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"ArtifactName": "alpine:3.18.0", "Results": results})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// vulns wraps v as one Trivy result entry's Vulnerabilities list.
func vulns(v ...map[string]any) map[string]any {
	return map[string]any{"Vulnerabilities": v}
}

func TestSummarizeCountsEverySeverityAcrossResults(t *testing.T) {
	summary, err := imagescan.Summarize(report(t,
		vulns(vulnerability("CVE-1", "CRITICAL", "openssl", true), vulnerability("CVE-2", "HIGH", "openssl", true), vulnerability("CVE-3", "MEDIUM", "openssl", true)),
		vulns(vulnerability("GHSA-1", "LOW", "lodash", true), vulnerability("CVE-4", "weird", "zlib", true)),
		map[string]any{"Target": "clean layer"},
	), imagescan.MaxStoredFindings)
	if err != nil {
		t.Fatal(err)
	}
	want := imagescan.Counts{Critical: 1, High: 1, Low: 1, Medium: 1, Unknown: 1}
	if summary.Counts != want || summary.FixableCounts != want || summary.TotalFindings != 5 {
		t.Fatalf("got %+v", summary)
	}
}

func TestSummarizeFixableAndDedupe(t *testing.T) {
	summary, err := imagescan.Summarize(report(t, vulns(
		vulnerability("CVE-1", "CRITICAL", "a", false),
		vulnerability("CVE-2", "CRITICAL", "b", true),
		vulnerability("CVE-3", "HIGH", "c", false),
		vulnerability("CVE-2", "CRITICAL", "b", true),
	)), imagescan.MaxStoredFindings)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Counts != (imagescan.Counts{Critical: 2, High: 1}) || summary.FixableCounts != (imagescan.Counts{Critical: 1}) || summary.TotalFindings != 3 {
		t.Fatalf("got %+v", summary)
	}
}

func TestSummarizeSortsAndCaps(t *testing.T) {
	summary, err := imagescan.Summarize(report(t, vulns(
		vulnerability("CVE-LOW", "LOW", "openssl", true),
		vulnerability("CVE-B", "CRITICAL", "b", false),
		vulnerability("CVE-A", "CRITICAL", "a", true),
		vulnerability("CVE-HIGH", "HIGH", "openssl", true),
	)), 3)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, finding := range summary.Findings {
		ids = append(ids, finding.ID)
	}
	if !reflect.DeepEqual(ids, []string{"CVE-A", "CVE-B", "CVE-HIGH"}) || summary.Findings[1].FixedVersion != nil || summary.TotalFindings != 4 {
		t.Fatalf("got %v %+v", ids, summary)
	}
}

func TestSummarizeFieldsMatchTheApp(t *testing.T) {
	summary, err := imagescan.Summarize(report(t, vulns(vulnerability("CVE-9", "critical", "openssl", true))), imagescan.MaxStoredFindings)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(summary.Findings[0])
	want := `{"fixedVersion":"3.0.9","id":"CVE-9","installedVersion":"3.0.8","pkg":"openssl","severity":"CRITICAL","title":"CVE-9 title"}`
	if string(raw) != want {
		t.Fatalf("got %s", raw)
	}
}

func TestSummarizeCleanAndInvalid(t *testing.T) {
	summary, err := imagescan.Summarize([]byte(`{"SchemaVersion":2}`), imagescan.MaxStoredFindings)
	if err != nil || summary.TotalFindings != 0 || summary.Findings == nil {
		t.Fatalf("clean: %+v %v", summary, err)
	}
	for _, raw := range []string{"FATAL no such image", "[]", "null"} {
		if _, err := imagescan.Summarize([]byte(raw), imagescan.MaxStoredFindings); err == nil || err.Error() != "Trivy didn't return a JSON report." {
			t.Fatalf("%q: %v", raw, err)
		}
	}
}

func TestLastErrorLine(t *testing.T) {
	cases := map[string]string{
		"2024 INFO starting\n2024 FATAL unable to find the specified image\n\n": "2024 FATAL unable to find the specified image",
		"just a line\n": "just a line",
		"":              "no output",
	}
	for input, want := range cases {
		if got := imagescan.LastErrorLine(input); got != want {
			t.Fatalf("%q: got %q", input, got)
		}
	}
}

func TestCommand(t *testing.T) {
	remote := imagescan.Command("homerun-mirror:5000/x:1", imagescan.Source{Insecure: true, Kind: "remote"})
	if !reflect.DeepEqual(remote[:4], []string{"image", "--image-src", "remote", "--insecure"}) || remote[len(remote)-1] != "homerun-mirror:5000/x:1" {
		t.Fatalf("remote: %v", remote)
	}
	if got := imagescan.Command("app:1", imagescan.Source{Kind: "docker"})[2]; got != "docker" {
		t.Fatal(got)
	}
	if got := imagescan.Command("app:1", imagescan.Source{Kind: "any"})[2]; got != "docker,remote" {
		t.Fatal(got)
	}
	if strings.Contains(strings.Join(imagescan.Command("r/app:1", imagescan.Source{Kind: "remote"}), " "), "--insecure") {
		t.Fatal("insecure without asking")
	}
}

type fakeDaemon struct {
	mu      sync.Mutex
	created map[string]any
	removed bool
	exit    int
	stdout  string
	stderr  string
}

// serve starts a fake daemon running the scan container and returns a client
// pointed at it.
func (d *fakeDaemon) serve(t *testing.T) *dockerapi.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.mu.Lock()
		defer d.mu.Unlock()
		switch {
		case r.URL.Path == "/images/"+imagescan.TrivyImage+"/json":
			_, _ = w.Write([]byte(`{}`))
		case r.URL.Path == "/containers/create":
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &d.created)
			_, _ = w.Write([]byte(`{"Id":"scan1"}`))
		case r.URL.Path == "/containers/scan1/start":
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/containers/scan1/wait":
			_ = json.NewEncoder(w).Encode(map[string]int{"StatusCode": d.exit})
		case r.URL.Path == "/containers/scan1/logs":
			_, _ = w.Write(append(testsupport.DockerFrame(1, d.stdout), testsupport.DockerFrame(2, d.stderr)...))
		case r.Method == http.MethodDelete && r.URL.Path == "/containers/scan1":
			d.removed = true
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"no such container"}`))
		}
	}))
	t.Cleanup(server.Close)
	return dockerapi.NewWithHTTP(server.Client(), server.URL)
}

func TestScanRunsTrivyAndSummarizes(t *testing.T) {
	d := &fakeDaemon{stdout: string(report(t, vulns(vulnerability("CVE-1", "HIGH", "openssl", true)))), stderr: "INFO noise\n"}
	client := d.serve(t)
	summary, err := imagescan.Scan(context.Background(), client, "/var/run/docker.sock", "homerun", imagescan.Target{
		Auth:   &dockerapi.AuthConfig{Password: "pw", Username: "me"},
		Ref:    "nginx:alpine",
		Source: imagescan.Source{Kind: "any"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Counts.High != 1 || !d.removed {
		t.Fatalf("summary %+v removed %v", summary, d.removed)
	}
	host := d.created["HostConfig"].(map[string]any)
	binds := host["Binds"].([]any)
	if host["NetworkMode"] != "homerun" || len(binds) != 2 || binds[1] != "/var/run/docker.sock:/var/run/docker.sock" {
		t.Fatalf("host config %v", host)
	}
	if env := d.created["Env"].([]any); len(env) != 2 || env[1] != "TRIVY_USERNAME=me" {
		t.Fatalf("env %v", env)
	}
}

func TestScanReportsTheScannerError(t *testing.T) {
	d := &fakeDaemon{exit: 1, stderr: "INFO x\nFATAL unable to find the specified image\n"}
	_, err := imagescan.Scan(context.Background(), d.serve(t), "/sock", "", imagescan.Target{Ref: "gone:1", Source: imagescan.Source{Kind: "remote"}})
	if err == nil || err.Error() != "FATAL unable to find the specified image" || !d.removed {
		t.Fatalf("err %v removed %v", err, d.removed)
	}
	if binds := d.created["HostConfig"].(map[string]any)["Binds"].([]any); len(binds) != 1 {
		t.Fatalf("remote scan mounted the socket: %v", binds)
	}
}

func TestRunRejectsABadSpec(t *testing.T) {
	job, _, err := jobs.Recorder("image_scan", []int{1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := imagescan.Run(context.Background(), job); err == nil {
		t.Fatal("expected a decode error")
	}
}
