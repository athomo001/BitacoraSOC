package scheduler

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunTicksImmediatelyAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var calls atomic.Int32
	done := make(chan struct{})
	var once sync.Once
	go func() {
		Run(ctx, time.Millisecond, func(context.Context) error {
			if calls.Add(1) >= 2 {
				once.Do(func() { cancel(); close(done) })
			}
			return nil
		})
		once.Do(func() { close(done) })
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("scheduler did not tick")
	}
	if calls.Load() < 2 {
		t.Fatalf("calls = %d, want immediate and scheduled tick", calls.Load())
	}
}
