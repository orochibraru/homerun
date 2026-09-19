package cli

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/homerun"
)

// DeviceStart is the device-authorization request the instance opens for us.
type DeviceStart struct {
	DeviceCode              string `json:"deviceCode"`
	ExpiresIn               int    `json:"expiresIn"`
	Interval                int    `json:"interval"`
	UserCode                string `json:"userCode"`
	VerificationURI         string `json:"verificationUri"`
	VerificationURIComplete string `json:"verificationUriComplete"`
}

// pollResult is one poll of a pending device-authorization request.
type pollResult struct {
	APIKey string `json:"apiKey"`
	Status string `json:"status"`
}

// Login is a machine-to-machine login: the CLI has no browser of its own to
// redirect through (and often runs on a headless/remote box entirely), so this
// is a device-code flow, same shape as `gh auth login`'s non-web option or a
// smart-TV OAuth sign-in, not a localhost-callback flow. A human approves from
// any already-authenticated browser tab by typing the short code shown here,
// the CLI just polls until that happens.
func Login(flagBaseURL string) {
	baseURL := ResolveLoginBaseURL(flagBaseURL)
	start := StartDeviceAuth(baseURL)

	fmt.Print("\nTo finish logging in, open this URL and enter the code below:\n\n")
	fmt.Printf("  %s\n", start.VerificationURI)
	fmt.Printf("\n  Code: %s\n\n", start.UserCode)
	fmt.Printf("(or open %s to skip typing it)\n\n", start.VerificationURIComplete)
	fmt.Println("Waiting for approval...")

	PollForApproval(baseURL, start)
}

// ResolveLoginBaseURL is the instance URL, from --base-url, the stored config,
// or an interactive prompt, with any trailing slash stripped.
func ResolveLoginBaseURL(flagBaseURL string) string {
	rawBaseURL := flagBaseURL
	if rawBaseURL == "" {
		fallback := ""
		if stored := homerun.ReadStoredConfig(); stored != nil {
			fallback = stored.BaseURL
		}
		rawBaseURL = Prompt("Homerun instance URL", fallback)
	}
	if rawBaseURL == "" {
		Fail("A base URL is required (e.g. https://homerun.example.com).")
	}
	return strings.TrimRight(rawBaseURL, "/")
}

// Prompt asks one question on stdin, falling back to fallback on an empty answer.
func Prompt(question, fallback string) string {
	suffix := ""
	if fallback != "" {
		suffix = fmt.Sprintf(" (%s)", fallback)
	}
	fmt.Printf("%s%s: ", question, suffix)
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		return fallback
	}
	answer := strings.TrimSpace(scanner.Text())
	if answer == "" {
		return fallback
	}
	return answer
}

// StartDeviceAuth opens the device-authorization request, returning the codes
// the human needs to approve it.
func StartDeviceAuth(baseURL string) DeviceStart {
	response, err := http.Post(baseURL+"/api/v1/auth/cli/device", "application/json", nil)
	if err != nil {
		Fail(fmt.Sprintf("Couldn't reach %s: %s", baseURL, err))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		Fail(fmt.Sprintf(
			"Couldn't start login: %d %s",
			response.StatusCode, http.StatusText(response.StatusCode),
		))
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		Fail(err.Error())
	}
	var start DeviceStart
	if err := json.Unmarshal(body, &start); err != nil {
		Fail(err.Error())
	}
	return start
}

// PollForApproval polls until the request is approved (storing the key),
// rejected, or the deadline passes.
func PollForApproval(baseURL string, start DeviceStart) {
	deadline := time.Now().Add(time.Duration(start.ExpiresIn) * time.Second)
	for time.Now().Before(deadline) {
		Sleep(time.Duration(start.Interval) * time.Second)

		payload, err := json.Marshal(map[string]string{"deviceCode": start.DeviceCode})
		if err != nil {
			Fail(err.Error())
		}
		response, err := http.Post(
			baseURL+"/api/v1/auth/cli/token", "application/json", bytes.NewReader(payload),
		)
		if err != nil {
			Fail(fmt.Sprintf("Login failed: %s", err))
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			Fail(fmt.Sprintf(
				"Login failed: %d %s",
				response.StatusCode, http.StatusText(response.StatusCode),
			))
		}
		if readErr != nil {
			Fail(readErr.Error())
		}
		var result pollResult
		if err := json.Unmarshal(body, &result); err != nil {
			Fail(err.Error())
		}

		switch {
		case result.Status == "denied":
			Fail("Login request was denied.")
		case result.Status == "expired":
			Fail("Login request expired. Run `homerun login` again.")
		case result.Status == "approved" && result.APIKey != "":
			if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: result.APIKey, BaseURL: baseURL}); err != nil {
				Fail(err.Error())
			}
			fmt.Printf("\nLogged in to %s.\n", baseURL)
			fmt.Printf("Config saved to %s.\n", homerun.ConfigPath())
			return
		}
	}

	Fail("Timed out waiting for approval. Run `homerun login` again.")
}

// Logout revokes the API key on the server (DELETE /api/v1/auth-token, which
// revokes whichever key authenticated the request, i.e. this one), then always
// clears the local config, even when the server call fails, so a
// stale/unreachable instance can never block logging out locally.
func Logout() {
	existing := homerun.ReadStoredConfig()
	if existing == nil {
		fmt.Println("Not logged in.")
		return
	}

	revoked := RevokeAPIKey(*existing)
	homerun.ClearStoredConfig()

	if revoked {
		fmt.Printf("Logged out of %s and revoked the API key.\n", existing.BaseURL)
		return
	}
	fmt.Printf(
		"Logged out of %s. Couldn't revoke the API key on the server (it may already be invalid, or the server is unreachable) : cleared the local config anyway.\n",
		existing.BaseURL,
	)
}

// RevokeAPIKey is best-effort: any transport error or non-ok response just
// means the local logout proceeds without server-side revocation.
func RevokeAPIKey(config homerun.StoredConfig) bool {
	client := NewClient(homerun.Config(config))
	response, err := client.send("DELETE", "/auth-token", nil)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode >= 200 && response.StatusCode < 300
}
