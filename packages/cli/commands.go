package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPollInterval        = 2 * time.Second
	defaultScanTimeout         = 30 * time.Minute
	defaultUpdatePollInterval  = 3 * time.Second
	defaultInstanceUpdateAfter = 10 * time.Minute
)

// failOnLevels are the severities --fail-on accepts, most severe first.
var failOnLevels = []string{"critical", "high", "medium", "low"}

var finishedJobStatuses = map[string]bool{
	"succeeded": true,
	"failed":    true,
	"cancelled": true,
}

// ListArgs are the shared --json/--page/--per-page/--search options of every list command.
type ListArgs struct {
	JSON    bool
	Page    int
	PerPage int
	Search  string
}

// ScanArgs are the options of `services scan`.
type ScanArgs struct {
	FailOn  string
	JSON    bool
	Timeout time.Duration
	Wait    bool
}

// SeverityCounts is one scan's findings tallied by severity.
type SeverityCounts struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Low      int `json:"low"`
	Medium   int `json:"medium"`
	Unknown  int `json:"unknown"`
}

// ImageScan is one vulnerability scan of a service's deployed image.
type ImageScan struct {
	Counts        SeverityCounts `json:"counts"`
	Digest        string         `json:"digest"`
	Error         string         `json:"error"`
	Findings      []ScanFinding  `json:"findings"`
	ID            string         `json:"id"`
	ImageRef      string         `json:"imageRef"`
	ScannedAt     string         `json:"scannedAt"`
	Status        string         `json:"status"`
	TotalFindings int            `json:"totalFindings"`
}

// ScanFinding is one vulnerability in a scan.
type ScanFinding struct {
	FixedVersion     string `json:"fixedVersion"`
	ID               string `json:"id"`
	InstalledVersion string `json:"installedVersion"`
	Pkg              string `json:"pkg"`
	Severity         string `json:"severity"`
	Title            string `json:"title"`
}

// Revision is one deployed revision of a service.
type Revision struct {
	CreatedAt      string `json:"createdAt"`
	Current        bool   `json:"current"`
	GitCommit      string `json:"gitCommit"`
	Health         string `json:"health"`
	HealthReason   string `json:"healthReason"`
	ID             string `json:"id"`
	ImageDigest    string `json:"imageDigest"`
	ImageRef       string `json:"imageRef"`
	LastDeployedAt string `json:"lastDeployedAt"`
	Previous       bool   `json:"previous"`
	Retained       bool   `json:"retained"`
}

// InstanceUpdateStatus is what the instance reports about its own version.
type InstanceUpdateStatus struct {
	Current string `json:"current"`
	Latest  *struct {
		Version string `json:"version"`
	} `json:"latest"`
	Preflight struct {
		Ready  bool   `json:"ready"`
		Reason string `json:"reason"`
	} `json:"preflight"`
	UpdateAvailable bool `json:"updateAvailable"`
}

// listQuery turns the shared list options into the API's query parameters.
func listQuery(args ListArgs) url.Values {
	query := url.Values{}
	if args.Page > 0 {
		query.Set("page", strconv.Itoa(args.Page))
	}
	if args.PerPage > 0 {
		query.Set("perPage", strconv.Itoa(args.PerPage))
	}
	if args.Search != "" {
		query.Set("q", args.Search)
	}
	return query
}

// findingsAtOrAbove counts scan findings at level or any more severe level,
// which is what --fail-on gates on. An "unknown" severity never counts.
func findingsAtOrAbove(counts SeverityCounts, level string) int {
	byLevel := map[string]int{
		"critical": counts.Critical,
		"high":     counts.High,
		"medium":   counts.Medium,
		"low":      counts.Low,
	}
	total := 0
	for _, ranked := range failOnLevels {
		total += byLevel[ranked]
		if ranked == level {
			break
		}
	}
	return total
}

