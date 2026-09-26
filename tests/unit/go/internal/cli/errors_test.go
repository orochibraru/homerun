package cli_test

import (
	"reflect"
	"testing"

	"github.com/orochibraru/homerun/internal/cli"
)

func TestErrorRowsShortensLongText(t *testing.T) {
	rows := cli.ErrorRows([]cli.ErrorIssue{{
		Count:         3,
		Culprit:       "handler (src/index.js)",
		ID:            "issue-1",
		LastSeen:      "2026-09-26T10:00:00.000Z",
		Level:         "error",
		Status:        "unresolved",
		Title:         "TypeError: Cannot read properties of undefined (reading 'name') in a very long place",
		UsersAffected: 2,
	}})
	want := []map[string]string{{
		"count":    "3",
		"culprit":  "handler (src/index.js)",
		"id":       "issue-1",
		"lastSeen": "2026-09-26T10:00:00.000Z",
		"level":    "error",
		"status":   "unresolved",
		"title":    cli.Shorten("TypeError: Cannot read properties of undefined (reading 'name') in a very long place", 60),
		"users":    "2",
	}}
	if !reflect.DeepEqual(rows, want) {
		t.Errorf("want %v, got %v", want, rows)
	}
}
