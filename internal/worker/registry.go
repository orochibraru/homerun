package worker

import (
	"context"

	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/jobs/backup"
	"github.com/orochibraru/homerun/internal/jobs/cleanup"
	"github.com/orochibraru/homerun/internal/jobs/cronjob"
	"github.com/orochibraru/homerun/internal/jobs/deploy"
	"github.com/orochibraru/homerun/internal/jobs/imagescan"
)

// Executor runs one job and returns its result, stored as the row's
// executor_result for the TypeScript finalize step.
type Executor func(ctx context.Context, job jobs.Job) (map[string]any, error)

// Executors maps a job type to the executor that runs it.
var Executors = map[string]Executor{
	"backup":         backup.Run,
	"backup_restore": backup.Run,
	"cron_job":       cronjob.Run,
	"deploy":         deploy.Run,
	"docker_cleanup": cleanup.Run,
	"image_scan":     imagescan.Run,
}
