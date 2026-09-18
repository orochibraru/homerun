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
)

// PartSize is how much of an upload is held in memory at once: one multipart
// part. S3 needs at least 5 MiB per part but the last, and allows 10000 parts.
const PartSize = 16 << 20

// Client is one bucket on one S3-compatible endpoint.
type Client struct {
	AccessKeyID     string `json:"accessKeyId"`
	Bucket          string `json:"bucket"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	SecretAccessKey string `json:"secretAccessKey"`

	HTTP *http.Client     `json:"-"`
	Now  func() time.Time `json:"-"`
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

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

func canonicalQuery(query url.Values) string {
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
	stringToSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest))}, "\n")
	key := hmacSHA256([]byte("AWS4"+secretAccessKey), dateStamp)
	key = hmacSHA256(key, region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	return hex.EncodeToString(hmacSHA256(key, stringToSign)), signedHeaders
}

func (c *Client) objectPath(key string) string {
	path := "/" + c.Bucket + "/" + key
	for strings.Contains(path, "//") {
		path = strings.ReplaceAll(path, "//", "/")
	}
	return escape(path, true)
}

func (c *Client) do(ctx context.Context, method, key string, query url.Values, body []byte) (*http.Response, error) {
	endpoint, err := url.Parse(strings.TrimRight(c.Endpoint, "/"))
	if err != nil {
		return nil, fmt.Errorf("invalid S3 endpoint %q: %w", c.Endpoint, err)
	}
	escapedPath := c.objectPath(key)
	canonical := canonicalQuery(query)
	target, err := url.Parse(endpoint.Scheme + "://" + endpoint.Host + escapedPath)
	if err != nil {
		return nil, err
	}
	target.RawQuery = canonical
	payloadHash := sha256Hex(body)
	amzDate := c.now().UTC().Format("20060102T150405Z")
	headers := map[string]string{
		"host":                 target.Host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date":           amzDate,
	}
	signature, signedHeaders := Signature(c.SecretAccessKey, c.Region, amzDate, method, escapedPath, canonical, headers, payloadHash)
	request, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.ContentLength = int64(len(body))
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
	return nil, fmt.Errorf("S3 %s failed: %s %s", method, response.Status, strings.TrimSpace(string(text)))
}

func (c *Client) send(ctx context.Context, method, key string, query url.Values, body []byte) (http.Header, []byte, error) {
	response, err := c.do(ctx, method, key, query, body)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(response.Body)
	return response.Header, raw, err
}

// Get opens key for reading. The caller closes the stream.
func (c *Client) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	response, err := c.do(ctx, http.MethodGet, key, nil, nil)
	if err != nil {
		return nil, err
	}
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

func (c *Client) uploadParts(ctx context.Context, key, uploadID string, buffer []byte, body io.Reader) (int64, error) {
	var parts []completedPart
	var total int64
	n := len(buffer)
	for number := 1; n > 0; number++ {
		header, _, err := c.send(ctx, http.MethodPut, key,
			url.Values{"partNumber": {strconv.Itoa(number)}, "uploadId": {uploadID}}, buffer[:n])
		if err != nil {
			return 0, err
		}
		parts = append(parts, completedPart{ETag: header.Get("ETag"), PartNumber: number})
		total += int64(n)
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
