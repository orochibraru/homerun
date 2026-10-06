package cli

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
)

var errorStatuses = []string{"unresolved", "resolved", "ignored", "all"}

var errorColumns = []string{"id", "level", "status", "count", "users", "lastSeen", "title", "culprit"}

// ErrorIssue is one issue as GET /services/{id}/errors lists it.
type ErrorIssue struct {
	Count         int    `json:"count"`
	Culprit       string `json:"culprit"`
	ID            string `json:"id"`
	LastSeen      string `json:"lastSeen"`
	Level         string `json:"level"`
	Status        string `json:"status"`
	Title         string `json:"title"`
	UsersAffected int    `json:"usersAffected"`
}

// ErrorRows turns issues into table rows, long titles and culprits shortened.
func ErrorRows(issues []ErrorIssue) []map[string]string {
	rows := make([]map[string]string, 0, len(issues))
	for _, issue := range issues {
		rows = append(rows, map[string]string{
			"count":    strconv.Itoa(issue.Count),
			"culprit":  Shorten(issue.Culprit, 40),
			"id":       issue.ID,
			"lastSeen": issue.LastSeen,
			"level":    issue.Level,
			"status":   issue.Status,
			"title":    Shorten(issue.Title, 60),
			"users":    strconv.Itoa(issue.UsersAffected),
		})
	}
	return rows
}

// ErrorsList prints a service's error issues, most recently seen first, as a
// table or raw JSON.
func ErrorsList(client *Client, serviceID, status string, args ListArgs) {
	query := ListQuery(args)
	if status != "" {
		query.Set("status", status)
	}
	body, header := client.do("GET", fmt.Sprintf("/services/%s/errors", url.PathEscape(serviceID)), query)
	if args.JSON {
		PrintJSON(body)
		return
	}
	var issues []ErrorIssue
	if err := json.Unmarshal(body, &issues); err != nil {
		Fail(err.Error())
	}
	PrintTable(ErrorRows(issues), errorColumns)
	PrintPageFooter(header, len(issues))
}

// ErrorGet prints one error issue with its latest event (or the event named by
// eventID) as JSON.
func ErrorGet(client *Client, serviceID, issueID, eventID string) {
	query := url.Values{}
	if eventID != "" {
		query.Set("event", eventID)
	}
	body, _ := client.do("GET", fmt.Sprintf("/services/%s/errors/%s", url.PathEscape(serviceID), url.PathEscape(issueID)), query)
	PrintJSON(body)
}

// ErrorSetStatus marks an error issue resolved, ignored or unresolved and
// prints the updated issue as JSON.
func ErrorSetStatus(client *Client, serviceID, issueID, status string) {
	var updated json.RawMessage
	path := fmt.Sprintf("/services/%s/errors/%s", url.PathEscape(serviceID), url.PathEscape(issueID))
	client.decodeJSON("PATCH", path, map[string]string{"status": status}, &updated)
	PrintJSON(updated)
}
