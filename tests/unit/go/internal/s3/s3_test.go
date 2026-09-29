package s3_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/s3"
)

func TestSignatureMatchesAWSExample(t *testing.T) {
	signature, signed := s3.Signature(
		"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", "20130524T000000Z",
		"GET", "/test.txt", "",
		map[string]string{
			"host":                 "examplebucket.s3.amazonaws.com",
			"range":                "bytes=0-9",
			"x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			"x-amz-date":           "20130524T000000Z",
		},
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	)
	if signature != "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41" {
		t.Fatalf("signature = %s", signature)
	}
	if signed != "host;range;x-amz-content-sha256;x-amz-date" {
		t.Fatalf("signed headers = %s", signed)
	}
}

type fakeS3 struct {
	mu      sync.Mutex
	objects map[string][]byte
	parts   map[int][]byte
	aborted bool
	failAt  int
	flaky   int
	tries   map[int]int
}

func init() {
	s3.RetryDelay = func(int) time.Duration { return 0 }
}

// handler is the fake S3 endpoint's HTTP handler, verifying every request's
// signature before serving it.
func (f *fakeS3) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		headers := map[string]string{
			"host":                 r.Host,
			"x-amz-content-sha256": r.Header.Get("x-amz-content-sha256"),
			"x-amz-date":           r.Header.Get("x-amz-date"),
		}
		want, _ := s3.Signature("secret", "us-east-1", headers["x-amz-date"], r.Method, r.URL.EscapedPath(),
			s3.CanonicalQuery(r.URL.Query()), headers, s3.SHA256Hex(body))
		if !strings.HasSuffix(r.Header.Get("Authorization"), "Signature="+want) {
			t.Errorf("bad signature on %s %s", r.Method, r.URL)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		query := r.URL.Query()
		switch {
		case r.Method == http.MethodPost && query.Has("uploads"):
			fmt.Fprint(w, "<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>")
		case r.Method == http.MethodPut && query.Has("partNumber"):
			number, _ := strconv.Atoi(query.Get("partNumber"))
			f.tries[number]++
			if number == f.failAt && (f.flaky == 0 || f.tries[number] <= f.flaky) {
				w.WriteHeader(http.StatusGatewayTimeout)
				return
			}
			f.parts[number] = body
			w.Header().Set("ETag", fmt.Sprintf(`"etag-%d"`, number))
		case r.Method == http.MethodPost && query.Has("uploadId"):
			numbers := make([]int, 0, len(f.parts))
			for number := range f.parts {
				numbers = append(numbers, number)
			}
			sort.Ints(numbers)
			var joined []byte
			for _, number := range numbers {
				joined = append(joined, f.parts[number]...)
			}
			f.objects[r.URL.Path] = joined
			fmt.Fprint(w, "<CompleteMultipartUploadResult/>")
		case r.Method == http.MethodDelete:
			f.aborted = true
		case r.Method == http.MethodPut:
			f.objects[r.URL.Path] = body
		case r.Method == http.MethodGet:
			object, ok := f.objects[r.URL.Path]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write(object)
		}
	}
}

// newFake starts a fake S3 server and returns a client pointed at it.
func newFake(t *testing.T) (*s3.Client, *fakeS3) {
	fake := &fakeS3{objects: map[string][]byte{}, parts: map[int][]byte{}, tries: map[int]int{}}
	server := httptest.NewServer(fake.handler(t))
	t.Cleanup(server.Close)
	return &s3.Client{
		AccessKeyID: "key", Bucket: "bucket", Endpoint: server.URL, Region: "us-east-1", SecretAccessKey: "secret",
		Now: func() time.Time { return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC) },
	}, fake
}

func TestUploadSmallIsOnePut(t *testing.T) {
	client, fake := newFake(t)
	size, err := client.Upload(context.Background(), "prefix/vol 1+x.tar.gz", strings.NewReader("hello"))
	if err != nil || size != 5 {
		t.Fatalf("size=%d err=%v", size, err)
	}
	if got := string(fake.objects["/bucket/prefix/vol 1+x.tar.gz"]); got != "hello" {
		t.Fatalf("stored %q", got)
	}
	stream, err := client.Get(context.Background(), "prefix/vol 1+x.tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if got, _ := io.ReadAll(stream); string(got) != "hello" {
		t.Fatalf("got %q", got)
	}
}

func TestUploadLargeIsMultipart(t *testing.T) {
	client, fake := newFake(t)
	data := make([]byte, 2*s3.PartSize+123)
	_, _ = rand.Read(data)
	size, err := client.Upload(context.Background(), "big.tar.gz", bytes.NewReader(data))
	if err != nil || size != int64(len(data)) {
		t.Fatalf("size=%d err=%v", size, err)
	}
	if len(fake.parts) != 3 || !bytes.Equal(fake.objects["/bucket/big.tar.gz"], data) {
		t.Fatalf("parts=%d, reassembled object differs", len(fake.parts))
	}
}

