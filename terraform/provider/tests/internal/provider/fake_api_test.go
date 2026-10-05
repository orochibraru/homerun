package provider_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/orochibraru/homerun/terraform/provider/internal/provider"
)

type recorded struct {
	body   map[string]any
	method string
	path   string
}

type fakeAPI struct {
	hidden   map[string]bool
	mu       sync.Mutex
	next     int
	objects  map[string]map[string]any
	requests []recorded
	server   *httptest.Server
}

func newFakeAPI(t *testing.T) *fakeAPI {
	t.Helper()
	spec, err := provider.LoadSpec()
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeAPI{hidden: map[string]bool{}, objects: map[string]map[string]any{}}
	for _, resource := range spec.Resources {
		for _, attribute := range resource.Attributes {
			if !attribute.FromAPI() {
				fake.hidden[attribute.Name] = true
			}
		}
	}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serve))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeAPI) URL() string {
	return f.server.URL
}

func (f *fakeAPI) put(path string, object map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[path] = object
}

func (f *fakeAPI) set(path, field string, value any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[path][field] = value
}

func (f *fakeAPI) calls(method, prefix string) []recorded {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []recorded
	for _, request := range f.requests {
		if request.method == method && strings.HasPrefix(request.path, prefix) {
			out = append(out, request)
		}
	}
	return out
}

func (f *fakeAPI) visible(object map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range object {
		if !f.hidden[key] {
			out[key] = value
		}
	}
	return out
}

func (f *fakeAPI) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.requests = append(f.requests, recorded{body: body, method: r.Method, path: path})
	if r.Header.Get("x-api-key") != "test-key" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	switch r.Method {
	case http.MethodGet:
		f.get(w, path)
	case http.MethodPost:
		f.create(w, path, body)
	case http.MethodPatch:
		object, ok := f.objects[path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		for key, value := range body {
			object[key] = value
		}
		_ = json.NewEncoder(w).Encode(f.visible(object))
	case http.MethodDelete:
		delete(f.objects, path)
		w.WriteHeader(http.StatusNoContent)
	}
}

func (f *fakeAPI) get(w http.ResponseWriter, path string) {
	if object, ok := f.objects[path]; ok {
		_ = json.NewEncoder(w).Encode(f.visible(object))
		return
	}
	list := []map[string]any{}
	for key, object := range f.objects {
		rest, found := strings.CutPrefix(key, path+"/")
		if found && !strings.Contains(rest, "/") {
			list = append(list, f.visible(object))
		}
	}
	if len(list) == 0 && strings.Count(path, "/") > 1 {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"Not found"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(list)
}

func (f *fakeAPI) create(w http.ResponseWriter, path string, body map[string]any) {
	if strings.HasSuffix(path, "/deploy") {
		_, _ = w.Write([]byte(`{}`))
		return
	}
	object := map[string]any{}
	for key, value := range body {
		object[key] = value
	}
	key := ""
	if strings.HasSuffix(path, "/buckets") {
		storeID := strings.Split(path, "/")[2]
		object["storeId"] = storeID
		object["id"] = fmt.Sprintf("%s/%s", storeID, body["name"])
		key = fmt.Sprintf("%s/%s", path, body["name"])
	} else {
		f.next++
		object["id"] = fmt.Sprintf("id-%d", f.next)
		key = fmt.Sprintf("%s/id-%d", path, f.next)
	}
	f.objects[key] = object
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(f.visible(object))
}
