package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Inexplicable-YL/delion-bot/helper/scope"
)

func TestRemoteScopedFiles(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	project := filepath.Join(home, "project")
	if err := os.Mkdir(project, 0700); err != nil {
		t.Fatal(err)
	}
	call := func(directory string, input scope.Request) scope.Response {
		t.Helper()
		body, err := json.Marshal(struct {
			Directory string
			scope.Request
		}{directory, input})
		if err != nil {
			t.Fatal(err)
		}
		reply := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/fs/scoped", bytes.NewReader(body))
		(&server{}).handleScopedFile(reply, request)
		var result scope.Response
		if reply.Code != http.StatusOK || json.Unmarshal(reply.Body.Bytes(), &result) != nil {
			t.Fatalf("unexpected scoped response: %s", reply.Body)
		}
		return result
	}
	if got := call(home, scope.Request{Action: "ls", Path: "."}); got.Error == "" {
		t.Fatal("remote home must not include the helper state")
	}
	if got := call(project, scope.Request{Action: "write", Path: "note.txt", Content: "project", Writable: true}); got.Error != "" {
		t.Fatal(got.Error)
	}
	if got := call(project, scope.Request{Action: "read", Path: "note.txt", Limit: 20}); string(got.Data) != "project" {
		t.Fatalf("unexpected file: %+v", got)
	}
	if got := call(project, scope.Request{Action: "read", Path: "../outside", Limit: 20}); got.Error == "" {
		t.Fatal("remote tool read outside the registered project")
	}
}
