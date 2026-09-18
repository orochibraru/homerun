// Package registryapi is a small client for the Docker Distribution (registry
// v2) HTTP API, covering what the homerun-mirror garbage collector needs:
// catalog, tags, manifest digests, re-tagging and manifest deletes.
package registryapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// ManifestAccept is the Accept header that makes the registry answer with an
// image index or manifest list when a tag has one, so a multi-arch tag
// resolves to the digest a pull would.
const ManifestAccept = "application/vnd.oci.image.index.v1+json, " +
	"application/vnd.docker.distribution.manifest.list.v2+json, " +
	"application/vnd.oci.image.manifest.v1+json, " +
	"application/vnd.docker.distribution.manifest.v2+json"

const catalogPageSize = 1000

var (
	nextLinkRe   = regexp.MustCompile(`<([^>]+)>;\s*rel="next"`)
	digestRe     = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	repositoryRe = regexp.MustCompile(`^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$`)
)

// IsValidRepository reports whether name matches the distribution
// repository-name grammar (lowercase, "/"-separated path segments).
func IsValidRepository(name string) bool {
	return repositoryRe.MatchString(name)
}

// IsValidDigest reports whether digest is a well-formed sha256 content digest.
func IsValidDigest(digest string) bool {
	return digestRe.MatchString(digest)
}

// Tag is one repository:tag and the manifest digest it points at.
type Tag struct {
	Digest     string `json:"digest"`
	Repository string `json:"repository"`
	Tag        string `json:"tag"`
}

// Digest is one manifest of a repository, addressed by digest.
type Digest struct {
	Digest     string `json:"digest"`
	Repository string `json:"repository"`
}

// Client talks to one registry at a base URL, with optional basic auth.
type Client struct {
	base     string
	http     *http.Client
	password string
	username string
}

// New builds a client for the registry at base. Empty credentials mean
// anonymous requests.
func New(base, username, password string) *Client {
	return &Client{
		base:     strings.TrimRight(base, "/"),
		http:     &http.Client{Timeout: 30 * time.Second},
		password: password,
		username: username,
	}
}

func (c *Client) do(ctx context.Context, method, path string, header http.Header, body []byte) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return nil, err
	}
	for key, values := range header {
		request.Header[key] = values
	}
	if c.username != "" {
		request.SetBasicAuth(c.username, c.password)
	}
	return c.http.Do(request)
}

func failure(response *http.Response, what string) error {
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	text := strings.TrimSpace(string(raw))
	if len(text) > 200 {
		text = text[:200]
	}
	if text != "" {
		return fmt.Errorf("%s failed: HTTP %d %s", what, response.StatusCode, text)
	}
	return fmt.Errorf("%s failed: HTTP %d", what, response.StatusCode)
}

// Ping reports whether the registry answers /v2/ successfully within 3s.
func (c *Client) Ping(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	response, err := c.do(ctx, http.MethodGet, "/v2/", nil, nil)
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return response.StatusCode >= 200 && response.StatusCode < 300
}

// NextCatalogPath is the path and query of the next catalog page from a
// Link header, or "" when there is none.
func NextCatalogPath(link string) string {
	match := nextLinkRe.FindStringSubmatch(link)
	if match == nil {
		return ""
	}
	parsed, err := url.Parse(match[1])
	if err != nil {
		return ""
	}
	if parsed.RawQuery == "" {
		return parsed.Path
	}
	return parsed.Path + "?" + parsed.RawQuery
}

// Catalog lists every repository, following the catalog's Link paging, and
// drops names that aren't valid repository names.
func (c *Client) Catalog(ctx context.Context) ([]string, error) {
	var repositories []string
	path := fmt.Sprintf("/v2/_catalog?n=%d", catalogPageSize)
	for path != "" {
		response, err := c.do(ctx, http.MethodGet, path, nil, nil)
		if err != nil {
			return nil, err
		}
		if response.StatusCode != http.StatusOK {
			err := failure(response, "Listing the mirror's repositories")
			_ = response.Body.Close()
			return nil, err
		}
		var page struct {
			Repositories []string `json:"repositories"`
		}
		err = json.NewDecoder(response.Body).Decode(&page)
		_ = response.Body.Close()
		if err != nil {
			return nil, err
		}
		for _, name := range page.Repositories {
			if IsValidRepository(name) {
				repositories = append(repositories, name)
			}
		}
		path = NextCatalogPath(response.Header.Get("Link"))
	}
	return repositories, nil
}

// Tags lists a repository's tags; an unknown repository has none.
func (c *Client) Tags(ctx context.Context, repository string) ([]string, error) {
	response, err := c.do(ctx, http.MethodGet, "/v2/"+repository+"/tags/list", nil, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if response.StatusCode != http.StatusOK {
		return nil, failure(response, "Listing tags of "+repository)
	}
	var body struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Tags, nil
}

// ManifestDigest resolves repository:reference to its content digest with a
// HEAD request; "" when the reference doesn't exist.
func (c *Client) ManifestDigest(ctx context.Context, repository, reference string) (string, error) {
	response, err := c.do(ctx, http.MethodHead, "/v2/"+repository+"/manifests/"+reference,
		http.Header{"Accept": {ManifestAccept}}, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return "", nil
	}
	if response.StatusCode != http.StatusOK {
		return "", failure(response, fmt.Sprintf("Resolving %s:%s", repository, reference))
	}
	return response.Header.Get("Docker-Content-Digest"), nil
}

// Inventory resolves every tag of repository to its digest, one HEAD at a
// time, skipping tags that vanished meanwhile.
func (c *Client) Inventory(ctx context.Context, repository string) ([]Tag, error) {
	tags, err := c.Tags(ctx, repository)
	if err != nil {
		return nil, err
	}
	var entries []Tag
	for _, tag := range tags {
		digest, err := c.ManifestDigest(ctx, repository, tag)
		if err != nil {
			return nil, err
		}
		if digest != "" {
			entries = append(entries, Tag{Digest: digest, Repository: repository, Tag: tag})
		}
	}
	return entries, nil
}

// TagManifest copies the manifest at entry.Digest onto entry.Tag in the same
// repository. False when the source manifest doesn't exist.
func (c *Client) TagManifest(ctx context.Context, entry Tag) (bool, error) {
	source, err := c.do(ctx, http.MethodGet, "/v2/"+entry.Repository+"/manifests/"+entry.Digest,
		http.Header{"Accept": {ManifestAccept}}, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = source.Body.Close() }()
	if source.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if source.StatusCode != http.StatusOK {
		return false, failure(source, fmt.Sprintf("Reading %s@%s", entry.Repository, entry.Digest))
	}
	body, err := io.ReadAll(source.Body)
	if err != nil {
		return false, err
	}
	contentType := source.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/vnd.docker.distribution.manifest.v2+json"
	}
	response, err := c.do(ctx, http.MethodPut, "/v2/"+entry.Repository+"/manifests/"+entry.Tag,
		http.Header{"Content-Type": {contentType}}, body)
	if err != nil {
		return false, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return false, failure(response, fmt.Sprintf("Tagging %s:%s", entry.Repository, entry.Tag))
	}
	return true, nil
}

// DeleteManifest deletes a manifest by digest, which drops every tag pointing
// at it. False when it was already gone.
func (c *Client) DeleteManifest(ctx context.Context, entry Digest) (bool, error) {
	response, err := c.do(ctx, http.MethodDelete, "/v2/"+entry.Repository+"/manifests/"+entry.Digest, nil, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return false, failure(response, fmt.Sprintf("Deleting %s@%s", entry.Repository, entry.Digest))
	}
	return true, nil
}
