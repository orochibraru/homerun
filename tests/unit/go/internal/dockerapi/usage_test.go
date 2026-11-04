package dockerapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

func TestContainersUsageSamplesEveryRunningContainer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/containers/json"):
			_, _ = w.Write([]byte(`[
				{"Id":"aaaaaaaaaaaaaaaa","Names":["/web"],"Image":"nginx","Labels":{"homerun.service.id":"svc-1","other":"x"}},
				{"Id":"bbbbbbbbbbbbbbbb","Names":[],"Image":"gone"}
			]`))
		case strings.Contains(r.URL.Path, "/containers/aaaaaaaaaaaaaaaa/stats"):
			_, _ = w.Write([]byte(`{
				"cpu_stats":{"cpu_usage":{"total_usage":300},"system_cpu_usage":2000,"online_cpus":2},
				"precpu_stats":{"cpu_usage":{"total_usage":100},"system_cpu_usage":1000},
				"memory_stats":{"usage":314572800,"limit":1073741824,"stats":{"inactive_file":104857600}}
			}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"No such container"}`))
		}
	}))
	t.Cleanup(server.Close)
	client := dockerapi.NewWithHTTP(server.Client(), server.URL+"/")

	usage, err := client.ContainersUsage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(usage) != 1 {
		t.Fatalf("a container that can't be sampled is left out, got %+v", usage)
	}
	web := usage[0]
	if web.Name != "web" || web.Image != "nginx" || web.CPUPercent != 40 || web.HostCPUPercent != 20 {
		t.Errorf("got %+v", web)
	}
	if web.MemUsedMb != 200 {
		t.Errorf("memory should leave out the page cache like docker stats, got %v MB", web.MemUsedMb)
	}
	if web.Labels["homerun.service.id"] != "svc-1" || web.Labels["other"] != "" {
		t.Errorf("only homerun labels are kept, got %v", web.Labels)
	}
}
