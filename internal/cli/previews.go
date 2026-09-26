package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/homerun"
)

const (
	defaultPreviewWait    = 20 * time.Minute
	defaultPromoteWait    = 30 * time.Minute
	previewPollInterval   = 5 * time.Second
	previewCommitPattern  = `^[0-9a-fA-F]{7,40}$`
	previewVerdictReady   = "ready"
	previewVerdictWaiting = "waiting"
	previewVerdictFailed  = "failed"
)

var previewCommit = regexp.MustCompile(previewCommitPattern)

// Preview is one pull request preview as GET /services/{id}/previews returns it.
type Preview struct {
	Branch     string             `json:"branch"`
	Deployment *PreviewDeployment `json:"deployment"`
	GitRef     string             `json:"gitRef"`
	Hostnames  []string           `json:"hostnames"`
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	PRNumber   int                `json:"prNumber"`
	Revision   *PreviewRevision   `json:"revision"`
	Slug       string             `json:"slug"`
	Status     string             `json:"status"`
	Title      string             `json:"title"`
	URL        string             `json:"url"`
}

// PreviewRevision is the revision a preview runs now.
type PreviewRevision struct {
	GitCommit    string `json:"gitCommit"`
	Health       string `json:"health"`
	HealthReason string `json:"healthReason"`
	ID           string `json:"id"`
	ImageRef     string `json:"imageRef"`
}

// PreviewDeployment is a preview's latest deploy attempt.
type PreviewDeployment struct {
	ErrorMessage string `json:"errorMessage"`
	GitCommit    string `json:"gitCommit"`
	ID           string `json:"id"`
	Status       string `json:"status"`
}

// PreviewWaitArgs are the options of `previews wait`.
type PreviewWaitArgs struct {
	Commit  string
	JSON    bool
	Timeout time.Duration
}

// PreviewPromoteArgs are the options of `previews promote`.
type PreviewPromoteArgs struct {
	Commit  string
	Timeout time.Duration
	Wait    bool
}

// RunPreviews dispatches a `previews` subcommand.
func RunPreviews(global GlobalFlags, args []string) {
	if len(args) == 0 {
		Fail("usage: homerun previews list|get|wait|delete|promote <service> [pr]")
	}
	client := func() *Client { return RequireClient(global.BaseURL, global.APIKey) }
	switch args[0] {
	case "list":
		set := NewFlagSet("previews list")
		asJSON := set.Bool("json", false, "print raw JSON instead of a table")
		rest := Parse(set, args[1:])
		PreviewsList(client(), RequireArg(rest, 0, "service"), *asJSON)
	case "get":
		rest := Parse(NewFlagSet("previews get"), args[1:])
		service := RequireArg(rest, 0, "service")
		PreviewGet(client(), service, RequirePR(rest))
	case "wait":
		set := NewFlagSet("previews wait")
		commit := set.String("commit", "", "wait until the preview runs this commit")
		timeout := set.Duration("timeout", defaultPreviewWait, "give up after this long, e.g. 20m")
		asJSON := set.Bool("json", false, "print the preview as JSON instead of its URL")
		rest := Parse(set, args[1:])
		service := RequireArg(rest, 0, "service")
		pr := RequirePR(rest)
		requireCommit(*commit)
		PreviewWait(client(), service, pr, PreviewWaitArgs{Commit: *commit, JSON: *asJSON, Timeout: *timeout})
	case "delete":
		rest := Parse(NewFlagSet("previews delete"), args[1:])
		service := RequireArg(rest, 0, "service")
		PreviewDelete(client(), service, RequirePR(rest))
	case "promote":
		set := NewFlagSet("previews promote")
		commit := set.String("commit", "", "refuse unless the preview runs this commit")
		wait := set.Bool("wait", false, "wait for the deploy to finish")
		timeout := set.Duration("timeout", defaultPromoteWait, "with --wait, give up after this long")
		rest := Parse(set, args[1:])
		service := RequireArg(rest, 0, "service")
		pr := RequirePR(rest)
		requireCommit(*commit)
		PreviewPromote(client(), service, pr, PreviewPromoteArgs{Commit: *commit, Timeout: *timeout, Wait: *wait})
	default:
		Fail(fmt.Sprintf("unknown previews subcommand %q. Run `homerun --help` to see what's available.", args[0]))
	}
}

