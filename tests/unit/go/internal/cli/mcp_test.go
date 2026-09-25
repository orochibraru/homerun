package cli_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/orochibraru/homerun/internal/cli"
	"github.com/orochibraru/homerun/internal/homerun"
)

type mcpRequest struct {
	Body   string
	Method string
	URL    string
}

func connectMCP(t *testing.T, readOnly bool) (*mcp.ClientSession, *[]mcpRequest) {
	t.Helper()
	seen := &[]mcpRequest{}
	instance := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		*seen = append(*seen, mcpRequest{Body: string(body), Method: r.Method, URL: r.URL.RequestURI()})
		if r.URL.Path == "/api/v1/services/missing/config" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"Service not found"}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(instance.Close)

	server := cli.NewMCPServer(homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: instance.URL}), readOnly)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session, seen
}

func toolNames(t *testing.T, session *mcp.ClientSession) []string {
	t.Helper()
	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(listed.Tools))
	for _, tool := range listed.Tools {
		names = append(names, tool.Name)
	}
	return names
}

func TestMCPReadOnlyLeavesOutEveryChangingTool(t *testing.T) {
	readOnly, _ := connectMCP(t, true)
	full, _ := connectMCP(t, false)
	readNames := toolNames(t, readOnly)
	fullNames := toolNames(t, full)
	for _, name := range []string{"deploy_service", "update_service", "restart_service", "stop_service", "rollback_service"} {
		if slices.Contains(readNames, name) {
			t.Errorf("read-only server exposes %s", name)
		}
		if !slices.Contains(fullNames, name) {
			t.Errorf("full server is missing %s", name)
		}
	}
	if slices.Contains(fullNames, "delete_service") {
		t.Error("deleting a service must never be a tool")
	}
}

func TestMCPToolsCallTheAPI(t *testing.T) {
	session, seen := connectMCP(t, false)
	ctx := context.Background()
	calls := []struct {
		args any
		name string
	}{
		{map[string]any{"serviceId": "svc"}, "get_service_config"},
		{map[string]any{"serviceId": "svc", "tail": 50}, "service_logs"},
		{map[string]any{"changes": map[string]any{"replicas": 2}, "serviceId": "svc"}, "update_service"},
		{map[string]any{"serviceId": "svc"}, "rollback_service"},
	}
	for _, call := range calls {
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Arguments: call.args, Name: call.name})
		if err != nil || result.IsError {
			t.Fatalf("%s failed: %v %+v", call.name, err, result)
		}
	}
	want := []mcpRequest{
		{Method: "GET", URL: "/api/v1/services/svc/config"},
		{Method: "GET", URL: "/api/v1/services/svc/logs?tail=50"},
		{Body: `{"replicas":2}`, Method: "PATCH", URL: "/api/v1/services/svc"},
		{Method: "POST", URL: "/api/v1/services/svc/revisions/previous/deploy"},
	}
	if !slices.Equal(*seen, want) {
		got, _ := json.Marshal(*seen)
		t.Errorf("requests = %s", got)
	}
}

func TestMCPReportsTheInstancesErrorToTheAgent(t *testing.T) {
	session, _ := connectMCP(t, true)
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Arguments: map[string]any{"serviceId": "missing"},
		Name:      "get_service_config",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("a 404 came back as a success")
	}
	message := result.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(message, "Service not found") {
		t.Errorf("error text %q doesn't carry the instance's message", message)
	}
}
