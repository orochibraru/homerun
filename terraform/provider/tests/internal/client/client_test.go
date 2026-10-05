package client_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/orochibraru/homerun/terraform/provider/internal/client"
)

func newServer(t *testing.T, handler http.HandlerFunc) *client.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	apiClient, err := client.New(server.URL+"/", "secret-key")
	if err != nil {
		t.Fatal(err)
	}
	return apiClient
}

func TestNewRejectsEmptyAndRelativeEndpoints(t *testing.T) {
	for _, endpoint := range []string{"", "  ", "homerun.local", "/api/v1"} {
		if _, err := client.New(endpoint, "key"); err == nil {
			t.Errorf("New(%q) should fail", endpoint)
		}
	}
	if _, err := client.New("https://homerun.example.com/api/v1/", "key"); err != nil {
		t.Errorf("an endpoint ending in /api/v1 should work: %v", err)
	}
}

func TestGetSendsTheKeyAndDecodesNumbers(t *testing.T) {
	apiClient := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/stacks/abc" || r.Header.Get("x-api-key") != "secret-key" {
			t.Errorf("unexpected request %s %s key=%q", r.Method, r.URL.Path, r.Header.Get("x-api-key"))
		}
		_, _ = w.Write([]byte(`{"id":"abc","replicas":3}`))
	})
	object, err := apiClient.Get(context.Background(), "/stacks/abc")
	if err != nil {
		t.Fatal(err)
	}
	if object["id"] != "abc" || object["replicas"] != json.Number("3") {
		t.Errorf("unexpected object %#v", object)
	}
}

func TestErrorsCarryTheMessageAndStatus(t *testing.T) {
	apiClient := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/missing":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"Not found"}`))
		case "/api/v1/invalid":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"Invalid request body","issues":{"fieldErrors":{"name":["Required"]}}}`))
		default:
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte("upstream down"))
		}
	})
	ctx := context.Background()
	_, err := apiClient.Get(ctx, "/missing")
	if !client.IsNotFound(err) {
		t.Errorf("expected a 404, got %v", err)
	}
	_, err = apiClient.Create(ctx, "/invalid", client.Object{})
	if err == nil || err.Error() != `homerun API answered 400: Invalid request body: {"fieldErrors":{"name":["Required"]}}` {
		t.Errorf("unexpected error %v", err)
	}
	_, err = apiClient.Get(ctx, "/other")
	if err == nil || err.Error() != "homerun API answered 502: upstream down" {
		t.Errorf("unexpected error %v", err)
	}
}

func TestCreateUpdateDeleteAndDeploy(t *testing.T) {
	var calls []string
	apiClient := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		var body map[string]any
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		switch r.Method {
		case http.MethodDelete:
			w.WriteHeader(http.StatusNotFound)
		case http.MethodPost, http.MethodPatch:
			body["id"] = "svc-1"
			_ = json.NewEncoder(w).Encode(body)
		}
	})
	ctx := context.Background()
	created, err := apiClient.Create(ctx, "/services", client.Object{"name": "web"})
	if err != nil || created["name"] != "web" || created["id"] != "svc-1" {
		t.Fatalf("create: %v %#v", err, created)
	}
	updated, err := apiClient.Update(ctx, "/services/svc-1", client.Object{"replicas": 2})
	if err != nil || updated["replicas"] != json.Number("2") {
		t.Fatalf("update: %v %#v", err, updated)
	}
	if err := apiClient.Delete(ctx, "/services/svc-1"); err != nil {
		t.Errorf("deleting something already gone should succeed: %v", err)
	}
	if err := apiClient.Deploy(ctx, "svc 1"); err != nil {
		t.Fatal(err)
	}
	want := []string{"POST /api/v1/services", "PATCH /api/v1/services/svc-1", "DELETE /api/v1/services/svc-1", "POST /api/v1/services/svc 1/deploy"}
	if len(calls) != len(want) {
		t.Fatalf("calls %v", calls)
	}
	for index := range want {
		if calls[index] != want[index] {
			t.Errorf("call %d: %s, want %s", index, calls[index], want[index])
		}
	}
}

func TestListFollowsPagesOnlyWhenPaged(t *testing.T) {
	apiClient := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if r.URL.Path == "/api/v1/paged" {
			w.Header().Set("x-total-count", "150")
			count := 100
			if page == 2 {
				count = 50
			}
			items := make([]map[string]any, count)
			for index := range items {
				items[index] = map[string]any{"id": strconv.Itoa((page-1)*100 + index)}
			}
			_ = json.NewEncoder(w).Encode(items)
			return
		}
		if r.URL.Query().Get("q") != "web" {
			t.Errorf("the search wasn't forwarded: %s", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "a"}, {"id": "b"}})
	})
	ctx := context.Background()
	paged, err := apiClient.List(ctx, "/paged", nil)
	if err != nil || len(paged) != 150 || paged[149]["id"] != "149" {
		t.Fatalf("paged: %v, %d items", err, len(paged))
	}
	whole, err := apiClient.List(ctx, "/whole", map[string][]string{"q": {"web"}})
	if err != nil || len(whole) != 2 {
		t.Fatalf("whole: %v %#v", err, whole)
	}
}