// RequirePR returns the pull request number, the second positional argument,
// failing unless it's a positive whole number.
func RequirePR(args []string) int {
	raw := strings.TrimPrefix(RequireArg(args, 1, "pr"), "#")
	pr, err := strconv.Atoi(raw)
	if err != nil || pr <= 0 {
		Fail(fmt.Sprintf("%q isn't a pull request number.", raw))
	}
	return pr
}

// requireCommit fails unless commit is empty or a full or 7+ character SHA.
func requireCommit(commit string) {
	if commit != "" && !previewCommit.MatchString(commit) {
		Fail(fmt.Sprintf("--commit %q isn't a commit SHA (7 to 40 hex characters).", commit))
	}
}

// previewPath is the API path of a service's previews, or of one of them when pr is positive.
func previewPath(service string, pr int) string {
	path := "/services/" + url.PathEscape(service) + "/previews"
	if pr > 0 {
		path += "/" + strconv.Itoa(pr)
	}
	return path
}

// SameCommit reports whether given, a full or abbreviated SHA, names full.
func SameCommit(full, given string) bool {
	return full != "" && given != "" && strings.HasPrefix(strings.ToLower(full), strings.ToLower(given))
}

// PreviewVerdict decides whether a preview is ready for tests, still coming,
// or failed, with a line saying why. With commit it's ready once the preview's
// current revision is that commit and healthy, and failed once that commit's
// deploy failed or its revision was judged unhealthy; without, it goes by
// whatever the preview last deployed.
func PreviewVerdict(preview Preview, commit string) (string, string) {
	revision, deployment := preview.Revision, preview.Deployment
	if commit != "" {
		if revision != nil && SameCommit(revision.GitCommit, commit) {
			return revisionVerdict(preview, *revision)
		}
		if deployment != nil && deployment.Status == "failed" &&
			(SameCommit(deployment.GitCommit, commit) || (deployment.GitCommit == "" && SameCommit(preview.GitRef, commit))) {
			return previewVerdictFailed, fmt.Sprintf("The deploy of %s failed: %s", Shorten(commit, 7), deployment.ErrorMessage)
		}
		return previewVerdictWaiting, fmt.Sprintf("Waiting for %s to be deployed...", Shorten(commit, 7))
	}
	if deployment != nil && deployment.Status == "failed" {
		return previewVerdictFailed, "The preview's latest deploy failed: " + deployment.ErrorMessage
	}
	if deployment != nil && deployment.Status != "running" && deployment.Status != "stopped" {
		return previewVerdictWaiting, "Waiting for the deploy in progress..."
	}
	if revision == nil {
		return previewVerdictWaiting, "Waiting for a first successful deploy..."
	}
	return revisionVerdict(preview, *revision)
}

// revisionVerdict is PreviewVerdict for the revision the preview runs.
func revisionVerdict(preview Preview, revision PreviewRevision) (string, string) {
	switch revision.Health {
	case "healthy":
		return previewVerdictReady, "Healthy."
	case "unhealthy", "rolled_back":
		return previewVerdictFailed, fmt.Sprintf("The preview is %s: %s", strings.ReplaceAll(revision.Health, "_", " "), revision.HealthReason)
	case "":
		if preview.Status == "running" {
			return previewVerdictReady, "Running."
		}
		return previewVerdictWaiting, "Waiting for the preview to be running..."
	default:
		return previewVerdictWaiting, "Deployed, waiting for its health check..."
	}
}

// PreviewRow flattens a preview into a table row.
func PreviewRow(preview Preview) map[string]string {
	row := map[string]string{
		"branch": preview.Branch,
		"pr":     "#" + strconv.Itoa(preview.PRNumber),
		"status": preview.Status,
		"title":  preview.Title,
		"url":    preview.URL,
	}
	if preview.Revision != nil {
		row["commit"] = Shorten(preview.Revision.GitCommit, 7)
		row["health"] = preview.Revision.Health
	}
	return row
}

// PreviewsList lists a service's open previews as JSON or a table.
func PreviewsList(client *Client, service string, asJSON bool) {
	body, _ := client.do("GET", previewPath(service, 0), nil)
	if asJSON {
		PrintJSON(body)
		return
	}
	var previews []Preview
	if err := json.Unmarshal(body, &previews); err != nil {
		Fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(previews))
	for _, preview := range previews {
		rows = append(rows, PreviewRow(preview))
	}
	PrintTable(rows, []string{"pr", "title", "branch", "commit", "status", "health", "url"})
}

// PreviewGet prints one pull request's preview as JSON.
func PreviewGet(client *Client, service string, pr int) {
	body, _ := client.do("GET", previewPath(service, pr), nil)
	PrintJSON(body)
}

