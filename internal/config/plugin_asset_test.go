package config

import "testing"

func TestValidPluginAsset(t *testing.T) {
	tests := []struct {
		name  string
		asset string
		want  bool
	}{
		{"entry", "index.umd.js", true},
		{"nested", "assets/app.css", true},
		{"deep", "a/b/c.js", true},
		{"empty", "", false},
		{"dot", ".", false},
		{"parent", "..", false},
		{"absolute", "/index.js", false},
		{"traversal", "../index.js", false},
		{"inner traversal", "a/../b.js", false},
		{"double slash", "a//b.js", false},
		{"backslash", `a\b.js`, false},
		{"query", "index.js?x=1", false},
		{"fragment", "index.js#top", false},
		{"percent", "index%2Ejs", false},
		{"scheme", "https:index.js", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ValidPluginAsset(test.asset); got != test.want {
				t.Fatalf("ValidPluginAsset(%q) = %v, want %v", test.asset, got, test.want)
			}
		})
	}
}
