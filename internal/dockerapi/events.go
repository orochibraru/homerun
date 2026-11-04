package dockerapi

import (
	"context"
	"errors"
	"io"
	"strconv"
	"time"

	"github.com/moby/moby/client"
)

// Event is one daemon event, flattened to what a timeline shows.
type Event struct {
	Action   string `json:"action"`
	ExitCode string `json:"exitCode,omitempty"`
	ID       string `json:"id"`
	Image    string `json:"image,omitempty"`
	Name     string `json:"name,omitempty"`
	Time     int64  `json:"time"`
	Type     string `json:"type"`
}

// Events returns every event the daemon still holds from since until now,
// oldest first. The daemon only keeps its last few hundred, so a busy host's
// list starts later than since.
func (c *Client) Events(ctx context.Context, since time.Time) ([]Event, error) {
	ctx, cancel := context.WithTimeout(ctx, ControlTimeout)
	defer cancel()
	result := c.api.Events(ctx, client.EventsListOptions{
		Since: strconv.FormatInt(since.Unix(), 10),
		Until: strconv.FormatInt(time.Now().Unix(), 10),
	})
	events := []Event{}
	for {
		select {
		case message := <-result.Messages:
			events = append(events, Event{
				Action:   string(message.Action),
				ExitCode: message.Actor.Attributes["exitCode"],
				ID:       message.Actor.ID,
				Image:    message.Actor.Attributes["image"],
				Name:     message.Actor.Attributes["name"],
				Time:     message.TimeNano / int64(time.Millisecond),
				Type:     string(message.Type),
			})
		case err := <-result.Err:
			if err == nil || errors.Is(err, io.EOF) {
				return events, nil
			}
			return nil, err
		}
	}
}
