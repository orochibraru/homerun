package cli

import (
	"flag"
	"fmt"
	"net/url"
)

// ChannelsUsage is the help for `services channels`, printed on a bad call.
const ChannelsUsage = "usage: homerun services channels enable <id> [--branch <branch>] [--tags <glob>] [--canary-domain <domain>] | disable <id> | status <id>"

// ChannelArgs are the release channel settings `services channels enable` sends,
// each one left out of the request when its flag wasn't passed.
type ChannelArgs struct {
	Branch          string
	CanaryDomain    string
	CanaryDomainSet bool
	TagPattern      string
}

// ChannelsBody is the PATCH body for /services/{id}/channels: enabled always,
// the other settings only when given, and an empty canary domain as null so
// it clears the one set.
func ChannelsBody(enabled bool, args ChannelArgs) map[string]any {
	body := map[string]any{"enabled": enabled}
	if args.Branch != "" {
		body["branch"] = args.Branch
	}
	if args.TagPattern != "" {
		body["tagPattern"] = args.TagPattern
	}
	if args.CanaryDomainSet {
		if args.CanaryDomain == "" {
			body["canaryDomain"] = nil
		} else {
			body["canaryDomain"] = args.CanaryDomain
		}
	}
	return body
}

// RunChannels dispatches `services channels enable|disable|status`.
func RunChannels(client func() *Client, args []string) {
	if len(args) == 0 {
		Fail(ChannelsUsage)
	}
	switch args[0] {
	case "enable":
		set := NewFlagSet("services channels enable")
		branch := set.String("branch", "", "the branch whose pushes deploy the canary (default: the service's branch)")
		tags := set.String("tags", "", "glob a pushed tag must match to deploy stable (default v*)")
		canaryDomain := set.String("canary-domain", "", "a custom domain for the canary, empty to clear it")
		rest := Parse(set, args[1:])
		id := RequireArg(rest, 0, "id")
		ChannelsConfigure(client(), id, true, ChannelArgs{
			Branch:          *branch,
			CanaryDomain:    *canaryDomain,
			CanaryDomainSet: flagSet(set, "canary-domain"),
			TagPattern:      *tags,
		})
	case "disable":
		ChannelsConfigure(client(), RequireArg(args, 1, "id"), false, ChannelArgs{})
	case "status":
		ChannelsStatus(client(), RequireArg(args, 1, "id"))
	default:
		Fail(ChannelsUsage)
	}
}

// flagSet reports whether a flag was passed at all, so an explicit empty value can mean "clear".
func flagSet(set *flag.FlagSet, name string) bool {
	found := false
	set.Visit(func(f *flag.Flag) {
		if f.Name == name {
			found = true
		}
	})
	return found
}

// ChannelsConfigure turns a service's release channels on (with the given
// settings) or off, and prints the resulting settings as JSON. Turning them
// off deletes the canary service.
func ChannelsConfigure(client *Client, id string, enabled bool, args ChannelArgs) {
	var result map[string]any
	client.decodeJSON("PATCH", fmt.Sprintf("/services/%s/channels", url.PathEscape(id)), ChannelsBody(enabled, args), &result)
	PrintValue(result)
}

// ChannelsStatus prints a service's release channel settings and canary as JSON.
func ChannelsStatus(client *Client, id string) {
	body, _ := client.do("GET", fmt.Sprintf("/services/%s/channels", url.PathEscape(id)), nil)
	PrintJSON(body)
}

// ServiceDeployEnvironment deploys one environment of a service with release
// channels on, canary or stable, and waits for it like ServiceDeploy.
func ServiceDeployEnvironment(client *Client, id, environment string) {
	if environment != "canary" && environment != "stable" && environment != "production" {
		Fail("--environment must be canary or stable.")
	}
	var result map[string]any
	client.decodeJSON("POST", fmt.Sprintf("/services/%s/deploy", url.PathEscape(id)), map[string]string{"environment": environment}, &result)
	PrintValue(result)
}
