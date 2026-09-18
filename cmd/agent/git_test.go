package main

import (
	"strings"
	"testing"
)

func TestAuthenticatedCloneURL(t *testing.T) {
	credential := &GitCredential{Token: "t0k/en", Username: "bot"}
	cases := []struct {
		name       string
		url        string
		credential *GitCredential
		want       string
	}{
		{"injects into https", "https://github.com/o/r.git", credential, "https://bot:t0k%2Fen@github.com/o/r.git"},
		{"injects into http", "http://git.local/r", credential, "http://bot:t0k%2Fen@git.local/r"},
		{"no credential", "https://github.com/o/r.git", nil, "https://github.com/o/r.git"},
		{"already carries one", "https://x:y@github.com/o/r.git", credential, "https://x:y@github.com/o/r.git"},
		{"not http", "git@github.com:o/r.git", credential, "git@github.com:o/r.git"},
		{"git protocol", "git://git.local/repo", credential, "git://git.local/repo"},
	}
	for _, testCase := range cases {
		if got := authenticatedCloneURL(testCase.url, testCase.credential); got != testCase.want {
			t.Errorf("%s: want %q, got %q", testCase.name, testCase.want, got)
		}
	}
}

func TestRedactCloneURLKeepsSecretsOutOfLogs(t *testing.T) {
	if got := redactCloneURL("https://bot:SECRET@github.com/o/r.git"); strings.Contains(got, "SECRET") {
		t.Errorf("a bare URL must be redacted, got %q", got)
	}
	message := "fatal: unable to access 'https://bot:SECRET@github.com/o/r.git/': denied"
	got := redactCloneURL(message)
	if strings.Contains(got, "SECRET") {
		t.Errorf("a URL inside an error message must be redacted too, got %q", got)
	}
	if !strings.Contains(got, "github.com/o/r.git") {
		t.Errorf("the rest of the message should survive, got %q", got)
	}
	if got := redactCloneURL("nothing to see"); got != "nothing to see" {
		t.Errorf("plain text should pass through, got %q", got)
	}
	if got := redactCloneURL(""); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestGitCheckoutSteps(t *testing.T) {
	branch := gitCheckoutSteps("https://x/r", "main", "/w/r")
	if len(branch) != 1 || strings.Join(branch[0], " ") != "clone --depth 1 --branch main --single-branch https://x/r /w/r" {
		t.Errorf("a branch is one shallow clone, got %v", branch)
	}

	sha := strings.Repeat("A", 40)
	steps := gitCheckoutSteps("https://x/r", sha, "/w/r")
	if len(steps) != 4 {
		t.Fatalf("a commit is init, remote, fetch, checkout, got %v", steps)
	}
	if strings.Join(steps[2], " ") != "-C /w/r fetch --depth 1 origin "+strings.ToLower(sha) {
		t.Errorf("the SHA is fetched lower-cased, got %v", steps[2])
	}
	if strings.Join(steps[3], " ") != "-C /w/r checkout --detach FETCH_HEAD" {
		t.Errorf("got %v", steps[3])
	}
}

func TestIsCommitSHAAndExtract(t *testing.T) {
	sha := "0123456789abcdef0123456789abcdef01234567"
	if !isCommitSHA(sha) || !isCommitSHA(" "+strings.ToUpper(sha)+" ") {
		t.Error("a full SHA in either case is a commit")
	}
	if isCommitSHA("main") || isCommitSHA(sha[:39]) {
		t.Error("a branch or a short SHA is not")
	}
	if got := extractCommitSHA("\x01\x00\x00\x00\x00\x00\x00\x29" + sha + "\n"); got != sha {
		t.Errorf("should read through a Docker frame header, got %q", got)
	}
	if got := extractCommitSHA("no commit here"); got != "" {
		t.Errorf("got %q", got)
	}
}
