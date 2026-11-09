package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var pipelineRepositoryColumns = []string{"id", "repository", "provider", "runs", "failed", "p50", "cost", "syncedAt", "webhook"}

var pipelineRunColumns = []string{"id", "repository", "workflow", "status", "branch", "commit", "duration", "cost", "createdAt"}

// PipelineStats is one set of CI totals as the pipelines routes return them.
type PipelineStats struct {
	AvgQueueMs      *float64 `json:"avgQueueMs"`
	BillableMinutes int      `json:"billableMinutes"`
	CostUSD         float64  `json:"costUsd"`
	Failed          int      `json:"failed"`
	P50Ms           *float64 `json:"p50Ms"`
	P95Ms           *float64 `json:"p95Ms"`
	Runs            int      `json:"runs"`
	Succeeded       int      `json:"succeeded"`
}

// PipelineRepository is one watched repository as GET /pipelines/repositories returns it.
type PipelineRepository struct {
	FullName          string         `json:"fullName"`
	ID                string         `json:"id"`
	PipelinesError    *string        `json:"pipelinesError"`
	PipelinesSyncedAt *string        `json:"pipelinesSyncedAt"`
	ProviderKind      string         `json:"providerKind"`
	Stats             *PipelineStats `json:"stats"`
	WebhookID         *string        `json:"webhookId"`
}

// PipelineRun is one CI run as the runs lists return it.
type PipelineRun struct {
	Branch         *string  `json:"branch"`
	CommitSha      *string  `json:"commitSha"`
	CostUSD        float64  `json:"costUsd"`
	CreatedAt      string   `json:"createdAt"`
	DurationMs     *float64 `json:"durationMs"`
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Number         *int     `json:"number"`
	RepositoryName string   `json:"repositoryName"`
	Status         string   `json:"status"`
}

// RunListArgs are the options of `pipelines runs`: the shared list options and a status filter.
type RunListArgs struct {
	List   ListArgs
	Status string
}

func pipelineRepositoryPath(id, suffix string) string {
	return "/pipelines/repositories/" + url.PathEscape(id) + suffix
}

// FormatMs renders a duration in milliseconds to the second, or a dash for none.
func FormatMs(ms *float64) string {
	if ms == nil {
		return "-"
	}
	if *ms < 1000 {
		return fmt.Sprintf("%.0fms", *ms)
	}
	return (time.Duration(*ms) * time.Millisecond).Round(time.Second).String()
}

func formatUSD(value float64) string {
	return fmt.Sprintf("$%.2f", value)
}

func orDash(value *string) string {
	if value == nil || *value == "" {
		return "-"
	}
	return *value
}

// PipelineStatsText renders CI totals as one line each.
func PipelineStatsText(label string, stats PipelineStats) string {
	return strings.Join([]string{
		label + ":",
		fmt.Sprintf("  Runs:      %d (%d passed, %d failed)", stats.Runs, stats.Succeeded, stats.Failed),
		fmt.Sprintf("  Duration:  p50 %s, p95 %s", FormatMs(stats.P50Ms), FormatMs(stats.P95Ms)),
		fmt.Sprintf("  Queue:     %s on average", FormatMs(stats.AvgQueueMs)),
		fmt.Sprintf("  Billable:  %d minutes, %s", stats.BillableMinutes, formatUSD(stats.CostUSD)),
	}, "\n")
}

// PipelineStatsShow prints CI totals across every watched repository, or the raw JSON.
func PipelineStatsShow(client *Client, asJSON bool) {
	body, _ := client.do("GET", "/pipelines", nil)
	if asJSON {
		PrintJSON(body)
		return
	}
	var overview struct {
		AllTimeStats PipelineStats `json:"allTimeStats"`
		Repositories int           `json:"repositories"`
		Stats        PipelineStats `json:"stats"`
		WindowDays   int           `json:"windowDays"`
	}
	if err := json.Unmarshal(body, &overview); err != nil {
		Fail(err.Error())
	}
	fmt.Printf("%d watched repositories\n\n%s\n\n%s\n",
		overview.Repositories,
		PipelineStatsText(fmt.Sprintf("Last %d days", overview.WindowDays), overview.Stats),
		PipelineStatsText("All time", overview.AllTimeStats),
	)
}

