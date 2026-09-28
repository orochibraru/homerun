// Package s3 is a minimal S3-compatible object storage client (AWS S3, MinIO,
// R2, Backblaze B2...) signed with AWS Signature V4 by hand, covering what
// Homerun's backups need: streaming multipart uploads and streaming downloads.
// Path-style addressing (bucket in the path) is used, which both AWS and MinIO
// accept.
package s3

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/activity"
)

// PartSize is how much of an upload is held in memory at once: one multipart
// part. S3 needs at least 5 MiB per part but the last, and allows 10000 parts.
const PartSize = 16 << 20

// RequestTimeout caps one buffered request (a single PUT, one part, a
// multipart start or completion), so an endpoint that stops answering fails
// that request instead of holding the job forever.
var RequestTimeout = 10 * time.Minute

// RequestAttempts is how many times a buffered request is sent before its
// error is returned: a transport error, a timeout, a 429 or a 5xx is retried.
const RequestAttempts = 3

// RetryDelay is the pause before retry n (1-based), doubling from 2s.
var RetryDelay = func(n int) time.Duration { return time.Duration(1<<n) * time.Second }

// progressEvery is the minimum gap between two upload progress lines.
const progressEvery = 30 * time.Second

// Client is one bucket on one S3-compatible endpoint.
type Client struct {
	AccessKeyID     string `json:"accessKeyId"`
	Bucket          string `json:"bucket"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	SecretAccessKey string `json:"secretAccessKey"`

	HTTP *http.Client     `json:"-"`
	Log  func(string)     `json:"-"`
	Now  func() time.Time `json:"-"`
}

// StatusError is a non-2xx answer from the endpoint.
type StatusError struct {
	Code    int
	Message string
}

// Error renders the status and the body S3 sent back.
func (e *StatusError) Error() string { return e.Message }

// log hands line to c.Log when set.
func (c *Client) log(line string) {
	if c.Log != nil {
		c.Log(line)
	}
}

// retryable reports whether a failed request is worth sending again.
func retryable(err error) bool {
	var status *StatusError
	if errors.As(err, &status) {
		return status.Code == http.StatusTooManyRequests || status.Code >= 500
	}
	return true
}

// httpClient returns c.HTTP, or http.DefaultClient when unset.
func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

// now returns c.Now(), or time.Now() when unset.
func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// hmacSHA256 computes the HMAC-SHA256 of data keyed by key.
func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

// SHA256Hex hex-encodes the SHA-256 digest of data.
func SHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// escape percent-encodes s for AWS Signature V4, keeping slashes intact when
// keepSlash is set.
func escape(s string, keepSlash bool) string {
	var b strings.Builder
	for i := range len(s) {
		ch := s[i]
		switch {
		case ch >= 'A' && ch <= 'Z', ch >= 'a' && ch <= 'z', ch >= '0' && ch <= '9',
			ch == '-', ch == '_', ch == '.', ch == '~', keepSlash && ch == '/':
			b.WriteByte(ch)
		default:
			fmt.Fprintf(&b, "%%%02X", ch)
		}
	}
	return b.String()
}

// CanonicalQuery renders query in AWS Signature V4's canonical form.
func CanonicalQuery(query url.Values) string {
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		for _, value := range query[key] {
			parts = append(parts, escape(key, false)+"="+escape(value, false))
		}
	}
	return strings.Join(parts, "&")
}

// Signature computes an AWS Signature V4 for an S3 request. headers are the
// lowercase header names and values to sign, host included.
func Signature(secretAccessKey, region, amzDate, method, canonicalURI, query string, headers map[string]string, payloadHash string) (signature, signedHeaders string) {
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, name := range names {
		canonicalHeaders.WriteString(name + ":" + strings.TrimSpace(headers[name]) + "\n")
	}
	signedHeaders = strings.Join(names, ";")
	canonicalRequest := strings.Join([]string{method, canonicalURI, query, canonicalHeaders.String(), signedHeaders, payloadHash}, "\n")
	dateStamp := amzDate[:8]
	scope := dateStamp + "/" + region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, SHA256Hex([]byte(canonicalRequest))}, "\n")
	key := hmacSHA256([]byte("AWS4"+secretAccessKey), dateStamp)
	key = hmacSHA256(key, region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	return hex.EncodeToString(hmacSHA256(key, stringToSign)), signedHeaders
}

// objectPath is key's escaped, slash-collapsed path within c.Bucket.
func (c *Client) objectPath(key string) string {
	path := "/" + c.Bucket + "/" + key
	for strings.Contains(path, "//") {
		path = strings.ReplaceAll(path, "//", "/")
	}
	return escape(path, true)
}

// do sends one signed S3 request and returns the raw response, or an error
// for a non-2xx status.
func (c *Client) do(ctx context.Context, method, key string, query url.Values, body []byte) (*http.Response, error) {
	endpoint, err := url.Parse(strings.TrimRight(c.Endpoint, "/"))
	if err != nil {
		return nil, fmt.Errorf("invalid S3 endpoint %q: %w", c.Endpoint, err)
	}
	escapedPath := c.objectPath(key)
	canonical := CanonicalQuery(query)
	target, err := url.Parse(endpoint.Scheme + "://" + endpoint.Host + escapedPath)
	if err != nil {
		return nil, err
	}
	target.RawQuery = canonical
	payloadHash := SHA256Hex(body)
	amzDate := c.now().UTC().Format("20060102T150405Z")
	headers := map[string]string{
		"host":                 target.Host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date":           amzDate,
	}
	signature, signedHeaders := Signature(c.SecretAccessKey, c.Region, amzDate, method, escapedPath, canonical, headers, payloadHash)
	var payload io.Reader = http.NoBody
	if len(body) > 0 {
		payload = activity.Reader(ctx, bytes.NewReader(body))
	}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), payload)
	if err != nil {
		return nil, err
	}
	request.ContentLength = int64(len(body))
	if len(body) > 0 {
		request.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
	}
	request.Header.Set("x-amz-content-sha256", payloadHash)
	request.Header.Set("x-amz-date", amzDate)
	request.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s/%s/s3/aws4_request, SignedHeaders=%s, Signature=%s",
		c.AccessKeyID, amzDate[:8], c.Region, signedHeaders, signature))
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	defer func() { _ = response.Body.Close() }()
	text, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	return nil, &StatusError{Code: response.StatusCode, Message: fmt.Sprintf("S3 %s failed: %s %s", method, response.Status, strings.TrimSpace(string(text)))}
}

// send is do plus reading the response body fully, each attempt capped at
// RequestTimeout and a retryable failure sent again up to RequestAttempts
// times, every retry logged.
func (c *Client) send(ctx context.Context, method, key string, query url.Values, body []byte) (http.Header, []byte, error) {
	var err error
	for attempt := 1; ; attempt++ {
		var header http.Header
		var raw []byte
		header, raw, err = c.sendOnce(ctx, method, key, query, body)
		if err == nil {
			return header, raw, nil
		}
		if ctx.Err() != nil || attempt >= RequestAttempts || !retryable(err) {
			return nil, nil, err
		}
		delay := RetryDelay(attempt)
		c.log(fmt.Sprintf("S3 %s %s failed (attempt %d/%d), retrying in %s: %s", method, describe(query), attempt, RequestAttempts, delay, err))
		select {
		case <-ctx.Done():
			return nil, nil, err
		case <-time.After(delay):
		}
	}
}

// sendOnce is one attempt of send.
func (c *Client) sendOnce(ctx context.Context, method, key string, query url.Values, body []byte) (http.Header, []byte, error) {
	attemptCtx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()
	response, err := c.do(attemptCtx, method, key, query, body)
	if err == nil {
		defer func() { _ = response.Body.Close() }()
		var raw []byte
		raw, err = io.ReadAll(response.Body)
		if err == nil {
			return response.Header, raw, nil
		}
	}
	if errors.Is(attemptCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
		return nil, nil, fmt.Errorf("S3 %s %s got no answer within %s: %w", method, describe(query), RequestTimeout, err)
	}
	return nil, nil, err
}

// describe names a request by its query, for a log line: which part, or the
// multipart start/completion.
func describe(query url.Values) string {
	switch {
	case query.Has("partNumber"):
		return "part " + query.Get("partNumber")
	case query.Has("uploads"):
		return "multipart start"
	case query.Has("uploadId"):
		return "multipart completion"
	default:
		return "object"
	}
}

// MiB renders a byte count in MiB.
func MiB(n int64) string {
	return fmt.Sprintf("%.1f MiB", float64(n)/(1<<20))
}

// Get opens key for reading. The caller closes the stream.
func (c *Client) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	response, err := c.do(ctx, http.MethodGet, key, nil, nil)
	if err != nil {
		return nil, err
	}
	response.Body = progressBody{Reader: activity.Reader(ctx, response.Body), Closer: response.Body}
	return response.Body, nil
}

// Upload streams body to key and returns how many bytes it stored. At most one
// PartSize chunk is held in memory: a body that fits in one is a single PUT,
// anything larger a multipart upload, aborted if any part fails.
func (c *Client) Upload(ctx context.Context, key string, body io.Reader) (int64, error) {
	first := make([]byte, PartSize)
	n, err := io.ReadFull(body, first)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return 0, err
	}
	if n < PartSize {
		if _, _, err := c.send(ctx, http.MethodPut, key, nil, first[:n]); err != nil {
			return 0, err
		}
		return int64(n), nil
	}
	c.log(fmt.Sprintf("Archive is over %s, uploading it in parts", MiB(PartSize)))
	uploadID, err := c.startMultipart(ctx, key)
	if err != nil {
		return 0, err
	}
	total, err := c.uploadParts(ctx, key, uploadID, first, body)
	if err != nil {
		abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		_, _, _ = c.send(abortCtx, http.MethodDelete, key, url.Values{"uploadId": {uploadID}}, nil)
		return 0, err
	}
	return total, nil
}

// startMultipart initiates a multipart upload for key and returns its upload id.
func (c *Client) startMultipart(ctx context.Context, key string) (string, error) {
	_, raw, err := c.send(ctx, http.MethodPost, key, url.Values{"uploads": {""}}, nil)
	if err != nil {
		return "", err
	}
	var started struct {
		UploadID string `xml:"UploadId"`
	}
	if err := xml.Unmarshal(raw, &started); err != nil || started.UploadID == "" {
		return "", fmt.Errorf("S3 didn't return an upload id: %s", strings.TrimSpace(string(raw)))
	}
	return started.UploadID, nil
}

type completedPart struct {
	ETag       string `xml:"ETag"`
	PartNumber int    `xml:"PartNumber"`
}

// uploadParts uploads buffer, then the rest of body, as successive parts of
// uploadID, and completes the multipart upload.
func (c *Client) uploadParts(ctx context.Context, key, uploadID string, buffer []byte, body io.Reader) (int64, error) {
	var parts []completedPart
	var total int64
	started := time.Now()
	lastLog := started
	n := len(buffer)
	for number := 1; n > 0; number++ {
		header, _, err := c.send(ctx, http.MethodPut, key,
			url.Values{"partNumber": {strconv.Itoa(number)}, "uploadId": {uploadID}}, buffer[:n])
		if err != nil {
			return 0, fmt.Errorf("part %d (after %s uploaded): %w", number, MiB(total), err)
		}
		parts = append(parts, completedPart{ETag: header.Get("ETag"), PartNumber: number})
		total += int64(n)
		if time.Since(lastLog) >= progressEvery {
			lastLog = time.Now()
			elapsed := time.Since(started)
			c.log(fmt.Sprintf("Uploaded %s in %d parts (%s/s over %s)", MiB(total), number,
				MiB(int64(float64(total)/elapsed.Seconds())), elapsed.Round(time.Second)))
		}
		var readErr error
		n, readErr = io.ReadFull(body, buffer)
		if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) && !errors.Is(readErr, io.EOF) {
			return 0, readErr
		}
	}
	complete, err := xml.Marshal(struct {
		XMLName xml.Name        `xml:"CompleteMultipartUpload"`
		Parts   []completedPart `xml:"Part"`
	}{Parts: parts})
	if err != nil {
		return 0, err
	}
	_, raw, err := c.send(ctx, http.MethodPost, key, url.Values{"uploadId": {uploadID}}, complete)
	if err != nil {
		return 0, err
	}
	if bytes.Contains(raw, []byte("<Error>")) {
		return 0, fmt.Errorf("S3 couldn't complete the upload: %s", strings.TrimSpace(string(raw)))
	}
	return total, nil
}

type progressBody struct {
	io.Reader
	io.Closer
}
