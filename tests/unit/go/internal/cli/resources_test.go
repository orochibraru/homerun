package cli_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

const stackUUID = "7d0c9a52-1f3e-4b6a-8c2d-5e4f3a2b1c0d"

func TestApplySetParsesJSONValuesAndFallsBackToStrings(t *testing.T) {
	body := map[string]any{}
	for _, assignment := range []string{
		"name=web",
		"replicas=3",
		"privileged=false",
		"stackId=null",
		`domains=["a.example.com","b.example.com"]`,
		`labels={"team":"core"}`,
		`tag="2024"`,
		"command=npm run start",
		"empty=",
		"url=https://x.example.com/?a=b",
	} {
		if err := cli.ApplySet(body, assignment); err != nil {
			t.Fatalf("%s: %v", assignment, err)
		}
	}
	encoded, _ := json.Marshal(body)
	want := `{"command":"npm run start","domains":["a.example.com","b.example.com"],"empty":"","labels":{"team":"core"},"name":"web","privileged":false,"replicas":3,"stackId":null,"tag":"2024","url":"https://x.example.com/?a=b"}`
	if string(encoded) != want {
		t.Errorf("want %s\n got %s", want, encoded)
	}
}

func TestApplySetDottedKeysBuildNestedObjects(t *testing.T) {
	body := map[string]any{"envVars": map[string]any{"KEEP": "1"}}
	for _, assignment := range []string{"envVars.MODE=prod", "resources.limits.cpu=0.5"} {
		if err := cli.ApplySet(body, assignment); err != nil {
			t.Fatal(err)
		}
	}
	encoded, _ := json.Marshal(body)
	if want := `{"envVars":{"KEEP":"1","MODE":"prod"},"resources":{"limits":{"cpu":0.5}}}`; string(encoded) != want {
		t.Errorf("want %s, got %s", want, encoded)
	}
}

func TestApplySetRejectsBadAssignments(t *testing.T) {
	for assignment, want := range map[string]string{
		"novalue":      "want key=value",
		"a..b=1":       "empty key segment",
		"=1":           "empty key segment",
		"name.first=x": "name isn't an object",
	} {
		err := cli.ApplySet(map[string]any{"name": "web"}, assignment)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: want %q, got %v", assignment, want, err)
		}
	}
}

