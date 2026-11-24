package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/Inexplicable-YL/delion-bot/helper/scope"
)

func coversPath(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (s *server) handleScopedFile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Directory string
		scope.Request
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024*1024)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "请求体不是合法 JSON")
		return
	}
	root, err := requireAbsPath(input.Directory)
	if err == nil {
		root, err = filepath.EvalSymlinks(root)
	}
	home, homeErr := os.UserHomeDir()
	if err != nil || homeErr != nil {
		writeJSON(w, http.StatusOK, scope.Response{Error: "远程授权目录不可用"})
		return
	}
	helperDir := filepath.Join(home, ".delion-bot")
	if canonical, err := filepath.EvalSymlinks(helperDir); err == nil {
		helperDir = canonical
	}
	for _, denied := range []string{helperDir, "/dev", "/proc", "/sys", "/run"} {
		if coversPath(denied, root) || coversPath(root, denied) {
			writeJSON(w, http.StatusOK, scope.Response{Error: "远程授权目录不可用"})
			return
		}
	}
	writeJSON(w, http.StatusOK, scope.Run(r.Context(), root, input.Request))
}