func countsLine(counts SeverityCounts) string {
	return fmt.Sprintf(
		"%d critical, %d high, %d medium, %d low, %d unknown",
		counts.Critical, counts.High, counts.Medium, counts.Low, counts.Unknown,
	)
}

func shorten(value string, length int) string {
	runes := []rune(value)
	if len(runes) <= length {
		return value
	}
	return string(runes[:length])
}

// revisionRow flattens a revision into a table row, shortening the commit and
// digest, adding when it last went live, marking it current/previous and
// whether its image is still retained, and why it was judged unhealthy.
func revisionRow(revision Revision) map[string]string {
	marker := ""
	if revision.Current {
		marker = "current"
	} else if revision.Previous {
		marker = "previous"
	}
	if !revision.Retained {
		marker = strings.TrimSpace(marker + " (not retained)")
	}
	return map[string]string{
		"commit":         shorten(revision.GitCommit, 7),
		"createdAt":      revision.CreatedAt,
		"digest":         shorten(revision.ImageDigest, 19),
		"health":         revision.Health,
		"id":             revision.ID,
		"image":          revision.ImageRef,
		"lastDeployedAt": revision.LastDeployedAt,
		"marker":         marker,
		"reason":         revision.HealthReason,
	}
}

// instanceStatusText summarises an instance update status in a few lines: the
// running and latest versions, then whether an update can start and why not.
func instanceStatusText(status InstanceUpdateStatus) string {
	lines := []string{fmt.Sprintf("Running:  v%s", status.Current)}
	if status.Latest == nil {
		lines = append(lines, "Latest:   unknown (couldn't reach GitHub)")
		return strings.Join(lines, "\n")
	}
	lines = append(lines, fmt.Sprintf("Latest:   v%s", status.Latest.Version))
	switch {
	case !status.UpdateAvailable:
		lines = append(lines, "Up to date.")
	case status.Preflight.Ready:
		lines = append(lines, "Update available: run `homerun instance update`.")
	default:
		reason := status.Preflight.Reason
		if reason == "" {
			reason = "unknown reason"
		}
		lines = append(lines, fmt.Sprintf("Update available, but it can't start now: %s", reason))
	}
	return strings.Join(lines, "\n")
}

// servicesList lists services as JSON or a table, with a footer when the page is truncated.
func servicesList(client *Client, args ListArgs) {
	var services []struct {
		CurrentStatus string `json:"currentStatus"`
		ID            string `json:"id"`
		Image         string `json:"image"`
		Name          string `json:"name"`
		Slug          string `json:"slug"`
		Tag           string `json:"tag"`
	}
	body, header := client.do("GET", "/services", listQuery(args))
	if args.JSON {
		printJSON(body)
		return
	}
	if err := json.Unmarshal(body, &services); err != nil {
		fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(services))
	for _, service := range services {
		rows = append(rows, map[string]string{
			"id":     service.ID,
			"image":  fmt.Sprintf("%s:%s", service.Image, service.Tag),
			"name":   service.Name,
			"slug":   service.Slug,
			"status": service.CurrentStatus,
		})
	}
	printTable(rows, []string{"id", "name", "slug", "status", "image"})
	printPageFooter(header, len(services))
}

// serviceGet fetches one service and prints it as JSON.
func serviceGet(client *Client, id string) {
	body, _ := client.do("GET", "/services/"+url.PathEscape(id), nil)
	printJSON(body)
}

// serviceAction triggers a deploy, start, stop or restart on a service and prints the API's result as JSON.
func serviceAction(client *Client, action, id string) {
	body, _ := client.do("POST", fmt.Sprintf("/services/%s/%s", url.PathEscape(id), action), nil)
	printJSON(body)
}

// serviceDelete deletes a service, the same danger-zone action as the Settings
// tab's Delete button. Exits on an API error, including the 409 the API answers
// (without force) when the container or swarm service couldn't be removed.
func serviceDelete(client *Client, id string, force bool) {
	query := url.Values{}
	if force {
		query.Set("force", "true")
	}
	client.do("DELETE", "/services/"+url.PathEscape(id), query)
	printValue(map[string]any{"deleted": true, "id": id})
}

