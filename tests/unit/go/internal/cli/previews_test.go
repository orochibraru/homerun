package cli_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/cli"
)

const fullSHA = "0123456789abcdef0123456789abcdef01234567"

func TestSameCommit(t *testing.T) {
	tests := []struct {
		full, given string
		want        bool
	}{
		{fullSHA, fullSHA, true},
		{fullSHA, "0123456", true},
		{fullSHA, "0123456789ABCDEF", true},
		{fullSHA, "1123456", false},
		{"", "0123456", false},
		{fullSHA, "", false},
	}
	for _, test := range tests {
		if got := cli.SameCommit(test.full, test.given); got != test.want {
			t.Errorf("SameCommit(%q, %q) = %v, want %v", test.full, test.given, got, test.want)
		}
	}
}

func TestPreviewVerdict(t *testing.T) {
	healthy := &cli.PreviewRevision{GitCommit: fullSHA, Health: "healthy"}
	tests := []struct {
		name    string
		preview cli.Preview
		commit  string
		want    string
	}{
		{"healthy revision of the commit", cli.Preview{Revision: healthy}, "0123456", "ready"},
		{"still watched", cli.Preview{Revision: &cli.PreviewRevision{GitCommit: fullSHA, Health: "watching"}}, fullSHA, "waiting"},
		{"unhealthy", cli.Preview{Revision: &cli.PreviewRevision{GitCommit: fullSHA, Health: "unhealthy", HealthReason: "restart loop"}}, fullSHA, "failed"},
		{"rolled back", cli.Preview{Revision: &cli.PreviewRevision{GitCommit: fullSHA, Health: "rolled_back"}}, fullSHA, "failed"},
		{"no health yet but running", cli.Preview{Revision: &cli.PreviewRevision{GitCommit: fullSHA}, Status: "running"}, fullSHA, "ready"},
		{"older commit still running", cli.Preview{Revision: &cli.PreviewRevision{GitCommit: "ffffffffff", Health: "healthy"}}, fullSHA, "waiting"},
		{
			"the commit's build failed before checking it out",
			cli.Preview{GitRef: fullSHA, Deployment: &cli.PreviewDeployment{Status: "failed", ErrorMessage: "boom"}},
			"0123456", "failed",
		},
		{
			"an older commit's failure doesn't count",
			cli.Preview{GitRef: fullSHA, Deployment: &cli.PreviewDeployment{Status: "failed", GitCommit: "ffffffffff"}},
			fullSHA, "waiting",
		},
		{"no commit, deploy in flight", cli.Preview{Revision: healthy, Deployment: &cli.PreviewDeployment{Status: "pulling"}}, "", "waiting"},
		{"no commit, latest deploy failed", cli.Preview{Revision: healthy, Deployment: &cli.PreviewDeployment{Status: "failed"}}, "", "failed"},
		{"no commit, healthy", cli.Preview{Revision: healthy, Deployment: &cli.PreviewDeployment{Status: "running"}}, "", "ready"},
		{"no commit, never deployed", cli.Preview{}, "", "waiting"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got, message := cli.PreviewVerdict(test.preview, test.commit); got != test.want {
				t.Errorf("got %s (%s), want %s", got, message, test.want)
			}
		})
	}
}

