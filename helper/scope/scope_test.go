package scope

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestScopedFileOperations(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	tests := []struct {
		name  string
		input Request
		want  string
		fails bool
	}{
		{"unapproved", Request{Action: "write", Path: "report.txt", Content: "before"}, "", true},
		{"write", Request{Action: "write", Path: "notes/report.txt", Content: "before", Writable: true}, "", false},
		{"edit", Request{Action: "edit", Path: "notes/report.txt", OldText: "before", Content: "after", Writable: true}, "", false},
		{"read", Request{Action: "read", Path: "notes/report.txt", Limit: 32}, "after", false},
		{"read bound", Request{Action: "read", Path: "notes/report.txt", Limit: 2}, "", true},
		{"parent", Request{Action: "write", Path: "../report.txt", Writable: true}, "", true},
		{"alternate stream", Request{Action: "read", Path: "notes/report.txt:hidden", Limit: 32}, "", true},
		{"repository metadata", Request{Action: "write", Path: ".git/config", Content: "config", Writable: true}, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := execute(context.Background(), root, tt.input)
			if (got.Error != "") != tt.fails || string(got.Data) != tt.want {
				t.Errorf("got %+v, want data %q, error=%t", got, tt.want, tt.fails)
			}
		})
	}
	if got := execute(context.Background(), root, Request{Action: "ls", Path: "notes"}); len(got.Entries) != 1 || got.Entries[0] != "report.txt" {
		t.Errorf("unexpected entries: %+v", got)
	}
	if got := execute(context.Background(), root, Request{Action: "find", Path: ".", Pattern: "*.txt"}); len(got.Entries) != 1 || got.Entries[0] != "notes/report.txt" {
		t.Errorf("unexpected search: %+v", got)
	}
	if got := execute(context.Background(), root, Request{Action: "grep", Path: "notes", Pattern: "^after$"}); len(got.Matches) != 1 || got.Matches[0].Path != "notes/report.txt" || got.Matches[0].Line != 1 {
		t.Errorf("unexpected matches: %+v", got)
	}
}

func TestExternalLinksStayOutsideScope(t *testing.T) {
	dir, external := t.TempDir(), t.TempDir()
	secret := filepath.Join(external, "secret.txt")
	if err := os.WriteFile(secret, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	t.Run("hard link", func(t *testing.T) {
		if err := os.Link(secret, filepath.Join(dir, "hard")); err != nil {
			t.Fatal(err)
		}
		if got := execute(context.Background(), root, Request{Action: "read", Path: "hard", Limit: 32}); got.Error == "" {
			t.Fatal("read followed a hard link")
		}
		if got := execute(context.Background(), root, Request{Action: "write", Path: "hard", Content: "new", Writable: true}); got.Error != "" {
			t.Fatal(got.Error)
		}
	})
	t.Run("external directory link", func(t *testing.T) {
		if err := os.Symlink(external, filepath.Join(dir, "outside")); err != nil {
			t.Skip(err)
		}
		for _, action := range []string{"read", "write", "edit"} {
			got := execute(context.Background(), root, Request{Action: action, Path: "outside/secret.txt", Limit: 32, Writable: true})
			if got.Error == "" {
				t.Errorf("%s followed the external directory link", action)
			}
		}
	})
	if body, err := os.ReadFile(secret); err != nil || string(body) != "outside" {
		t.Fatalf("external file changed: %q, %v", body, err)
	}
}
