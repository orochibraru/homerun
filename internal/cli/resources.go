package cli

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Resource is one REST collection exposed as a generic command group, so a
// new collection is a table entry rather than five hand-written commands.
// Group is the command group ("volumes"), Noun the singular its summaries use,
// Path the API collection, with a %s filled by the Parent positional argument
// when Parent is set ("/object-stores/%s/buckets"), ID the name of the item
// argument, Columns the fields `list` prints, Paginated whether the list
// endpoint takes page/perPage/q, Slugs whether an item argument may be a slug
// (resolved through the list), ForceDelete whether `delete` takes --force, and
// Verbs which of list, get, create, update and delete exist.
type Resource struct {
	Columns     []string
	ForceDelete bool
	Group       string
	ID          string
	Noun        string
	Paginated   bool
	Parent      string
	Path        string
	Slugs       bool
	Verbs       []string
}

var allVerbs = []string{"list", "get", "create", "update", "delete"}

var resources = []Resource{
	{Group: "services", Noun: "service", Path: "/services", ID: "id", Slugs: true, Verbs: []string{"create", "update"}},
	{
		Columns: []string{"id", "name", "slug", "parentId", "description"}, ForceDelete: true,
		Group: "stacks", ID: "id|slug", Noun: "stack", Path: "/stacks", Slugs: true,
		Verbs: []string{"get", "create", "update", "delete"},
	},
	{Group: "templates", ID: "id", Noun: "template", Path: "/templates", Verbs: []string{"get"}},
	{
		Columns: []string{"id", "serviceId", "name", "slug", "ref", "domain"},
		Group:   "service-environments", ID: "id", Noun: "service environment", Path: "/service-environments", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "serviceId", "dependsOnId", "createdAt"},
		Group:   "service-dependencies", ID: "id", Noun: "service dependency", Path: "/service-dependencies",
		Verbs: []string{"list", "get", "create", "delete"},
	},
	{
		Columns: []string{"id", "name", "kind", "source", "backupEnabled", "backupSchedule"},
		Group:   "volumes", ID: "id", Noun: "volume", Paginated: true, Path: "/volumes", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "serviceId", "volumeId", "containerPath", "readOnly"},
		Group:   "volume-mounts", ID: "id", Noun: "volume mount", Path: "/volume-mounts", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "kind", "schedule", "enabled", "image", "lastRunAt"},
		Group:   "cron-jobs", ID: "id", Noun: "cron job", Paginated: true, Path: "/cron-jobs", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "kind", "targetLabel", "enabled", "lastError"},
		Group:   "notification-channels", ID: "id", Noun: "notification channel", Path: "/notification-channels", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "type", "endpoint", "bucket", "region"},
		Group:   "backup-destinations", ID: "id", Noun: "backup destination", Paginated: true, Path: "/backup-destinations", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "registryUrl", "username"},
		Group:   "build-cache-registries", ID: "id", Noun: "build cache registry", Paginated: true, Path: "/build-cache-registries", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "provider", "providerName", "createdAt"},
		Group:   "dns-connections", ID: "id", Noun: "DNS connection", Path: "/dns-connections", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "kind", "baseUrl", "enabled", "clientId"},
		Group:   "git-providers", ID: "id", Noun: "git provider", Path: "/git-providers", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "kind", "endpoint", "region"},
		Group:   "object-stores", ID: "id", Noun: "object store", Path: "/object-stores", Verbs: allVerbs,
	},
	{
		Columns: []string{"name", "id", "expirationDays"},
		Group:   "buckets", ID: "bucket", Noun: "bucket", Parent: "store", Path: "/object-stores/%s/buckets", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "slug", "scope", "isPublic", "stackId"},
		Group:   "status-pages", ID: "id", Noun: "status page", Path: "/status-pages", Verbs: allVerbs,
	},
	{
		Columns: []string{"id", "name", "slug", "storeId", "bucket", "prefix", "serial", "locked"},
		Group:   "iac projects", ID: "id", Noun: "Terraform state project", Path: "/iac/projects",
		Verbs: []string{"list", "get", "create", "delete"},
	},
}

