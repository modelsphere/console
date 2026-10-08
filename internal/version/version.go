// Package version carries the one version constant.
//
// In source rather than stamped by ldflags: `go build ./cmd/console` from
// anywhere then reports the truth, and a forgotten build flag cannot ship an
// image that calls itself "dev". hack/bump.sh moves this and Chart.yaml's
// appVersion together, and a test here refuses a commit where they disagree.
package version

const Version = "0.1.2"