// serviceWebhook fetches a service's push-to-deploy webhook URL and secret and
// prints it as JSON. Exits on an API error, including the 404 when deploy on
// push isn't turned on.
func serviceWebhook(client *Client, id string) {
	body, _ := client.do("GET", fmt.Sprintf("/services/%s/webhook", url.PathEscape(id)), nil)
	printJSON(body)
}

// revisionsList lists a service's deployed revisions, one row per revision with
// redeploys folded in, as JSON or a table.
func revisionsList(client *Client, serviceID string, asJSON bool) {
	body, _ := client.do("GET", fmt.Sprintf("/services/%s/revisions", url.PathEscape(serviceID)), nil)
	if asJSON {
		printJSON(body)
		return
	}
	var revisions []Revision
	if err := json.Unmarshal(body, &revisions); err != nil {
		fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(revisions))
	for _, revision := range revisions {
		rows = append(rows, revisionRow(revision))
	}
	printTable(rows, []string{
		"id", "createdAt", "lastDeployedAt", "marker", "health", "image", "commit", "digest", "reason",
	})
}

// serviceLogs writes a service's logs to stdout: the last tail lines, or with
// follow a live stream that only ends when the connection does. Exits on an API
// error, including the 400 for a service that was never deployed.
func serviceLogs(client *Client, id string, follow bool, tail int) {
	query := url.Values{}
	if tail > 0 {
		query.Set("tail", strconv.Itoa(tail))
	}
	if follow {
		query.Set("follow", "true")
	}
	response, err := client.send("GET", fmt.Sprintf("/services/%s/logs", url.PathEscape(id)), query)
	if err != nil {
		fail(err.Error())
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(response.Body)
		fail(apiErrorMessage(response.StatusCode, body))
	}
	if _, err := io.Copy(os.Stdout, response.Body); err != nil {
		fail(err.Error())
	}
}

// serviceRollback redeploys a service from one of its revisions, the previous
// one when revisionID is empty. With restoreConfig it also puts back the env
// vars, resources and networking that revision ran with.
func serviceRollback(client *Client, serviceID, revisionID string, restoreConfig bool) {
	if revisionID == "" {
		revisionID = "previous"
	}
	query := url.Values{}
	if restoreConfig {
		query.Set("restoreConfig", "true")
	}
	path := fmt.Sprintf(
		"/services/%s/revisions/%s/deploy",
		url.PathEscape(serviceID), url.PathEscape(revisionID),
	)
	body, _ := client.do("POST", path, query)
	printJSON(body)
}

// scansList lists a service's image scans with per-severity counts, as JSON or a table.
func scansList(client *Client, serviceID string, args ListArgs) {
	body, header := client.do(
		"GET", fmt.Sprintf("/services/%s/scans", url.PathEscape(serviceID)), listQuery(args),
	)
	if args.JSON {
		printJSON(body)
		return
	}
	var scans []ImageScan
	if err := json.Unmarshal(body, &scans); err != nil {
		fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(scans))
	for _, scan := range scans {
		rows = append(rows, map[string]string{
			"critical":  strconv.Itoa(scan.Counts.Critical),
			"high":      strconv.Itoa(scan.Counts.High),
			"id":        scan.ID,
			"image":     scan.ImageRef,
			"low":       strconv.Itoa(scan.Counts.Low),
			"medium":    strconv.Itoa(scan.Counts.Medium),
			"scannedAt": scan.ScannedAt,
			"status":    scan.Status,
		})
	}
	printTable(rows, []string{"id", "scannedAt", "status", "critical", "high", "medium", "low", "image"})
	printPageFooter(header, len(scans))
}

