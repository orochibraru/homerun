// Package imagescan executes image_scan jobs for the homerun worker: a Trivy
// vulnerability scan of a service's deployed image. Scan is also what a
// deploy's own scan step runs.
package imagescan

import (
	"context"
	"fmt"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs"
)

// Spec is what the app's prepare step resolves for one scan.
type Spec struct {
	Network string `json:"network"`
	Target  Target `json:"target"`
}

// Run scans the spec's target and returns {"summary": Summary}. A scanner
// failure is returned as the error, which the app records as a failed scan.
func Run(ctx context.Context, job jobs.Job) (map[string]any, error) {
	var spec Spec
	if err := job.DecodeSpec(&spec); err != nil {
		return nil, err
	}
	job.AppendLog("Scanning " + spec.Target.Ref + " for vulnerabilities...")
	summary, err := Scan(ctx, dockerapi.New(job.DockerSocket), job.DockerSocket, spec.Network, spec.Target)
	if err != nil {
		job.AppendLog("Image scan failed: " + err.Error())
		return nil, err
	}
	job.AppendLog("Image scanned: " + CountsLine(summary.Counts) + ".")
	return map[string]any{"summary": summary}, nil
}

// CountsLine formats counts like countsLine in src/lib/image-scan.ts.
func CountsLine(c Counts) string {
	return fmt.Sprintf("%d critical, %d high, %d medium, %d low, %d unknown", c.Critical, c.High, c.Medium, c.Low, c.Unknown)
}
