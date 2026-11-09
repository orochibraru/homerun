package cli_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

const pipelineRepositoryUUID = "22222222-3333-4444-5555-666666666666"

func pipelineAPI(t *testing.T) (*cli.Client, *[]seenRequest) {
	t.Helper()
	return fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("content-type", "application/json")
		switch {
		case request.URL.Path == "/api/v1/pipelines/repositories" && request.Method == http.MethodGet:
			_, _ = writer.Write([]byte(`[{"id":"` + pipelineRepositoryUUID + `","fullName":"acme/api","providerKind":"github","webhookId":"7","stats":{"runs":4,"failed":1,"costUsd":0.5,"p50Ms":90000}},{"id":"other","fullName":"acme/api-docs","providerKind":"github","webhookId":null,"stats":null}]`))
		case strings.HasSuffix(request.URL.Path, "/runs"):
			_, _ = writer.Write([]byte(`[{"id":"run-1","name":"CI","number":12,"repositoryName":"acme/api","status":"failure","branch":"main","commitSha":"abcdef123456","durationMs":125000,"costUsd":0.016,"createdAt":"2026-11-01T10:00:00Z"}]`))
		default:
			_, _ = writer.Write([]byte(`{"jobId":"job-1"}`))
		}
	})
}

func TestPipelinesRepositoriesShowsTotalsAndHowEachIsKeptCurrent(t *testing.T) {
	client, _ := pipelineAPI(t)
	out, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"pipelines", "repos"})
	})
	if failed != "" {
		t.Fatalf("failed: %s", failed)
	}
	for _, want := range []string{"acme/api", "registered", "polled", "1m30s", "$0.50"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %q", want, out)
		}
	}
}

func TestPipelinesRunsResolvesARepositoryPathAndFiltersByStatus(t *testing.T) {
	client, seen := pipelineAPI(t)
	out, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"pipelines", "runs", "acme/api", "--status", "failure"})
	})
	if failed != "" {
		t.Fatalf("failed: %s", failed)
	}
	requests := *seen
	if len(requests) != 2 || requests[0].Query.Get("q") != "acme/api" {
		t.Fatalf("unexpected requests %+v", requests)
	}
	if requests[1].Path != "/api/v1/pipelines/repositories/"+pipelineRepositoryUUID+"/runs" || requests[1].Query.Get("status") != "failure" {
		t.Errorf("unexpected runs request %+v", requests[1])
	}
	for _, want := range []string{"CI #12", "abcdef1", "2m5s", "failure"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %q", want, out)
		}
	}
}

func TestPipelinesRunsWithoutARepositoryListsEveryRun(t *testing.T) {
	client, seen := pipelineAPI(t)
	_, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"pipelines", "runs", "--per-page", "5"})
	})
	if failed != "" {
		t.Fatalf("failed: %s", failed)
	}
	requests := *seen
	if len(requests) != 1 || requests[0].Path != "/api/v1/pipelines/runs" || requests[0].Query.Get("perPage") != "5" {
		t.Errorf("unexpected requests %+v", requests)
	}
}

func TestPipelinesSyncPostsToTheRepositorySyncRoute(t *testing.T) {
	client, seen := pipelineAPI(t)
	out, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"pipelines", "sync", pipelineRepositoryUUID})
	})
	if failed != "" {
		t.Fatalf("failed: %s", failed)
	}
	request := (*seen)[0]
	if len(*seen) != 1 || request.Method != http.MethodPost || request.Path != "/api/v1/pipelines/repositories/"+pipelineRepositoryUUID+"/sync" {
		t.Errorf("unexpected requests %+v", *seen)
	}
	if !strings.Contains(out, "job-1") {
		t.Errorf("the job id should be printed, got %q", out)
	}
}

func TestPipelinesWatchSendsTheProviderAndPath(t *testing.T) {
	client, seen := pipelineAPI(t)
	_, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"pipelines", "watch", "gh", "acme/api", "--default-branch", "main"})
	})
	if failed != "" {
		t.Fatalf("failed: %s", failed)
	}
	request := (*seen)[0]
	if request.Method != http.MethodPost || request.Path != "/api/v1/pipelines/repositories" || request.Body != `{"defaultBranch":"main","fullName":"acme/api","providerId":"gh"}` {
		t.Errorf("unexpected request %+v", request)
	}
}

func TestPipelinesUnknownRepositoryPathFails(t *testing.T) {
	client, _ := pipelineAPI(t)
	_, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"pipelines", "repository", "acme/nope"})
	})
	if !strings.Contains(failed, `No watched repository "acme/nope"`) {
		t.Errorf("expected a not-watched failure, got %q", failed)
	}
}

func TestFormatMs(t *testing.T) {
	cases := map[string]*float64{"-": nil, "850ms": ptr(850.0), "42s": ptr(42_000.0), "1h5m0s": ptr(3_900_000.0)}
	for want, input := range cases {
		if got := cli.FormatMs(input); got != want {
			t.Errorf("FormatMs(%v) = %q, want %q", input, got, want)
		}
	}
}

func ptr[T any](value T) *T {
	return &value
}
