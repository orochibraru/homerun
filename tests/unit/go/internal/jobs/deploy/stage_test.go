package deploy_test

import (
	"testing"

	"github.com/orochibraru/homerun/internal/jobs/deploy"
)

func TestImageStageNamesTheTraceStage(t *testing.T) {
	cases := map[string]string{
		"agent-build":  "build",
		"docker-build": "build",
		"local-build":  "build",
		"pull":         "pull",
		"revision":     "revision",
	}
	for kind, want := range cases {
		if got := deploy.ImageStage(kind); got != want {
			t.Errorf("ImageStage(%q) = %q, want %q", kind, got, want)
		}
	}
}