// PipelineRepositoriesList prints the watched repositories with their 30-day totals, as a table or raw JSON.
func PipelineRepositoriesList(client *Client, options ListArgs) {
	body, header := client.do("GET", "/pipelines/repositories", ListQuery(options))
	if options.JSON {
		PrintJSON(body)
		return
	}
	var repositories []PipelineRepository
	if err := json.Unmarshal(body, &repositories); err != nil {
		Fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(repositories))
	for _, repository := range repositories {
		stats := PipelineStats{}
		if repository.Stats != nil {
			stats = *repository.Stats
		}
		webhook := "registered"
		if repository.WebhookID == nil {
			webhook = "polled"
		}
		syncedAt := orDash(repository.PipelinesSyncedAt)
		if repository.PipelinesError != nil {
			syncedAt += " (failed)"
		}
		rows = append(rows, map[string]string{
			"cost":       formatUSD(stats.CostUSD),
			"failed":     strconv.Itoa(stats.Failed),
			"id":         repository.ID,
			"p50":        FormatMs(stats.P50Ms),
			"provider":   repository.ProviderKind,
			"repository": repository.FullName,
			"runs":       strconv.Itoa(stats.Runs),
			"syncedAt":   syncedAt,
			"webhook":    webhook,
		})
	}
	PrintTable(rows, pipelineRepositoryColumns)
	PrintPageFooter(header, len(repositories))
}

// ResolvePipelineRepository turns a repository's path on its provider into
// the id of the watched repository, looked up through the list's search. A
// UUID is returned unchanged; a path nothing watches fails.
func ResolvePipelineRepository(client *Client, ref string) string {
	if uuidPattern.MatchString(ref) {
		return ref
	}
	var repositories []PipelineRepository
	client.decode("GET", "/pipelines/repositories", url.Values{"q": {ref}, "perPage": {"100"}}, &repositories)
	for _, repository := range repositories {
		if repository.FullName == ref {
			return repository.ID
		}
	}
	Fail(fmt.Sprintf("No watched repository %q. Run `homerun pipelines repositories` to see them.", ref))
	return ""
}

// PipelineRunsList prints CI runs, of one repository when repositoryID is set, newest first, as a table or raw JSON.
func PipelineRunsList(client *Client, repositoryID string, options RunListArgs) {
	path := "/pipelines/runs"
	if repositoryID != "" {
		path = pipelineRepositoryPath(repositoryID, "/runs")
	}
	query := ListQuery(options.List)
	if options.Status != "" {
		query.Set("status", options.Status)
	}
	body, header := client.do("GET", path, query)
	if options.List.JSON {
		PrintJSON(body)
		return
	}
	var runs []PipelineRun
	if err := json.Unmarshal(body, &runs); err != nil {
		Fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(runs))
	for _, run := range runs {
		workflow := run.Name
		if run.Number != nil {
			workflow = fmt.Sprintf("%s #%d", run.Name, *run.Number)
		}
		commit := orDash(run.CommitSha)
		if len(commit) > 7 {
			commit = commit[:7]
		}
		rows = append(rows, map[string]string{
			"branch":     orDash(run.Branch),
			"commit":     commit,
			"cost":       formatUSD(run.CostUSD),
			"createdAt":  run.CreatedAt,
			"duration":   FormatMs(run.DurationMs),
			"id":         run.ID,
			"repository": run.RepositoryName,
			"status":     run.Status,
			"workflow":   Shorten(workflow, 40),
		})
	}
	PrintTable(rows, pipelineRunColumns)
	PrintPageFooter(header, len(runs))
}

