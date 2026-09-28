package cli_test

import (
	"fmt"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFindSourceMapsKeepsPathsRelativeToTheBuildDir(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "_app", "immutable", "entry", "app.js.map"), "{}")
	writeFile(t, filepath.Join(dir, "_app", "immutable", "entry", "app.js"), "x")
	writeFile(t, filepath.Join(dir, "index.js.map"), "{}")

	files, err := cli.FindSourceMaps(dir)
	if err != nil {
		t.Fatal(err)
	}
	rels := []string{}
	for _, file := range files {
		rels = append(rels, file.Rel)
	}
	if strings.Join(rels, ",") != "_app/immutable/entry/app.js.map,index.js.map" {
		t.Errorf("got %v", rels)
	}
}

func TestSourceMapBatchesSplitOnCountAndSize(t *testing.T) {
	files := make([]cli.SourceMapFile, 0, 250)
	for index := range 250 {
		files = append(files, cli.SourceMapFile{Rel: fmt.Sprint(index), Size: 1})
	}
	if batches := cli.SourceMapBatches(files); len(batches) != 3 || len(batches[0]) != 100 || len(batches[2]) != 50 {
		t.Errorf("want 100/100/50, got %d batches", len(batches))
	}

	big := []cli.SourceMapFile{{Rel: "a", Size: 30 << 20}, {Rel: "b", Size: 30 << 20}, {Rel: "c", Size: 1}}
	if batches := cli.SourceMapBatches(big); len(batches) != 2 || len(batches[1]) != 2 {
		t.Errorf("want [a] [b c], got %v", batches)
	}
}

func TestSourceMapsUploadSendsEachMapUnderItsPath(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "_app", "app.js.map"), `{"version":3}`)
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `{"files":["_app/app.js"],"release":"abc123"}`)
	})

	out, failed := runCLI(t, func() { cli.SourceMapsUpload(client, "svc-1", dir, "abc123") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	sent := (*seen)[0]
	if sent.Method != "POST" || sent.Path != "/api/v1/services/svc-1/sourcemaps" {
		t.Errorf("wrong request %s %s", sent.Method, sent.Path)
	}
	_, params, err := mime.ParseMediaType(sent.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	form, err := multipart.NewReader(strings.NewReader(sent.Body), params["boundary"]).ReadForm(1 << 20)
	if err != nil {
		t.Fatal(err)
	}
	if form.Value["release"][0] != "abc123" || len(form.File["_app/app.js.map"]) != 1 {
		t.Errorf("got values %v files %v", form.Value, form.File)
	}
	if !strings.Contains(out, "Uploaded 1/1 maps") {
		t.Errorf("got %q", out)
	}
}

func TestSourceMapsUploadNeedsMaps(t *testing.T) {
	_, failed := runCLI(t, func() { cli.SourceMapsUpload(nil, "svc-1", t.TempDir(), "abc") })
	if !strings.Contains(failed, "No .map files") {
		t.Errorf("got %q", failed)
	}
}
