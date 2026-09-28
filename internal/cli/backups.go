package cli

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

// BackupsUsage is the help for `backups`, printed on a bad call.
const BackupsUsage = "usage: homerun backups list [--volume <id|name>] [--outcome running|success|failed] | volumes | run <id|name> [--wait] [--timeout <seconds>]"

// JobsUsage is the help for `jobs`, printed on a bad call.
const JobsUsage = "usage: homerun jobs list [--status <s,...>] | get <id> [--json]"

const defaultBackupTimeout = 6 * time.Hour

var backupOutcomes = []string{"running", "success", "failed"}

var backupColumns = []string{"id", "volume", "kind", "outcome", "started", "took", "size", "job", "progress", "error"}

var volumeColumns = []string{"id", "name", "kind", "backup", "schedule", "lastRun", "nextRun"}

var jobColumns = []string{"id", "type", "status", "attempts", "created", "heartbeat", "title"}

// BackupRun is one run as GET /backups lists it.
type BackupRun struct {
	Error         *string `json:"error"`
	FinishedAt    *string `json:"finishedAt"`
	ID            string  `json:"id"`
	JobAttempts   *int    `json:"jobAttempts"`
	JobID         *string `json:"jobId"`
	JobProgressAt *string `json:"jobProgressAt"`
	JobStatus     *string `json:"jobStatus"`
	Kind          string  `json:"kind"`
	SizeBytes     *int64  `json:"sizeBytes"`
	StartedAt     string  `json:"startedAt"`
	Success       *bool   `json:"success"`
	VolumeName    string  `json:"volumeName"`
}

// Volume is one volume as GET /volumes lists it.
type Volume struct {
	BackupEnabled   bool    `json:"backupEnabled"`
	BackupLastRunAt *string `json:"backupLastRunAt"`
	BackupNextRunAt *string `json:"backupNextRunAt"`
	BackupSchedule  *string `json:"backupSchedule"`
	ID              string  `json:"id"`
	Kind            string  `json:"kind"`
	Name            string  `json:"name"`
}

// Job is one job as GET /jobs/{id} returns it.
type Job struct {
	Attempts    int     `json:"attempts"`
	CreatedAt   string  `json:"createdAt"`
	Error       *string `json:"error"`
	FinishedAt  *string `json:"finishedAt"`
	HeartbeatAt *string `json:"heartbeatAt"`
	ID          string  `json:"id"`
	Log         string  `json:"log"`
	MaxAttempts int     `json:"maxAttempts"`
	ProgressAt  *string `json:"progressAt"`
	StartedAt   *string `json:"startedAt"`
	Stage       *string `json:"stage"`
	Status      string  `json:"status"`
	Title       string  `json:"title"`
	Type        string  `json:"type"`
}

// deref returns *value, or "" when value is nil.
func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// sinceText renders how long ago an ISO timestamp was, "" when absent or unparseable.
func sinceText(timestamp *string, now time.Time) string {
	parsed, err := time.Parse(time.RFC3339, deref(timestamp))
	if err != nil {
		return ""
	}
	return now.Sub(parsed).Round(time.Second).String() + " ago"
}

// BackupOutcome is a run's outcome as a word: running, success or failed.
func BackupOutcome(run BackupRun) string {
	switch {
	case run.Success == nil:
		return "running"
	case *run.Success:
		return "success"
	default:
		return "failed"
	}
}

// BackupRows turns runs into table rows, the running ones timed up to now.
func BackupRows(runs []BackupRun, now time.Time) []map[string]string {
	rows := make([]map[string]string, 0, len(runs))
	for _, run := range runs {
		took := ""
		if started, err := time.Parse(time.RFC3339, run.StartedAt); err == nil {
			end := now
			if finished, err := time.Parse(time.RFC3339, deref(run.FinishedAt)); err == nil {
				end = finished
			}
			took = end.Sub(started).Round(time.Second).String()
		}
		size := ""
		if run.SizeBytes != nil {
			size = fmt.Sprintf("%.1f MiB", float64(*run.SizeBytes)/(1<<20))
		}
		job := deref(run.JobStatus)
		if run.JobAttempts != nil {
			job += " #" + strconv.Itoa(*run.JobAttempts)
		}
		progress := ""
		if run.Success == nil {
			progress = sinceText(run.JobProgressAt, now)
		}
		rows = append(rows, map[string]string{
			"error":    Shorten(strings.ReplaceAll(deref(run.Error), "\n", " "), 60),
			"id":       run.ID,
			"job":      job,
			"kind":     run.Kind,
			"outcome":  BackupOutcome(run),
			"progress": progress,
			"size":     size,
			"started":  run.StartedAt,
			"took":     took,
			"volume":   run.VolumeName,
		})
	}
	return rows
}

