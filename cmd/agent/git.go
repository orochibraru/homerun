package main

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	commitSHA      = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)
	commitSHAInLog = regexp.MustCompile(`\b[0-9a-f]{40}\b`)
)

// GitCredential is a provider token the main app resolves for a private repo
// and sends along, since the agent has no access to its git provider table.
type GitCredential struct {
	Token    string `json:"token"`
	Username string `json:"username"`
}

// authenticatedCloneURL injects a credential into an http(s) clone URL, the
// same rules as the main app's authenticatedCloneUrl: a URL that already
// carries credentials, isn't http(s), or doesn't parse is left alone.
func authenticatedCloneURL(gitURL string, credential *GitCredential) string {
	if credential == nil {
		return gitURL
	}
	parsed, err := url.Parse(gitURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil {
		return gitURL
	}
	parsed.User = url.UserPassword(credential.Username, credential.Token)
	return parsed.String()
}

// redactCloneURL strips any credential back out of every URL in text before it
// reaches a log line or an error message.
func redactCloneURL(text string) string {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return text
	}
	redacted := text
	for _, field := range fields {
		parsed, err := url.Parse(strings.Trim(field, `"'()`))
		if err != nil || parsed.User == nil || parsed.Host == "" {
			continue
		}
		clean := *parsed
		clean.User = nil
		redacted = strings.ReplaceAll(redacted, parsed.String(), clean.String())
	}
	return redacted
}

// isCommitSHA reports whether a ref is a full 40-character commit SHA, the same
// rule as the main app's isCommitSha.
func isCommitSHA(ref string) bool {
	return commitSHA.MatchString(strings.TrimSpace(ref))
}

// gitCheckoutSteps is the git argv lists that check ref out into repoDir, the
// same as the main app's gitCheckoutSteps: one shallow single-branch clone for
// a branch or tag, an init plus a shallow fetch and detached checkout for a
// commit SHA.
func gitCheckoutSteps(cloneURL, ref, repoDir string) [][]string {
	if !isCommitSHA(ref) {
		return [][]string{{
			"clone", "--depth", "1", "--branch", ref, "--single-branch", cloneURL, repoDir,
		}}
	}
	sha := strings.ToLower(strings.TrimSpace(ref))
	return [][]string{
		{"init", "--quiet", repoDir},
		{"-C", repoDir, "remote", "add", "origin", cloneURL},
		{"-C", repoDir, "fetch", "--depth", "1", "origin", sha},
		{"-C", repoDir, "checkout", "--detach", "FETCH_HEAD"},
	}
}

// extractCommitSHA is the first full commit SHA in a git command's output,
// such as `rev-parse HEAD`, or the empty string.
func extractCommitSHA(output string) string {
	return commitSHAInLog.FindString(output)
}
