package cli_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

func TestChannelsBodySendsOnlyWhatWasGiven(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		args    cli.ChannelArgs
		want    map[string]any
	}{
		{"disable", false, cli.ChannelArgs{}, map[string]any{"enabled": false}},
		{"enable with defaults", true, cli.ChannelArgs{}, map[string]any{"enabled": true}},
		{
			"enable with everything",
			true,
			cli.ChannelArgs{Branch: "main", CanaryDomain: "canary.example.com", CanaryDomainSet: true, TagPattern: "v*"},
			map[string]any{"branch": "main", "canaryDomain": "canary.example.com", "enabled": true, "tagPattern": "v*"},
		},
		{
			"an empty canary domain clears it",
			true,
			cli.ChannelArgs{CanaryDomainSet: true},
			map[string]any{"canaryDomain": nil, "enabled": true},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := cli.ChannelsBody(test.enabled, test.args); !reflect.DeepEqual(got, test.want) {
				t.Errorf("want %v, got %v", test.want, got)
			}
		})
	}
}

func TestChannelsConfigurePatchesTheService(t *testing.T) {
	client, seen := jsonAPI(t, `{"enabled":true,"tagPattern":"v*"}`)

	out, failed := runCLI(t, func() {
		cli.ChannelsConfigure(client, "svc-1", true, cli.ChannelArgs{Branch: "main"})
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	request := (*seen)[0]
	if request.Method != "PATCH" || request.Path != "/api/v1/services/svc-1/channels" {
		t.Errorf("wrong request %s %s", request.Method, request.Path)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(request.Body), &body); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(body, map[string]any{"branch": "main", "enabled": true}) {
		t.Errorf("got body %v", body)
	}
	if !strings.Contains(out, `"tagPattern": "v*"`) {
		t.Errorf("got %q", out)
	}
}

func TestRunChannelsDispatches(t *testing.T) {
	tests := []struct {
		name       string
		args       []string
		wantMethod string
		wantBody   string
	}{
		{"status", []string{"status", "svc-1"}, "GET", ""},
		{"disable", []string{"disable", "svc-1"}, "PATCH", `{"enabled":false}`},
		{"enable clears the domain", []string{"enable", "svc-1", "--tags", "release-*", "--canary-domain", ""}, "PATCH", `{"canaryDomain":null,"enabled":true,"tagPattern":"release-*"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, seen := jsonAPI(t, `{"enabled":false}`)
			_, failed := runCLI(t, func() {
				cli.Execute(cli.Env{Client: func() *cli.Client { return client }}, append([]string{"services", "channels"}, test.args...))
			})
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			request := (*seen)[0]
			if request.Method != test.wantMethod || request.Path != "/api/v1/services/svc-1/channels" {
				t.Errorf("wrong request %s %s", request.Method, request.Path)
			}
			if request.Body != test.wantBody {
				t.Errorf("want body %s, got %s", test.wantBody, request.Body)
			}
		})
	}
}

func TestRunChannelsRejectsAnUnknownSubcommand(t *testing.T) {
	_, failed := runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return nil }}, append([]string{"services", "channels"}, []string{"toggle", "svc-1"}...))
	})
	if !strings.Contains(failed, `unknown services channels subcommand "toggle"`) {
		t.Errorf("got %q", failed)
	}
	_, failed = runCLI(t, func() {
		cli.Execute(cli.Env{Client: func() *cli.Client { return nil }}, append([]string{"services", "channels"}, nil...))
	})
	if !strings.Contains(failed, "missing services channels subcommand") {
		t.Errorf("got %q", failed)
	}
}

func TestServiceDeployEnvironment(t *testing.T) {
	client, seen := jsonAPI(t, `{"deploymentId":"d1","success":true}`)

	out, failed := runCLI(t, func() { cli.ServiceDeployEnvironment(client, "svc-1", "canary") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	request := (*seen)[0]
	if request.Method != "POST" || request.Path != "/api/v1/services/svc-1/deploy" {
		t.Errorf("wrong request %s %s", request.Method, request.Path)
	}
	if request.Body != `{"environment":"canary"}` {
		t.Errorf("got body %s", request.Body)
	}
	if !strings.Contains(out, `"deploymentId": "d1"`) {
		t.Errorf("got %q", out)
	}

	_, failed = runCLI(t, func() { cli.ServiceDeployEnvironment(client, "svc-1", "staging") })
	if failed != "--environment must be canary or stable." {
		t.Errorf("got %q", failed)
	}
}

func TestServiceSetEnvironment(t *testing.T) {
	client, seen := jsonAPI(t, `{"environmentName":"staging"}`)

	out, failed := runCLI(t, func() { cli.ServiceSetEnvironment(client, "svc-1", "staging") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	request := (*seen)[0]
	if request.Method != "PATCH" || request.Path != "/api/v1/services/svc-1" {
		t.Errorf("wrong request %s %s", request.Method, request.Path)
	}
	if request.Body != `{"environmentName":"staging"}` {
		t.Errorf("got body %s", request.Body)
	}
	if strings.TrimSpace(out) != "staging" {
		t.Errorf("got %q", out)
	}

	reset, seenReset := jsonAPI(t, `{"environmentName":null}`)
	out, _ = runCLI(t, func() { cli.ServiceSetEnvironment(reset, "svc-1", "") })
	if (*seenReset)[0].Body != `{"environmentName":null}` || strings.TrimSpace(out) != "production" {
		t.Errorf("got body %s, output %q", (*seenReset)[0].Body, out)
	}
}
