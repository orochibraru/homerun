package dockerapi

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
)

// Demux copies a multiplexed log stream into w, dropping the 8-byte frame
// header Docker puts in front of every stdout/stderr chunk of a non-TTY
// container. Both streams go to the same writer, in the order they arrived.
func Demux(stream io.Reader, w io.Writer) error {
	return DemuxSplit(stream, w, w)
}

// DemuxAuto copies a log stream into w, demultiplexing it only if it actually
// is multiplexed.
//
// Which it is depends on the container, not the endpoint: the daemon frames
// stdout and stderr separately for a normal container, but a container created
// with Tty (which every service Homerun deploys is, see
// containerCreateTemplate) gets one raw terminal stream with no headers at all.
// Running the frame decoder over that would eat eight bytes out of every
// "frame" it invented and hand back shredded output, so the first eight bytes
// are sniffed: a real header's first byte is a stream number (0, 1 or 2) and
// its next three are zero padding, which arbitrary terminal output only
// matches by accident.
func DemuxAuto(stream io.Reader, w io.Writer) error {
	header := make([]byte, 8)
	read, err := io.ReadFull(stream, header)
	if read > 0 && !looksFramed(header[:read]) {
		if _, writeErr := w.Write(header[:read]); writeErr != nil {
			return writeErr
		}
		if err != nil {
			return ignoreStreamEnd(err)
		}
		_, copyErr := io.Copy(w, stream)
		return ignoreStreamEnd(copyErr)
	}
	if err != nil {
		return ignoreStreamEnd(err)
	}
	return Demux(io.MultiReader(bytes.NewReader(header), stream), w)
}

// looksFramed reports whether these leading bytes are a Docker stream header.
func looksFramed(header []byte) bool {
	if len(header) < 8 {
		return false
	}
	return header[0] <= 2 && header[1] == 0 && header[2] == 0 && header[3] == 0
}

// ignoreStreamEnd treats a stream that simply ended as success.
func ignoreStreamEnd(err error) error {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return nil
	}
	return err
}

// DemuxSplit copies a multiplexed log stream like Demux, but keeps stdout and
// stderr apart, for a helper whose stdout is machine-readable output.
func DemuxSplit(stream io.Reader, stdout, stderr io.Writer) error {
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(stream, header); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
		target := stdout
		if header[0] == 2 {
			target = stderr
		}
		size := int64(binary.BigEndian.Uint32(header[4:]))
		if _, err := io.CopyN(target, stream, size); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}
