package cli

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/homerun"
)

const mcpInstructions = `Homerun is a self-hosted PaaS: each service is one Docker container or swarm service, routed by Traefik at its domains.

To diagnose a service: find its id with list_services, read get_service (status, container and swarm ids) and get_service_config (its settings grouped like the dashboard tabs), then service_logs and list_revisions (each revision's health and the reason it failed). Swarm logs can interleave every task generation, dead ones included, so check timestamps before blaming a line on the running task. Services in one stack reach each other by slug on the stack's network.

To fix one: update_service changes settings (applied on the next deploy), deploy_service rolls them out, restart_service restarts without redeploying, rollback_service redeploys an earlier revision. Say what you're about to change before changing it.`

type serviceIDArgs struct {
	ServiceID string `json:"serviceId" jsonschema:"the service's id, from list_services"`
}

type listArgs struct {
	Search string `json:"search,omitempty" jsonschema:"only services whose name or slug matches this term"`
}

type logsArgs struct {
	ServiceID string `json:"serviceId" jsonschema:"the service's id, from list_services"`
	Tail      int    `json:"tail,omitempty" jsonschema:"how many of the latest lines to return, 1 to 10000 (default 200)"`
}

type deployArgs struct {
	ServiceID string `json:"serviceId" jsonschema:"the service's id, from list_services"`
	Tag       string `json:"tag,omitempty" jsonschema:"switch an image-based service to this image tag first"`
}

type rollbackArgs struct {
	ServiceID     string `json:"serviceId" jsonschema:"the service's id, from list_services"`
	RevisionID    string `json:"revisionId,omitempty" jsonschema:"the revision to redeploy, from list_revisions (default: the previous one)"`
	RestoreConfig bool   `json:"restoreConfig,omitempty" jsonschema:"also restore the env vars, resources and networking that revision ran with"`
}

type updateArgs struct {
	ServiceID string         `json:"serviceId" jsonschema:"the service's id, from list_services"`
	Changes   map[string]any `json:"changes" jsonschema:"the fields to change, as the PATCH /services/{serviceId} body takes them, e.g. {\"envVars\": {\"KEY\": \"value\"}} (envVars replaces the whole map, so send every var)"`
}

// ServiceSummary is the slice of a service list_services returns: enough to
// pick one, without every service's env vars and settings.
type ServiceSummary struct {
	CurrentStatus string  `json:"currentStatus"`
	ID            string  `json:"id"`
	Image         string  `json:"image"`
	Name          string  `json:"name"`
	Slug          string  `json:"slug"`
	StackID       *string `json:"stackId"`
	Tag           string  `json:"tag"`
}

// mcpTools runs one MCP tool call against the instance's API.
type mcpTools struct {
	api *homerun.Client
}

// text wraps an API answer as a tool result, or turns a failure into an error
// the agent reads, with the instance's own message.
func text(body []byte, err error) (*mcp.CallToolResult, any, error) {
	if err != nil {
		var apiErr *homerun.APIError
		if errors.As(err, &apiErr) {
			return nil, nil, errors.New(homerun.APIErrorMessage(apiErr.Status, apiErr.Body))
		}
		return nil, nil, err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(body)}}}, nil, nil
}

// get performs one GET and returns its body as the tool result.
func (t mcpTools) get(path string, query url.Values) (*mcp.CallToolResult, any, error) {
	body, _, err := t.api.Do("GET", path, query)
	return text(body, err)
}

// post performs one bodiless POST and returns its body as the tool result.
func (t mcpTools) post(path string, query url.Values) (*mcp.CallToolResult, any, error) {
	body, _, err := t.api.Do("POST", path, query)
	return text(body, err)
}

// sendJSON performs one call with a JSON body and returns the answer as the tool result.
func (t mcpTools) sendJSON(method, path string, payload any) (*mcp.CallToolResult, any, error) {
	var answer json.RawMessage
	err := t.api.DecodeJSON(method, path, payload, &answer)
	return text(answer, err)
}

func servicePath(id string, suffix string) string {
	return "/services/" + url.PathEscape(id) + suffix
}

var falseHint = false

