// Package web embeds the built SPA.
//
// `go build` works without a frontend build: dist is committed empty (a
// .gitkeep), FS reports that nothing was built, and console serves the API
// regardless -- the SPA routes answer 404 rather than a blank page. Run
// `npm run build` in web/, or start console with -web-dir to serve from disk.
//
// The build output itself is not committed: every UI change rewrites a dozen
// content-hashed filenames, and the Dockerfile replaces dist from its own web
// stage anyway, so a committed bundle is never the one that ships.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS returns the built site, or nil when nothing was built into this binary.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil
	}
	return sub
}
