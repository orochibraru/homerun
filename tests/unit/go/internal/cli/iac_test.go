package cli_test

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

const generatedBody = `{"name":"Web","slug":"web","files":[
	{"path":"versions.tf","content":"terraform {}\n"},
	{"path":"modules/extra.tf","content":"# no trailing newline"},
	{"path":"terraform.tfvars","content":"db_password = \"hunter2\"\n"}
]}`

func iacAPI(t *testing.T) (*cli.Client, *[]seenRequest) {
	t.Helper()
	return fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("format") == "zip" {
			writer.Header().Set("content-type", "application/zip")
			fmt.Fprint(writer, "PK\x03\x04zipbytes")
			return
		}
		writer.Header().Set("content-type", "application/json")
		fmt.Fprint(writer, generatedBody)
	})
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

func TestIacGenerateWritesTheProjectWithPrivateSecrets(t *testing.T) {
	client, seen := iacAPI(t)
	dir := filepath.Join(t.TempDir(), "out")

	out, failed := runCLI(t, func() {
		cli.IacGenerate(client, cli.IacGenerateArgs{Out: dir, Project: "proj-1", Scope: "service:api"})
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	request := (*seen)[0]
	if request.Path != "/api/v1/iac/generate" || request.Query.Get("scope") != "service:api" || request.Query.Get("project") != "proj-1" {
		t.Errorf("wrong request %s %v", request.Path, request.Query)
	}
	for path, want := range map[string]os.FileMode{"versions.tf": 0o644, "modules/extra.tf": 0o644, "terraform.tfvars": 0o600} {
		if got := fileMode(t, filepath.Join(dir, path)); got != want {
			t.Errorf("%s: want mode %o, got %o", path, want, got)
		}
	}
	content, _ := os.ReadFile(filepath.Join(dir, "terraform.tfvars"))
	if string(content) != "db_password = \"hunter2\"\n" {
		t.Errorf("wrong content %q", content)
	}
	for _, want := range []string{"Wrote 3 files to " + dir, "terraform.tfvars holds secret values", "export TF_HTTP_PASSWORD", "cd " + dir + " && terraform init && terraform plan"} {
		if !strings.Contains(out, want) {
			t.Errorf("want %q in %q", want, out)
		}
	}
}

func TestIacGenerateDefaultsToASlugFolder(t *testing.T) {
	client, _ := iacAPI(t)
	t.Chdir(t.TempDir())

	out, failed := runCLI(t, func() { cli.IacGenerate(client, cli.IacGenerateArgs{Scope: "stack:web"}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if _, err := os.Stat(filepath.Join("web-terraform", "versions.tf")); err != nil {
		t.Errorf("want web-terraform/versions.tf: %v", err)
	}
	if strings.Contains(out, "TF_HTTP_PASSWORD") {
		t.Errorf("no backend password step without a state project: %q", out)
	}
}

func TestIacGenerateRefusesToOverwriteWithoutForce(t *testing.T) {
	client, _ := iacAPI(t)
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "versions.tf"), "mine")
	writeFile(t, filepath.Join(dir, "terraform.tfvars"), "old")
	if err := os.Chmod(filepath.Join(dir, "terraform.tfvars"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, failed := runCLI(t, func() { cli.IacGenerate(client, cli.IacGenerateArgs{Out: dir, Scope: "stack:web"}) })
	if !strings.Contains(failed, "already has versions.tf, terraform.tfvars") || !strings.Contains(failed, "--force") {
		t.Errorf("got %q", failed)
	}
	if content, _ := os.ReadFile(filepath.Join(dir, "versions.tf")); string(content) != "mine" {
		t.Errorf("an existing file was touched: %q", content)
	}
	if _, err := os.Stat(filepath.Join(dir, "modules")); err == nil {
		t.Error("nothing should be written when any file exists")
	}

	if _, failed := runCLI(t, func() {
		cli.IacGenerate(client, cli.IacGenerateArgs{Force: true, Out: dir, Scope: "stack:web"})
	}); failed != "" {
		t.Fatalf("--force failed with %q", failed)
	}
	if content, _ := os.ReadFile(filepath.Join(dir, "versions.tf")); string(content) != "terraform {}\n" {
		t.Errorf("--force should overwrite, got %q", content)
	}
	if got := fileMode(t, filepath.Join(dir, "terraform.tfvars")); got != 0o600 {
		t.Errorf("an overwritten terraform.tfvars should end up 0600, got %o", got)
	}
}

func TestIacGenerateStdout(t *testing.T) {
	client, _ := iacAPI(t)
	out, failed := runCLI(t, func() { cli.IacGenerate(client, cli.IacGenerateArgs{Scope: "stack:web", Stdout: true}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	want := "# ==> versions.tf <==\nterraform {}\n\n" +
		"# ==> modules/extra.tf <==\n# no trailing newline\n\n" +
		"# ==> terraform.tfvars <==\ndb_password = \"hunter2\"\n"
	if out != want {
		t.Errorf("want %q\n got %q", want, out)
	}
}

func TestIacGenerateZip(t *testing.T) {
	client, seen := iacAPI(t)
	path := filepath.Join(t.TempDir(), "web.zip")

	out, failed := runCLI(t, func() { cli.IacGenerate(client, cli.IacGenerateArgs{Scope: "stack:web", Zip: path}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if (*seen)[0].Query.Get("format") != "zip" {
		t.Errorf("want format=zip, got %v", (*seen)[0].Query)
	}
	if content, _ := os.ReadFile(path); string(content) != "PK\x03\x04zipbytes" {
		t.Errorf("wrong zip content %q", content)
	}
	if got := fileMode(t, path); got != 0o600 {
		t.Errorf("the zip holds secrets, want 0600, got %o", got)
	}
	if !strings.Contains(out, "Saved "+path) {
		t.Errorf("got %q", out)
	}

	_, failed = runCLI(t, func() { cli.IacGenerate(client, cli.IacGenerateArgs{Scope: "stack:web", Zip: path}) })
	if !strings.Contains(failed, "already exists") {
		t.Errorf("want a refusal to overwrite the zip, got %q", failed)
	}
}

func TestWriteProjectRefusesPathsOutsideTheDir(t *testing.T) {
	dir := t.TempDir()
	for _, path := range []string{"../escape.tf", "/etc/passwd"} {
		err := cli.WriteProject(dir, []cli.GeneratedFile{{Content: "x", Path: path}}, true)
		if err == nil || !strings.Contains(err.Error(), "outside") {
			t.Errorf("%s: want a refusal, got %v", path, err)
		}
	}
}

func TestRunIacGenerateValidatesItsFlags(t *testing.T) {
	for name, test := range map[string]struct {
		args []string
		want string
	}{
		"no scope":         {nil, "exactly one of --stack or --service"},
		"both scopes":      {[]string{"--stack", "a", "--service", "b"}, "exactly one of --stack or --service"},
		"two destinations": {[]string{"--stack", "a", "--stdout", "--zip", "x.zip"}, "can't be combined"},
		"out and stdout":   {[]string{"--stack", "a", "--stdout", "--out", "dir"}, "can't be combined"},
	} {
		t.Run(name, func(t *testing.T) {
			args := append([]string{"iac", "generate"}, test.args...)
			_, failed := runCLI(t, func() {
				cli.Execute(cli.Env{Client: func() *cli.Client { t.Fatal("the API must not be reached"); return nil }}, args)
			})
			if !strings.Contains(failed, test.want) {
				t.Errorf("want %q, got %q", test.want, failed)
			}
		})
	}
}

func TestRunIacGenerateBuildsTheScope(t *testing.T) {
	client, seen := iacAPI(t)
	if _, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"iac", "generate", "--service", "api", "--stdout"})
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if got := (*seen)[0].Query.Get("scope"); got != "service:api" {
		t.Errorf("want scope service:api, got %q", got)
	}
}

func TestIacStatePull(t *testing.T) {
	client, seen := jsonAPI(t, `{"version":4,"serial":7}`)
	out, failed := runCLI(t, func() { cli.IacStatePull(client, "proj-1") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if (*seen)[0].Path != "/api/v1/iac/projects/proj-1/state" || (*seen)[0].Header.Get("x-api-key") != "k" {
		t.Errorf("wrong request %s %v", (*seen)[0].Path, (*seen)[0].Header)
	}
	if out != `{"version":4,"serial":7}` {
		t.Errorf("the state should be written verbatim, got %q", out)
	}

	empty, _ := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusNoContent) })
	out, failed = runCLI(t, func() { cli.IacStatePull(empty, "proj-1") })
	if failed != "" || out != "" {
		t.Errorf("no state should print nothing on stdout, got %q / %q", out, failed)
	}
}

func TestRunIacUnlock(t *testing.T) {
	client, seen := jsonAPI(t, `{"success":true}`)
	withStdin(t, "yes\n")
	out, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"iac", "unlock", "proj-1", "--force"})
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	request := (*seen)[0]
	if request.Method != "DELETE" || request.Path != "/api/v1/iac/projects/proj-1/lock" || request.Query.Get("force") != "true" {
		t.Errorf("wrong request %s %s %v", request.Method, request.Path, request.Query)
	}
	if !strings.Contains(out, "Unlocked state project proj-1.") {
		t.Errorf("got %q", out)
	}

	_, failed = runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { t.Fatal("unlock without --force must not reach the API"); return nil }}, []string{"iac", "unlock", "proj-1", "--yes"})
	})
	if !strings.Contains(failed, "--force is required") {
		t.Errorf("got %q", failed)
	}

	withStdin(t, "n\n")
	_, failed = runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { t.Fatal("a declined unlock must not reach the API"); return nil }}, []string{"iac", "unlock", "proj-1", "--force"})
	})
	if !strings.Contains(failed, "Still locked") {
		t.Errorf("got %q", failed)
	}
}
