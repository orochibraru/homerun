package homerun

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/orochibraru/homerun/internal/buildinfo"
)

// Client talks to one instance's REST API under /api/v1.
type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

// NewClient builds an API client. The http.Client has no timeout: a
// `logs --follow` stream and a deploy waiting on a slow image pull both run far
// longer than any sane request timeout.
func NewClient(config Config) *Client {
	return &Client{
		apiKey:  config.APIKey,
		baseURL: strings.TrimRight(config.BaseURL, "/"),
		http:    &http.Client{},
	}
}

// Send performs one API call and hands back the raw response, whatever its
// status, for a caller that streams the body or reads an error body itself.
// x-api-key is the header the instance checks first for a non-cookie caller.
// The caller closes the body.
func (c *Client) Send(method, path string, query url.Values) (*http.Response, error) {
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

// Do performs one API call and reads its body. A non-2xx answer is an
// *APIError carrying the status and body.
func (c *Client) Do(method, path string, query url.Values) ([]byte, http.Header, error) {
	response, err := c.Send(method, path, query)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return body, response.Header, &APIError{Body: body, Status: response.StatusCode}
	}
	return body, response.Header, nil
}

// Decode performs one API call and unmarshals its body into out.
func (c *Client) Decode(method, path string, query url.Values, out any) (http.Header, error) {
	body, header, err := c.Do(method, path, query)
	if err != nil {
		return header, err
	}
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return header, fmt.Errorf("couldn't read the instance's answer: %w", err)
		}
	}
	return header, nil
}

// APIError is a non-2xx answer from the instance.
type APIError struct {
	Body   []byte
	Status int
}

// Error is the status line plus the JSON error body, see APIErrorMessage.
func (e *APIError) Error() string {
	return APIErrorMessage(e.Status, e.Body)
}

// APIErrorMessage is the message for a failed API call: the status line plus
// the JSON error body. A body that isn't JSON (an HTML page) is left out, and a
// 404 of that kind says the instance likely predates this client's endpoint.
func APIErrorMessage(status int, body []byte) string {
	statusLine := fmt.Sprintf("%d %s", status, http.StatusText(status))
	if json.Valid(body) && len(body) > 0 {
		return fmt.Sprintf("%s: %s", statusLine, strings.TrimSpace(string(body)))
	}
	if status == http.StatusNotFound {
		return fmt.Sprintf(
			"%s: this instance doesn't have that endpoint, it's probably older than this CLI (v%s). Update the instance first.",
			statusLine, buildinfo.Version,
		)
	}
	return fmt.Sprintf("%s: the instance answered with a non-JSON body.", statusLine)
}
