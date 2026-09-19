package dockerapi

import (
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