func TestBuildBodyMergesTheFileUnderTheSets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "body.json")
	writeFile(t, path, `{"name":"web","envVars":{"A":"1","MODE":"dev"},"big":12345678901234567890}`)

	body, err := cli.BuildBody(path, []string{"envVars.MODE=prod", "name=api"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(body)
	if want := `{"big":12345678901234567890,"envVars":{"A":"1","MODE":"prod"},"name":"api"}`; string(encoded) != want {
		t.Errorf("want %s, got %s", want, encoded)
	}

	fromStdin, err := cli.BuildBody("-", []string{"b=2"}, strings.NewReader(`{"a":1}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fromStdin, map[string]any{"a": json.Number("1"), "b": json.Number("2")}) {
		t.Errorf("stdin body: got %#v", fromStdin)
	}

	for name, content := range map[string]string{"array": `[1]`, "null": `null`, "junk": `{nope`, "two values": `{} {}`} {
		bad := filepath.Join(t.TempDir(), "bad.json")
		writeFile(t, bad, content)
		if _, err := cli.BuildBody(bad, nil, nil, nil); err == nil || !strings.Contains(err.Error(), "isn't a JSON object") {
			t.Errorf("%s: want a not-an-object error, got %v", name, err)
		}
	}
	if _, err := cli.BuildBody(filepath.Join(t.TempDir(), "missing.json"), nil, nil, nil); err == nil {
		t.Error("a missing file should fail")
	}
}

func TestBuildBodyStartsADottedSetFromTheCurrentObject(t *testing.T) {
	current := map[string]any{"envVars": map[string]any{"KEEP": "1", "MODE": "dev"}, "name": "web"}

	body, err := cli.BuildBody("", []string{"envVars.MODE=prod", "labels.team=core", "name=api"}, nil, current)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(body)
	if want := `{"envVars":{"KEEP":"1","MODE":"prod"},"labels":{"team":"core"},"name":"api"}`; string(encoded) != want {
		t.Errorf("want %s, got %s", want, encoded)
	}

	path := filepath.Join(t.TempDir(), "body.json")
	writeFile(t, path, `{"envVars":{"ONLY":"this"}}`)
	body, err = cli.BuildBody(path, []string{"envVars.MODE=prod"}, nil, current)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(body)
	if want := `{"envVars":{"MODE":"prod","ONLY":"this"}}`; string(encoded) != want {
		t.Errorf("the file's object should win over the current one, want %s, got %s", want, encoded)
	}
}

func TestUpdateWithADottedSetKeepsTheOtherKeys(t *testing.T) {
	const serviceUUID = "0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90"
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `{"id":"`+serviceUUID+`","envVars":{"KEEP":"1"},"replicas":1}`)
	})
	if _, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"services", "update", serviceUUID, "--set", "envVars.MODE=prod"})
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if len(*seen) != 2 || (*seen)[0].Method != "GET" {
		t.Fatalf("want a GET of the current service then the PATCH, got %+v", *seen)
	}
	if patch := (*seen)[1]; patch.Method != "PATCH" || patch.Body != `{"envVars":{"KEEP":"1","MODE":"prod"}}` {
		t.Errorf("got %s %s", patch.Method, patch.Body)
	}

	client, seen = jsonAPI(t, `{"id":"x"}`)
	if _, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"volumes", "update", "v-1", "--set", "name=data"})
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if len(*seen) != 1 || (*seen)[0].Method != "PATCH" {
		t.Errorf("a flat set needs no GET first, got %+v", *seen)
	}
}

func TestCell(t *testing.T) {
	for _, test := range []struct {
		value any
		want  string
	}{
		{nil, ""},
		{"plain", "plain"},
		{"two\nlines", `"two\nlines"`},
		{true, "true"},
		{float64(30), "30"},
		{0.25, "0.25"},
		{[]any{"a", "b"}, `["a","b"]`},
		{map[string]any{"k": "v"}, `{"k":"v"}`},
	} {
		if got := cli.Cell(test.value); got != test.want {
			t.Errorf("%#v: want %q, got %q", test.value, test.want, got)
		}
	}
}

func TestResourceVerbsDispatch(t *testing.T) {
	tests := []struct {
		name       string
		args       []string
		stdin      string
		wantMethod string
		wantPath   string
		wantQuery  string
		wantBody   string
		wantOut    string
	}{
		{"list paginated", []string{"volumes", "list", "--per-page", "5", "--search", "db"}, "", "GET", "/api/v1/volumes", "perPage=5&q=db", "", "backupEnabled"},
		{"list under a parent", []string{"buckets", "list", "store-1"}, "", "GET", "/api/v1/object-stores/store-1/buckets", "", "", "expirationDays"},
		{"get", []string{"cron-jobs", "get", "cron-1"}, "", "GET", "/api/v1/cron-jobs/cron-1", "", "", "field"},
		{"get as json", []string{"git-providers", "get", "gp-1", "--json"}, "", "GET", "/api/v1/git-providers/gp-1", "", "", `"id": "x"`},
		{"create", []string{"volumes", "create", "--set", "name=data", "--set", "backupEnabled=true"}, "", "POST", "/api/v1/volumes", "", `{"backupEnabled":true,"name":"data"}`, "value"},
		{"create from stdin", []string{"status-pages", "create", "--file", "-", "--set", "isPublic=false"}, `{"name":"Status","isPublic":true}`, "POST", "/api/v1/status-pages", "", `{"isPublic":false,"name":"Status"}`, "value"},
		{"update under a parent", []string{"buckets", "update", "store-1", "logs", "--set", "expirationDays=30"}, "", "PATCH", "/api/v1/object-stores/store-1/buckets/logs", "", `{"expirationDays":30}`, "value"},
		{"update a service", []string{"services", "update", "0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90", "--set", "envVars.MODE=prod"}, "", "PATCH", "/api/v1/services/0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90", "", `{"envVars":{"MODE":"prod"}}`, "value"},
		{"delete with --yes", []string{"dns-connections", "delete", "dns-1", "--yes"}, "", "DELETE", "/api/v1/dns-connections/dns-1", "", "", `"deleted": true`},
		{"delete confirmed", []string{"volume-mounts", "delete", "m-1"}, "y\n", "DELETE", "/api/v1/volume-mounts/m-1", "", "", `"deleted": true`},
		{"stack delete --force", []string{"stacks", "delete", stackUUID, "--yes", "--force"}, "", "DELETE", "/api/v1/stacks/" + stackUUID, "force=true", "", `"deleted": true`},
		{"iac project create", []string{"iac", "projects", "create", "--set", "name=infra", "--set", "storeId=s-1", "--set", "bucket=tf"}, "", "POST", "/api/v1/iac/projects", "", `{"bucket":"tf","name":"infra","storeId":"s-1"}`, "value"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			withStdin(t, test.stdin)
			client, seen := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
				if request.Method == "GET" && !strings.Contains(strings.TrimPrefix(request.URL.Path, "/api/v1/"), "/") ||
					strings.HasSuffix(request.URL.Path, "/buckets") && request.Method == "GET" {
					fmt.Fprint(writer, `[{"id":"x","name":"n","backupEnabled":true,"expirationDays":null}]`)
					return
				}
				if request.Method == "DELETE" {
					writer.WriteHeader(http.StatusNoContent)
					return
				}
				fmt.Fprint(writer, `{"id":"x","name":"n"}`)
			})
			out, failed := runCLI(t, func() {
				cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, test.args)
			})
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			request := (*seen)[len(*seen)-1]
			if request.Method != test.wantMethod || request.Path != test.wantPath {
				t.Errorf("want %s %s, got %s %s", test.wantMethod, test.wantPath, request.Method, request.Path)
			}
			if request.Query.Encode() != test.wantQuery {
				t.Errorf("want query %q, got %q", test.wantQuery, request.Query.Encode())
			}
			if request.Body != test.wantBody {
				t.Errorf("want body %s, got %s", test.wantBody, request.Body)
			}
			if !strings.Contains(out, test.wantOut) {
				t.Errorf("want %q in %q", test.wantOut, out)
			}
		})
	}
}

func TestResourceCommandsRefuseBeforeCallingTheAPI(t *testing.T) {
	for name, test := range map[string]struct {
		args  []string
		stdin string
		want  string
	}{
		"update with nothing":       {[]string{"volumes", "update", "v-1"}, "", "Nothing to change"},
		"delete declined":           {[]string{"volumes", "delete", "v-1"}, "n\n", "Not deleted"},
		"delete with no answer":     {[]string{"volumes", "delete", "v-1"}, "", "Not deleted"},
		"bad assignment":            {[]string{"volumes", "create", "--set", "oops"}, "", "want key=value"},
		"missing parent":            {[]string{"buckets", "list"}, "", "missing <store>"},
		"missing bucket":            {[]string{"buckets", "get", "store-1"}, "", "missing <bucket>"},
		"no update for deps":        {[]string{"service-dependencies", "update", "d-1"}, "", "unknown service-dependencies subcommand"},
		"no force on volumes":       {[]string{"volumes", "delete", "v-1", "--force"}, "", "flag provided but not defined"},
		"unknown status to resolve": {[]string{"services", "errors", "resolve", "s", "i", "--status", "all"}, "", "--status must be one of"},
	} {
		t.Run(name, func(t *testing.T) {
			withStdin(t, test.stdin)
			_, failed := runCLI(t, func() {
				cli.Execute(cli.Env{Client: func() *cli.Client { t.Fatal("the API must not be reached"); return nil }}, test.args)
			})
			if !strings.Contains(failed, test.want) {
				t.Errorf("want %q, got %q", test.want, failed)
			}
		})
	}
}

func TestResolveSlugLooksUpNonUUIDs(t *testing.T) {
	client, seen := jsonAPI(t, `[{"id":"`+stackUUID+`","slug":"web"},{"id":"other","slug":"web-2"}]`)

	if got := cli.ResolveSlug(client, "/stacks", "web"); got != stackUUID {
		t.Errorf("want the slug's id, got %q", got)
	}
	if request := (*seen)[0]; request.Path != "/api/v1/stacks" || request.Query.Get("q") != "web" {
		t.Errorf("wrong lookup %s %v", request.Path, request.Query)
	}
	if got := cli.ResolveSlug(client, "/stacks", "nope"); got != "nope" {
		t.Errorf("an unknown ref should pass through for the API to answer, got %q", got)
	}
	before := len(*seen)
	if got := cli.ResolveSlug(client, "/stacks", stackUUID); got != stackUUID || len(*seen) != before {
		t.Errorf("a UUID needs no lookup, got %q after %d requests", got, len(*seen)-before)
	}
}

func TestStacksGetAcceptsASlug(t *testing.T) {
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/v1/stacks" {
			fmt.Fprint(writer, `[{"id":"`+stackUUID+`","slug":"web"}]`)
			return
		}
		fmt.Fprint(writer, `{"id":"`+stackUUID+`","slug":"web"}`)
	})
	if _, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"stacks", "get", "web"})
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if got := (*seen)[len(*seen)-1].Path; got != "/api/v1/stacks/"+stackUUID {
		t.Errorf("want the resolved id in the path, got %s", got)
	}
}

func TestServiceCommandsAcceptASlug(t *testing.T) {
	const serviceUUID = "0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90"
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/v1/services" {
			fmt.Fprint(writer, `[{"id":"`+serviceUUID+`","slug":"api"}]`)
			return
		}
		fmt.Fprint(writer, `[]`)
	})
	if _, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"services", "deployments", "api", "--limit", "3"})
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	last := (*seen)[len(*seen)-1]
	if last.Path != "/api/v1/services/"+serviceUUID+"/deployments" || last.Query.Get("limit") != "3" {
		t.Errorf("got %s %v", last.Path, last.Query)
	}
}

func TestErrorResolveSendsTheStatus(t *testing.T) {
	const serviceUUID = "0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90"
	client, seen := jsonAPI(t, `{"id":"issue-1","status":"ignored"}`)
	out, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"services", "errors", "resolve", serviceUUID, "issue-1", "--status", "ignored"})
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	request := (*seen)[0]
	if request.Method != "PATCH" || request.Path != "/api/v1/services/"+serviceUUID+"/errors/issue-1" || request.Body != `{"status":"ignored"}` {
		t.Errorf("got %s %s %s", request.Method, request.Path, request.Body)
	}
	if !strings.Contains(out, `"status": "ignored"`) {
		t.Errorf("got %q", out)
	}
}

func TestSystemStatsText(t *testing.T) {
	used, total := 100.0, 400.0
	stats := cli.SystemStats{CPUPercent: 12.34, MemTotalMb: 8000, MemUsedMb: 2000, DiskTotalGb: &total, DiskUsedGb: &used}
	got := cli.SystemStatsText(stats)
	for _, want := range []string{"CPU:     12.3%", "Memory:  2000 / 8000 MB (25.0%)", "Disk:    100.0 / 400.0 GB (25.0%)"} {
		if !strings.Contains(got, want) {
			t.Errorf("want %q in %q", want, got)
		}
	}
	if strings.Contains(got, "GPU") {
		t.Errorf("no GPU line without a GPU: %q", got)
	}
	if got := cli.SystemStatsText(cli.SystemStats{}); !strings.Contains(got, "Disk:    unknown") || !strings.Contains(got, "(0.0%)") {
		t.Errorf("a missing disk should say unknown, an empty memory 0%%: %q", got)
	}
}

func TestVolumesBackupIsBackupsRun(t *testing.T) {
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == "GET" {
			fmt.Fprint(writer, `[{"id":"v-1","name":"data"}]`)
			return
		}
		fmt.Fprint(writer, `{"jobId":"job-1"}`)
	})
	out, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, []string{"volumes", "backup", "data"})
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if last := (*seen)[len(*seen)-1]; last.Method != "POST" || last.Path != "/api/v1/volumes/v-1/backup" {
		t.Errorf("got %s %s", last.Method, last.Path)
	}
	if !strings.Contains(out, `"jobId": "job-1"`) {
		t.Errorf("got %q", out)
	}
}

func TestEveryResourceVerbIsRegistered(t *testing.T) {
	for _, name := range []string{
		"services create", "services update", "stacks get", "stacks create", "stacks update", "stacks delete",
		"templates get", "volumes list", "buckets delete", "iac projects list", "iac projects delete",
	} {
		if command, _ := cli.Lookup(strings.Fields(name)); command == nil || command.Name != name {
			t.Errorf("%q isn't registered", name)
		}
	}
}
