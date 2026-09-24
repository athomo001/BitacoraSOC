package scheduler

import (
	"context"
	"time"
)

// Run executes one scheduler tick immediately and then at the configured interval.
func Run(ctx context.Context, interval time.Duration, tick func(context.Context) error) {
	if interval <= 0 {
		interval = time.Minute
	}
	_ = tick(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = tick(ctx)
		}
	}
}