// RunBackups dispatches a `backups` subcommand.
func RunBackups(client func() *Client, args []string) {
	if len(args) == 0 {
		Fail(BackupsUsage)
	}
	switch args[0] {
	case "list":
		set := NewFlagSet("backups list")
		options := ListFlags(set)
		volume := set.String("volume", "", "only this volume's runs, by id or name")
		outcome := set.String("outcome", "", "running, success or failed")
		Parse(set, args[1:])
		if *outcome != "" && !slices.Contains(backupOutcomes, *outcome) {
			Fail(fmt.Sprintf("--outcome must be one of %s", strings.Join(backupOutcomes, ", ")))
		}
		c := client()
		volumeID := ""
		if *volume != "" {
			volumeID = ResolveVolume(c, *volume).ID
		}
		BackupsList(c, volumeID, *outcome, *options)
	case "volumes":
		set := NewFlagSet("backups volumes")
		options := ListFlags(set)
		Parse(set, args[1:])
		VolumesList(client(), *options)
	case "run":
		set := NewFlagSet("backups run")
		wait := set.Bool("wait", false, "follow the backup's log until it finishes, non-zero exit when it fails")
		timeout := set.Int("timeout", 0, "with --wait, how long to wait before giving up, in seconds (default 6h)")
		rest := Parse(set, args[1:])
		if len(rest) != 1 {
			Fail(BackupsUsage)
		}
		RequirePositiveTimeout(*timeout)
		limit := defaultBackupTimeout
		if *timeout > 0 {
			limit = time.Duration(*timeout) * time.Second
		}
		BackupRunNow(client(), rest[0], *wait, limit)
	default:
		Fail(fmt.Sprintf("unknown backups subcommand %q. %s", args[0], BackupsUsage))
	}
}

// BackupsList prints backup runs, newest first, as a table or raw JSON.
func BackupsList(client *Client, volumeID, outcome string, args ListArgs) {
	query := ListQuery(args)
	if volumeID != "" {
		query.Set("volume", volumeID)
	}
	if outcome != "" {
		query.Set("outcome", outcome)
	}
	body, header := client.do("GET", "/backups", query)
	if args.JSON {
		PrintJSON(body)
		return
	}
	var runs []BackupRun
	if err := json.Unmarshal(body, &runs); err != nil {
		Fail(err.Error())
	}
	PrintTable(BackupRows(runs, time.Now()), backupColumns)
	PrintPageFooter(header, len(runs))
}

// VolumesList prints storage volumes with their backup schedule, as a table or raw JSON.
func VolumesList(client *Client, args ListArgs) {
	body, header := client.do("GET", "/volumes", ListQuery(args))
	if args.JSON {
		PrintJSON(body)
		return
	}
	var volumes []Volume
	if err := json.Unmarshal(body, &volumes); err != nil {
		Fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(volumes))
	for _, volume := range volumes {
		backup := "off"
		if volume.BackupEnabled {
			backup = "on"
		}
		rows = append(rows, map[string]string{
			"backup":   backup,
			"id":       volume.ID,
			"kind":     volume.Kind,
			"lastRun":  deref(volume.BackupLastRunAt),
			"name":     volume.Name,
			"nextRun":  deref(volume.BackupNextRunAt),
			"schedule": deref(volume.BackupSchedule),
		})
	}
	PrintTable(rows, volumeColumns)
	PrintPageFooter(header, len(volumes))
}

// ResolveVolume finds a volume by exact id or name, exiting when none or
// several match.
func ResolveVolume(client *Client, ref string) Volume {
	var volumes []Volume
	client.decode("GET", "/volumes", url.Values{"q": {ref}, "perPage": {"100"}}, &volumes)
	var matches []Volume
	for _, volume := range volumes {
		if volume.ID == ref || volume.Name == ref {
			matches = append(matches, volume)
		}
	}
	if len(matches) != 1 {
		Fail(fmt.Sprintf("%d volumes match %q, pass its id (homerun backups volumes lists them).", len(matches), ref))
	}
	return matches[0]
}

