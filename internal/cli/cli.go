// Package cli is the homerun command-line client for the Homerun REST API.
package cli

import (
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/buildinfo"
)

// GlobalFlags are the --base-url/--api-key overrides every command accepts,
// before or after the subcommand.
type GlobalFlags struct {
	APIKey  string
	BaseURL string
}

// Usage is the CLI's top-level help text, printed with no arguments, --help or an unknown command.
const Usage = `homerun - CLI for the Homerun REST API.

Usage: homerun [--base-url <url>] [--api-key <key>] <command> [options]

Commands:
  login [--base-url <url>]        log in via a device-code flow and save the resulting API key
  logout                          clear the saved login
  update [--channel stable|canary|nightly]
                                  self-update the installed binary to the newest release on a channel (default stable, never downgrades)

  services list                   list services
  services get <id>               get a service by id
  services config <id>            print a service's settings as JSON, grouped by dashboard tab (also: services <id> config)
  services deploy <id> [--tag <tag>]
                                  deploy a service and wait for it, optionally switching its image tag first
  services start|stop|restart <id>
                                  start, stop or restart a service
  services delete <id> [--force]  delete a service
  services webhook <id>           show a service's push-to-deploy webhook URL and secret
  services revisions <id>         list a service's revisions, newest first by first deploy
  services logs <id> [--tail <n>] [-f|--follow]
                                  print a service's logs (the last 200 lines by default)
  services rollback <id> [revisionId] [--restore-config]
                                  redeploy a revision's exact image and wait for it
  services scan <id> [--wait] [--fail-on <level>] [--timeout <seconds>]
                                  queue a vulnerability scan of a service's deployed image
  services scans list <id>        list a service's image scans, newest first
  services scans get <id> [scanId]
                                  show one scan's counts and findings (default: the latest)

  stacks list                     list stacks
  templates list                  list templates

  instance status                 show the running version, the channel, its latest release and whether an update can start
  instance update [--wait=false] [--timeout <seconds>]
                                  update the instance to the latest release on its channel (not the CLI itself, see ` + "`homerun update`" + `)
  instance channel stable|canary|nightly
                                  set the release channel the instance updates from (switching to a more stable one never downgrades)

List options (services/stacks/templates/scans list):
  --json                          print raw JSON instead of a table
  --page <n>                      1-based page number (default 1)
  --per-page <n>                  items per page (default 100, max 100)
  --search <term>                 only rows matching this term

Global options:
  --base-url <url>                instance URL, overrides the saved login (or HOMERUN_BASE_URL)
  --api-key <key>                 API key, overrides the saved login (or HOMERUN_API_KEY)
  -v, --version                   print the CLI version
  -h, --help                      print this help

Auth/target: run ` + "`homerun login`" + ` once (stores your instance URL and a
CLI-scoped API key in ~/.config/homerun/config.json), or override per-call
with --base-url/--api-key above or their HOMERUN_BASE_URL/HOMERUN_API_KEY
env var equivalents.
`

// Main runs homerun-cli with the process's own arguments, exiting non-zero on failure.
func Main() {
	args := os.Args[1:]
	if len(args) == 0 {
		fmt.Print(Usage)
		return
	}

	global, rest := SplitGlobalFlags(args)
	if len(rest) == 0 {
		fmt.Print(Usage)
		return
	}

	switch rest[0] {
	case "login":
		Login(global.BaseURL)
	case "logout":
		Logout()
	case "update":
		set := NewFlagSet("update")
		channel := set.String("channel", "stable", "release channel to update from: stable, canary or nightly")
		Parse(set, rest[1:])
		SelfUpdate(*channel)
	case "services":
		RunServices(global, rest[1:])
	case "stacks":
		RunStacks(global, rest[1:])
	case "templates":
		RunTemplates(global, rest[1:])
	case "instance":
		RunInstance(global, rest[1:])
	default:
		Fail(fmt.Sprintf("unknown command %q. Run `homerun --help` to see what's available.", rest[0]))
	}
}

// SplitGlobalFlags pulls --base-url/--api-key (and --help/--version) out of the
// argument list wherever they appear, so they work before or after the
// subcommand, and returns everything else in order.
func SplitGlobalFlags(args []string) (GlobalFlags, []string) {
	global := GlobalFlags{}
	rest := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		arg := args[index]
		value := ""
		inline := false
		name := arg
		if equals := strings.Index(arg, "="); strings.HasPrefix(arg, "--") && equals != -1 {
			name, value, inline = arg[:equals], arg[equals+1:], true
		}
		takeValue := func() string {
			if inline {
				return value
			}
			if index+1 < len(args) {
				index++
				return args[index]
			}
			Fail(fmt.Sprintf("%s needs a value", name))
			return ""
		}
		switch name {
		case "--base-url":
			global.BaseURL = takeValue()
		case "--api-key":
			global.APIKey = takeValue()
		case "-h", "--help":
			fmt.Print(Usage)
			os.Exit(0)
		case "-v", "--version":
			fmt.Println(buildinfo.Version)
			os.Exit(0)
		default:
			rest = append(rest, arg)
		}
	}
	return global, rest
}

