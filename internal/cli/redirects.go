package cli

import (
	"encoding/json"
	"flag"
	"net/url"
	"strconv"
)

var redirectColumns = []string{"id", "source", "destination", "enabled", "permanent", "keepPath"}

// Redirect is one redirect as the API returns it.
type Redirect struct {
	Destination string `json:"destination"`
	Enabled     bool   `json:"enabled"`
	ID          string `json:"id"`
	KeepPath    bool   `json:"keepPath"`
	Permanent   bool   `json:"permanent"`
	Source      string `json:"source"`
}

func redirectPath(id string) string {
	return "/redirects/" + url.PathEscape(id)
}

// RedirectsList prints redirects, newest first, as a table or raw JSON.
func RedirectsList(client *Client, args ListArgs) {
	body, header := client.do("GET", "/redirects", ListQuery(args))
	if args.JSON {
		PrintJSON(body)
		return
	}
	var redirects []Redirect
	if err := json.Unmarshal(body, &redirects); err != nil {
		Fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(redirects))
	for _, redirect := range redirects {
		rows = append(rows, map[string]string{
			"destination": redirect.Destination,
			"enabled":     strconv.FormatBool(redirect.Enabled),
			"id":          redirect.ID,
			"keepPath":    strconv.FormatBool(redirect.KeepPath),
			"permanent":   strconv.FormatBool(redirect.Permanent),
			"source":      redirect.Source,
		})
	}
	PrintTable(rows, redirectColumns)
	PrintPageFooter(header, len(redirects))
}

// RedirectGet prints one redirect as JSON.
func RedirectGet(client *Client, id string) {
	body, _ := client.do("GET", redirectPath(id), nil)
	PrintJSON(body)
}

// RedirectCreate adds a redirect and prints it as JSON.
func RedirectCreate(client *Client, fields map[string]any) {
	var created map[string]any
	client.decodeJSON("POST", "/redirects", fields, &created)
	PrintValue(created)
}

// RedirectUpdate changes the given fields of a redirect and prints it as JSON.
func RedirectUpdate(client *Client, id string, fields map[string]any) {
	var updated map[string]any
	client.decodeJSON("PATCH", redirectPath(id), fields, &updated)
	PrintValue(updated)
}

// RedirectDelete deletes a redirect.
func RedirectDelete(client *Client, id string) {
	client.do("DELETE", redirectPath(id), nil)
	PrintValue(map[string]any{"deleted": true, "id": id})
}

// redirectFlags registers the redirect field flags and returns the fields the
// caller actually passed, keyed by their API name.
func redirectFlags(set *flag.FlagSet, withRoute bool) func() map[string]any {
	names := map[string]string{"keep-path": "keepPath", "permanent": "permanent", "enabled": "enabled"}
	values := map[string]any{
		"enabled":   set.Bool("enabled", true, "whether Traefik serves it"),
		"keepPath":  set.Bool("keep-path", true, "append the rest of the path and the query string to the destination"),
		"permanent": set.Bool("permanent", true, "a permanent (308) rather than temporary (307) redirect"),
	}
	if withRoute {
		names["source"], names["destination"] = "source", "destination"
		values["source"] = set.String("source", "", "`host[/path]` to redirect, e.g. old.example.com or example.com/blog")
		values["destination"] = set.String("destination", "", "full http(s) `URL` to send requests to")
	}
	return func() map[string]any {
		fields := map[string]any{}
		set.Visit(func(f *flag.Flag) {
			if key, ok := names[f.Name]; ok {
				switch value := values[key].(type) {
				case *bool:
					fields[key] = *value
				case *string:
					fields[key] = *value
				}
			}
		})
		return fields
	}
}

var redirectCommands = []Command{
	{
		Name:    "redirects list",
		Summary: "list redirects, newest first",
		Setup: func(set *flag.FlagSet) Runner {
			options := ListFlags(set)
			return func(env Env, _ []string) { RedirectsList(env.Client(), *options) }
		},
	},
	{
		Args:    "<id>",
		Name:    "redirects get",
		Summary: "get a redirect by id",
		Setup:   noFlags(func(env Env, args []string) { RedirectGet(env.Client(), args[0]) }),
	},
	{
		Args:    "<source> <destination>",
		Name:    "redirects create",
		Summary: "send a hostname, or a path under it, to another URL",
		Setup: func(set *flag.FlagSet) Runner {
			fields := redirectFlags(set, false)
			return func(env Env, args []string) {
				body := fields()
				body["source"], body["destination"] = args[0], args[1]
				RedirectCreate(env.Client(), body)
			}
		},
	},
	{
		Args:    "<id>",
		Name:    "redirects update",
		Summary: "change a redirect, keeping the fields not passed",
		Setup: func(set *flag.FlagSet) Runner {
			fields := redirectFlags(set, true)
			return func(env Env, args []string) {
				body := fields()
				if len(body) == 0 {
					Fail("Nothing to change: pass at least one option.")
				}
				RedirectUpdate(env.Client(), args[0], body)
			}
		},
	},
	{
		Args:    "<id>",
		Name:    "redirects enable",
		Summary: "turn a redirect on",
		Setup: noFlags(func(env Env, args []string) {
			RedirectUpdate(env.Client(), args[0], map[string]any{"enabled": true})
		}),
	},
	{
		Args:    "<id>",
		Name:    "redirects disable",
		Summary: "turn a redirect off",
		Setup: noFlags(func(env Env, args []string) {
			RedirectUpdate(env.Client(), args[0], map[string]any{"enabled": false})
		}),
	},
	{
		Args:    "<id>",
		Name:    "redirects delete",
		Summary: "delete a redirect",
		Setup:   noFlags(func(env Env, args []string) { RedirectDelete(env.Client(), args[0]) }),
	},
}