func TestUploadAbortsOnFailedPart(t *testing.T) {
	client, fake := newFake(t)
	fake.failAt = 2
	if _, err := client.Upload(context.Background(), "big.tar.gz", bytes.NewReader(make([]byte, s3.PartSize+1))); err == nil {
		t.Fatal("expected an error")
	}
	if !fake.aborted {
		t.Fatal("multipart upload wasn't aborted")
	}
	if fake.tries[2] != s3.RequestAttempts {
		t.Fatalf("part 2 sent %d times, want %d", fake.tries[2], s3.RequestAttempts)
	}
}

func TestUploadRetriesAFlakyPart(t *testing.T) {
	client, fake := newFake(t)
	var logged []string
	client.Log = func(line string) { logged = append(logged, line) }
	fake.failAt, fake.flaky = 2, 2
	data := make([]byte, s3.PartSize+1)
	size, err := client.Upload(context.Background(), "big.tar.gz", bytes.NewReader(data))
	if err != nil || size != int64(len(data)) || fake.aborted {
		t.Fatalf("size=%d err=%v aborted=%v", size, err, fake.aborted)
	}
	if retries := strings.Count(strings.Join(logged, "\n"), "retrying"); retries != 2 {
		t.Fatalf("logged %d retries: %v", retries, logged)
	}
}

func TestUploadDoesNotRetryAClientError(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(server.Close)
	client := &s3.Client{Bucket: "bucket", Endpoint: server.URL, Region: "us-east-1"}
	if _, err := client.Upload(context.Background(), "x", strings.NewReader("x")); err == nil || calls != 1 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}

func TestUploadTimesOutASilentEndpoint(t *testing.T) {
	previous := s3.RequestTimeout
	s3.RequestTimeout = 50 * time.Millisecond
	t.Cleanup(func() { s3.RequestTimeout = previous })
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(release); server.Close() })
	client := &s3.Client{Bucket: "bucket", Endpoint: server.URL, Region: "us-east-1"}
	_, err := client.Upload(context.Background(), "x", strings.NewReader("x"))
	if err == nil || !strings.Contains(err.Error(), "no answer within") {
		t.Fatalf("err = %v", err)
	}
}

func TestGetMissingIsAnError(t *testing.T) {
	client, _ := newFake(t)
	if _, err := client.Get(context.Background(), "nope"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("err = %v", err)
	}
}

func TestUploadSendsPartsConcurrently(t *testing.T) {
	var mu sync.Mutex
	inFlight, peak := 0, 0
	parts := map[string][]byte{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		query := r.URL.Query()
		switch {
		case query.Has("uploads"):
			fmt.Fprint(w, "<InitiateMultipartUploadResult><UploadId>up</UploadId></InitiateMultipartUploadResult>")
		case query.Has("partNumber"):
			mu.Lock()
			inFlight++
			peak = max(peak, inFlight)
			mu.Unlock()
			time.Sleep(50 * time.Millisecond)
			mu.Lock()
			inFlight--
			parts[query.Get("partNumber")] = body
			mu.Unlock()
			w.Header().Set("ETag", `"e"`)
		default:
			fmt.Fprint(w, "<CompleteMultipartUploadResult/>")
		}
	}))
	t.Cleanup(server.Close)
	client := &s3.Client{Bucket: "b", Endpoint: server.URL, Region: "us-east-1"}
	data := make([]byte, 6*s3.PartSize+7)
	_, _ = rand.Read(data)
	size, err := client.Upload(context.Background(), "big", bytes.NewReader(data))
	if err != nil || size != int64(len(data)) {
		t.Fatalf("size=%d err=%v", size, err)
	}
	if peak < 2 || peak > s3.UploadConcurrency {
		t.Fatalf("peak parts in flight = %d, want 2..%d", peak, s3.UploadConcurrency)
	}
	var joined []byte
	for i := 1; i <= len(parts); i++ {
		joined = append(joined, parts[strconv.Itoa(i)]...)
	}
	if !bytes.Equal(joined, data) {
		t.Fatal("parts don't reassemble into the upload")
	}
}

func TestPartSizeGrowsToStayUnderThePartLimit(t *testing.T) {
	if s3.PartSizeFor(1) != s3.PartSize || s3.PartSizeFor(s3.PartsPerStep) != s3.PartSize {
		t.Fatal("the first step should use PartSize")
	}
	if s3.PartSizeFor(s3.PartsPerStep+1) != 2*s3.PartSize {
		t.Fatal("the second step should double")
	}
	if s3.PartSizeFor(10_000) != s3.MaxPartSize {
		t.Fatalf("part 10000 is %d, want the cap", s3.PartSizeFor(10_000))
	}
	var total int64
	for number := 1; number <= 10_000; number++ {
		total += int64(s3.PartSizeFor(number))
	}
	if total < 200<<30 {
		t.Fatalf("10000 parts only hold %d GiB", total>>30)
	}
}
