package cli

import (
	"bytes"
	"fmt"
	"io/fs"
	"mime/multipart"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	sourceMapBatchFiles = 100
	sourceMapBatchBytes = 40 << 20
)

var sourceMapColumns = []string{"release", "files", "size", "uploaded"}

// SourceMapRelease is one release a service has source maps for.
type SourceMapRelease struct {
	Files      int    `json:"files"`
	Release    string `json:"release"`
	SizeBytes  int64  `json:"sizeBytes"`
	UploadedAt string `json:"uploadedAt"`
}

// SourceMapFile is one .map file found for an upload: its path relative to
// the uploaded directory, which is the path the minified file is served at.
type SourceMapFile struct {
	Path string
	Rel  string
	Size int64
}

// FindSourceMaps lists every .map file under dir with its slash-separated
// path relative to dir.
func FindSourceMaps(dir string) ([]SourceMapFile, error) {
	var files []SourceMapFile
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".map") {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		files = append(files, SourceMapFile{Path: path, Rel: filepath.ToSlash(rel), Size: info.Size()})
		return nil
	})
	return files, err
}

// SourceMapBatches splits files into uploads of at most 100 files and about
// 40 MiB each, so no single request gets huge; a file bigger than that goes
// alone.
func SourceMapBatches(files []SourceMapFile) [][]SourceMapFile {
	var batches [][]SourceMapFile
	var current []SourceMapFile
	var size int64
	for _, file := range files {
		if len(current) > 0 && (len(current) >= sourceMapBatchFiles || size+file.Size > sourceMapBatchBytes) {
			batches = append(batches, current)
			current, size = nil, 0
		}
		current = append(current, file)
		size += file.Size
	}
	if len(current) > 0 {
		batches = append(batches, current)
	}
	return batches
}

// sourceMapForm is the multipart body of one batch: the release, then each
// map under a field named after its relative path.
func sourceMapForm(release string, files []SourceMapFile) ([]byte, string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("release", release); err != nil {
		return nil, "", err
	}
	for _, file := range files {
		content, err := os.ReadFile(file.Path)
		if err != nil {
			return nil, "", err
		}
		part, err := writer.CreateFormFile(file.Rel, filepath.Base(file.Path))
		if err != nil {
			return nil, "", err
		}
		if _, err := part.Write(content); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), writer.FormDataContentType(), nil
}

// SourceMapsUpload uploads every .map file under dir as release's maps, in
// batches, and prints how many went up.
func SourceMapsUpload(client *Client, serviceID, dir, release string) {
	files, err := FindSourceMaps(dir)
	if err != nil {
		Fail(err.Error())
	}
	if len(files) == 0 {
		Fail(fmt.Sprintf("No .map files under %s. Build with source maps on (e.g. `build.sourcemap: true` in Vite) first.", dir))
	}
	path := fmt.Sprintf("/services/%s/sourcemaps", url.PathEscape(serviceID))
	uploaded := 0
	for _, batch := range SourceMapBatches(files) {
		body, contentType, err := sourceMapForm(release, batch)
		if err != nil {
			Fail(err.Error())
		}
		var answer struct {
			Files []string `json:"files"`
		}
		client.decodeBody("POST", path, contentType, body, &answer)
		uploaded += len(answer.Files)
		fmt.Printf("Uploaded %d/%d maps\n", uploaded, len(files))
	}
	fmt.Printf("Release %s has its source maps: errors it reports from now on show the original source.\n", release)
}

// SourceMapsList prints the releases a service has maps for.
func SourceMapsList(client *Client, serviceID string, asJSON bool) {
	path := fmt.Sprintf("/services/%s/sourcemaps", url.PathEscape(serviceID))
	if asJSON {
		body, _ := client.do("GET", path, nil)
		PrintJSON(body)
		return
	}
	var releases []SourceMapRelease
	client.decode("GET", path, nil, &releases)
	rows := make([]map[string]string, 0, len(releases))
	for _, release := range releases {
		rows = append(rows, map[string]string{
			"files":    strconv.Itoa(release.Files),
			"release":  release.Release,
			"size":     fmt.Sprintf("%.1f MiB", float64(release.SizeBytes)/(1<<20)),
			"uploaded": release.UploadedAt,
		})
	}
	PrintTable(rows, sourceMapColumns)
}

// SourceMapsDelete deletes one release's maps.
func SourceMapsDelete(client *Client, serviceID, release string) {
	var answer struct {
		Deleted int `json:"deleted"`
	}
	client.decode("DELETE", fmt.Sprintf("/services/%s/sourcemaps", url.PathEscape(serviceID)), url.Values{"release": {release}}, &answer)
	fmt.Printf("Deleted %d maps of release %s.\n", answer.Deleted, release)
}
