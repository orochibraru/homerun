package cli

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

var deploymentColumns = []string{"id", "status", "trigger", "environment", "image", "commit", "startedAt", "finishedAt", "error"}

// SystemStats is the host's resource usage as GET /system-stats returns it.
type SystemStats struct {
	CPUPercent  float64  `json:"cpuPercent"`
	DiskTotalGb *float64 `json:"diskTotalGb"`
	DiskUsedGb  *float64 `json:"diskUsedGb"`
	GPU         *struct {
		MemTotalMb         float64 `json:"memTotalMb"`
		MemUsedMb          float64 `json:"memUsedMb"`
		Name               string  `json:"name"`
		UtilizationPercent float64 `json:"utilizationPercent"`
	} `json:"gpu"`
	MemTotalMb float64 `json:"memTotalMb"`
	MemUsedMb  float64 `json:"memUsedMb"`
}

func percent(used, total float64) float64 {
	if total <= 0 {
		return 0
	}
	return used / total * 100
}

// SystemStatsText renders host usage as one line each for CPU, memory, disk
// and, when there is one, the GPU.
func SystemStatsText(stats SystemStats) string {
	lines := []string{
		fmt.Sprintf("CPU:     %.1f%%", stats.CPUPercent),
		fmt.Sprintf("Memory:  %.0f / %.0f MB (%.1f%%)", stats.MemUsedMb, stats.MemTotalMb, percent(stats.MemUsedMb, stats.MemTotalMb)),
	}
	if stats.DiskUsedGb != nil && stats.DiskTotalGb != nil {
		lines = append(lines, fmt.Sprintf(
			"Disk:    %.1f / %.1f GB (%.1f%%)",
			*stats.DiskUsedGb, *stats.DiskTotalGb, percent(*stats.DiskUsedGb, *stats.DiskTotalGb),
		))
	} else {
		lines = append(lines, "Disk:    unknown")
	}
	if stats.GPU != nil {
		lines = append(lines, fmt.Sprintf(
			"GPU:     %s, %.0f%% busy, %.0f / %.0f MB",
			stats.GPU.Name, stats.GPU.UtilizationPercent, stats.GPU.MemUsedMb, stats.GPU.MemTotalMb,
		))
	}
	return strings.Join(lines, "\n")
}

// SystemStatsShow prints the host's CPU, memory, disk and GPU usage, or the raw JSON.
func SystemStatsShow(client *Client, asJSON bool) {
	body, _ := client.do("GET", "/system-stats", nil)
	if asJSON {
		PrintJSON(body)
		return
	}
	var stats SystemStats
	if err := json.Unmarshal(body, &stats); err != nil {
		Fail(err.Error())
	}
	fmt.Println(SystemStatsText(stats))
}

// DeploymentsList prints a service's latest deploy attempts, newest first, as
// a table or raw JSON. limit 0 leaves the API's default.
func DeploymentsList(client *Client, serviceID string, limit int, asJSON bool) {
	query := url.Values{}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	body, _ := client.do("GET", fmt.Sprintf("/services/%s/deployments", url.PathEscape(serviceID)), query)
	if asJSON {
		PrintJSON(body)
		return
	}
	var deployments []map[string]any
	if err := json.Unmarshal(body, &deployments); err != nil {
		Fail(err.Error())
	}
	rows := make([]map[string]string, 0, len(deployments))
	for _, deployment := range deployments {
		message, _ := deployment["errorMessage"].(string)
		rows = append(rows, map[string]string{
			"commit":      Shorten(Cell(deployment["gitCommit"]), 7),
			"environment": Cell(deployment["environment"]),
			"error":       Shorten(strings.ReplaceAll(message, "\n", " "), 60),
			"finishedAt":  Cell(deployment["finishedAt"]),
			"id":          Cell(deployment["id"]),
			"image":       Cell(deployment["imageRef"]),
			"startedAt":   Cell(deployment["startedAt"]),
			"status":      Cell(deployment["status"]),
			"trigger":     Cell(deployment["trigger"]),
		})
	}
	PrintTable(rows, deploymentColumns)
}
