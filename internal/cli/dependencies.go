package cli

import (
	"fmt"
	"net/url"
)

var dependencyColumns = []string{"direction", "name", "slug", "id", "source"}

// DependencyRef is one service on either side of a dependency, as GET /services/{id}/dependencies returns it.
type DependencyRef struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Source string `json:"source"`
}

// ServiceDependencies is what a service depends on and what depends on it.
type ServiceDependencies struct {
	DependedOnBy []DependencyRef `json:"dependedOnBy"`
	DependsOn    []DependencyRef `json:"dependsOn"`
}

// DependencyRows flattens both directions into table rows, what the service
// depends on first.
func DependencyRows(deps ServiceDependencies) []map[string]string {
	rows := []map[string]string{}
	for _, side := range []struct {
		direction string
		refs      []DependencyRef
	}{{"depends on", deps.DependsOn}, {"needed by", deps.DependedOnBy}} {
		for _, ref := range side.refs {
			rows = append(rows, map[string]string{"direction": side.direction, "id": ref.ID, "name": ref.Name, "slug": ref.Slug, "source": ref.Source})
		}
	}
	return rows
}

// DependenciesList prints what a service depends on and what depends on it,
// with each edge's source: recorded, env or both.
func DependenciesList(client *Client, id string, asJSON bool) {
	path := fmt.Sprintf("/services/%s/dependencies", url.PathEscape(id))
	if asJSON {
		body, _ := client.do("GET", path, nil)
		PrintJSON(body)
		return
	}
	var deps ServiceDependencies
	client.decode("GET", path, nil, &deps)
	PrintTable(DependencyRows(deps), dependencyColumns)
}

// DependenciesSet replaces the services a service is recorded as depending
// on (none clears them) and prints the result like DependenciesList.
func DependenciesSet(client *Client, id string, dependsOn []string) {
	if dependsOn == nil {
		dependsOn = []string{}
	}
	var deps ServiceDependencies
	client.decodeJSON("PUT", fmt.Sprintf("/services/%s/dependencies", url.PathEscape(id)), map[string][]string{"dependsOn": dependsOn}, &deps)
	PrintTable(DependencyRows(deps), dependencyColumns)
}
