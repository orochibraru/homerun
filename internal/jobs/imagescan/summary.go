package imagescan

import (
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"
)

// MaxStoredFindings caps how many findings a scan keeps, as the app does.
const MaxStoredFindings = 200

var severities = []string{"CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"}

var severityRank = map[string]int{"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "UNKNOWN": 4}

// Counts is a per-severity finding count, shaped like the app's SeverityCounts.
type Counts struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Low      int `json:"low"`
	Medium   int `json:"medium"`
	Unknown  int `json:"unknown"`
}

// Finding is one vulnerability, shaped like the app's ImageScanFinding.
type Finding struct {
	FixedVersion     *string `json:"fixedVersion"`
	ID               string  `json:"id"`
	InstalledVersion string  `json:"installedVersion"`
	Pkg              string  `json:"pkg"`
	Severity         string  `json:"severity"`
	Title            *string `json:"title"`
}

// Summary is a summarised Trivy report, shaped like the app's TrivySummary.
type Summary struct {
	Counts        Counts    `json:"counts"`
	FixableCounts Counts    `json:"fixableCounts"`
	Findings      []Finding `json:"findings"`
	TotalFindings int       `json:"totalFindings"`
}

// add increments the counter for severity (unrecognized values count as Unknown).
func (c *Counts) add(severity string) {
	switch severity {
	case "CRITICAL":
		c.Critical++
	case "HIGH":
		c.High++
	case "MEDIUM":
		c.Medium++
	case "LOW":
		c.Low++
	default:
		c.Unknown++
	}
}

// normalizeSeverity upper-cases value and maps it to a known severity, or "UNKNOWN".
func normalizeSeverity(value any) string {
	text, _ := value.(string)
	upper := strings.ToUpper(text)
	for _, severity := range severities {
		if upper == severity {
			return upper
		}
	}
	return "UNKNOWN"
}

// asText returns value as a string pointer, or nil when it isn't a non-empty string.
func asText(value any) *string {
	text, ok := value.(string)
	if !ok || text == "" {
		return nil
	}
	return &text
}

// textOr is asText's value, or fallback when there is none.
func textOr(value any, fallback string) string {
	if text := asText(value); text != nil {
		return *text
	}
	return fallback
}

// findingsOf extracts the Finding list from one Trivy result entry.
func findingsOf(result any) []Finding {
	record, _ := result.(map[string]any)
	vulnerabilities, _ := record["Vulnerabilities"].([]any)
	var findings []Finding
	for _, raw := range vulnerabilities {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := asText(entry["VulnerabilityID"])
		if id == nil {
			continue
		}
		findings = append(findings, Finding{
			FixedVersion:     asText(entry["FixedVersion"]),
			ID:               *id,
			InstalledVersion: textOr(entry["InstalledVersion"], ""),
			Pkg:              textOr(entry["PkgName"], textOr(entry["PkgID"], "")),
			Severity:         normalizeSeverity(entry["Severity"]),
			Title:            asText(entry["Title"]),
		})
	}
	return findings
}

// Summarize turns a Trivy JSON report into per-severity counts and at most
// limit findings, de-duplicated by vulnerability, package and version, sorted
// by severity with fixable findings first, IDs tie-breaking by byte order.
func Summarize(raw []byte, limit int) (Summary, error) {
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Summary{}, errors.New("Trivy didn't return a JSON report.")
	}
	report, ok := parsed.(map[string]any)
	if !ok {
		return Summary{}, errors.New("Trivy didn't return a JSON report.")
	}
	results, _ := report["Results"].([]any)
	seen := map[string]bool{}
	unique := []Finding{}
	for _, result := range results {
		for _, finding := range findingsOf(result) {
			key := finding.ID + "|" + finding.Pkg + "|" + finding.InstalledVersion
			if !seen[key] {
				seen[key] = true
				unique = append(unique, finding)
			}
		}
	}
	summary := Summary{TotalFindings: len(unique)}
	for _, finding := range unique {
		summary.Counts.add(finding.Severity)
		if finding.FixedVersion != nil {
			summary.FixableCounts.add(finding.Severity)
		}
	}
	sort.SliceStable(unique, func(i, j int) bool {
		a, b := unique[i], unique[j]
		if severityRank[a.Severity] != severityRank[b.Severity] {
			return severityRank[a.Severity] < severityRank[b.Severity]
		}
		if (a.FixedVersion == nil) != (b.FixedVersion == nil) {
			return a.FixedVersion != nil
		}
		return a.ID < b.ID
	})
	if len(unique) > limit {
		unique = unique[:limit]
	}
	summary.Findings = unique
	return summary, nil
}

var errorLine = regexp.MustCompile(`(?i)error|fatal|denied|unauthorized`)

// LastErrorLine is the most telling line of a failed helper's output: the last
// one mentioning an error, else the last non-empty one, else "no output".
func LastErrorLine(output string) string {
	last := ""
	lines := strings.Split(output, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if errorLine.MatchString(line) {
			return line
		}
		if last == "" {
			last = line
		}
	}
	if last == "" {
		return "no output"
	}
	return last
}