// NewMCPServer builds the MCP server over the instance's API: read-only
// diagnosis tools always, plus the tools that change a service unless
// readOnly. Deleting a service is deliberately not a tool.
func NewMCPServer(api *homerun.Client, readOnly bool) *mcp.Server {
	server := mcp.NewServer(
		&mcp.Implementation{Name: "homerun", Version: buildinfo.Version},
		&mcp.ServerOptions{Instructions: mcpInstructions},
	)
	tools := mcpTools{api: api}
	read := &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &falseHint}

	mcp.AddTool(server, &mcp.Tool{Name: "list_services", Description: "List services with their id, name, slug, image, tag, status and stack.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, args listArgs) (*mcp.CallToolResult, any, error) {
			query := url.Values{"perPage": {"100"}}
			if args.Search != "" {
				query.Set("q", args.Search)
			}
			var services []ServiceSummary
			if _, err := tools.api.Decode("GET", "/services", query, &services); err != nil {
				return text(nil, err)
			}
			body, err := json.Marshal(services)
			return text(body, err)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_service", Description: "A service's full record: status, container and swarm ids, image, domains and every setting as stored.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, args serviceIDArgs) (*mcp.CallToolResult, any, error) {
			return tools.get(servicePath(args.ServiceID, ""), nil)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_service_config", Description: "A service's settings grouped by dashboard tab (source, env, volumes, networking, compute, runtime, security, settings), secrets left out.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, args serviceIDArgs) (*mcp.CallToolResult, any, error) {
			return tools.get(servicePath(args.ServiceID, "/config"), nil)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "service_logs", Description: "The latest lines of a service's container or swarm task logs.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, args logsArgs) (*mcp.CallToolResult, any, error) {
			query := url.Values{}
			if args.Tail > 0 {
				query.Set("tail", strconv.Itoa(args.Tail))
			}
			return tools.get(servicePath(args.ServiceID, "/logs"), query)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "list_revisions", Description: "A service's deployed revisions, newest first, with each one's image, health and failure reason.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, args serviceIDArgs) (*mcp.CallToolResult, any, error) {
			return tools.get(servicePath(args.ServiceID, "/revisions"), nil)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "list_stacks", Description: "List stacks, the groups services share a network in.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
			return tools.get("/stacks", url.Values{"perPage": {"100"}})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "system_stats", Description: "The host's CPU, memory and disk usage.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
			return tools.get("/system-stats", nil)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "instance_status", Description: "The instance's running version, release channel and whether an update is available.", Annotations: read},
		func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
			return tools.get("/instance/update", nil)
		})

	if readOnly {
		return server
	}

	change := &mcp.ToolAnnotations{OpenWorldHint: &falseHint}
	mcp.AddTool(server, &mcp.Tool{Name: "update_service", Description: "Change a service's settings. Takes effect on its next deploy_service.", Annotations: change},
		func(_ context.Context, _ *mcp.CallToolRequest, args updateArgs) (*mcp.CallToolResult, any, error) {
			if len(args.Changes) == 0 {
				return nil, nil, errors.New("changes is empty: pass the fields to change")
			}
			return tools.sendJSON("PATCH", servicePath(args.ServiceID, ""), args.Changes)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "deploy_service", Description: "Deploy a service with its current settings and wait for the result, optionally switching its image tag first.", Annotations: change},
		func(_ context.Context, _ *mcp.CallToolRequest, args deployArgs) (*mcp.CallToolResult, any, error) {
			if args.Tag == "" {
				return tools.post(servicePath(args.ServiceID, "/deploy"), nil)
			}
			return tools.sendJSON("POST", servicePath(args.ServiceID, "/deploy"), map[string]string{"tag": args.Tag})
		})
	for action, verb := range map[string]string{"restart": "Restart", "start": "Start", "stop": "Stop"} {
		mcp.AddTool(server, &mcp.Tool{Name: action + "_service", Description: verb + " a service's container or swarm service, without redeploying it.", Annotations: change},
			func(_ context.Context, _ *mcp.CallToolRequest, args serviceIDArgs) (*mcp.CallToolResult, any, error) {
				return tools.post(servicePath(args.ServiceID, "/"+action), nil)
			})
	}
	mcp.AddTool(server, &mcp.Tool{Name: "rollback_service", Description: "Redeploy one of a service's earlier revisions (default: the previous one) and wait for it.", Annotations: change},
		func(_ context.Context, _ *mcp.CallToolRequest, args rollbackArgs) (*mcp.CallToolResult, any, error) {
			revision := args.RevisionID
			if revision == "" {
				revision = "previous"
			}
			query := url.Values{}
			if args.RestoreConfig {
				query.Set("restoreConfig", "true")
			}
			return tools.post(servicePath(args.ServiceID, "/revisions/"+url.PathEscape(revision)+"/deploy"), query)
		})
	return server
}

// RunMCP serves the MCP server over stdio until the client disconnects.
func RunMCP(global GlobalFlags, args []string) {
	set := NewFlagSet("mcp")
	readOnly := set.Bool("read-only", false, "only expose the tools that read, none that change a service")
	Parse(set, args)
	config := homerun.ResolveConfig(global.BaseURL, global.APIKey)
	if config == nil {
		Fail("Not logged in. Run `homerun login` to get started.")
		return
	}
	if err := NewMCPServer(homerun.NewClient(*config), *readOnly).Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		Fail(err.Error())
	}
}
