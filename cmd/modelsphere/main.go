package main

import (
	"fmt"
	"os"

	"github.com/modelsphere/console/internal/plugincli"
)

func main() {
	if err := plugincli.New().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "modelsphere: "+err.Error())
		os.Exit(1)
	}
}