// scanGet fetches and prints one scan, its summary and findings table or raw
// JSON, and returns it so serviceScan can check it against --fail-on.
func scanGet(client *Client, serviceID, scanID string, asJSON bool) ImageScan {
	path := fmt.Sprintf("/services/%s/scans/%s", url.PathEscape(serviceID), url.PathEscape(scanID))
	body, _ := client.do("GET", path, nil)
	var scan ImageScan
	if err := json.Unmarshal(body, &scan); err != nil {
		fail(err.Error())
	}
	if asJSON {
		printJSON(body)
		return scan
	}
	printScan(scan)
	return scan
}

// printScan prints a scan as a summary header followed by its findings table
// and a note when the API truncated the list.
func printScan(scan ImageScan) {
	fmt.Printf("Scan %s (%s, %s)\n", scan.ID, scan.Status, scan.ScannedAt)
	fmt.Printf("Image:    %s\n", scan.ImageRef)
	if scan.Digest != "" {
		fmt.Printf("Digest:   %s\n", scan.Digest)
	}
	fmt.Printf("Findings: %s\n", countsLine(scan.Counts))
	if scan.Error != "" {
		fmt.Printf("Error:    %s\n", scan.Error)
	}
	fmt.Println("")
	rows := make([]map[string]string, 0, len(scan.Findings))
	for _, finding := range scan.Findings {
		rows = append(rows, map[string]string{
			"fixed":     finding.FixedVersion,
			"id":        finding.ID,
			"installed": finding.InstalledVersion,
			"package":   finding.Pkg,
			"severity":  finding.Severity,
			"title":     finding.Title,
		})
	}
	printTable(rows, []string{"severity", "id", "package", "installed", "fixed", "title"})
	if scan.TotalFindings > len(scan.Findings) {
		fmt.Printf(
			"\nShowing %d of %d findings, most severe first.\n",
			len(scan.Findings), scan.TotalFindings,
		)
	}
}

// queueScan asks the API to queue a scan job and returns the job id to poll.
// With wait, a 409 for a scan already in flight is accepted and that job is
// reused instead of failing.
func queueScan(client *Client, serviceID string, wait bool) string {
	response, err := client.send("POST", fmt.Sprintf("/services/%s/scans", url.PathEscape(serviceID)), nil)
	if err != nil {
		fail(err.Error())
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	var queued struct {
		JobID string `json:"jobId"`
	}
	_ = json.Unmarshal(body, &queued)
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return queued.JobID
	}
	if wait && response.StatusCode == http.StatusConflict && queued.JobID != "" {
		return queued.JobID
	}
	fail(apiErrorMessage(response.StatusCode, body))
	return ""
}

// waitForJob polls a job every pollEvery until it reaches a terminal status,
// exiting the process once timeout has passed.
func waitForJob(client *Client, jobID string, pollEvery, timeout time.Duration) (string, string) {
	deadline := time.Now().Add(timeout)
	for {
		var job struct {
			Error  string `json:"error"`
			Status string `json:"status"`
		}
		client.decode("GET", "/jobs/"+url.PathEscape(jobID), nil, &job)
		if finishedJobStatuses[job.Status] {
			return job.Status, job.Error
		}
		if time.Now().After(deadline) {
			fail(fmt.Sprintf("Timed out waiting for scan job %s (still %s).", jobID, job.Status))
		}
		sleep(pollEvery)
	}
}

// serviceScan queues an image scan. Without Wait it prints the job id and
// returns; with it, polls the job to completion, prints the latest scan and
// exits non-zero when the job didn't succeed, it timed out, or FailOn findings
// were found.
func serviceScan(client *Client, serviceID string, args ScanArgs) {
	jobID := queueScan(client, serviceID, args.Wait)
	if !args.Wait {
		printValue(map[string]any{"jobId": jobID, "status": "queued"})
		return
	}
	timeout := args.Timeout
	if timeout <= 0 {
		timeout = defaultScanTimeout
	}
	status, jobError := waitForJob(client, jobID, defaultPollInterval, timeout)
	if status != "succeeded" {
		if jobError == "" {
			jobError = "no reason given"
		}
		fail(fmt.Sprintf("Scan %s: %s", status, jobError))
	}
	scan := scanGet(client, serviceID, "latest", args.JSON)
	if args.FailOn == "" {
		return
	}
	found := findingsAtOrAbove(scan.Counts, args.FailOn)
	if found > 0 {
		noun := "findings"
		if found == 1 {
			noun = "finding"
		}
		fail(fmt.Sprintf(
			"%d %s at or above %s (--fail-on %s).",
			found, noun, strings.ToUpper(args.FailOn), args.FailOn,
		))
	}
}

