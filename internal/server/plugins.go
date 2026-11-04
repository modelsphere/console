package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
)

type pluginManifest struct {
	ID     string   `json:"id"`
	Entry  string   `json:"entry"`
	Styles []string `json:"styles,omitempty"`
}

var pluginID = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)

func (s *Server) SetPluginsDir(dir string) error {
	if dir != "" {
		root, err := os.OpenRoot(dir)
		if err != nil {
			return fmt.Errorf("plugins directory %q: %w", dir, err)
		}
		root.Close()
	}
	s.pluginsDir = dir
	return nil
}

func validPluginPath(name string) bool {
	return name != "." && fs.ValidPath(name) && !strings.Contains(name, `\`)
}

func readPlugin(dir *os.Root, folder string) (pluginManifest, error) {
	var manifest pluginManifest
	if !pluginID.MatchString(folder) {
		return manifest, fmt.Errorf("directory name %q must be lowercase kebab-case", folder)
	}
	files := pluginFiles{dir.FS()}
	data, err := fs.ReadFile(files, "plugin.json")
	if err != nil {
		return manifest, fmt.Errorf("plugin.json: %w", err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, fmt.Errorf("plugin.json: %w", err)
	}
	if manifest.ID != folder {
		return manifest, fmt.Errorf("manifest id %q must match directory name %q", manifest.ID, folder)
	}
	for _, asset := range append([]string{manifest.Entry}, manifest.Styles...) {
		if !validPluginPath(asset) {
			return manifest, fmt.Errorf("asset %q must be a non-empty relative file path", asset)
		}
		if _, err := fs.Stat(files, asset); err != nil {
			return manifest, fmt.Errorf("asset %q: %w", asset, err)
		}
	}
	return manifest, nil
}

func (s *Server) installedPlugins() ([]pluginManifest, error) {
	plugins := make([]pluginManifest, 0)
	if s.pluginsDir == "" {
		return plugins, nil
	}
	root, err := os.OpenRoot(s.pluginsDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	folders, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		if !folder.IsDir() && folder.Type()&fs.ModeSymlink == 0 {
			continue
		}
		dir, err := root.OpenRoot(folder.Name())
		if err != nil {
			return nil, fmt.Errorf("plugin %q: %w", folder.Name(), err)
		}
		manifest, err := readPlugin(dir, folder.Name())
		dir.Close()
		if err != nil {
			return nil, fmt.Errorf("plugin %q: %w", folder.Name(), err)
		}
		prefix := "/plugins/" + folder.Name() + "/"
		manifest.Entry = (&url.URL{Path: prefix + manifest.Entry}).String()
		for i, style := range manifest.Styles {
			manifest.Styles[i] = (&url.URL{Path: prefix + style}).String()
		}
		plugins = append(plugins, manifest)
	}
	return plugins, nil
}

func (s *Server) handlePluginIndex(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	plugins, err := s.installedPlugins()
	if err != nil {
		s.log.Error("load installed plugins", "dir", s.pluginsDir, "error", err)
		writeError(w, http.StatusInternalServerError, "could not load installed plugins")
		return
	}
	writeJSON(w, http.StatusOK, plugins)
}

func (s *Server) handlePluginAsset(w http.ResponseWriter, r *http.Request) {
	id, asset := r.PathValue("id"), r.PathValue("asset")
	if s.pluginsDir == "" || !pluginID.MatchString(id) || !validPluginPath(asset) {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(s.pluginsDir)
	if err != nil {
		s.log.Error("open plugins directory", "dir", s.pluginsDir, "error", err)
		writeError(w, http.StatusInternalServerError, "could not load installed plugins")
		return
	}
	defer root.Close()
	dir, err := root.OpenRoot(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer dir.Close()
	if _, err := readPlugin(dir, id); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			http.NotFound(w, r)
			return
		}
		s.log.Error("load plugin assets", "plugin", id, "error", err)
		writeError(w, http.StatusInternalServerError, "could not load plugin assets")
		return
	}
	files := pluginFiles{dir.FS()}
	if _, err := fs.Stat(files, asset); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.StripPrefix("/plugins/"+id, http.FileServer(http.FS(files))).ServeHTTP(w, r)
}

type pluginFiles struct{ fs.FS }

func (f pluginFiles) Open(name string) (fs.File, error) {
	info, err := fs.Stat(f.FS, name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular file: %w", name, fs.ErrNotExist)
	}
	return f.FS.Open(name)
}

func pluginPaths(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reject traversal before ServeMux can redirect it into the SPA.
		if strings.HasPrefix(r.URL.Path, "/plugins/") && !validPluginPath(strings.TrimPrefix(r.URL.Path, "/plugins/")) {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}