func TestRequirePR(t *testing.T) {
	_, failed := runCLI(t, func() {
		if got := cli.RequirePR([]string{"svc", "#12"}); got != 12 {
			t.Errorf("got %d", got)
		}
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	for _, bad := range []string{"0", "-3", "abc"} {
		_, failed := runCLI(t, func() { cli.RequirePR([]string{"svc", bad}) })
		if !strings.Contains(failed, "isn't a pull request number") {
			t.Errorf("%q: got %q", bad, failed)
		}
	}
}

func TestPreviewsList(t *testing.T) {
	client, seen := jsonAPI(t, `[{"prNumber":7,"title":"Add login","branch":"login","status":"running","url":"https://app-pr-7.example.com","revision":{"gitCommit":"`+fullSHA+`","health":"healthy"}}]`)
	out, failed := runCLI(t, func() { cli.PreviewsList(client, "svc-1", false) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if (*seen)[0].Path != "/api/v1/services/svc-1/previews" {
		t.Errorf("got path %s", (*seen)[0].Path)
	}
	for _, want := range []string{"#7", "Add login", "0123456", "healthy", "https://app-pr-7.example.com"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %q", want, out)
		}
	}
}

func TestPreviewDelete(t *testing.T) {
	client, seen := jsonAPI(t, `{"success":true}`)
	out, failed := runCLI(t, func() { cli.PreviewDelete(client, "svc-1", 7) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if (*seen)[0].Method != "DELETE" || (*seen)[0].Path != "/api/v1/services/svc-1/previews/7" {
		t.Errorf("got %s %s", (*seen)[0].Method, (*seen)[0].Path)
	}
	if !strings.Contains(out, `"deleted": true`) {
		t.Errorf("got %q", out)
	}
}

// previewAPI is a fake instance with previews on whose preview of #7 answers
// with each of states in turn, a 404 for an empty one, then keeps the last.
func previewAPI(t *testing.T, previewsEnabled bool, states ...string) (*cli.Client, *[]seenRequest) {
	t.Helper()
	calls := 0
	return fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("content-type", "application/json")
		if request.URL.Path == "/api/v1/services/svc-1" {
			fmt.Fprintf(writer, `{"id":"svc-1","previewsEnabled":%v}`, previewsEnabled)
			return
		}
		state := states[min(calls, len(states)-1)]
		calls++
		if state == "" {
			writer.WriteHeader(http.StatusNotFound)
			fmt.Fprint(writer, `{"error":"There's no preview for #7."}`)
			return
		}
		fmt.Fprint(writer, state)
	})
}

func TestPreviewWaitWaitsForTheCommitThenPrintsTheURL(t *testing.T) {
	noSleep(t)
	old := `{"url":"https://app-pr-7.example.com","revision":{"gitCommit":"ffffffffff","health":"healthy"}}`
	watching := `{"url":"https://app-pr-7.example.com","revision":{"gitCommit":"` + fullSHA + `","health":"watching"}}`
	ready := `{"url":"https://app-pr-7.example.com","revision":{"gitCommit":"` + fullSHA + `","health":"healthy"}}`
	client, seen := previewAPI(t, true, "", old, watching, ready)

	out, failed := runCLI(t, func() {
		cli.PreviewWait(client, "svc-1", 7, cli.PreviewWaitArgs{Commit: "0123456", Timeout: time.Minute})
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if strings.TrimSpace(out) != "https://app-pr-7.example.com" {
		t.Errorf("stdout should be the URL alone, got %q", out)
	}
	if len(*seen) != 5 {
		t.Errorf("want the service then 4 polls, got %d requests", len(*seen))
	}
}

func TestPreviewWaitFailsOnAFailedDeploy(t *testing.T) {
	noSleep(t)
	client, _ := previewAPI(t, true, `{"gitRef":"`+fullSHA+`","deployment":{"status":"failed","errorMessage":"Dockerfile not found"}}`)
	_, failed := runCLI(t, func() {
		cli.PreviewWait(client, "svc-1", 7, cli.PreviewWaitArgs{Commit: fullSHA, Timeout: time.Minute})
	})
	if !strings.Contains(failed, "Dockerfile not found") {
		t.Errorf("got %q", failed)
	}
}

func TestPreviewWaitRefusesAServiceWithoutPreviews(t *testing.T) {
	client, seen := previewAPI(t, false, "")
	_, failed := runCLI(t, func() {
		cli.PreviewWait(client, "svc-1", 7, cli.PreviewWaitArgs{Timeout: time.Minute})
	})
	if !strings.Contains(failed, "Previews are off") {
		t.Errorf("got %q", failed)
	}
	if len(*seen) != 1 {
		t.Errorf("shouldn't poll, got %d requests", len(*seen))
	}
}

func TestPreviewWaitGivesUp(t *testing.T) {
	noSleep(t)
	client, _ := previewAPI(t, true, "")
	_, failed := runCLI(t, func() {
		cli.PreviewWait(client, "svc-1", 7, cli.PreviewWaitArgs{Timeout: time.Nanosecond})
	})
	if !strings.Contains(failed, "Timed out") {
		t.Errorf("got %q", failed)
	}
}

func TestPreviewPromote(t *testing.T) {
	queued := `{"deploymentId":"dep-1","gitCommit":"` + fullSHA + `","imageRef":"homerun-build-app-pr-7:abc","jobId":"job-1","previewId":"p-1","revisionId":"rev-1"}`

	t.Run("without wait prints the queued deploy", func(t *testing.T) {
		client, seen := jsonAPI(t, queued)
		out, failed := runCLI(t, func() {
			cli.PreviewPromote(client, "svc-1", 7, cli.PreviewPromoteArgs{Commit: "0123456"})
		})
		if failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		request := (*seen)[0]
		if request.Method != "POST" || request.Path != "/api/v1/services/svc-1/previews/7/promote" {
			t.Errorf("got %s %s", request.Method, request.Path)
		}
		if request.Body != `{"commit":"0123456"}` {
			t.Errorf("got body %q", request.Body)
		}
		if !strings.Contains(out, `"jobId": "job-1"`) {
			t.Errorf("got %q", out)
		}
	})

	for _, test := range []struct {
		job        string
		wantFailed string
	}{
		{`{"status":"succeeded"}`, ""},
		{`{"status":"failed","error":"image gone"}`, "Promote failed: image gone"},
	} {
		t.Run("with wait "+test.job, func(t *testing.T) {
			noSleep(t)
			client, seen := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/api/v1/jobs/job-1" {
					fmt.Fprint(writer, test.job)
					return
				}
				fmt.Fprint(writer, queued)
			})
			out, failed := runCLI(t, func() {
				cli.PreviewPromote(client, "svc-1", 7, cli.PreviewPromoteArgs{Timeout: time.Minute, Wait: true})
			})
			if (*seen)[0].Body != `{}` {
				t.Errorf("no --commit should send an empty body, got %q", (*seen)[0].Body)
			}
			if test.wantFailed == "" {
				if failed != "" || !strings.Contains(out, `"success": true`) {
					t.Errorf("got %q / %q", out, failed)
				}
				return
			}
			if !strings.Contains(failed, test.wantFailed) {
				t.Errorf("got %q", failed)
			}
		})
	}
}
