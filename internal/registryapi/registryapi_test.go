package registryapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

const (
	alpine = "docker.io/library/alpine"
	nginx  = "docker.io/library/nginx"
)

func digest(char string) string {
	return "sha256:" + strings.Repeat(char, 64)
}

func TestPlanGC(t *testing.T) {
	inventory := []Tag{
		{Digest: digest("1"), Repository: alpine, Tag: "3.20"},
		{Digest: digest("1"), Repository: alpine, Tag: "latest"},
		{Digest: digest("2"), Repository: alpine, Tag: "3.19"},
		{Digest: digest("3"), Repository: alpine, Tag: "3.18"},
		{Digest: digest("9"), Repository: alpine, Tag: KeepTagFor(digest("9"))},
		{Digest: digest("5"), Repository: nginx, Tag: "1.27"},
	}
	keep := KeepSet{
		Digests: []Digest{
			{Digest: digest("2"), Repository: alpine},
			{Digest: digest("7"), Repository: alpine},
			{Digest: digest("8"), Repository: "docker.io/library/gone"},
		},
		Tags: []TagRef{{Repository: alpine, Tag: "3.20"}},
	}
	plan := PlanGC(inventory, []string{alpine, nginx, "ghcr.io/empty"}, keep)

	wantDeletes := []Digest{{digest("3"), alpine}, {digest("9"), alpine}, {digest("5"), nginx}}
	if !reflect.DeepEqual(plan.Deletes, wantDeletes) {
		t.Errorf("deletes = %v, want %v", plan.Deletes, wantDeletes)
	}
	wantPins := []Tag{{Digest: digest("7"), Repository: alpine, Tag: KeepTagFor(digest("7"))}}
	if !reflect.DeepEqual(plan.Pins, wantPins) {
		t.Errorf("pins = %v, want %v", plan.Pins, wantPins)
	}
	if want := []string{nginx, "ghcr.io/empty"}; !reflect.DeepEqual(plan.EmptiedRepositories, want) {
		t.Errorf("emptied = %v, want %v", plan.EmptiedRepositories, want)
	}
	if plan.KeptManifests != 3 {
		t.Errorf("kept = %d, want 3", plan.KeptManifests)
	}
}

func TestPlanGCEmptyKeepDeletesEverything(t *testing.T) {
	plan := PlanGC([]Tag{{Digest: digest("1"), Repository: alpine, Tag: "3.20"}}, []string{alpine}, KeepSet{})
	if len(plan.Deletes) != 1 || len(plan.Pins) != 0 || !reflect.DeepEqual(plan.EmptiedRepositories, []string{alpine}) {
		t.Errorf("plan = %+v", plan)
	}
}

func TestKeepTagIsAValidTag(t *testing.T) {
	tag := KeepTagFor(digest("f"))
	if !strings.HasPrefix(tag, KeepTagPrefix) || !regexp.MustCompile(`^\w[\w.-]{0,127}$`).MatchString(tag) {
		t.Errorf("tag = %q", tag)
	}
}

func TestHelpers(t *testing.T) {
	if got := NextCatalogPath(`</v2/_catalog?last=b&n=1000>; rel="next"`); got != "/v2/_catalog?last=b&n=1000" {
		t.Errorf("next = %q", got)
	}
	if NextCatalogPath("") != "" {
		t.Error("no link should have no next page")
	}
	if !IsValidRepository(alpine) || IsValidRepository("../etc") || IsValidRepository("a/../../b") {
		t.Error("repository validation is wrong")
	}
}

type recorded struct {
	method, path, accept, contentType, auth string
	body                                    string
}

func fakeRegistry(t *testing.T, routes map[string]http.HandlerFunc) (*Client, *[]recorded) {
	t.Helper()
	var calls []recorded
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		user, _, _ := r.BasicAuth()
		calls = append(calls, recorded{r.Method, r.URL.RequestURI(), r.Header.Get("Accept"), r.Header.Get("Content-Type"), user, string(raw)})
		if handler, ok := routes[r.Method+" "+r.URL.RequestURI()]; ok {
			handler(w, r)
			return
		}
		http.Error(w, "nope", http.StatusNotFound)
	}))
	t.Cleanup(server.Close)
	return New(server.URL+"/", "", ""), &calls
}

