package cli

import (
	"net/http"
	"net/url"

	"github.com/orochibraru/homerun/internal/homerun"
)

// Client is the CLI's view of the API client: the same calls as
// internal/homerun's, except that a failure exits the process with the
// instance's own error, which is all a CLI command ever wants to do with one.
type Client struct {
	api *homerun.Client
}

// NewClient builds the API client.
func NewClient(config homerun.Config) *Client {
	return &Client{api: homerun.NewClient(config)}
}

// RequireClient resolves the client or exits with the "not logged in" message.
func RequireClient(flagBaseURL, flagAPIKey string) *Client {
	config := homerun.ResolveConfig(flagBaseURL, flagAPIKey)
	if config == nil {
		Fail("Not logged in. Run `homerun login` to get started.")
		return nil
	}
	return NewClient(*config)
}

// send performs one API call and hands back the raw response for a caller
// that streams or reads an error body itself. The caller closes the body.
func (c *Client) send(method, path string, query url.Values) (*http.Response, error) {
	return c.api.Send(method, path, query)
}

// do performs one API call and reads its body, exiting with the status and
// error body on a transport error or any non-2xx response.
func (c *Client) do(method, path string, query url.Values) ([]byte, http.Header) {
	body, header, err := c.api.Do(method, path, query)
	if err != nil {
		Fail(err.Error())
	}
	return body, header
}

// decode performs one API call and unmarshals its body into out, exiting on failure.
func (c *Client) decode(method, path string, query url.Values, out any) http.Header {
	header, err := c.api.Decode(method, path, query, out)
	if err != nil {
		Fail(err.Error())
	}
	return header
}

// decodeJSON sends payload as a JSON body and unmarshals the answer into out, exiting on failure.
func (c *Client) decodeJSON(method, path string, payload, out any) {
	if err := c.api.DecodeJSON(method, path, payload, out); err != nil {
		Fail(err.Error())
	}
}
