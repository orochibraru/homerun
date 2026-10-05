// Package client is a small typed client for the Homerun REST API
// (/api/v1), the calls the Terraform provider makes.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Object is one API resource as JSON: field names as the API spells them.
type Object = map[string]any

// Client talks to one Homerun instance with one API key.
type Client struct {
	endpoint string
	apiKey   string
	http     *http.Client
}

// Error is a non-2xx answer from the API, with the message its body carried.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("homerun API answered %d: %s", e.Status, e.Message)
}

// IsNotFound reports whether err is the API's 404.
func IsNotFound(err error) bool {
	var apiErr *Error
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound
}

// New returns a client for the instance at endpoint (its base URL, with or
// without /api/v1), authenticated with apiKey.
func New(endpoint, apiKey string) (*Client, error) {
	base := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if base == "" {
		return nil, errors.New("the Homerun endpoint is empty")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("%q isn't an http(s) URL", endpoint)
	}
	base = strings.TrimSuffix(base, "/api/v1")
	return &Client{
		apiKey:   apiKey,
		endpoint: base + "/api/v1",
		http:     &http.Client{Timeout: 30 * time.Minute},
	}, nil
}

// Get reads the object at path.
func (c *Client) Get(ctx context.Context, path string) (Object, error) {
	var out Object
	err := c.do(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

// List reads every object a collection path returns, following its pages
// when the API pages it (an x-total-count header).
func (c *Client) List(ctx context.Context, path string, query url.Values) ([]Object, error) {
	var all []Object
	for page := 1; ; page++ {
		values := url.Values{}
		for key, list := range query {
			values[key] = list
		}
		values.Set("page", strconv.Itoa(page))
		values.Set("perPage", "100")
		var batch []Object
		header, err := c.send(ctx, http.MethodGet, path+"?"+values.Encode(), nil, &batch)
		if err != nil {
			return nil, err
		}
		all = append(all, batch...)
		total, paged := totalCount(header)
		if !paged || len(batch) == 0 || len(all) >= total {
			return all, nil
		}
	}
}

func totalCount(header http.Header) (int, bool) {
	total, err := strconv.Atoi(header.Get("x-total-count"))
	return total, err == nil
}

// Create posts body to a collection path and returns the created object.
func (c *Client) Create(ctx context.Context, path string, body Object) (Object, error) {
	var out Object
	err := c.do(ctx, http.MethodPost, path, body, &out)
	return out, err
}

// Update patches the object at path with body and returns it.
func (c *Client) Update(ctx context.Context, path string, body Object) (Object, error) {
	var out Object
	err := c.do(ctx, http.MethodPatch, path, body, &out)
	return out, err
}

// Delete removes the object at path; one already gone isn't an error.
func (c *Client) Delete(ctx context.Context, path string) error {
	err := c.do(ctx, http.MethodDelete, path, nil, nil)
	if IsNotFound(err) {
		return nil
	}
	return err
}

// Deploy deploys a service (or an environment) and waits for the pipeline
// to finish, the way POST /services/{id}/deploy does.
func (c *Client) Deploy(ctx context.Context, serviceID string) error {
	return c.do(ctx, http.MethodPost, "/services/"+url.PathEscape(serviceID)+"/deploy", Object{}, nil)
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	_, err := c.send(ctx, method, path, body, out)
	return err
}

func (c *Client) send(ctx context.Context, method, path string, body, out any) (http.Header, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.endpoint+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		return nil, &Error{Message: errorMessage(raw, res.Status), Status: res.StatusCode}
	}
	if out == nil || len(bytes.TrimSpace(raw)) == 0 {
		return res.Header, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	return res.Header, decoder.Decode(out)
}

func errorMessage(raw []byte, status string) string {
	var body struct {
		Error  string `json:"error"`
		Issues any    `json:"issues"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Error == "" {
		text := strings.TrimSpace(string(raw))
		if text == "" {
			return status
		}
		return text
	}
	if body.Issues != nil {
		issues, _ := json.Marshal(body.Issues)
		return body.Error + ": " + string(issues)
	}
	return body.Error
}