func TestCatalogPagesAndFilters(t *testing.T) {
	client, _ := fakeRegistry(t, map[string]http.HandlerFunc{
		"GET /v2/_catalog?n=1000": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Link", `</v2/_catalog?last=x&n=1000>; rel="next"`)
			_, _ = io.WriteString(w, `{"repositories":["`+alpine+`","Bad/../name"]}`)
		},
		"GET /v2/_catalog?last=x&n=1000": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, `{"repositories":["`+nginx+`"]}`)
		},
	})
	got, err := client.Catalog(context.Background())
	if err != nil || !reflect.DeepEqual(got, []string{alpine, nginx}) {
		t.Errorf("catalog = %v, %v", got, err)
	}
}

func TestInventoryResolvesDigestsWithIndexAwareAccept(t *testing.T) {
	client, calls := fakeRegistry(t, map[string]http.HandlerFunc{
		"GET /v2/" + alpine + "/tags/list": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, `{"tags":["3.20","vanished"]}`)
		},
		"HEAD /v2/" + alpine + "/manifests/3.20": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Docker-Content-Digest", digest("1"))
		},
	})
	got, err := client.Inventory(context.Background(), alpine)
	if err != nil || !reflect.DeepEqual(got, []Tag{{Digest: digest("1"), Repository: alpine, Tag: "3.20"}}) {
		t.Fatalf("inventory = %v, %v", got, err)
	}
	if (*calls)[1].accept != ManifestAccept || !strings.Contains(ManifestAccept, "application/vnd.oci.image.index.v1+json") {
		t.Errorf("accept = %q", (*calls)[1].accept)
	}
}

func TestUnknownRepositoryHasNoTags(t *testing.T) {
	client, _ := fakeRegistry(t, nil)
	if tags, err := client.Tags(context.Background(), "docker.io/library/gone"); err != nil || len(tags) != 0 {
		t.Errorf("tags = %v, %v", tags, err)
	}
}

func TestDeleteManifest(t *testing.T) {
	client, _ := fakeRegistry(t, map[string]http.HandlerFunc{
		"DELETE /v2/" + alpine + "/manifests/" + digest("1"): func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusAccepted)
		},
		"DELETE /v2/" + alpine + "/manifests/" + digest("3"): func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, `{"errors":[{"code":"UNSUPPORTED"}]}`, http.StatusMethodNotAllowed)
		},
	})
	ctx := context.Background()
	if gone, err := client.DeleteManifest(ctx, Digest{digest("1"), alpine}); !gone || err != nil {
		t.Errorf("delete = %v, %v", gone, err)
	}
	if gone, err := client.DeleteManifest(ctx, Digest{digest("2"), alpine}); gone || err != nil {
		t.Errorf("already gone = %v, %v", gone, err)
	}
	if _, err := client.DeleteManifest(ctx, Digest{digest("3"), alpine}); err == nil || !strings.Contains(err.Error(), "HTTP 405") {
		t.Errorf("disabled delete err = %v", err)
	}
}

func TestTagManifestRePutsTheManifest(t *testing.T) {
	manifest := `{"schemaVersion":2}`
	mediaType := "application/vnd.oci.image.manifest.v1+json"
	client, calls := fakeRegistry(t, map[string]http.HandlerFunc{
		"GET /v2/" + alpine + "/manifests/" + digest("7"): func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", mediaType)
			_, _ = io.WriteString(w, manifest)
		},
		"PUT /v2/" + alpine + "/manifests/" + KeepTagFor(digest("7")): func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusCreated)
		},
	})
	ctx := context.Background()
	pinned, err := client.TagManifest(ctx, Tag{Digest: digest("7"), Repository: alpine, Tag: KeepTagFor(digest("7"))})
	if !pinned || err != nil {
		t.Fatalf("pin = %v, %v", pinned, err)
	}
	put := (*calls)[1]
	if put.method != http.MethodPut || put.contentType != mediaType || put.body != manifest {
		t.Errorf("put = %+v", put)
	}
	if pinned, err := client.TagManifest(ctx, Tag{Digest: digest("8"), Repository: alpine, Tag: KeepTagFor(digest("8"))}); pinned || err != nil {
		t.Errorf("missing source = %v, %v", pinned, err)
	}
}

func TestPingAndBasicAuth(t *testing.T) {
	if New("http://127.0.0.1:1", "", "").Ping(context.Background()) {
		t.Error("an unreachable registry should not ping")
	}
	var user string
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		user, _, _ = r.BasicAuth()
	}))
	defer server.Close()
	if !New(server.URL, "homerun-internal", "secret").Ping(context.Background()) || user != "homerun-internal" {
		t.Errorf("ping with auth sent user %q", user)
	}
}