var pipelineCommands = []Command{
	{
		Name:    "pipelines stats",
		Summary: "CI totals across every watched repository, over the last 30 days and all time",
		Setup: func(set *flag.FlagSet) Runner {
			asJSON := set.Bool("json", false, "print raw JSON instead of text")
			return func(env Env, _ []string) { PipelineStatsShow(env.Client(), *asJSON) }
		},
	},
	{
		Aliases: []string{"pipelines repos"},
		Name:    "pipelines repositories",
		Summary: "list watched repositories with their 30-day CI totals and whether a webhook or polling keeps them current",
		Setup: func(set *flag.FlagSet) Runner {
			options := ListFlags(set)
			return func(env Env, _ []string) { PipelineRepositoriesList(env.Client(), *options) }
		},
	},
	{
		Args:    "<repository>",
		Name:    "pipelines repository",
		Summary: "a watched repository, by id or owner/repo, with its totals per workflow and its runner rates, as JSON",
		Setup: noFlags(func(env Env, args []string) {
			client := env.Client()
			body, _ := client.do("GET", pipelineRepositoryPath(ResolvePipelineRepository(client, args[0]), ""), nil)
			PrintJSON(body)
		}),
	},
	{
		Args:    "[repository]",
		Name:    "pipelines runs",
		Summary: "list CI runs, newest first, of one repository (id or owner/repo) or of all of them",
		Setup: func(set *flag.FlagSet) Runner {
			list := ListFlags(set)
			status := set.String("status", "", "only runs in these comma-separated `statuses`: queued, running, success, failure, cancelled, skipped")
			return func(env Env, args []string) {
				client := env.Client()
				repositoryID := ""
				if len(args) > 0 {
					repositoryID = ResolvePipelineRepository(client, args[0])
				}
				PipelineRunsList(client, repositoryID, RunListArgs{List: *list, Status: *status})
			}
		},
	},
	{
		Args:    "<repository> <runId>",
		Name:    "pipelines run",
		Summary: "one CI run with every job of every attempt, as JSON",
		Setup: noFlags(func(env Env, args []string) {
			client := env.Client()
			body, _ := client.do("GET", pipelineRepositoryPath(ResolvePipelineRepository(client, args[0]), "/runs/"+url.PathEscape(args[1])), nil)
			PrintJSON(body)
		}),
	},
	{
		Args:    "<repository>",
		Name:    "pipelines sync",
		Summary: "read a watched repository's latest CI runs now, as a background job (`homerun jobs get` follows it)",
		Setup: noFlags(func(env Env, args []string) {
			client := env.Client()
			var queued map[string]any
			client.decodeJSON("POST", pipelineRepositoryPath(ResolvePipelineRepository(client, args[0]), "/sync"), nil, &queued)
			PrintValue(queued)
		}),
	},
	{
		Args:    "<providerId> <owner/repo>",
		Name:    "pipelines watch",
		Summary: "start watching a repository's CI runs on a git provider you're connected to, registering its CI webhook",
		Setup: func(set *flag.FlagSet) Runner {
			defaultBranch := set.String("default-branch", "", "the repository's default `branch`")
			return func(env Env, args []string) {
				body := map[string]any{"fullName": args[1], "providerId": args[0]}
				if *defaultBranch != "" {
					body["defaultBranch"] = *defaultBranch
				}
				var watched map[string]any
				env.Client().decodeJSON("POST", "/pipelines/repositories", body, &watched)
				PrintValue(watched)
			}
		},
	},
	{
		Args:    "<repository>",
		Name:    "pipelines unwatch",
		Summary: "stop watching a repository, deleting its stored runs and its CI webhook, asking first unless --yes",
		Setup: func(set *flag.FlagSet) Runner {
			yes := set.Bool("yes", false, "don't ask for confirmation")
			return func(env Env, args []string) {
				if !*yes && !Confirm(fmt.Sprintf("Stop watching %s and delete its stored runs?", args[0])) {
					Fail("Still watched. Pass --yes to stop without asking.")
					return
				}
				client := env.Client()
				id := ResolvePipelineRepository(client, args[0])
				client.do("DELETE", pipelineRepositoryPath(id, ""), nil)
				PrintValue(map[string]any{"id": id, "unwatched": true})
			}
		},
	},
}