// ResourceCommands turns every Resource into its Commands entries, in table order.
func ResourceCommands(all []Resource) []Command {
	commands := []Command{}
	for _, resource := range all {
		commands = append(commands, resource.Commands()...)
	}
	return commands
}

// Commands is the resource's entries for Commands, one per verb it has.
func (resource Resource) Commands() []Command {
	commands := []Command{}
	for _, verb := range allVerbs {
		if !slices.Contains(resource.Verbs, verb) {
			continue
		}
		commands = append(commands, resource.command(verb))
	}
	return commands
}

func (resource Resource) command(verb string) Command {
	parent := ""
	if resource.Parent != "" {
		parent = "<" + resource.Parent + "> "
	}
	item := parent + "<" + resource.ID + ">"
	noun := article(resource.Noun) + " " + resource.Noun
	command := Command{Name: resource.Group + " " + verb}
	switch verb {
	case "list":
		command.Args = strings.TrimSpace(parent)
		command.Summary = "list " + plural(resource.Noun)
		command.Setup = func(set *flag.FlagSet) Runner {
			options := &ListArgs{}
			if resource.Paginated {
				options = ListFlags(set)
			} else {
				set.BoolVar(&options.JSON, "json", false, "print raw JSON instead of a table")
			}
			return func(env Env, args []string) {
				ResourceList(env.Client(), resource, args, *options)
			}
		}
	case "get":
		command.Args = item
		command.Summary = "show " + noun
		command.Setup = func(set *flag.FlagSet) Runner {
			asJSON := set.Bool("json", false, "print raw JSON instead of a field table")
			return func(env Env, args []string) {
				client := env.Client()
				ResourceGet(client, resource.itemPath(args, resource.itemID(client, args)), *asJSON)
			}
		}
	case "create":
		command.Args = strings.TrimSpace(parent)
		command.Summary = "create " + noun + " from --set fields and/or a --file body"
		command.Setup = func(set *flag.FlagSet) Runner {
			body := BodyFlags(set)
			return func(env Env, args []string) {
				payload := body.Build(false, nil)
				ResourceWrite(env.Client(), "POST", resource.collectionPath(args), payload, body.JSON)
			}
		}
	case "update":
		command.Args = item
		command.Summary = "change " + noun + "'s fields from --set and/or --file, keeping the rest"
		command.Setup = func(set *flag.FlagSet) Runner {
			body := BodyFlags(set)
			return func(env Env, args []string) {
				if body.File == "" && len(body.Sets) == 0 {
					Fail("Nothing to change: pass --set key=value or --file <body.json>.")
				}
				client := env.Client()
				path := resource.itemPath(args, resource.itemID(client, args))
				payload := body.Build(true, func() map[string]any {
					current, _ := client.do("GET", path, nil)
					var item map[string]any
					if err := decodeJSONValue(current, &item); err != nil {
						Fail(err.Error())
					}
					return item
				})
				ResourceWrite(client, "PATCH", path, payload, body.JSON)
			}
		}
	case "delete":
		command.Args = item
		command.Summary = "delete " + noun + ", asking first unless --yes"
		command.Setup = func(set *flag.FlagSet) Runner {
			yes := set.Bool("yes", false, "don't ask for confirmation")
			force := new(bool)
			if resource.ForceDelete {
				force = set.Bool("force", false, "delete Homerun's record even if a workload couldn't be removed")
			}
			return func(env Env, args []string) {
				ref := args[len(args)-1]
				if !*yes && !Confirm(fmt.Sprintf("Delete %s %s?", resource.Noun, ref)) {
					Fail("Not deleted. Pass --yes to delete without asking.")
					return
				}
				client := env.Client()
				id := resource.itemID(client, args)
				ResourceDelete(client, resource.itemPath(args, id), id, *force)
			}
		}
	}
	return command
}

func (resource Resource) collectionPath(args []string) string {
	if resource.Parent == "" {
		return resource.Path
	}
	return fmt.Sprintf(resource.Path, url.PathEscape(args[0]))
}

func (resource Resource) itemID(client *Client, args []string) string {
	ref := args[len(args)-1]
	if resource.Slugs {
		return ResolveSlug(client, resource.Path, ref)
	}
	return ref
}

