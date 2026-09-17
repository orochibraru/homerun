package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ClientConfig is a resolved instance URL and API key, whatever they came from.
type ClientConfig struct {
	APIKey  string
	BaseURL string
}

// Client talks to one instance's REST API under /api/v1.
type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

// resolveConfig resolves in order: the --base-url/--api-key flags, then the
// HOMERUN_BASE_URL/HOMERUN_API_KEY env vars, then the config file `homerun
// login` writes. Returns nil rather than failing when either piece is still
// missing: the caller treats that as "not logged in" and points at `homerun
// login`, rather than surfacing a raw error.
func resolveConfig(flagBaseURL, flagAPIKey string) *ClientConfig {
	baseURL := firstNonEmpty(flagBaseURL, os.Getenv("HOMERUN_BASE_URL"))
	apiKey := firstNonEmpty(flagAPIKey, os.Getenv("HOMERUN_API_KEY"))

	if baseURL == "" || apiKey == "" {
		if stored := readStoredConfig(); stored != nil {
			baseURL = firstNonEmpty(baseURL, stored.BaseURL)
			apiKey = firstNonEmpty(apiKey, stored.APIKey)
		}
	}

	if baseURL == "" || apiKey == "" {
		return nil
	}
	return &ClientConfig{APIKey: apiKey, BaseURL: strings.TrimRight(baseURL, "/")}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// newClient builds the API client. No timeout on the http.Client itself: a
// `logs --follow` stream and a deploy that waits on a slow image pull both run
// far longer than any sane request timeout.
func newClient(config ClientConfig) *Client {
	return &Client{
		apiKey:  config.APIKey,
		baseURL: config.BaseURL,
		http:    &http.Client{},
	}
}

// requireClient resolves the client or exits with the "not logged in" message.
func requireClient(flagBaseURL, flagAPIKey string) *Client {
	config := resolveConfig(flagBaseURL, flagAPIKey)
	if config == nil {
		fail("Not logged in. Run `homerun login` to get started.")
		return nil
	}
	return newClient(*config)
}

// send performs one API call. x-api-key is the header hooks.server.ts checks
// first for a non-cookie caller. The response body is left open for the caller
// to read and close.
func (c *Client) send(method, path string, query url.Values) (*http.Response, error) {
	endpoint := c.baseURL + "/api/v1" + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	request, err := http.NewRequest(method, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("x-api-key", c.apiKey)
	return c.http.Do(request)
}

// do performs one API call and reads its body, exiting with the status and
// error body on a transport error or any non-2xx response.
func (c *Client) do(method, path string, query url.Values) ([]byte, http.Header) {
	response, err := c.send(method, path, query)
	if err != nil {
		fail(err.Error())
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		fail(err.Error())
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fail(apiErrorMessage(response.StatusCode, body))
	}
	return body, response.Header
}

// decode performs one API call and unmarshals its body into out.
func (c *Client) decode(method, path string, query url.Values, out any) http.Header {
	body, header := c.do(method, path, query)
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			fail(fmt.Sprintf("couldn't read the instance's answer: %s", err))
		}
	}
	return header
}

// apiErrorMessage is the message for a failed API call: the status line plus
// the JSON error body. A body that isn't JSON (an HTML page) is left out, and a
// 404 of that kind says the instance likely predates this CLI's endpoint
// instead.
func apiErrorMessage(status int, body []byte) string {
	statusLine := fmt.Sprintf("%d %s", status, http.StatusText(status))
	if json.Valid(body) && len(body) > 0 {
		return fmt.Sprintf("%s: %s", statusLine, strings.TrimSpace(string(body)))
	}
	if status == 404 {
		return fmt.Sprintf(
			"%s: this instance doesn't have that endpoint, it's probably older than this CLI (v%s). Update the instance first.",
			statusLine, version,
		)
	}
	return fmt.Sprintf("%s: the instance answered with a non-JSON body.", statusLine)
}

var sleep = func(d time.Duration) {
	time.Sleep(d)
}
