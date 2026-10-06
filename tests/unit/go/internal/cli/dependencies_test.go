package cli_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

const dependenciesBody = `{"dependsOn":[{"id":"db-1","name":"Postgres","slug":"postgres","source":"both"}],"dependedOnBy":[{"id":"cron-1","name":"Cron","slug":"cron","source":"env"}]}`

func TestDependencyRowsListsWhatItNeedsFirst(t *testing.T) {
	rows := cli.DependencyRows(cli.ServiceDependencies{
		DependedOnBy: []cli.DependencyRef{{ID: "cron-1", Name: "Cron", Slug: "cron", Source: "env"}},
		DependsOn:    []cli.DependencyRef{{ID: "db-1", Name: "Postgres", Slug: "postgres", Source: "both"}},
	})
	want := []map[string]string{
		{"direction": "depends on", "id": "db-1", "name": "Postgres", "slug": "postgres", "source": "both"},
		{"direction": "needed by", "id": "cron-1", "name": "Cron", "slug": "cron", "source": "env"},
	}
	if !reflect.DeepEqual(rows, want) {
		t.Errorf("want %v, got %v", want, rows)
	}
}

func TestRunDependenciesDispatches(t *testing.T) {
	tests := []struct {
		name       string
		args       []string
		wantMethod string
		wantBody   string
		wantOut    string
	}{
		{"list", []string{"0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90"}, "GET", "", "depends on  Postgres"},
		{"list as json", []string{"0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90", "--json"}, "GET", "", `"slug": "postgres"`},
		{"set", []string{"set", "0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90", "db-1", "cache-1"}, "PUT", `{"dependsOn":["db-1","cache-1"]}`, "needed by"},
		{"set nothing clears", []string{"set", "0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90"}, "PUT", `{"dependsOn":[]}`, "Cron"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, seen := jsonAPI(t, dependenciesBody)
			out, failed := runCLI(t, func() {
				cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, append([]string{"services", "dependencies"}, test.args...))
			})
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			request := (*seen)[0]
			if request.Method != test.wantMethod || request.Path != "/api/v1/services/0b6f6c62-6a3b-4f8e-9d55-2f1a4c7e8d90/dependencies" {
				t.Errorf("wrong request %s %s", request.Method, request.Path)
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

func TestRunDependenciesNeedsArguments(t *testing.T) {
	_, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return nil }}, append([]string{"services", "dependencies"}, nil...))
	})
	if !strings.Contains(failed, "missing <id>") {
		t.Errorf("got %q", failed)
	}
}