func (resource Resource) itemPath(args []string, id string) string {
	return resource.collectionPath(args) + "/" + url.PathEscape(id)
}

func article(noun string) string {
	if strings.ContainsRune("aeiouAEIOU", rune(noun[0])) {
		return "an"
	}
	return "a"
}

func plural(noun string) string {
	if before, found := strings.CutSuffix(noun, "y"); found {
		return before + "ies"
	}
	return noun + "s"
}

// ResolveSlug turns a slug into the id of the item in collection carrying it,
// looked up through the list's search. A UUID, or a ref no item has as its
// slug, is returned unchanged, so the API answers for it.
func ResolveSlug(client *Client, collection, ref string) string {
	if uuidPattern.MatchString(ref) {
		return ref
	}
	var items []struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
	}
	client.decode("GET", collection, url.Values{"q": {ref}, "perPage": {"100"}}, &items)
	for _, item := range items {
		if item.Slug == ref {
			return item.ID
		}
	}
	return ref
}

// ResourceList prints a resource's list as a table of its Columns, or raw
// JSON, with a footer when a paginated listing was truncated.
func ResourceList(client *Client, resource Resource, args []string, options ListArgs) {
	body, header := client.do("GET", resource.collectionPath(args), ListQuery(options))
	if options.JSON {
		PrintJSON(body)
		return
	}
	var items []map[string]any
	if err := json.Unmarshal(body, &items); err != nil {
		Fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(items))
	for _, item := range items {
		row := map[string]string{}
		for _, column := range resource.Columns {
			row[column] = Shorten(Cell(item[column]), 60)
		}
		rows = append(rows, row)
	}
	PrintTable(rows, resource.Columns)
	PrintPageFooter(header, len(items))
}

// ResourceGet prints one item as a field/value table, or raw JSON.
func ResourceGet(client *Client, path string, asJSON bool) {
	body, _ := client.do("GET", path, nil)
	PrintItem(body, asJSON)
}

// ResourceWrite sends payload as a create (POST) or update (PATCH) and prints
// the item the API answers with, like ResourceGet.
func ResourceWrite(client *Client, method, path string, payload map[string]any, asJSON bool) {
	var answer json.RawMessage
	client.decodeJSON(method, path, payload, &answer)
	PrintItem(answer, asJSON)
}

// ResourceDelete deletes one item, with ?force=true when force is set, and
// prints the id it deleted.
func ResourceDelete(client *Client, path, id string, force bool) {
	query := url.Values{}
	if force {
		query.Set("force", "true")
	}
	client.do("DELETE", path, query)
	PrintValue(map[string]any{"deleted": true, "id": id})
}

// PrintItem prints a JSON object as a field/value table sorted by field, or
// the raw JSON when asJSON is set or the body isn't an object.
func PrintItem(body []byte, asJSON bool) {
	var item map[string]any
	if asJSON || json.Unmarshal(body, &item) != nil {
		PrintJSON(body)
		return
	}
	fields := make([]string, 0, len(item))
	for field := range item {
		fields = append(fields, field)
	}
	slices.Sort(fields)
	rows := make([]map[string]string, 0, len(fields))
	for _, field := range fields {
		rows = append(rows, map[string]string{"field": field, "value": Cell(item[field])})
	}
	PrintTable(rows, []string{"field", "value"})
}

// Cell renders one JSON value for a table: strings as they are (quoted when
// they span lines), numbers and booleans plainly, null as blank and arrays or
// objects as compact JSON.
func Cell(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		if strings.Contains(typed, "\n") {
			return strconv.Quote(typed)
		}
		return typed
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return fmt.Sprint(typed)
		}
		return string(encoded)
	}
}

// Confirm asks a yes/no question on stderr and reads the answer from stdin,
// anything but y or yes (including no answer at all) meaning no.
func Confirm(question string) bool {
	fmt.Fprintf(os.Stderr, "%s [y/N] ", question)
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		fmt.Fprintln(os.Stderr)
		return false
	}
	answer := strings.ToLower(strings.TrimSpace(scanner.Text()))
	return answer == "y" || answer == "yes"
}

type assignments []string

