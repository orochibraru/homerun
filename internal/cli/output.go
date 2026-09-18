package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
)

// printTable prints rows as a padded, left-aligned text table with a header and
// dashed rule, or "(none)" when empty. Missing cells print blank.
func printTable(rows []map[string]string, columns []string) {
	if len(rows) == 0 {
		fmt.Println("(none)")
		return
	}
	widths := make([]int, len(columns))
	for i, column := range columns {
		widths[i] = len(column)
		for _, row := range rows {
			if len(row[column]) > widths[i] {
				widths[i] = len(row[column])
			}
		}
	}
	line := func(cells []string) string {
		padded := make([]string, len(cells))
		for i, cell := range cells {
			padded[i] = cell + strings.Repeat(" ", widths[i]-len(cell))
		}
		return strings.TrimRight(strings.Join(padded, "  "), " ")
	}
	rule := make([]string, len(columns))
	for i, width := range widths {
		rule[i] = strings.Repeat("-", width)
	}
	fmt.Println(line(columns))
	fmt.Println(line(rule))
	for _, row := range rows {
		cells := make([]string, len(columns))
		for i, column := range columns {
			cells[i] = row[column]
		}
		fmt.Println(line(cells))
	}
}

// printJSON pretty-prints a raw JSON body as two-space-indented JSON, falling
// back to the bytes as-is when they aren't JSON at all.
func printJSON(body []byte) {
	var indented bytes.Buffer
	if err := json.Indent(&indented, body, "", "  "); err != nil {
		fmt.Println(strings.TrimRight(string(body), "\n"))
		return
	}
	fmt.Println(strings.TrimRight(indented.String(), "\n"))
}

// printValue pretty-prints a value the CLI built itself, as two-space-indented JSON.
func printValue(value any) {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

// fail prints "error: <message>" to stderr and exits the process with status 1.
var fail = func(message string) {
	fmt.Fprintf(os.Stderr, "error: %s\n", message)
	os.Exit(1)
}

// printPageFooter notes what a truncated listing left out. The list endpoints
// return one page, with the row count and page size in x-total-count/x-per-page:
// without this a truncated listing looks identical to a complete one.
func printPageFooter(header http.Header, shown int) {
	total, totalErr := strconv.Atoi(header.Get("x-total-count"))
	page, pageErr := strconv.Atoi(header.Get("x-page"))
	perPage, perPageErr := strconv.Atoi(header.Get("x-per-page"))
	if totalErr != nil || pageErr != nil || perPageErr != nil {
		return
	}
	if total <= shown || perPage <= 0 {
		return
	}
	lastPage := int(math.Max(1, math.Ceil(float64(total)/float64(perPage))))
	fmt.Printf(
		"\nShowing %d of %d (page %d of %d). Use --page/--per-page for the rest.\n",
		shown, total, page, lastPage,
	)
}
