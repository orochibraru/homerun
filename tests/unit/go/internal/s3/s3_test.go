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
			if number == f.failAt {
				w.WriteHeader(http.StatusInternalServerError)
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
	fake := &fakeS3{objects: map[string][]byte{}, parts: map[int][]byte{}}
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
}

func TestGetMissingIsAnError(t *testing.T) {
	client, _ := newFake(t)
	if _, err := client.Get(context.Background(), "nope"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("err = %v", err)
	}
}