// NewFlagSet builds a flag set that reports a bad flag the same way every other
// CLI error is reported, rather than dumping Go's own usage block.
func NewFlagSet(name string) *flag.FlagSet {
	set := flag.NewFlagSet(name, flag.ContinueOnError)
	set.SetOutput(io.Discard)
	set.Usage = func() {}
	return set
}

// Parse parses one subcommand's flags and returns its positional arguments.
// Go's flag package stops at the first non-flag argument, so this resumes after
// each positional: `services scans list <id> --json` has to work, not just
// `--json <id>`.
func Parse(set *flag.FlagSet, args []string) []string {
	positionals := []string{}
	for len(args) > 0 {
		if err := set.Parse(args); err != nil {
			Fail(err.Error())
		}
		rest := set.Args()
		if len(rest) == 0 {
			break
		}
		positionals = append(positionals, rest[0])
		args = rest[1:]
	}
	return positionals
}

// ListFlags registers the shared list options on a flag set.
func ListFlags(set *flag.FlagSet) *ListArgs {
	args := &ListArgs{}
	set.BoolVar(&args.JSON, "json", false, "print raw JSON instead of a table")
	set.IntVar(&args.Page, "page", 0, "1-based page number")
	set.IntVar(&args.PerPage, "per-page", 0, "items per page")
	set.StringVar(&args.Search, "search", "", "only rows matching this term")
	return args
}

// RequirePositiveTimeout rejects a negative --timeout, which would otherwise
// silently fall back to the default wait rather than failing.
func RequirePositiveTimeout(seconds int) {
	if seconds < 0 {
		Fail("--timeout can't be negative.")
	}
}

// RequireArg returns the positional argument at index, failing with what the command expected.
func RequireArg(args []string, index int, what string) string {
	if index >= len(args) || args[index] == "" {
		Fail(fmt.Sprintf("missing <%s>. Run `homerun --help` to see the usage.", what))
	}
	return args[index]
}

// RunServices dispatches a `services` subcommand.
func RunServices(global GlobalFlags, args []string) {
	if len(args) == 0 {
		Fail("missing services subcommand. Run `homerun --help` to see what's available.")
	}
	client := func() *Client { return RequireClient(global.BaseURL, global.APIKey) }

	if len(args) >= 2 && args[1] == "config" {
		args = []string{"config", args[0]}
	}
	switch args[0] {
	case "config":
		id := RequireArg(args, 1, "id")
		ServiceConfig(client(), id)
	case "list":
		set := NewFlagSet("services list")
		options := ListFlags(set)
		Parse(set, args[1:])
		ServicesList(client(), *options)
	case "get":
		id := RequireArg(args, 1, "id")
		ServiceGet(client(), id)
	case "deploy":
		set := NewFlagSet("services deploy")
		tag := set.String("tag", "", "switch an image-based service to this image tag before deploying")
		rest := Parse(set, args[1:])
		id := RequireArg(rest, 0, "id")
		ServiceDeploy(client(), id, *tag)
	case "start", "stop", "restart":
		id := RequireArg(args, 1, "id")
		ServiceAction(client(), args[0], id)
	case "delete":
		set := NewFlagSet("services delete")
		force := set.Bool("force", false, "delete Homerun's record even if the workload couldn't be removed")
		rest := Parse(set, args[1:])
		id := RequireArg(rest, 0, "id")
		ServiceDelete(client(), id, *force)
	case "webhook":
		id := RequireArg(args, 1, "id")
		ServiceWebhook(client(), id)
	case "revisions":
		set := NewFlagSet("services revisions")
		asJSON := set.Bool("json", false, "print raw JSON instead of a table")
		rest := Parse(set, args[1:])
		id := RequireArg(rest, 0, "id")
		RevisionsList(client(), id, *asJSON)
	case "logs":
		set := NewFlagSet("services logs")
		tail := set.Int("tail", 0, "how many lines of backlog to print, 1 to 10000")
		follow := set.Bool("follow", false, "keep streaming new lines until interrupted")
		set.BoolVar(follow, "f", false, "keep streaming new lines until interrupted")
		rest := Parse(set, args[1:])
		id := RequireArg(rest, 0, "id")
		ServiceLogs(client(), id, *follow, *tail)
	case "rollback":
		set := NewFlagSet("services rollback")
		restoreConfig := set.Bool("restore-config", false, "also restore that revision's env vars, resources and networking")
		rest := Parse(set, args[1:])
		revisionID := ""
		if len(rest) > 1 {
			revisionID = rest[1]
		}
		id := RequireArg(rest, 0, "id")
		ServiceRollback(client(), id, revisionID, *restoreConfig)
	case "scan":
		RunServiceScan(client, args[1:])
	case "scans":
		RunScans(client, args[1:])
	default:
		Fail(fmt.Sprintf("unknown services subcommand %q. Run `homerun --help` to see what's available.", args[0]))
	}
}