func (values *assignments) String() string { return strings.Join(*values, ",") }

func (values *assignments) Set(value string) error {
	*values = append(*values, value)
	return nil
}

// BodyArgs are the --set/--file/--json options of a create or update.
type BodyArgs struct {
	File string
	JSON bool
	Sets []string
}

// BodyFlags registers --set (repeatable), --file and --json on a flag set.
func BodyFlags(set *flag.FlagSet) *BodyArgs {
	args := &BodyArgs{}
	set.Var((*assignments)(&args.Sets), "set", "set one body field, `key=value`, repeatable: the value is JSON when it parses as JSON, a string otherwise, and a dotted key sets a nested field (envVars.MODE=prod)")
	set.StringVar(&args.File, "file", "", "read the body from a JSON `file`, - for stdin; --set fields go on top")
	set.BoolVar(&args.JSON, "json", false, "print raw JSON instead of a field table")
	return args
}

// Build reads --file and applies --set on top, exiting on a bad file or
// assignment. For an update, current fetches the item as it is now, called
// only when a dotted --set needs the object it writes into (see BuildBody).
func (args BodyArgs) Build(update bool, current func() map[string]any) map[string]any {
	var item map[string]any
	if update && current != nil && slices.ContainsFunc(args.Sets, isDotted) {
		item = current()
	}
	body, err := BuildBody(args.File, args.Sets, os.Stdin, item)
	if err != nil {
		Fail(err.Error())
	}
	return body
}

func isDotted(assignment string) bool {
	key, _, _ := strings.Cut(assignment, "=")
	return strings.Contains(key, ".")
}

// BuildBody is a request body: the JSON object in file ("-" reads stdin, ""
// starts empty), then each key=value assignment set on top of it. A dotted
// assignment into an object the body doesn't have yet starts from that
// object in current, the item being updated (nil for a create), since the API
// replaces an object field whole: `--set envVars.MODE=prod` adds one variable
// rather than dropping the others.
func BuildBody(file string, sets []string, stdin io.Reader, current map[string]any) (map[string]any, error) {
	body := map[string]any{}
	if file != "" {
		var raw []byte
		var err error
		if file == "-" {
			raw, err = io.ReadAll(stdin)
		} else {
			raw, err = os.ReadFile(file)
		}
		if err != nil {
			return nil, err
		}
		if err := decodeJSONValue(raw, &body); err != nil || body == nil {
			return nil, fmt.Errorf("%s isn't a JSON object", file)
		}
	}
	for _, assignment := range sets {
		top, _, _ := strings.Cut(assignment, ".")
		if _, has := body[top]; !has && isDotted(assignment) {
			if existing, isObject := current[top].(map[string]any); isObject {
				body[top] = existing
			}
		}
		if err := ApplySet(body, assignment); err != nil {
			return nil, err
		}
	}
	return body, nil
}

// ApplySet sets one key=value assignment on body. The value is decoded as JSON
// when it is valid JSON (numbers, booleans, null, arrays, objects, quoted
// strings) and kept as a plain string otherwise; a dotted key walks into, or
// creates, nested objects.
func ApplySet(body map[string]any, assignment string) error {
	key, raw, found := strings.Cut(assignment, "=")
	if !found {
		return fmt.Errorf("--set %q: want key=value", assignment)
	}
	path := strings.Split(key, ".")
	if slices.Contains(path, "") {
		return fmt.Errorf("--set %q: empty key segment", assignment)
	}
	var value any = raw
	if json.Valid([]byte(raw)) {
		if err := decodeJSONValue([]byte(raw), &value); err != nil {
			return err
		}
	}
	target := body
	for _, segment := range path[:len(path)-1] {
		next, exists := target[segment]
		if !exists || next == nil {
			child := map[string]any{}
			target[segment] = child
			target = child
			continue
		}
		child, isObject := next.(map[string]any)
		if !isObject {
			return fmt.Errorf("--set %q: %s isn't an object", assignment, segment)
		}
		target = child
	}
	target[path[len(path)-1]] = value
	return nil
}

func decodeJSONValue(raw []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if decoder.More() {
		return errors.New("trailing data after the JSON value")
	}
	return nil
}
