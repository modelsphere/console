package pluginpackage

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	maxFileBytes    = int64(64 << 20)
	maxTotalBytes   = int64(256 << 20)
	maxPackageBytes = int64(256 << 20)
)

// ChartMetadata is the subset of Chart.yaml needed by the plugin lifecycle.
type ChartMetadata struct {
	APIVersion string `yaml:"apiVersion"`
	Name       string `yaml:"name"`
	Version    string `yaml:"version"`
	Type       string `yaml:"type"`
}

// Artifact is an inspected directory or package that can be handed to Helm.
type Artifact struct {
	Input     string
	Directory bool
	Chart     ChartMetadata
	Manifest  Manifest
}

// Inspect reads only the package metadata and enforces bounded, regular files.
func Inspect(input string) (Artifact, error) {
	stat, err := os.Lstat(input)
	if err != nil {
		return Artifact{}, fmt.Errorf("inspect plugin %s: %w", input, err)
	}
	if stat.Mode()&os.ModeSymlink != 0 {
		return Artifact{}, fmt.Errorf("plugin input cannot be a symbolic link: %s", input)
	}
	if stat.IsDir() {
		return inspectDirectory(input)
	}
	if !stat.Mode().IsRegular() {
		return Artifact{}, fmt.Errorf("plugin input must be a directory or regular .tgz file")
	}
	return inspectArchive(input, stat.Size())
}

func inspectDirectory(input string) (Artifact, error) {
	files, err := boundedDirectory(input)
	if err != nil {
		return Artifact{}, err
	}
	chartData, ok := files["Chart.yaml"]
	if !ok {
		return Artifact{}, fmt.Errorf("Chart.yaml is missing from %s", input)
	}
	manifestData, ok := files["plugin.yaml"]
	if !ok {
		return Artifact{}, fmt.Errorf("plugin.yaml is missing from %s", input)
	}
	artifact, err := parseMetadata(input, true, chartData, manifestData)
	if err != nil {
		return Artifact{}, err
	}
	return artifact, nil
}

func inspectArchive(input string, packageSize int64) (Artifact, error) {
	if packageSize > maxPackageBytes {
		return Artifact{}, fmt.Errorf("plugin package exceeds 256 MiB")
	}
	file, err := os.Open(input)
	if err != nil {
		return Artifact{}, fmt.Errorf("open plugin package: %w", err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return Artifact{}, fmt.Errorf("open plugin package gzip stream: %w", err)
	}
	defer gzipReader.Close()
	reader := tar.NewReader(gzipReader)
	var chartData, manifestData []byte
	archiveRoot := ""
	hasArchiveRoot := false
	var total int64
	for {
		header, nextErr := reader.Next()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			return Artifact{}, fmt.Errorf("read plugin package: %w", nextErr)
		}
		name, err := safeArchiveName(header.Name)
		if err != nil {
			return Artifact{}, err
		}
		if header.Typeflag == tar.TypeDir {
			continue
		}
		relative, root, err := archiveRelativeName(name)
		if err != nil {
			return Artifact{}, err
		}
		if !hasArchiveRoot {
			archiveRoot = root
			hasArchiveRoot = true
		} else if archiveRoot != root {
			return Artifact{}, fmt.Errorf("plugin package contains multiple chart roots")
		}
		if header.Typeflag == tar.TypeSymlink || header.Typeflag == tar.TypeLink {
			return Artifact{}, fmt.Errorf("plugin package contains a link: %s", name)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		if header.Size < 0 || header.Size > maxFileBytes || total > maxTotalBytes-header.Size {
			return Artifact{}, fmt.Errorf("plugin package expansion exceeds limits")
		}
		data, err := readArchiveEntry(reader, header.Size, name)
		if err != nil {
			return Artifact{}, err
		}
		total += header.Size
		switch relative {
		case "Chart.yaml":
			chartData = data
		case "plugin.yaml":
			manifestData = data
		}
	}
	if chartData == nil || manifestData == nil {
		return Artifact{}, fmt.Errorf("plugin package must contain Chart.yaml and plugin.yaml in one chart root")
	}
	return parseMetadata(input, false, chartData, manifestData)
}

func boundedDirectory(root string) (map[string][]byte, error) {
	files := map[string][]byte{}
	var total int64
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("plugin directory contains a symbolic link: %s", path)
		}
		if entry.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("plugin directory contains a non-regular file: %s", path)
		}
		if info.Size() > maxFileBytes || total > maxTotalBytes-info.Size() {
			return fmt.Errorf("plugin directory exceeds file or expansion limits")
		}
		total += info.Size()
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if relative == "Chart.yaml" || relative == "plugin.yaml" {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			files[relative] = data
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("inspect plugin directory: %w", err)
	}
	return files, nil
}

func parseMetadata(input string, directory bool, chartData, manifestData []byte) (Artifact, error) {
	var chart ChartMetadata
	if err := yaml.Unmarshal(chartData, &chart); err != nil {
		return Artifact{}, fmt.Errorf("parse Chart.yaml: %w", err)
	}
	if !identifierPattern.MatchString(chart.Name) {
		return Artifact{}, fmt.Errorf("Chart.yaml name %q must be lowercase kebab-case", chart.Name)
	}
	if !semverPattern.MatchString(chart.Version) || (chart.Type != "" && chart.Type != "application") {
		return Artifact{}, fmt.Errorf("Chart.yaml must define an application with a SemVer version")
	}
	var manifest Manifest
	if err := yaml.Unmarshal(manifestData, &manifest); err != nil {
		return Artifact{}, fmt.Errorf("parse plugin.yaml: %w", err)
	}
	if err := manifest.Validate(); err != nil {
		return Artifact{}, fmt.Errorf("validate plugin.yaml: %w", err)
	}
	return Artifact{Input: input, Directory: directory, Chart: chart, Manifest: manifest}, nil
}

func readArchiveEntry(reader *tar.Reader, size int64, name string) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, size+1))
	if err != nil {
		return nil, fmt.Errorf("read plugin package entry %s: %w", name, err)
	}
	if int64(len(data)) != size {
		return nil, fmt.Errorf("plugin package entry %s is truncated", name)
	}
	return data, nil
}

func safeArchiveName(raw string) (string, error) {
	if raw == "" || strings.Contains(raw, "\\") || strings.HasPrefix(raw, "/") {
		return "", fmt.Errorf("plugin package contains unsafe path %q", raw)
	}
	for _, part := range strings.Split(raw, "/") {
		if part == ".." {
			return "", fmt.Errorf("plugin package contains unsafe path %q", raw)
		}
	}
	name := path.Clean(raw)
	if name == "." || strings.HasPrefix(name, "../") || name == ".." {
		return "", fmt.Errorf("plugin package contains unsafe path %q", raw)
	}
	return name, nil
}

func archiveRelativeName(name string) (string, string, error) {
	parts := strings.Split(name, "/")
	if len(parts) == 1 {
		return name, "", nil
	}
	root := parts[0]
	relative := strings.TrimPrefix(name, root+"/")
	if root == "" || relative == "" {
		return "", "", fmt.Errorf("plugin package contains an invalid chart root %q", name)
	}
	return relative, root, nil
}