// RunServiceScan dispatches `services scan`.
func RunServiceScan(client func() *Client, args []string) {
	set := NewFlagSet("services scan")
	wait := set.Bool("wait", false, "wait for the scan to finish and print its findings")
	failOn := set.String("fail-on", "", "exit non-zero at or above this severity (implies --wait)")
	timeout := set.Int("timeout", 0, "give up waiting after this long, in seconds")
	asJSON := set.Bool("json", false, "print raw JSON instead of a summary")
	rest := Parse(set, args)
	if *failOn != "" && !slices.Contains(failOnLevels, *failOn) {
		Fail(fmt.Sprintf("--fail-on must be one of %s", strings.Join(failOnLevels, ", ")))
	}
	RequirePositiveTimeout(*timeout)
	id := RequireArg(rest, 0, "id")
	ServiceScan(client(), id, ScanArgs{
		FailOn:  *failOn,
		JSON:    *asJSON,
		Timeout: time.Duration(*timeout) * time.Second,
		Wait:    *wait || *failOn != "",
	})
}

// RunScans dispatches `services scans list|get`.
func RunScans(client func() *Client, args []string) {
	subcommand := "list"
	rest := args
	if len(args) > 0 && (args[0] == "list" || args[0] == "get") {
		subcommand, rest = args[0], args[1:]
	}
	if subcommand == "get" {
		set := NewFlagSet("services scans get")
		asJSON := set.Bool("json", false, "print raw JSON instead of a summary")
		positional := Parse(set, rest)
		scanID := "latest"
		if len(positional) > 1 {
			scanID = positional[1]
		}
		id := RequireArg(positional, 0, "id")
		ScanGet(client(), id, scanID, *asJSON)
		return
	}
	set := NewFlagSet("services scans list")
	options := ListFlags(set)
	positional := Parse(set, rest)
	id := RequireArg(positional, 0, "id")
	ScansList(client(), id, *options)
}

// RunStacks dispatches a `stacks` subcommand.
func RunStacks(global GlobalFlags, args []string) {
	if len(args) == 0 || args[0] != "list" {
		Fail("usage: homerun stacks list [--json] [--page <n>] [--per-page <n>] [--search <term>]")
	}
	set := NewFlagSet("stacks list")
	options := ListFlags(set)
	Parse(set, args[1:])
	StacksList(RequireClient(global.BaseURL, global.APIKey), *options)
}

// RunTemplates dispatches a `templates` subcommand.
func RunTemplates(global GlobalFlags, args []string) {
	if len(args) == 0 || args[0] != "list" {
		Fail("usage: homerun templates list [--json] [--page <n>] [--per-page <n>] [--search <term>]")
	}
	set := NewFlagSet("templates list")
	options := ListFlags(set)
	Parse(set, args[1:])
	TemplatesList(RequireClient(global.BaseURL, global.APIKey), *options)
}

// RunInstance dispatches an `instance` subcommand.
func RunInstance(global GlobalFlags, args []string) {
	if len(args) == 0 {
		Fail("usage: homerun instance status|update|channel")
	}
	switch args[0] {
	case "status":
		set := NewFlagSet("instance status")
		asJSON := set.Bool("json", false, "print raw JSON instead of a summary")
		Parse(set, args[1:])
		InstanceStatus(RequireClient(global.BaseURL, global.APIKey), *asJSON)
	case "update":
		set := NewFlagSet("instance update")
		wait := set.Bool("wait", true, "follow the update until the instance is back on the new version, --wait=false to return once it starts")
		timeout := set.Int("timeout", 0, "with --wait, how long to wait before giving up, in seconds")
		Parse(set, args[1:])
		RequirePositiveTimeout(*timeout)
		InstanceUpdate(
			RequireClient(global.BaseURL, global.APIKey),
			*wait,
			time.Duration(*timeout)*time.Second,
		)
	case "channel":
		if len(args) != 2 {
			Fail("usage: homerun instance channel stable|canary|nightly")
		}
		InstanceChannel(RequireClient(global.BaseURL, global.APIKey), args[1])
	default:
		Fail(fmt.Sprintf("unknown instance subcommand %q. Run `homerun --help` to see what's available.", args[0]))
	}
}