// PreviewDelete deletes one pull request's preview.
func PreviewDelete(client *Client, service string, pr int) {
	client.do("DELETE", previewPath(service, pr), nil)
	PrintValue(map[string]any{"deleted": true, "pr": pr, "service": service})
}

// PreviewWait blocks until the preview of pr is ready (see PreviewVerdict),
// then prints its URL, or the preview as JSON. Progress goes to stderr so the
// URL can be captured. A preview that doesn't exist yet is waited for; a
// service without previews turned on fails right away. Exits non-zero when
// the deploy fails, the preview is unhealthy, or timeout passes.
func PreviewWait(client *Client, service string, pr int, args PreviewWaitArgs) {
	var parent struct {
		PreviewsEnabled bool `json:"previewsEnabled"`
	}
	client.decode("GET", "/services/"+url.PathEscape(service), nil, &parent)
	if !parent.PreviewsEnabled {
		Fail("Previews are off for this service: turn them on in its Previews tab.")
	}
	timeout := args.Timeout
	if timeout <= 0 {
		timeout = defaultPreviewWait
	}
	deadline := time.Now().Add(timeout)
	said := ""
	for {
		body, found := previewOrMissing(client, service, pr)
		verdict, message := previewVerdictWaiting, fmt.Sprintf("Waiting for the preview of #%d to be created...", pr)
		var preview Preview
		if found {
			if err := json.Unmarshal(body, &preview); err != nil {
				Fail(err.Error())
			}
			verdict, message = PreviewVerdict(preview, args.Commit)
		}
		if message != said {
			fmt.Fprintln(os.Stderr, message)
			said = message
		}
		switch verdict {
		case previewVerdictReady:
			printReadyPreview(body, preview, args.JSON)
			return
		case previewVerdictFailed:
			Fail(message)
			return
		}
		if time.Now().After(deadline) {
			Fail(fmt.Sprintf("Timed out after %s waiting for the preview of #%d. Last state: %s", timeout, pr, message))
			return
		}
		Sleep(previewPollInterval)
	}
}

// printReadyPreview prints a ready preview's URL, or the preview as JSON.
func printReadyPreview(body []byte, preview Preview, asJSON bool) {
	if asJSON {
		PrintJSON(body)
		return
	}
	if preview.URL == "" {
		fmt.Fprintln(os.Stderr, "The preview is ready, but nothing routes to it: it has no URL.")
		return
	}
	fmt.Println(preview.URL)
}

// previewOrMissing GETs one preview, reporting false for a 404 (not created
// yet) and exiting on any other failure.
func previewOrMissing(client *Client, service string, pr int) ([]byte, bool) {
	body, _, err := client.api.Do("GET", previewPath(service, pr), nil)
	if err == nil {
		return body, true
	}
	var apiErr *homerun.APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
		return nil, false
	}
	Fail(err.Error())
	return nil, false
}

// PreviewPromote deploys the preview's exact image to the service it
// previews. Without Wait it prints the queued deploy; with it, follows the
// deploy job and exits non-zero unless it succeeded.
func PreviewPromote(client *Client, service string, pr int, args PreviewPromoteArgs) {
	payload := map[string]string{}
	if args.Commit != "" {
		payload["commit"] = args.Commit
	}
	var queued struct {
		DeploymentID string `json:"deploymentId"`
		GitCommit    string `json:"gitCommit"`
		ImageRef     string `json:"imageRef"`
		JobID        string `json:"jobId"`
		RevisionID   string `json:"revisionId"`
	}
	client.decodeJSON("POST", previewPath(service, pr)+"/promote", payload, &queued)
	if !args.Wait {
		PrintValue(queued)
		return
	}
	fmt.Fprintf(os.Stderr, "Promoting %s from #%d...\n", strings.TrimSpace(queued.ImageRef+" "+Shorten(queued.GitCommit, 7)), pr)
	timeout := args.Timeout
	if timeout <= 0 {
		timeout = defaultPromoteWait
	}
	status, jobError := WaitForJob(client, queued.JobID, defaultPollInterval, timeout)
	if status != "succeeded" {
		if jobError == "" {
			jobError = "no reason given"
		}
		Fail(fmt.Sprintf("Promote %s: %s (deployment %s)", status, jobError, queued.DeploymentID))
	}
	PrintValue(map[string]any{
		"deploymentId": queued.DeploymentID,
		"gitCommit":    queued.GitCommit,
		"imageRef":     queued.ImageRef,
		"success":      true,
	})
}
