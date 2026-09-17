package main

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
)

// deviceStart is the device-authorization request the instance opens for us.
type deviceStart struct {
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

// login is a machine-to-machine login: the CLI has no browser of its own to
// redirect through (and often runs on a headless/remote box entirely), so this
// is a device-code flow, same shape as `gh auth login`'s non-web option or a
// smart-TV OAuth sign-in, not a localhost-callback flow. A human approves from
// any already-authenticated browser tab by typing the short code shown here,
// the CLI just polls until that happens.
func login(flagBaseURL string) {
	baseURL := resolveLoginBaseURL(flagBaseURL)
	start := startDeviceAuth(baseURL)

	fmt.Print("\nTo finish logging in, open this URL and enter the code below:\n\n")
	fmt.Printf("  %s\n", start.VerificationURI)
	fmt.Printf("\n  Code: %s\n\n", start.UserCode)
	fmt.Printf("(or open %s to skip typing it)\n\n", start.VerificationURIComplete)
	fmt.Println("Waiting for approval...")

	pollForApproval(baseURL, start)
}

// resolveLoginBaseURL is the instance URL, from --base-url, the stored config,
// or an interactive prompt, with any trailing slash stripped.
func resolveLoginBaseURL(flagBaseURL string) string {
	rawBaseURL := flagBaseURL
	if rawBaseURL == "" {
		fallback := ""
		if stored := readStoredConfig(); stored != nil {
			fallback = stored.BaseURL
		}
		rawBaseURL = prompt("Homerun instance URL", fallback)
	}
	if rawBaseURL == "" {
		fail("A base URL is required (e.g. https://homerun.example.com).")
	}
	return strings.TrimRight(rawBaseURL, "/")
}

// prompt asks one question on stdin, falling back to fallback on an empty answer.
func prompt(question, fallback string) string {
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

// startDeviceAuth opens the device-authorization request, returning the codes
// the human needs to approve it.
func startDeviceAuth(baseURL string) deviceStart {
	response, err := http.Post(baseURL+"/api/v1/auth/cli/device", "application/json", nil)
	if err != nil {
		fail(fmt.Sprintf("Couldn't reach %s: %s", baseURL, err))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fail(fmt.Sprintf(
			"Couldn't start login: %d %s",
			response.StatusCode, http.StatusText(response.StatusCode),
		))
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		fail(err.Error())
	}
	var start deviceStart
	if err := json.Unmarshal(body, &start); err != nil {
		fail(err.Error())
	}
	return start
}

// pollForApproval polls until the request is approved (storing the key),
// rejected, or the deadline passes.
func pollForApproval(baseURL string, start deviceStart) {
	deadline := time.Now().Add(time.Duration(start.ExpiresIn) * time.Second)
	for time.Now().Before(deadline) {
		sleep(time.Duration(start.Interval) * time.Second)

		payload, err := json.Marshal(map[string]string{"deviceCode": start.DeviceCode})
		if err != nil {
			fail(err.Error())
		}
		response, err := http.Post(
			baseURL+"/api/v1/auth/cli/token", "application/json", bytes.NewReader(payload),
		)
		if err != nil {
			fail(fmt.Sprintf("Login failed: %s", err))
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			fail(fmt.Sprintf(
				"Login failed: %d %s",
				response.StatusCode, http.StatusText(response.StatusCode),
			))
		}
		if readErr != nil {
			fail(readErr.Error())
		}
		var result pollResult
		if err := json.Unmarshal(body, &result); err != nil {
			fail(err.Error())
		}

		switch {
		case result.Status == "denied":
			fail("Login request was denied.")
		case result.Status == "expired":
			fail("Login request expired. Run `homerun login` again.")
		case result.Status == "approved" && result.APIKey != "":
			if err := writeStoredConfig(StoredConfig{APIKey: result.APIKey, BaseURL: baseURL}); err != nil {
				fail(err.Error())
			}
			fmt.Printf("\nLogged in to %s.\n", baseURL)
			fmt.Printf("Config saved to %s.\n", configPath())
			return
		}
	}

	fail("Timed out waiting for approval. Run `homerun login` again.")
}

// logout revokes the API key on the server (DELETE /api/v1/auth-token, which
// revokes whichever key authenticated the request, i.e. this one), then always
// clears the local config, even when the server call fails, so a
// stale/unreachable instance can never block logging out locally.
func logout() {
	existing := readStoredConfig()
	if existing == nil {
		fmt.Println("Not logged in.")
		return
	}

	revoked := revokeAPIKey(*existing)
	clearStoredConfig()

	if revoked {
		fmt.Printf("Logged out of %s and revoked the API key.\n", existing.BaseURL)
		return
	}
	fmt.Printf(
		"Logged out of %s. Couldn't revoke the API key on the server (it may already be invalid, or the server is unreachable) : cleared the local config anyway.\n",
		existing.BaseURL,
	)
}

// revokeAPIKey is best-effort: any transport error or non-ok response just
// means the local logout proceeds without server-side revocation.
func revokeAPIKey(config StoredConfig) bool {
	client := newClient(ClientConfig(config))
	response, err := client.send("DELETE", "/auth-token", nil)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode >= 200 && response.StatusCode < 300
}
