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

// globalFlags are the --base-url/--api-key overrides every command accepts,
// before or after the subcommand.
type globalFlags struct {
	apiKey  string
	baseURL string
}

const usage = `homerun - CLI for the Homerun REST API.

Usage: homerun [--base-url <url>] [--api-key <key>] <command> [options]

Commands:
  login [--base-url <url>]        log in via a device-code flow and save the resulting API key
  logout                          clear the saved login
  update                          self-update the installed binary to the latest release

  services list                   list services
  services get <id>               get a service by id
  services deploy <id>            deploy a service
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

  instance status                 show the running version, the latest release and whether an update can start
  instance update [--wait=false] [--timeout <seconds>]
                                  update the instance to the latest release (not the CLI itself, see ` + "`homerun update`" + `)

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
		fmt.Print(usage)
		return
	}

	global, rest := splitGlobalFlags(args)
	if len(rest) == 0 {
		fmt.Print(usage)
		return
	}

	switch rest[0] {
	case "login":
		login(global.baseURL)
	case "logout":
		logout()
	case "update":
		selfUpdate()
	case "services":
		runServices(global, rest[1:])
	case "stacks":
		runStacks(global, rest[1:])
	case "templates":
		runTemplates(global, rest[1:])
	case "instance":
		runInstance(global, rest[1:])
	default:
		fail(fmt.Sprintf("unknown command %q. Run `homerun --help` to see what's available.", rest[0]))
	}
}

// splitGlobalFlags pulls --base-url/--api-key (and --help/--version) out of the
// argument list wherever they appear, so they work before or after the
// subcommand, and returns everything else in order.
func splitGlobalFlags(args []string) (globalFlags, []string) {
	global := globalFlags{}
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
			fail(fmt.Sprintf("%s needs a value", name))
			return ""
		}
		switch name {
		case "--base-url":
			global.baseURL = takeValue()
		case "--api-key":
			global.apiKey = takeValue()
		case "-h", "--help":
			fmt.Print(usage)
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

// newFlagSet builds a flag set that reports a bad flag the same way every other
// CLI error is reported, rather than dumping Go's own usage block.
func newFlagSet(name string) *flag.FlagSet {
	set := flag.NewFlagSet(name, flag.ContinueOnError)
	set.SetOutput(io.Discard)
	set.Usage = func() {}
	return set
}

// parse parses one subcommand's flags and returns its positional arguments.
// Go's flag package stops at the first non-flag argument, so this resumes after
// each positional: `services scans list <id> --json` has to work, not just
// `--json <id>`.
func parse(set *flag.FlagSet, args []string) []string {
	positionals := []string{}
	for len(args) > 0 {
		if err := set.Parse(args); err != nil {
			fail(err.Error())
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

// listFlags registers the shared list options on a flag set.
func listFlags(set *flag.FlagSet) *ListArgs {
	args := &ListArgs{}
	set.BoolVar(&args.JSON, "json", false, "print raw JSON instead of a table")
	set.IntVar(&args.Page, "page", 0, "1-based page number")
	set.IntVar(&args.PerPage, "per-page", 0, "items per page")
	set.StringVar(&args.Search, "search", "", "only rows matching this term")
	return args
}

// requirePositiveTimeout rejects a negative --timeout, which would otherwise
// silently fall back to the default wait rather than failing.
func requirePositiveTimeout(seconds int) {
	if seconds < 0 {
		fail("--timeout can't be negative.")
	}
}

// requireArg returns the positional argument at index, failing with what the command expected.
func requireArg(args []string, index int, what string) string {
	if index >= len(args) || args[index] == "" {
		fail(fmt.Sprintf("missing <%s>. Run `homerun --help` to see the usage.", what))
	}
	return args[index]
}

func runServices(global globalFlags, args []string) {
	if len(args) == 0 {
		fail("missing services subcommand. Run `homerun --help` to see what's available.")
	}
	client := func() *Client { return requireClient(global.baseURL, global.apiKey) }

	switch args[0] {
	case "list":
		set := newFlagSet("services list")
		options := listFlags(set)
		parse(set, args[1:])
		servicesList(client(), *options)
	case "get":
		id := requireArg(args, 1, "id")
		serviceGet(client(), id)
	case "deploy", "start", "stop", "restart":
		id := requireArg(args, 1, "id")
		serviceAction(client(), args[0], id)
	case "delete":
		set := newFlagSet("services delete")
		force := set.Bool("force", false, "delete Homerun's record even if the workload couldn't be removed")
		rest := parse(set, args[1:])
		id := requireArg(rest, 0, "id")
		serviceDelete(client(), id, *force)
	case "webhook":
		id := requireArg(args, 1, "id")
		serviceWebhook(client(), id)
	case "revisions":
		set := newFlagSet("services revisions")
		asJSON := set.Bool("json", false, "print raw JSON instead of a table")
		rest := parse(set, args[1:])
		id := requireArg(rest, 0, "id")
		revisionsList(client(), id, *asJSON)
	case "logs":
		set := newFlagSet("services logs")
		tail := set.Int("tail", 0, "how many lines of backlog to print, 1 to 10000")
		follow := set.Bool("follow", false, "keep streaming new lines until interrupted")
		set.BoolVar(follow, "f", false, "keep streaming new lines until interrupted")
		rest := parse(set, args[1:])
		id := requireArg(rest, 0, "id")
		serviceLogs(client(), id, *follow, *tail)
	case "rollback":
		set := newFlagSet("services rollback")
		restoreConfig := set.Bool("restore-config", false, "also restore that revision's env vars, resources and networking")
		rest := parse(set, args[1:])
		revisionID := ""
		if len(rest) > 1 {
			revisionID = rest[1]
		}
		id := requireArg(rest, 0, "id")
		serviceRollback(client(), id, revisionID, *restoreConfig)
	case "scan":
		runServiceScan(client, args[1:])
	case "scans":
		runScans(client, args[1:])
	default:
		fail(fmt.Sprintf("unknown services subcommand %q. Run `homerun --help` to see what's available.", args[0]))
	}
}

func runServiceScan(client func() *Client, args []string) {
	set := newFlagSet("services scan")
	wait := set.Bool("wait", false, "wait for the scan to finish and print its findings")
	failOn := set.String("fail-on", "", "exit non-zero at or above this severity (implies --wait)")
	timeout := set.Int("timeout", 0, "give up waiting after this long, in seconds")
	asJSON := set.Bool("json", false, "print raw JSON instead of a summary")
	rest := parse(set, args)
	if *failOn != "" && !slices.Contains(failOnLevels, *failOn) {
		fail(fmt.Sprintf("--fail-on must be one of %s", strings.Join(failOnLevels, ", ")))
	}
	requirePositiveTimeout(*timeout)
	id := requireArg(rest, 0, "id")
	serviceScan(client(), id, ScanArgs{
		FailOn:  *failOn,
		JSON:    *asJSON,
		Timeout: time.Duration(*timeout) * time.Second,
		Wait:    *wait || *failOn != "",
	})
}

func runScans(client func() *Client, args []string) {
	subcommand := "list"
	rest := args
	if len(args) > 0 && (args[0] == "list" || args[0] == "get") {
		subcommand, rest = args[0], args[1:]
	}
	if subcommand == "get" {
		set := newFlagSet("services scans get")
		asJSON := set.Bool("json", false, "print raw JSON instead of a summary")
		positional := parse(set, rest)
		scanID := "latest"
		if len(positional) > 1 {
			scanID = positional[1]
		}
		id := requireArg(positional, 0, "id")
		scanGet(client(), id, scanID, *asJSON)
		return
	}
	set := newFlagSet("services scans list")
	options := listFlags(set)
	positional := parse(set, rest)
	id := requireArg(positional, 0, "id")
	scansList(client(), id, *options)
}

func runStacks(global globalFlags, args []string) {
	if len(args) == 0 || args[0] != "list" {
		fail("usage: homerun stacks list [--json] [--page <n>] [--per-page <n>] [--search <term>]")
	}
	set := newFlagSet("stacks list")
	options := listFlags(set)
	parse(set, args[1:])
	stacksList(requireClient(global.baseURL, global.apiKey), *options)
}

func runTemplates(global globalFlags, args []string) {
	if len(args) == 0 || args[0] != "list" {
		fail("usage: homerun templates list [--json] [--page <n>] [--per-page <n>] [--search <term>]")
	}
	set := newFlagSet("templates list")
	options := listFlags(set)
	parse(set, args[1:])
	templatesList(requireClient(global.baseURL, global.apiKey), *options)
}

func runInstance(global globalFlags, args []string) {
	if len(args) == 0 {
		fail("usage: homerun instance status|update")
	}
	switch args[0] {
	case "status":
		set := newFlagSet("instance status")
		asJSON := set.Bool("json", false, "print raw JSON instead of a summary")
		parse(set, args[1:])
		instanceStatus(requireClient(global.baseURL, global.apiKey), *asJSON)
	case "update":
		set := newFlagSet("instance update")
		wait := set.Bool("wait", true, "follow the update until the instance is back on the new version, --wait=false to return once it starts")
		timeout := set.Int("timeout", 0, "with --wait, how long to wait before giving up, in seconds")
		parse(set, args[1:])
		requirePositiveTimeout(*timeout)
		instanceUpdate(
			requireClient(global.baseURL, global.apiKey),
			*wait,
			time.Duration(*timeout)*time.Second,
		)
	default:
		fail(fmt.Sprintf("unknown instance subcommand %q. Run `homerun --help` to see what's available.", args[0]))
	}
}