// instanceStatus prints the instance's running version, the latest release and
// whether an update could start now, as JSON or a short summary.
func instanceStatus(client *Client, asJSON bool) {
	body, _ := client.do("GET", "/instance/update", nil)
	if asJSON {
		printJSON(body)
		return
	}
	var status InstanceUpdateStatus
	if err := json.Unmarshal(body, &status); err != nil {
		fail(err.Error())
	}
	fmt.Println(instanceStatusText(status))
}

// instanceUpdate starts a self-update of the instance, the same as the
// sidebar's Update now. With wait, polls until the instance answers with the
// new version, treating failed requests as the restart in progress. Exits on an
// API error (a 409 carries why it can't update) or once the wait times out.
func instanceUpdate(client *Client, wait bool, timeout time.Duration) {
	var started struct {
		Version string `json:"version"`
	}
	client.decode("POST", "/instance/update", nil, &started)
	if started.Version == "" {
		fail("The instance didn't say which version it's updating to.")
		return
	}
	fmt.Printf("Updating to v%s.\n", started.Version)
	if !wait {
		return
	}
	if timeout <= 0 {
		timeout = defaultInstanceUpdateAfter
	}
	deadline := time.Now().Add(timeout)
	for {
		sleep(defaultUpdatePollInterval)
		if current := currentVersionOrEmpty(client); current == started.Version {
			fmt.Printf("Homerun is now on v%s.\n", started.Version)
			return
		}
		if time.Now().After(deadline) {
			fail(fmt.Sprintf(
				"Timed out waiting for v%s. Check `docker logs homerun-updater` on the host.",
				started.Version,
			))
		}
	}
}

// currentVersionOrEmpty reads the instance's running version, treating any
// failure as the restart still being in progress.
func currentVersionOrEmpty(client *Client) string {
	response, err := client.send("GET", "/instance/update", nil)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
		return ""
	}
	var status InstanceUpdateStatus
	if err := json.Unmarshal(body, &status); err != nil {
		return ""
	}
	return status.Current
}

// stacksList lists stacks as JSON or a table, with a footer when the page is truncated.
func stacksList(client *Client, args ListArgs) {
	body, header := client.do("GET", "/stacks", listQuery(args))
	if args.JSON {
		printJSON(body)
		return
	}
	var stacks []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal(body, &stacks); err != nil {
		fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(stacks))
	for _, stack := range stacks {
		rows = append(rows, map[string]string{"id": stack.ID, "name": stack.Name, "slug": stack.Slug})
	}
	printTable(rows, []string{"id", "name", "slug"})
	printPageFooter(header, len(stacks))
}

// templatesList lists templates as JSON or a table, with a footer when the page is truncated.
func templatesList(client *Client, args ListArgs) {
	body, header := client.do("GET", "/templates", listQuery(args))
	if args.JSON {
		printJSON(body)
		return
	}
	var templates []struct {
		ID    string `json:"id"`
		Image string `json:"image"`
		Name  string `json:"name"`
		Tag   string `json:"tag"`
	}
	if err := json.Unmarshal(body, &templates); err != nil {
		fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(templates))
	for _, template := range templates {
		rows = append(rows, map[string]string{
			"id":    template.ID,
			"image": fmt.Sprintf("%s:%s", template.Image, template.Tag),
			"name":  template.Name,
		})
	}
	printTable(rows, []string{"id", "name", "image"})
	printPageFooter(header, len(templates))
}
