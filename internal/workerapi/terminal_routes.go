package workerapi

import (
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/orochibraru/homerun/internal/httpapi"
)

// mountTerminal wires the web terminal routes.
//
// The session is opened, read, written and closed over four separate requests
// rather than one socket, because the app has no custom server to hang a
// WebSocket upgrade off. That shape is unchanged from the TypeScript terminal;
// what moved is where the shell actually lives.
func (s *Server) mountTerminal(r chi.Router) {
	r.Post("/v1/terminal", httpapi.H(s.openTerminal))
	r.Get("/v1/terminal/{id}", httpapi.H(s.describeTerminal))
	r.Get("/v1/terminal/{id}/stream", httpapi.H(s.streamTerminal))
	r.Post("/v1/terminal/{id}/input", httpapi.H(s.writeTerminal))
	r.Post("/v1/terminal/{id}/resize", httpapi.H(s.resizeTerminal))
	r.Delete("/v1/terminal/{id}", httpapi.H(s.closeTerminal))
}

// openTerminalBody names the container to open a shell in.
type openTerminalBody struct {
	Command     []string `json:"command"`
	ContainerID string   `json:"containerId"`
}

// openTerminal starts a shell and answers with the new session's id.
func (s *Server) openTerminal(w http.ResponseWriter, r *http.Request) error {
	var input openTerminalBody
	if !httpapi.DecodeJSON(w, r, &input) {
		return nil
	}
	if input.ContainerID == "" {
		return httpapi.Invalid(w, "Invalid request body",
			[]httpapi.ValidationIssue{{Message: "containerId is required", Path: []string{"containerId"}}})
	}
	id, err := s.terminals.Open(r.Context(), input.ContainerID, input.Command)
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]string{"sessionId": id})
}

// describeTerminal answers with the container a session runs in, which is what
// the app re-checks a session's ownership against before streaming it.
func (s *Server) describeTerminal(w http.ResponseWriter, r *http.Request) error {
	containerID, err := s.terminals.ContainerOf(chi.URLParam(r, "id"))
	if errors.Is(err, errNoSession) {
		return httpapi.Error(w, http.StatusNotFound, "That terminal session isn't open.")
	}
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]string{"containerId": containerID})
}

// streamTerminal is the session's long-lived output stream, one per reader.
// It ends when the shell exits, when the session is closed, or when the reader
// goes away.
func (s *Server) streamTerminal(w http.ResponseWriter, r *http.Request) error {
	chunks, unsubscribe, err := s.terminals.Subscribe(chi.URLParam(r, "id"))
	if errors.Is(err, errNoSession) {
		return httpapi.Error(w, http.StatusNotFound, "That terminal session isn't open.")
	}
	if err != nil {
		return err
	}
	defer unsubscribe()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(noDeadline)

	for {
		select {
		case <-r.Context().Done():
			return nil
		case chunk, open := <-chunks:
			if !open {
				return nil
			}
			if _, err := w.Write(chunk); err != nil {
				return nil
			}
			if err := controller.Flush(); err != nil {
				return nil
			}
		}
	}
}

// writeTerminal sends the raw request body to the session's stdin.
func (s *Server) writeTerminal(w http.ResponseWriter, r *http.Request) error {
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	err = s.terminals.Write(chi.URLParam(r, "id"), data)
	if errors.Is(err, errNoSession) {
		return httpapi.Error(w, http.StatusNotFound, "That terminal session isn't open.")
	}
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// resizeTerminalBody is the terminal's new size in character cells.
type resizeTerminalBody struct {
	Height int `json:"height"`
	Width  int `json:"width"`
}

// resizeTerminal tells the shell its window changed size.
func (s *Server) resizeTerminal(w http.ResponseWriter, r *http.Request) error {
	var input resizeTerminalBody
	if !httpapi.DecodeJSON(w, r, &input) {
		return nil
	}
	if input.Height <= 0 || input.Width <= 0 {
		return httpapi.Invalid(w, "Invalid request body", []httpapi.ValidationIssue{
			{Message: "height and width must be positive", Path: []string{}},
		})
	}
	err := s.terminals.Resize(r.Context(), chi.URLParam(r, "id"), input.Height, input.Width)
	if errors.Is(err, errNoSession) {
		return httpapi.Error(w, http.StatusNotFound, "That terminal session isn't open.")
	}
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// closeTerminal ends a session. Closing one already gone is a success: the
// caller wanted it shut, and it is.
func (s *Server) closeTerminal(w http.ResponseWriter, r *http.Request) error {
	if err := s.terminals.Close(chi.URLParam(r, "id")); err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}
