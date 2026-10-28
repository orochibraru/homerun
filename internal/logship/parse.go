package logship

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxLineBytes is the longest line stored; anything past it is cut.
const MaxLineBytes = 16 * 1024

// taskIDAttr is the detail a swarm service's log line names its task with.
const taskIDAttr = "com.docker.swarm.task.id"

// Chunk is a piece of one stream's output, as the daemon framed it.
type Chunk struct {
	Stream string
	Data   []byte
}

// ReadChunks reads a log stream, multiplexed or not, and calls emit with
// every piece of it. A container created with a TTY (every service Homerun
// deploys) has one raw stream with no frame headers, which is reported as
// stdout; a non-TTY one has 8-byte headers naming stdout or stderr, sniffed
// the same way dockerapi.DemuxAuto does.
func ReadChunks(stream io.Reader, emit func(Chunk)) error {
	reader := bufio.NewReaderSize(stream, 64*1024)
	header, err := reader.Peek(8)
	if len(header) == 0 {
		return ignoreEnd(err)
	}
	if !looksFramed(header) {
		buf := make([]byte, 32*1024)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				emit(Chunk{Stream: "stdout", Data: bytes.Clone(buf[:n])})
			}
			if err != nil {
				return ignoreEnd(err)
			}
		}
	}
	frame := make([]byte, 8)
	for {
		if _, err := io.ReadFull(reader, frame); err != nil {
			return ignoreEnd(err)
		}
		name := "stdout"
		if frame[0] == 2 {
			name = "stderr"
		}
		data := make([]byte, binary.BigEndian.Uint32(frame[4:]))
		if _, err := io.ReadFull(reader, data); err != nil {
			return ignoreEnd(err)
		}
		emit(Chunk{Stream: name, Data: data})
	}
}

// looksFramed reports whether these leading bytes are a Docker stream header.
func looksFramed(header []byte) bool {
	return len(header) >= 8 && header[0] <= 2 && header[1] == 0 && header[2] == 0 && header[3] == 0
}

// ignoreEnd treats a stream that simply ended as success.
func ignoreEnd(err error) error {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return nil
	}
	return err
}

// Splitter turns chunks into whole lines per stream, holding a partial line
// back until the rest of it arrives.
type Splitter struct {
	pending map[string][]byte
}

// Feed adds a chunk and calls emit with every line it completed, without its
// line ending.
func (s *Splitter) Feed(chunk Chunk, emit func(stream, line string)) {
	if s.pending == nil {
		s.pending = map[string][]byte{}
	}
	data := slices.Concat(s.pending[chunk.Stream], chunk.Data)
	for {
		end := bytes.IndexByte(data, '\n')
		if end < 0 {
			break
		}
		emit(chunk.Stream, string(bytes.TrimRight(data[:end], "\r")))
		data = data[end+1:]
	}
	if len(data) > 4*MaxLineBytes {
		emit(chunk.Stream, string(data))
		data = nil
	}
	s.pending[chunk.Stream] = bytes.Clone(data)
}

// Flush calls emit with every partial line still held, oldest stream first.
func (s *Splitter) Flush(emit func(stream, line string)) {
	streams := make([]string, 0, len(s.pending))
	for name, data := range s.pending {
		if len(data) > 0 {
			streams = append(streams, name)
		}
	}
	sort.Strings(streams)
	for _, name := range streams {
		emit(name, string(bytes.TrimRight(s.pending[name], "\r")))
	}
	s.pending = nil
}

// Parsed is one log line split into the parts the daemon prefixed it with.
type Parsed struct {
	Time   time.Time
	TaskID string
	Text   string
}

// ParseLine splits a line the daemon wrote with timestamps (and, for a swarm
// service, details) into its time, cut to the microsecond Postgres keeps, its
// task and its text. ok is false for a line that doesn't start with a
// timestamp.
func ParseLine(line string, details bool) (Parsed, bool) {
	stamp, rest, _ := strings.Cut(line, " ")
	at, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		return Parsed{}, false
	}
	parsed := Parsed{Text: rest, Time: at.UTC().Truncate(time.Microsecond)}
	if details {
		attrs, text, _ := strings.Cut(rest, " ")
		if strings.Contains(attrs, "=") {
			parsed.TaskID = detail(attrs, taskIDAttr)
			parsed.Text = text
		}
	}
	return parsed, true
}

// detail is one key's value out of the daemon's comma-separated, query-escaped
// key=value details, empty when it isn't there.
func detail(attrs, key string) string {
	for pair := range strings.SplitSeq(attrs, ",") {
		name, value, _ := strings.Cut(pair, "=")
		if unescaped, err := url.QueryUnescape(name); err == nil && unescaped == key {
			if v, err := url.QueryUnescape(value); err == nil {
				return v
			}
			return value
		}
	}
	return ""
}

// Clean makes a line storable: valid UTF-8, no NUL bytes (Postgres text
// refuses them), at most MaxLineBytes long.
func Clean(text string) string {
	text = strings.ToValidUTF8(text, "�")
	text = strings.ReplaceAll(text, "\x00", "")
	if len(text) <= MaxLineBytes {
		return text
	}
	cut := MaxLineBytes
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut]
}

// DeploymentAt is the deployment that was running at t: the latest one that
// started at or before it, else the first one, empty when there are none.
// deployments is sorted by start, oldest first.
func DeploymentAt(deployments []Deployment, t time.Time) string {
	if len(deployments) == 0 {
		return ""
	}
	index := sort.Search(len(deployments), func(i int) bool { return deployments[i].Since.After(t) })
	if index == 0 {
		return deployments[0].ID
	}
	return deployments[index-1].ID
}

// ShortID is a container or task id cut to the twelve characters Docker shows.
func ShortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
