package config

import (
	"io/fs"
	"strings"
)

// ValidPluginAsset limits a plugin asset to a relative path inside the
// release's frontend files: no absolute paths, traversal, escapes or query
// syntax.
func ValidPluginAsset(asset string) bool {
	return asset != "." && fs.ValidPath(asset) && !strings.ContainsAny(asset, `\?#%:`)
}