// BackupRunNow queues a backup of a volume. Without wait it prints the job id;
// with it, prints the job's log as it grows and exits non-zero unless the
// backup succeeded.
func BackupRunNow(client *Client, ref string, wait bool, timeout time.Duration) {
	volume := ResolveVolume(client, ref)
	var queued struct {
		JobID string `json:"jobId"`
	}
	client.decodeJSON("POST", "/volumes/"+url.PathEscape(volume.ID)+"/backup", struct{}{}, &queued)
	if !wait {
		PrintValue(map[string]any{"jobId": queued.JobID, "status": "queued", "volume": volume.Name})
		return
	}
	fmt.Fprintf(os.Stderr, "Backing up %s, job %s\n", volume.Name, queued.JobID)
	job := FollowJob(client, queued.JobID, 5*time.Second, timeout)
	if job.Status != "succeeded" {
		Fail(fmt.Sprintf("Backup %s: %s", job.Status, deref(job.Error)))
	}
}

// FollowJob polls a job every pollEvery, printing each new part of its log,
// until it reaches a terminal status, exiting the process once timeout has
// passed.
func FollowJob(client *Client, jobID string, pollEvery, timeout time.Duration) Job {
	deadline := time.Now().Add(timeout)
	printed := 0
	for {
		var job Job
		client.decode("GET", "/jobs/"+url.PathEscape(jobID), nil, &job)
		if len(job.Log) > printed {
			fmt.Print(job.Log[printed:])
			if !strings.HasSuffix(job.Log, "\n") {
				fmt.Println()
			}
			printed = len(job.Log)
		}
		if finishedJobStatuses[job.Status] {
			return job
		}
		if time.Now().After(deadline) {
			Fail(fmt.Sprintf("Timed out waiting for job %s (still %s).", jobID, job.Status))
		}
		Sleep(pollEvery)
	}
}

// RunJobs dispatches a `jobs` subcommand.
func RunJobs(client func() *Client, args []string) {
	if len(args) == 0 {
		Fail(JobsUsage)
	}
	switch args[0] {
	case "list":
		set := NewFlagSet("jobs list")
		options := ListFlags(set)
		status := set.String("status", "", "comma-separated: queued, running, succeeded, failed, cancelled")
		Parse(set, args[1:])
		JobsList(client(), *status, *options)
	case "get":
		set := NewFlagSet("jobs get")
		asJSON := set.Bool("json", false, "print raw JSON instead of a summary")
		rest := Parse(set, args[1:])
		if len(rest) != 1 {
			Fail(JobsUsage)
		}
		JobGet(client(), rest[0], *asJSON)
	default:
		Fail(fmt.Sprintf("unknown jobs subcommand %q. %s", args[0], JobsUsage))
	}
}

// JobsList prints queue jobs, running first, as a table or raw JSON.
func JobsList(client *Client, status string, args ListArgs) {
	query := ListQuery(args)
	query.Del("q")
	if status != "" {
		query.Set("status", status)
	}
	body, header := client.do("GET", "/jobs", query)
	if args.JSON {
		PrintJSON(body)
		return
	}
	var jobs []Job
	if err := json.Unmarshal(body, &jobs); err != nil {
		Fail(err.Error())
	}
	now := time.Now()
	rows := make([]map[string]string, 0, len(jobs))
	for _, job := range jobs {
		rows = append(rows, map[string]string{
			"attempts":  strconv.Itoa(job.Attempts),
			"created":   job.CreatedAt,
			"heartbeat": sinceText(job.HeartbeatAt, now),
			"id":        job.ID,
			"status":    job.Status,
			"title":     Shorten(job.Title, 50),
			"type":      job.Type,
		})
	}
	PrintTable(rows, jobColumns)
	PrintPageFooter(header, len(jobs))
}

// JobGet prints one job's status, timings and full log, or its raw JSON.
func JobGet(client *Client, jobID string, asJSON bool) {
	body, _ := client.do("GET", "/jobs/"+url.PathEscape(jobID), nil)
	if asJSON {
		PrintJSON(body)
		return
	}
	var job Job
	if err := json.Unmarshal(body, &job); err != nil {
		Fail(err.Error())
	}
	now := time.Now()
	fmt.Printf("%s (%s)\n", job.Title, job.Type)
	fmt.Printf("  status:    %s %s, attempt %d/%d\n", job.Status, deref(job.Stage), job.Attempts, job.MaxAttempts)
	fmt.Printf("  created:   %s\n  started:   %s\n  finished:  %s\n", job.CreatedAt, deref(job.StartedAt), deref(job.FinishedAt))
	fmt.Printf("  heartbeat: %s\n  progress:  %s\n", sinceText(job.HeartbeatAt, now), sinceText(job.ProgressAt, now))
	if job.Error != nil && *job.Error != "" {
		fmt.Printf("  error:     %s\n", *job.Error)
	}
	if job.Log != "" {
		fmt.Printf("\n%s", job.Log)
		if !strings.HasSuffix(job.Log, "\n") {
			fmt.Println()
		}
	}
}
